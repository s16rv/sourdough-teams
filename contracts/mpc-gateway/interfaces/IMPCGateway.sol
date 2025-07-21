// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IMPCGateway {
    /**
     * @dev Error thrown when the transaction has already been executed.
     */
    error TransactionAlreadyExecuted();

    /**
     * @dev Error thrown when the transaction has not been approved.
     */
    error TransactionNotApproved();

    /**
     * @dev Error thrown when the transaction execution failed.
     */
    error TransactionFailed();

    /**
     * @notice Approves the execution of a contract call on the destination chain.
     * @dev This function is called by the relayer on the source chain to approve the execution of a contract call on the destination chain.
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationAddress Address of the contract to call on the destination chain
     * @param txHash Hash of the transaction
     */
    event ContractCallApproved(
        string sourceChain,
        string sourceAddress,
        address destinationAddress,
        bytes32 txHash
    );

    /**
     * @notice Executes a contract call on the destination chain.
     * @dev This function is called by the relayer on the destination chain to execute a contract call.
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationAddress Address of the contract to call on the destination chain
     * @param txHash Hash of the transaction
     */
    event ContractCallExecuted(
        string sourceChain,
        string sourceAddress,
        address destinationAddress,
        bytes32 txHash
    );
    
    /**
     * @notice Emitted when a contract call is being executed.
     * @dev This event is emitted at the beginning of the executeContractCall function.
     * @param mpcSignatureR The r component of the MPC signature
     * @param mpcSignatureS The s component of the MPC signature
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationAddress Address of the contract to call on the destination chain
     */
    event ContractCallExecuting(
        bytes32 mpcSignatureR,
        bytes32 mpcSignatureS,
        string sourceChain,
        string sourceAddress,
        address destinationAddress
    );
    
    /**
     * @notice Debug event emitted with the transaction hash.
     * @param txHash Hash of the transaction
     */
    event DebugTxHash(bytes32 txHash);
    
    /**
     * @notice Debug event emitted with the approval status.
     * @param isApproved Whether the transaction is approved
     */
    event DebugIsApproved(bool isApproved);
    
    /**
     * @notice Debug event emitted with the execution success status.
     * @param success Whether the execution was successful
     */
    event DebugSuccess(bool success);

    struct ContractCallParams {
        string sourceChain; // Identifier of the chain where the transaction originated
        string sourceAddress; // Address of the sender on the source chain
        string destinationChain; // Identifier of the target chain
        address destinationAddress; // Address of the contract to call on the destination chain
        bytes payload; // Encoded call data to be executed (Hex bytes)
    }

    /**
     * @notice Executes a contract call on the destination chain.
     * @dev This function is called by the relayer on the destination chain to execute a contract call.
     * @param mpcSignatureR Signature from the MPC service (Hex bytes)
     * @param mpcSignatureS Signature from the MPC service (Hex bytes)
     * @param params ContractCallParams struct containing the parameters for the contract call
     */
    function executeContractCall(
        bytes32 mpcSignatureR, // Signature from the MPC service (Hex bytes)
        bytes32 mpcSignatureS, // Signature from the MPC service (Hex bytes)
        ContractCallParams calldata params
    ) external;
}