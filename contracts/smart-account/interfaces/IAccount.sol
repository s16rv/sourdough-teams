// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../util/Authorization.sol";

interface IAccount {
    /**
     * @dev Error thrown when the signature is invalid.
     */
    error InvalidSignature();
    /**
     * @dev Error thrown when the threshold is invalid.
     */
    error InvalidThreshold();
    /**
     * @dev Error thrown when the public key is invalid.
     */
    error InvalidPubKey();
    /**
     * @dev Error thrown when a call is made by an unauthorized address.
     */
    error NotEntryPointOrRecover();

    /**
     * @dev Error thrown when the source address is invalid.
     */
    error InvalidSourceAddress();

    /**
     * @dev Error thrown when the proof is invalid.
     */
    error InvalidProof();

    /**
     * @dev Error thrown when the authorization provided for a transaction is invalid.
     */
    error InvalidAuthorization();

    /**
     * @dev Error thrown when the sequence number is invalid.
     */
    error InvalidSequence();

    /**
     * @dev Error thrown when the input length is invalid.
     */
    error InvalidInputLength();

    /**
     * @dev Error thrown when the operation is not executable.
     */
    error NotExecutable();

    /**
     * @dev Error thrown when the payload format is invalid.
     */
    error InvalidPayload();

    /**
     * @dev Event emitted when the account is initialized.
     * @param verifier The verifier address of the account.
     */
    event AccountInitialized(address indexed verifier);

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
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param messageHash The hash of the message to be validated.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param proof The proof of the transaction.
     * @param sequence The sequence number of the transaction.
     * @param data The data to pass to the destination contract.
     * @return bool indicating whether the signature is valid.
     */
    function validateOperation(
        string calldata sourceAddress,
        bytes32 messageHash,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 proof,
        uint64 sequence,
        bytes calldata data
    ) external view returns (bool, string memory);

    /**
     * @dev Executes a transaction to a specified destination address.
     * @param destList The list of destination addresses of the transactions.
     * @param valueList The list of amounts of Ether to send.
     * @param dataList The list of data to pass to the destinations.
     * @return bool indicating whether the transaction was successful.
     */
    function executeTransactions(
        address[] calldata destList,
        uint256[] calldata valueList,
        bytes[] calldata dataList
    ) external returns (bool);

    /**
     * @dev Recovers a transaction by validating the provided signature and executing the transaction if valid.
     * @param r Part of the signature (r) from secp256k1 signature.
     * @param s Part of the signature (s) from secp256k1 signature.
     * @param x Part of the public key (x) that signed the message.
     * @param y Part of the public key (y) that signed the message.
     * @param txPayload The transaction payload containing the sequence, destination address, value, and data from recoverProposal.
     * @return A boolean indicating whether the transaction was successfully recovered.
     */
    function recoverTransaction(
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes calldata txPayload
    ) external returns (bool);

    /**
     * @dev Payload template for recoverTransaction txPayload.
     * @param sequence The sequence number of the transaction.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether to send with the transaction.
     * @param data The data to pass to the destination contract.
     */
    function recoverProposal(uint64 sequence, address dest, uint256 value, bytes calldata data) external;

    /**
     * @dev The fallback function to allow the contract to receive Ether.
     */
    receive() external payable;
}
