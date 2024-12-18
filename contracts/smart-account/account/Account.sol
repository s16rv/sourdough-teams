// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../interfaces/IAccount.sol";
import "../util/SignatureVerifier.sol";
import "../EntryPoint.sol";

contract Account is IAccount {
    address public immutable recover;
    address private immutable verifier;
    EntryPoint private immutable entryPoint;
    bytes32 private immutable x;
    bytes32 private immutable y;
    bytes32 private immutable addrHash;

    /**
     * @dev Constructor that initializes the contract with the recover address, signer address, and entry point address.
     * Emits an `AccountInitialized` event.
     * @param _verifierAddr The address of the secp256k1 verifier contract.
     * @param _recoverAddr The address that has the authority to recover the account.
     * @param _entryPointAddr The address of the entry point contract.
     * @param _x The x part of the public key.
     * @param _y The y part of the public key.
     * @param _addrHash The hash of address on the source chain where the transaction originated.
     */
    constructor(
        address _verifierAddr,
        address _recoverAddr,
        address _entryPointAddr,
        bytes32 _x,
        bytes32 _y,
        bytes32 _addrHash
    ) {
        verifier = _verifierAddr;
        recover = _recoverAddr;
        entryPoint = EntryPoint(_entryPointAddr);
        x = _x;
        y = _y;
        addrHash = _addrHash;

        emit AccountInitialized(verifier);
    }

    /**
     * @dev Modifier that restricts function access to the EntryPoint or the recover address.
     * Reverts if called by any other address.
     */
    modifier onlyEntryPointOrRecover() {
        if (!(msg.sender == address(entryPoint) || msg.sender == recover)) {
            revert NotEntryPointOrRecover();
        }
        _;
    }

    /**
     * @dev Internal function that performs a low-level call to the target contract with specified value and data.
     * Reverts if the call fails.
     * @param target The address of the contract to call.
     * @param value The amount of Ether to send with the call.
     * @param data The data to pass to the target contract.
     * @return success A boolean indicating whether the call was successful.
     */
    function _call(
        address target,
        uint256 value,
        bytes memory data
    ) internal returns (bool) {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return success;
    }

    /**
     * @dev Validates an operation by verifying the provided signature against the stored signer.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param messageHash The hash of the message to be validated.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param proof The proof of the transaction.
     * @param data The data to pass to the destination contract.
     * @return A boolean indicating whether the signature is valid.
     */
    function validateOperation(
        string calldata sourceAddress,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        bytes calldata data
    ) external view returns (bool) {
        if (!compareSourceAddress(sourceAddress)) {
            revert InvalidSourceAddress();
        }

        bytes32 expectedProof = sha256(abi.encodePacked(messageHash, data));
        if (proof != expectedProof) {
            revert InvalidProof();
        }

        return SignatureVerifier.verifySignature(verifier, messageHash, r, s, x, y);
    }

    /**
     * @dev Allows the contract to execute arbitrary transactions, restricted to the recover address or EntryPoint.
     * Emits a `TransactionExecuted` event.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether to send with the transaction.
     * @param data The data to pass to the destination contract.
     * @return success A boolean indicating whether the transaction was successful.
     */
    function executeTransaction(
        address dest,
        uint256 value,
        bytes calldata data
    ) external onlyEntryPointOrRecover returns (bool) {
        bool success = _call(dest, value, data);
        emit TransactionExecuted(dest, value, data);
        return success;
    }

    /**
     * @dev Returns the verifier address.
     * @return The address of the verifier.
     */
    function getVerifier() public view returns (address) {
        return verifier;
    }

    /**
     * @dev Returns the x part of the public key.
     * @return The x part of the public key.
     */
    function getX() public view returns (bytes32) {
        return x;
    }

    /**
     * @dev Returns the y part of the public key.
     * @return The y part of the public key.
     */
    function getY() public view returns (bytes32) {
        return y;
    }

    /**
     * @dev Compares the source address with the stored source address hash.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return A boolean indicating whether the source address matches the stored hash.
     */
    function compareSourceAddress(string calldata sourceAddress) public view returns (bool) {
        return addrHash == keccak256(abi.encodePacked(sourceAddress));
    }

    /**
     * @dev Allows the contract to receive Ether.
     * The fallback function to handle incoming Ether.
     */
    receive() external payable {}
}
