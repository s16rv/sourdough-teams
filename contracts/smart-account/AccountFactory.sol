// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IAccountFactory.sol";
import "./util/SignatureVerifier.sol";
import "./account/Account.sol";

contract AccountFactory is IAccountFactory {
    mapping(bytes32 => address) private account;
    address private immutable verifier;

    /**
     * @dev Constructor that initializes the contract with the secp256k1 verifier address.
     * @param _verifierAddr The address of the secp256k1 verifier contract.
     */
    constructor(address _verifierAddr) {
        verifier = _verifierAddr;
    }

    /**
     * @dev Creates a new account contract using a signature for verification.
     *      The account is deployed using the CREATE2 opcode for address predictability.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param threshold The threshold of the account.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly created account contract.
     */
    function createAccount(
        address recover,
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        uint256 threshold,
        string calldata sourceAddress
    ) external returns (address) {
        if (threshold == 0 || threshold > x.length) revert InvalidThreshold();

        bytes32 addrHash = keccak256(abi.encodePacked(sourceAddress));
        address accAddr = _deployAccount(recover, entryPoint, x, y, addrHash, threshold);

        // Store the new account
        storeAccount(x, y, addrHash, accAddr, threshold);

        return accAddr;
    }

    /**
     * @dev Deploys the account contract using the CREATE2 opcode for address predictability.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly deployed account contract.
     */
    function _deployAccount(
        address recover,
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint256 threshold
    ) internal returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(verifier, recover, entryPoint, x, y, addrHash, threshold)
        );

        // Use CREATE2 to deploy the contract with the provided salt
        address accountAddress;
        assembly {
            accountAddress := create2(0, add(bytecode, 0x20), mload(bytecode), addrHash)
        }

        if (accountAddress == address(0)) revert FailedDeployAccount();

        return accountAddress;
    }

    /**
     * @dev Computes the address of an account contract to be deployed using CREATE2, without actually deploying it.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @param threshold The threshold of the account.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address recover,
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint256 threshold
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(verifier, recover, entryPoint, x, y, addrHash, threshold)
        );
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), addrHash, keccak256(bytecode)));
        return address(uint160(uint256(hash)));
    }

    /**
     * @dev Returns the list of accounts created by a particular signer.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @return An account address created by the signer.
     */
    function getAccount(
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint256 threshold
    ) external view returns (address) {
        bytes32 key = keccak256(abi.encodePacked(x, y, addrHash, threshold));
        return account[key];
    }

    function storeAccount(
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        address accAddr,
        uint256 threshold
    ) internal {
        bytes32 key = keccak256(abi.encodePacked(x, y, addrHash, threshold));
        account[key] = accAddr;
    }
}
