// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../util/Authorization.sol";

interface IAccount {
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
     * @param data The data to pass to the destination contract.
     * @return bool indicating whether the signature is valid.
     */
    function validateOperation(
        string calldata sourceAddress,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        bytes calldata data
    ) external view returns (bool);

    /**
     * @dev Executes a transaction to a specified destination address.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether to send.
     * @param data The data to pass to the destination.
     * @return bool indicating whether the transaction was successful.
     */
    function executeTransaction(address dest, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev The fallback function to allow the contract to receive Ether.
     */
    receive() external payable;

    /**
     * @dev Returns the stored contract information.
     * @return cAddress The contract address.
     * @return cValue The contract value.
     * @return cData The contract data.
     * @return cExpTs The expiration time.
     * @return cStatus The status.
     * @return cAuthorization The authorization.
     */
    function getStoredContract()
        external
        returns (
            address cAddress,
            uint256 cValue,
            bytes memory cData,
            uint256 cExpTs,
            Authorization.Status cStatus,
            bytes memory cAuthorization
        );

    /**
     * @dev Compares the source address with the stored source address hash.
     * @param cAddress The contract address stored on chain to be executed later.
     * @param cValue The contract value stored on chain to be executed later.
     * @param cData The contract data stored on chain to be executed later.
     * @param cExpTs The contract expiration time stored on chain to be executed later.
     * @param authPayload The authorization payload, can be empty
     */
    function createStoredContract(
        address cAddress,
        uint256 cValue,
        bytes calldata cData,
        uint32 cExpTs,
        bytes calldata authPayload
    ) external;

    /**
     * @dev Validates an operation by verifying the provided authorization against the stored data.
     * @param cAddress The contract address.
     * @param cValue The contract value.
     * @param cData The contract data.
     * @return A boolean indicating whether the authorization is valid.
     */
    function validateAuthorization(address cAddress, uint256 cValue, bytes calldata cData) external returns (bool);

    /**
     * @dev Compares the source address with the stored source address hash.
     */
    function revokeStoredContract() external;
}
