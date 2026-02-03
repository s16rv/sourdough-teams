// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

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
    error NotEntryPoint();

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
     * @dev Error thrown when public key array lengths don't match.
     */
    error InvalidPubKeyLength();

    /**
     * @dev Error thrown when signature array lengths don't match.
     */
    error InvalidSignatureLength();

    /**
     * @dev Error thrown when duplicate public keys are provided.
     */
    error DuplicatePubKey();

    /**
     * @dev Error thrown when the operation is not executable.
     */
    error NotExecutable();

    /**
     * @dev Error thrown when the payload format is invalid.
     */
    error InvalidPayload();

    /**
     * @dev Error thrown when the hash offset in signBytes is invalid.
     */
    error InvalidHashOffset();

    /**
     * @dev Error thrown when the hex prefix is invalid (not "0x").
     */
    error InvalidHexPrefix();

    /**
     * @dev Error thrown when an invalid hex character is encountered.
     */
    error InvalidHexCharacter();

    /**
     * @dev Error thrown when the hash commitment verification fails.
     */
    error InvalidHashCommitment();

    /**
     * @dev Event emitted when the account is initialized.
     * @param verifier The verifier address of the account.
     */
    event AccountInitialized(address indexed verifier);

    /**
     * @dev Event emitted when a transaction is executed by the account.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether sent.
     * @param data The data sent with the transaction.
     */
    event TransactionExecuted(address indexed dest, uint256 value, bytes data);

    /**
     * @dev Validates an operation by verifying the provided signatures over signBytes.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param signBytes The AMINO_JSON message that was signed.
     * @param txPayloadHashOffset The offset to the hash in signBytes (points to "0x" prefix).
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param x Part of the public key (x).
     * @param y Part of the public key (y).
     * @param sequence The sequence number of the transaction.
     * @param txPayload The transaction payload containing chainId, accountAddress, sequence, and calls.
     * @return bool indicating whether the signature is valid.
     * @return string reason for failure (empty if valid).
     */
    function validateOperation(
        string calldata sourceAddress,
        bytes calldata signBytes,
        uint256 txPayloadHashOffset,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 sequence,
        bytes calldata txPayload
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
     * @dev The fallback function to allow the contract to receive Ether.
     */
    receive() external payable;
}
