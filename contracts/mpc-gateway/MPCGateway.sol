// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IMPCGateway.sol";
import "./interfaces/IMPCVerifier.sol";
import "../smart-account/interfaces/IEntryPoint.sol";

contract MPCGateway is IMPCGateway {
    mapping(bytes32 => bool) private executedCalls;

    IMPCVerifier private verifier;
    address private ownerAddress;

    constructor(address _ownerAddress, address _verifierAddress) {
        ownerAddress = _ownerAddress;
        verifier = IMPCVerifier(_verifierAddress);
    }

    // Approve a cross-chain contract call
    function _approveContractCall(
        bytes32 txHash,
        bytes32 r,
        bytes32 s,
        ContractCallParams calldata params
    ) internal returns (bool) {
        // Call Verifier to validate MPC signature
        bool isValidSignature = verifier.validateMPCSignature(txHash, r, s);
        if (!isValidSignature) {
            return false;
        }

        // Emit ContractCallApproved event
        emit ContractCallApproved(
            params.sourceChain,
            params.sourceAddress,
            params.destinationAddress,
            txHash
        );

        return true;
    }

    // Execute a contract call (called by relayer)
    function executeContractCall(
        bytes32 mpcSignatureR,
        bytes32 mpcSignatureS,
        ContractCallParams calldata params
    ) public {
        bytes32 txHash = generateTxHash(params);

        // Check if already executed to prevent replay attacks
        if (executedCalls[txHash]) {
            revert("Transaction already executed");
        }

        // Ensure transaction is approved
        bool isApproved = _approveContractCall(txHash, mpcSignatureR, mpcSignatureS, params);
        if (!isApproved) {
            revert("Transaction not approved");
        }

        // Forward payload to smart account for execution
        bool success = callDestinationContract(
            params.destinationAddress,
            params.sourceChain,
            params.sourceAddress,
            params.payload
        );
        if (!success) {
            revert("Smart account execution failed");
        }

        // Mark transaction as executed to prevent replay
        executedCalls[txHash] = true;

        // Emit ContractCallExecuted event for tracking
        emit ContractCallExecuted(
            params.sourceChain,
            params.sourceAddress,
            params.destinationAddress,
            txHash
        );
    }

    function generateTxHash(ContractCallParams calldata params) private pure returns (bytes32) {
        return sha256(abi.encode(
            params.sourceChain,
            params.sourceAddress,
            params.destinationChain,
            params.destinationAddress,
            params.payload
        ));
    }

    function callDestinationContract(
        address destinationAddress,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) private returns (bool) {
        IEntryPoint entryPoint = IEntryPoint(destinationAddress);
        return entryPoint.executePayload(sourceChain, sourceAddress, payload);
    }
}