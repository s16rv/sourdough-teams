// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEntryPoint {
    /**
     * @dev Error thrown when a zero address is provided.
     */
    error ZeroAddress();

    /**
     * @dev Error thrown when caller is not the owner.
     */
    error OnlyOwner();

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
     * @dev Error thrown when the execution of a transaction fails with a custom reason.
     * @param reason The custom reason for the transaction failure.
     */
    error TransactionError(string reason);

    /**
     * @dev Error thrown when the authorization provided for a transaction is invalid.
     */
    error InvalidAuthorization();

    /**
     * @dev Error thrown when the caller is not the MPCGateway.
     */
    error NotMPCGateway();

    /**
     * @dev Error thrown when a multi-payload array is malformed or inconsistent.
     */
    error InvalidPayloadArray();

    /**
     * @dev Error thrown when the target account is not a known account.
     */
    error InvalidTargetAccount();

    /**
     * @dev Error thrown when the chain ID in the payload doesn't match expected.
     */
    error InvalidChainId();

    /**
     * @dev Event emitted when an account is created.
     * @param accountAddress The address of the newly created account.
     */
    event AccountCreated(address indexed accountAddress);

    /**
     * @dev Event emitted when a routing account is created.
     * @param routingAccountAddress The address of the newly created routing account.
     * @param routingKeyAddress The bonded routing key address.
     */
    event RoutingAccountCreated(address indexed routingAccountAddress, address indexed routingKeyAddress);

    /**
     * @dev Event emitted when a transaction is successfully executed.
     * @param target The target account address.
     * @param sequence The sequence number of the transaction.
     */
    event TransactionHandled(address indexed target, uint256 indexed sequence);

    /**
     * @dev Event emitted when a signature is validated successfully.
     * @param messageHash The hash of the message used for signature validation.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     */
    event SignatureValidated(bytes32 indexed messageHash, bytes32[] indexed r, bytes32[] indexed s);

    /**
     * @dev Event emitted when a cross-chain transaction is executed successfully.
     * @param sourceChain The blockchain from which the transaction originated.
     * @param sourceAddress The address on the source chain that initiated the transaction.
     */
    event Executed(string sourceChain, string sourceAddress);

    /**
     * @dev Debug event emitted when validation fails, containing the reason.
     * @param reason The reason for validation failure.
     */
    event DebugReason(string reason);

    /**
     * @dev Event emitted when the MPCGateway address is updated.
     * @param oldMPCGateway The previous MPCGateway address.
     * @param newMPCGateway The new MPCGateway address.
     */
    event MPCGatewayUpdated(address oldMPCGateway, address newMPCGateway);

    /**
     * @notice Executes a payload on the destination chain.
     * @dev This function is called by the MPCGateway on the destination chain to execute a payload.
     * It verifies the caller is the MPCGateway and then calls the internal `_execute` function.
     * @param _sourceChain The blockchain where the transaction originated.
     * @param _sourceAddress The address on the source chain where the transaction originated.
     * @param _payload The encoded GMP (General Message Passing) message sent from the source chain.
     */
    function executePayload(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) external returns (bool);

    /**
     * @notice Sets the MPCGateway address.
     * @dev Only the owner can set the MPCGateway address.
     * @param _mpcGateway The address of the MPCGateway contract.
     */
    function setMPCGateway(address _mpcGateway) external;
}
