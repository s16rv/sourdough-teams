// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../interfaces/IAccount.sol";
import "../util/SignatureVerifier.sol";
import "../EntryPoint.sol";

contract Account is IAccount, SignatureVerifier {
    address public recover;
    address public immutable signer;
    EntryPoint public immutable entryPoint;

    uint8 private constant SIGNATURE_V = 27;

    /**
     * @dev Constructor that initializes the contract with the recover address, signer address, and entry point address.
     * Emits an `AccountInitialized` event.
     * @param _recoverAddr The address that has the authority to recover the account.
     * @param _signerAddr The address of the signer responsible for validating operations.
     * @param _entryPointAddr The address of the entry point contract.
     */
    constructor(
        address _recoverAddr,
        address _signerAddr,
        address _entryPointAddr
    ) {
        recover = _recoverAddr;
        signer = _signerAddr;
        entryPoint = EntryPoint(_entryPointAddr);

        emit AccountInitialized(_recoverAddr, signer);
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
     * @dev Allows the recover address or EntryPoint to change the recover address.
     * Emits a `RecoverChanged` event.
     * @param newRecover The new recover address to be set.
     */
    function changeRecover(address newRecover) public onlyEntryPointOrRecover {
        emit RecoverChanged(recover, newRecover);
        recover = newRecover;
    }

    /**
     * @dev Validates an operation by verifying the provided signature against the stored signer.
     * @param messageHash The hash of the message to be validated.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @return A boolean indicating whether the signature is valid.
     */
    function validateOperation(
        bytes32 messageHash,
        bytes32 r,
        bytes32 s
    ) external view returns (bool) {
        return verifySignature(messageHash, r, s, SIGNATURE_V, signer);
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
     * @dev Returns the signer address.
     * @return The address of the signer.
     */
    function getSigner() public view returns (address) {
        return signer;
    }

    /**
     * @dev Allows the contract to receive Ether.
     * The fallback function to handle incoming Ether.
     */
    receive() external payable {}
}
