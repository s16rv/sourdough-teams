// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IAccount {
    
    /**
     * @dev Error thrown when a call is made by an unauthorized address.
     */
    error NotEntryPointOrRecover();

    /**
     * @dev Event emitted when the account is initialized.
     * @param recover The recover address of the account.
     * @param signer The signer address associated with the account.
     */
    event AccountInitialized(address indexed recover, address indexed signer);

    /**
     * @dev Event emitted when the recover address is changed.
     * @param oldRecover The previous recover address.
     * @param newRecover The new recover address.
     */
    event RecoverChanged(address indexed oldRecover, address indexed newRecover);

    /**
     * @dev Event emitted when a transaction is executed by the account.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether sent.
     * @param data The data sent with the transaction.
     */
    event TransactionExecuted(address indexed dest, uint256 value, bytes data);

    /**
     * @dev Validates an operation by verifying the provided signature.
     * @param messageHash The hash of the message to be validated.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @return bool indicating whether the signature is valid.
     */
    function validateOperation(
        bytes32 messageHash,
        bytes32 r,
        bytes32 s
    ) external view returns (bool);

    /**
     * @dev Executes a transaction to a specified destination address.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether to send.
     * @param data The data to pass to the destination.
     * @return bool indicating whether the transaction was successful.
     */
    function executeTransaction(
        address dest,
        uint256 value,
        bytes calldata data
    ) external returns (bool);

    /**
     * @dev The fallback function to allow the contract to receive Ether.
     */
    receive() external payable;
}
