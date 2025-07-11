// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IMPCGateway.sol";
import "./interfaces/IMPCVerifier.sol";
import "../smart-account/interfaces/IEntryPoint.sol";

contract MPCGateway is IMPCGateway {
    mapping(bytes32 => bool) private executedCalls;
    IMPCVerifier private verifier;
    address private ownerAddress;

    /**
     * @dev Constructor that initializes the contract.
     * @param _ownerAddress The address of the owner.
     * @param _verifierAddress The address of the secp256k1 verifier contract.
     */
    constructor(address _ownerAddress, address _verifierAddress) {
        ownerAddress = _ownerAddress;
        verifier = IMPCVerifier(_verifierAddress);
    }

    /**
     * @notice Approves a contract call by validating the MPC signature
     * @dev Internal function that validates the MPC signature against the transaction hash
     * @param txHash The hash of the transaction parameters
     * @param r The r component of the MPC signature
     * @param s The s component of the MPC signature  
     * @param params The contract call parameters containing source/destination info and payload
     * @return bool Returns true if signature is valid and call is approved
     */
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

    /**
     * @notice Executes a contract call on the destination chain.
     * @dev This function is called by the relayer on the destination chain to execute a contract call.
     * @param mpcSignatureR The r component of the MPC signature.
     * @param mpcSignatureS The s component of the MPC signature.
     * @param params The contract call parameters containing source/destination info and payload
     */
    function executeContractCall(
        bytes32 mpcSignatureR,
        bytes32 mpcSignatureS,
        ContractCallParams calldata params
    ) public {
        bytes32 txHash = generateTxHash(params);

        // Check if already executed to prevent replay attacks
        if (executedCalls[txHash]) {
            revert TransactionAlreadyExecuted();
        }

        // Ensure transaction is approved
        bool isApproved = _approveContractCall(txHash, mpcSignatureR, mpcSignatureS, params);
        if (!isApproved) {
            revert TransactionNotApproved();
        }

        // Forward payload to smart account for execution
        bool success = callDestinationContract(
            params.destinationAddress,
            params.sourceChain,
            params.sourceAddress,
            params.payload
        );
        if (!success) {
            revert TransactionFailed();
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

    /**
     * @notice Generates a transaction hash from the contract call parameters.
     * @dev This function is used to generate a unique hash for each contract call.
     * @param params The contract call parameters containing source/destination info and payload
     * @return bytes32 The generated transaction hash
     */
    function generateTxHash(ContractCallParams calldata params) private pure returns (bytes32) {
        return sha256(abi.encode(
            params.sourceChain,
            params.sourceAddress,
            params.destinationChain,
            params.destinationAddress,
            params.payload
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