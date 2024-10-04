// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IAccountFactory {

    /**
     * @dev Error thrown when the account deployment fails.
     */
    error FailedDeployAccount();

    /**
     * @dev Event emitted when a new account is created.
     * @param signer The address of the signer who owns the account.
     * @param accountAddress The address of the newly created account.
     */
    event AccountCreated(address indexed signer, address indexed accountAddress);

    /**
     * @dev Creates a new account contract using the provided parameters and deploys it using CREATE2.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param messageHash The hash of the message to verify the signer's identity.
     * @param r The r part of the signature.
     * @param s The s part of the signature.
     * @return accountAddress The address of the newly created account contract.
     */
    function createAccount(
        address recover, 
        address entryPoint,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s
    ) external returns (address);

    /**
     * @dev Computes the address of an account contract that would be deployed using CREATE2, without actually deploying it.
     * @param recover The address with recovery rights for the account.
     * @param signer The address of the signer for the account.
     * @param entryPoint The address of the entry point contract.
     * @param salt The salt used for deterministic contract deployment with CREATE2.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address recover,
        address signer,
        address entryPoint,
        uint256 salt
    ) external view returns (address);

    /**
     * @dev Returns the list of accounts created by a particular signer.
     * @param signer The address of the signer whose accounts to retrieve.
     * @return An array of account addresses created by the signer.
     */
    function getAccounts(address signer) external view returns (address[] memory);
}
