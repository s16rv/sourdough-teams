// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRoutingRailgun {
    /**
     * @dev Emitted when funds are received by the contract.
     * @param sender The address sending the funds.
     * @param amount The amount of funds received.
     */
    event FundsReceived(address indexed sender, uint256 amount);

    /**
     * @dev Emitted when a call is successfully executed.
     * @param target The address called.
     * @param value The amount of ETH sent with the call.
     * @param data The calldata sent with the call.
     */
    event CallExecuted(address indexed target, uint256 value, bytes data);

    /**
     * @dev Emitted when operations are successfully handled.
     * @param nonce The nonce used for this operation.
     */
    event OpsHandled(uint256 indexed nonce);

    /**
     * @dev Error thrown when the caller is not the EntryPoint.
     */
    error NotEntryPoint();

    /**
     * @dev Error thrown when the signature is invalid.
     */
    error InvalidSignature();

    /**
     * @dev Error thrown when the nonce doesn't match.
     */
    error InvalidNonce();

    /**
     * @dev Error thrown when the chain ID doesn't match.
     */
    error InvalidChainId();

    /**
     * @dev Error thrown when the account address doesn't match.
     */
    error InvalidAccountAddress();

    /**
     * @dev Error thrown when a call within the multicall fails.
     */
    error CallFailed(uint256 index);

    /**
     * @dev Error thrown when the payload is too short to parse.
     */
    error PayloadTooShort();

    /**
     * @dev Returns the address of the Railgun contract.
     * @return The address of the Railgun contract.
     */
    function railgunAddress() external view returns (address);

    /**
     * @dev Returns the bonded routing key address (EOA that signs operations).
     * @return The address of the routing key.
     */
    function routingKeyAddress() external view returns (address);

    /**
     * @dev Returns the current nonce for replay protection.
     * @return The current nonce.
     */
    function nonce() external view returns (uint256);

    /**
     * @dev Handles operations signed by the routing key.
     * Verifies signature, checks nonce, parses payload, and executes calls atomically.
     * @param payload The encoded operations payload (chainId + address + sequence + count + calls).
     * @param signature The ECDSA signature over sha256(json({"tx_hash": hex(keccak256(payload))})).
     */
    function handleOps(bytes calldata payload, bytes calldata signature) external;
}
