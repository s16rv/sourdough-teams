// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IEntryPoint {
    /**
     * @dev Error thrown when the payload for a transaction is too short.
     */
    error PayloadTooShort();

    /**
     * @dev Error thrown when an unsupported category is encountered in the payload.
     */
    error UnsupportedCategory();

    /**
     * @dev Error thrown when the signature provided for a transaction is invalid.
     */
    error InvalidSignature();

    /**
     * @dev Error thrown when the execution of a transaction fails.
     */
    error TransactionFailed();

    /**
     * @dev Error thrown when the authorization provided for a transaction is invalid.
     */
    error InvalidAuthorization();

    /**
     * @dev Event emitted when an account is created.
     * @param accountAddress The address of the newly created account.
     * @param recover The address that has recovery rights for the new account.
     */
    event AccountCreated(address indexed accountAddress, address indexed recover);

    /**
     * @dev Event emitted when a transaction is successfully executed.
     * @param target The target account address.
     * @param dest The destination address for the transaction.
     * @param value The amount of Ether sent in the transaction.
     * @param data The payload data for the transaction.
     */
    event TransactionHandled(address indexed target, address indexed dest, uint256 value, bytes data);

    /**
     * @dev Event emitted when a signature is validated successfully.
     * @param messageHash The hash of the message used for signature validation.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     */
    event SignatureValidated(bytes32 indexed messageHash, bytes32 indexed r, bytes32 indexed s);

    /**
     * @dev Event emitted when a cross-chain transaction is executed successfully.
     * @param sourceChain The blockchain from which the transaction originated.
     * @param sourceAddress The address on the source chain that initiated the transaction.
     */
    event Executed(string sourceChain, string sourceAddress);
}
