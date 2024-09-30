// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IAccountFactory {
    // Events
    event AccountCreated(address indexed owner, address indexed accountAddress);

    /**
     * @notice Create a new account and return its address.
     * @param recoveryAddress Address of the account recovery.
     * @param salt A unique value used to ensure determinacy of the account address.
     * @return accountAddress The address of the created account.
     */
    function createAccount(address recoveryAddress, uint256 salt) external returns (address accountAddress);
}
