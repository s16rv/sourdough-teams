// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IAccountFactory {
    /**
     * @dev Error thrown when the threshold is invalid.
     */
    error InvalidThreshold();
    /**
     * @dev Error thrown when the signature is invalid.
     */
    error InvalidSignature();

    /**
     * @dev Error thrown when the account deployment fails.
     */
    error FailedDeployAccount();

    /**
     * @dev Error thrown when the authorization provided for a transaction is invalid.
     */
    error InvalidAuthorization();

    /**
     * @dev Creates a new account contract using the provided parameters and deploys it using CREATE2.
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
    ) external returns (address);

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
    ) external view returns (address);

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
    ) external view returns (address);
}