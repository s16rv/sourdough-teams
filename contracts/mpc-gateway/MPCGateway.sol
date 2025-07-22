// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IMPCGateway.sol";
import "./interfaces/IMPCVerifier.sol";
import "../smart-account/interfaces/IEntryPoint.sol";

contract MPCGateway is IMPCGateway {
    mapping(bytes32 => bool) private executedCalls;
    IMPCVerifier private verifier;

    /**
     * @dev Constructor that initializes the contract.
     * @param _verifierAddress The address of the secp256k1 verifier contract.
     */
    constructor(address _verifierAddress) {
        verifier = IMPCVerifier(_verifierAddress);
    }

    /**
     * @notice Approves a contract call by validating the MPC signature
     * @dev Internal function that validates the MPC signature against the transaction hash
     * @param txHash The hash of the transaction parameters
     * @param r The r component of the MPC signature
     * @param s The s component of the MPC signature  
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationAddress Address of the contract to call on the destination chain
     * @return bool Returns true if signature is valid and call is approved
     */
    function _approveContractCall(
        bytes32 txHash,
        bytes32 r,
        bytes32 s,
        string calldata sourceChain,
        string calldata sourceAddress,
        address destinationAddress
    ) internal returns (bool) {
        // Call Verifier to validate MPC signature
        bool isValidSignature = verifier.validateMPCSignature(txHash, r, s);
        if (!isValidSignature) {
            return false;
        }

        // Emit ContractCallApproved event
        emit ContractCallApproved(
            sourceChain,
            sourceAddress,
            destinationAddress,
            txHash
        );

        return true;
    }

    /**
     * @notice Executes a contract call on the destination chain.
     * @dev This function is called by the relayer on the destination chain to execute a contract call.
     * @param mpcSignatureR The r component of the MPC signature.
     * @param mpcSignatureS The s component of the MPC signature.
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationChain Identifier of the target chain
     * @param destinationAddress Address of the contract to call on the destination chain
     * @param payload Encoded call data to be executed
     */
    function executeContractCall(
        bytes32 mpcSignatureR,
        bytes32 mpcSignatureS,
        string calldata sourceChain,
        string calldata sourceAddress,
        string calldata destinationChain,
        address destinationAddress,
        bytes calldata payload
    ) external {
        emit ContractCallExecuting(
            mpcSignatureR,
            mpcSignatureS,
            sourceChain,
            sourceAddress,
            destinationAddress
        );
        bytes32 txHash = generateTxHash(
            sourceChain,
            sourceAddress,
            destinationChain,
            destinationAddress,
            payload
        );
        emit DebugTxHash(txHash);

        // Check if already executed to prevent replay attacks
        if (executedCalls[txHash]) {
            revert TransactionAlreadyExecuted();
        }

        // Ensure transaction is approved
        bool isApproved = _approveContractCall(
            txHash, 
            mpcSignatureR, 
            mpcSignatureS, 
            sourceChain,
            sourceAddress,
            destinationAddress
        );
        emit DebugIsApproved(isApproved);
        if (!isApproved) {
            revert TransactionNotApproved();
        }

        // Forward payload to smart account for execution
        bool success = callDestinationContract(
            destinationAddress,
            sourceChain,
            sourceAddress,
            payload
        );
        emit DebugSuccess(success);
        if (!success) {
            revert TransactionFailed();
        }

        // Mark transaction as executed to prevent replay
        executedCalls[txHash] = true;

        // Emit ContractCallExecuted event for tracking
        emit ContractCallExecuted(
            sourceChain,
            sourceAddress,
            destinationAddress,
            txHash
        );
    }

    /**
     * @notice Generates a transaction hash from the contract call parameters.
     * @dev This function is used to generate a unique hash for each contract call.
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationChain Identifier of the target chain
     * @param destinationAddress Address of the contract to call on the destination chain
     * @param payload Encoded call data to be executed
     * @return bytes32 The generated transaction hash
     */
    function generateTxHash(
        string calldata sourceChain,
        string calldata sourceAddress,
        string calldata destinationChain,
        address destinationAddress,
        bytes calldata payload
    ) public pure returns (bytes32) {
        return sha256(abi.encode(
            sourceChain,
            sourceAddress,
            destinationChain,
            destinationAddress,
            payload
        ));
    }

    /**
     * @notice Forwards the payload to the destination contract for execution
     * @dev This function calls the destination smart account's executePayload function
     * @param destinationAddress The address of the destination smart account
     * @param sourceChain The source chain identifier
     * @param sourceAddress The source address on the source chain
     * @param payload The payload to be executed
     * @return bool Returns true if the execution was successful
     */
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