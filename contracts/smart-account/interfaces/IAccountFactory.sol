// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IAccountFactory {
    // Errors
    error FailedDeployAccount();

    // Events
    event AccountCreated(address indexed signer, address indexed accountAddress);

    /**
     * @notice Create a new account and return its address.
     * @param recover Address of the account recovery.
     * @param entryPoint Address of the account recovery.
     * @param messageHash Hash of the message being signed.
     * @param r ECDSA signature parameter r.
     * @param s ECDSA signature parameter s.
     * @return accountAddress The address of the created account.
     */
    function createAccount(
        address recover, 
        address entryPoint,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s
    ) external returns (address accountAddress);

    function computeAddress(address recover, address signer, address entryPoint, uint256 salt) external view returns (address);

    function getAccounts(address signer) external view returns (address[] memory);
}
