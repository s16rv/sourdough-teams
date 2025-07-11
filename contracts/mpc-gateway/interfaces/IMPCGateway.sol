// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IMPCGateway {
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