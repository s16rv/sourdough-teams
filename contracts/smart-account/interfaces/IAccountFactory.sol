// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IAccountFactory {

    /**
     * @dev Error thrown when the signature is invalid.
     */
    error InvalidSignature();

    /**
     * @dev Error thrown when the account deployment fails.
     */
    error FailedDeployAccount();

    /**
     * @dev Creates a new account contract using the provided parameters and deploys it using CREATE2.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param messageHash The hash of the message to verify the signer's identity.
     * @param r The r part of the signature.
     * @param s The s part of the signature.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly created account contract.
     */
    function createAccount(
        address recover, 
        address entryPoint,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y,
        string calldata sourceAddress
    ) external returns (address);

    /**
     * @dev Computes the address of an account contract that would be deployed using CREATE2, without actually deploying it.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address recover,
        address entryPoint,
        bytes32 x,
        bytes32 y,
        string calldata sourceAddress
    ) external view returns (address);

    /**
     * @dev Returns the account address for a given public key and salt.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return The address of the account.
     */
    function getAccount(
        bytes32 x,
        bytes32 y,
        string calldata sourceAddress
    ) external view returns (address);
}
