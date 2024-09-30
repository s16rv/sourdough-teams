// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IAccount {
    // Events
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event TransactionExecuted(address indexed dest, uint256 value, bytes data);
    event AccountInitialized(address indexed owner, address indexed signer);

    /**
     * @notice Validate an operation by checking the signature.
     * @param messageHash Hash of the message being signed.
     * @param r ECDSA signature parameter r.
     * @param s ECDSA signature parameter s.
     * @return True if the signature is valid, false otherwise.
     */
    function validateOperation(bytes32 messageHash, bytes32 r, bytes32 s) external view returns (bool);

    /**
     * @notice Execute a transaction on behalf of the account.
     * @param dest Address of the contract or recipient.
     * @param value Amount of Ether to send.
     * @param data Calldata to execute the transaction.
     * @return True if the transaction is successful, false otherwise.
     */
    function executeTransaction(address dest, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @notice Receive Ether into the contract.
     * @dev This function allows the contract to accept Ether.
     */
    receive() external payable;
}
