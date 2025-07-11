// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IMPCGateway {
    event ContractCallApproved(
        string sourceChain,
        string sourceAddress,
        address destinationAddress,
        bytes32 txHash
    );

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

    function executeContractCall(
        bytes32 mpcSignatureR, // Signature from the MPC service (Hex bytes)
        bytes32 mpcSignatureS, // Signature from the MPC service (Hex bytes)
        ContractCallParams calldata params
    ) external;
}