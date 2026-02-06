// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IMPCGateway.sol";
import "./interfaces/IMPCVerifier.sol";
import "../smart-account/interfaces/IEntryPoint.sol";

contract MPCGateway is IMPCGateway, Initializable, UUPSUpgradeable, OwnableUpgradeable {
    /// @custom:storage-location erc7201:sourdough.storage.MPCGateway
    struct MPCGatewayStorage {
        mapping(bytes32 => bool) executedCalls;
        IMPCVerifier verifier;
    }

    // keccak256(abi.encode(uint256(keccak256("sourdough.storage.MPCGateway")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION =
        keccak256(abi.encode(uint256(keccak256("sourdough.storage.MPCGateway")) - 1)) & ~bytes32(uint256(0xff));

    function _getMPCGatewayStorage() private pure returns (MPCGatewayStorage storage $) {
        bytes32 slot = STORAGE_LOCATION;
        assembly {
            $.slot := slot
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the MPCGateway contract
     * @param _verifierAddress The address of the MPCVerifier contract
     * @param _owner The address of the contract owner
     */
    function initialize(address _verifierAddress, address _owner) public initializer {
        if (_verifierAddress == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        MPCGatewayStorage storage $ = _getMPCGatewayStorage();
        $.verifier = IMPCVerifier(_verifierAddress);
    }

    /**
     * @notice Returns whether a transaction has been executed
     * @param txHash The transaction hash to check
     * @return bool True if the transaction has been executed
     */
    function executedCalls(bytes32 txHash) external view returns (bool) {
        MPCGatewayStorage storage $ = _getMPCGatewayStorage();
        return $.executedCalls[txHash];
    }

    /**
     * @notice Sets the verifier contract address
     * @param newVerifier The new verifier address
     * @dev Only the contract owner can update the verifier
     */
    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        MPCGatewayStorage storage $ = _getMPCGatewayStorage();
        emit VerifierUpdated(address($.verifier), newVerifier);
        $.verifier = IMPCVerifier(newVerifier);
    }

    /**
     * @notice Approves a contract call by validating the MPC signature
     * @dev Internal function that validates the MPC signature against the transaction hash
     * @param txHash The hash of the transaction parameters
     * @param v The v component of the MPC signature (recovery parameter)
     * @param r The r component of the MPC signature
     * @param s The s component of the MPC signature
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationAddress Address of the contract to call on the destination chain
     * @return bool Returns true if signature is valid and call is approved
     */
    function _approveContractCall(
        bytes32 txHash,
        uint8 v,
        bytes32 r,
        bytes32 s,
        string calldata sourceChain,
        string calldata sourceAddress,
        address destinationAddress
    ) internal returns (bool) {
        MPCGatewayStorage storage $ = _getMPCGatewayStorage();
        // Call Verifier to validate MPC signature
        bool isValidSignature = $.verifier.validateMPCSignature(txHash, v, r, s);
        if (!isValidSignature) {
            return false;
        }

        // Emit ContractCallApproved event
        emit ContractCallApproved(sourceChain, sourceAddress, destinationAddress, txHash);

        return true;
    }

    /**
     * @notice Executes a contract call on the destination chain.
     * @dev This function is called by the relayer on the destination chain to execute a contract call.
     * @param mpcSignatureV The recovery id of the MPC signature.
     * @param mpcSignatureR The r component of the MPC signature.
     * @param mpcSignatureS The s component of the MPC signature.
     * @param sourceChain Identifier of the chain where the transaction originated
     * @param sourceAddress Address of the sender on the source chain
     * @param destinationChain Identifier of the target chain
     * @param destinationAddress Address of the contract to call on the destination chain
     * @param payload Encoded call data to be executed
     */
    function executeContractCall(
        uint8 mpcSignatureV,
        bytes32 mpcSignatureR,
        bytes32 mpcSignatureS,
        string calldata sourceChain,
        string calldata sourceAddress,
        string calldata destinationChain,
        address destinationAddress,
        bytes calldata payload
    ) external returns (bool) {
        MPCGatewayStorage storage $ = _getMPCGatewayStorage();

        emit ContractCallExecuting(
            mpcSignatureV,
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
        if ($.executedCalls[txHash]) {
            emit DebugError("TransactionAlreadyExecuted");
            return false;
        }

        // Mark transaction as executed to prevent replay
        $.executedCalls[txHash] = true;

        // Ensure transaction is approved
        bool isApproved = _approveContractCall(
            txHash,
            mpcSignatureV,
            mpcSignatureR,
            mpcSignatureS,
            sourceChain,
            sourceAddress,
            destinationAddress
        );
        if (!isApproved) {
            emit DebugError("TransactionNotApproved");
            $.executedCalls[txHash] = false;
            return false;
        }

        // Forward payload to smart account for execution
        bool result = callDestinationContract(
            destinationAddress,
            sourceChain,
            sourceAddress,
            payload
        );
        if (!result) {
            emit DebugError("CallFailed");
            $.executedCalls[txHash] = false;
            return false;
        }

        // Emit ContractCallExecuted event for tracking
        emit ContractCallExecuted(sourceChain, sourceAddress, destinationAddress, txHash);
        return true;
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
        return
            sha256(
                abi.encode(sourceChain, sourceAddress, destinationChain, destinationAddress, payload)
            );
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
        try entryPoint.executePayload(sourceChain, sourceAddress, payload) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    /**
     * @dev Authorizes an upgrade to a new implementation
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
