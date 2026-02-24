// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IRoutingRailgun.sol";

// Payload layout constants
uint64 constant ROUTING_HEADER_SIZE = 128; // chainId(32) + accountAddress(32) + sequence(32) + count(32)
uint64 constant CALL_HEADER_SIZE = 96; // target(32) + value(32) + dataLen(32)

contract RoutingRailgun is IRoutingRailgun {
    address public immutable railgunAddress;
    address public immutable routingKeyAddress;
    address public immutable entryPoint;
    uint256 public nonce;

    // Hex lookup table for _toHex conversion
    bytes16 private constant HEX_DIGITS = "0123456789abcdef";

    /**
     * @dev Modifier to restrict access to the EntryPoint.
     */
    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert NotEntryPoint();
        _;
    }

    /**
     * @dev Initializes the contract with the routing key, Railgun address, and EntryPoint.
     * @param routingKeyAddress_ The EOA address bonded to this routing account.
     * @param railgunAddress_ The address of the Railgun contract.
     * @param entryPoint_ The address of the EntryPoint contract.
     */
    constructor(address routingKeyAddress_, address railgunAddress_, address entryPoint_) {
        routingKeyAddress = routingKeyAddress_;
        railgunAddress = railgunAddress_;
        entryPoint = entryPoint_;
    }

    /**
     * @dev Allows the contract to receive Ether.
     */
    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    /**
     * @dev Handles operations signed by the routing key.
     * Verifies the ECDSA signature, validates the nonce and header, then executes calls atomically.
     *
     * Signature scheme: sha256(json({"tx_hash":"0x<hex(keccak256(payload))>"}))
     * This matches the Cosmos AMINO_JSON signing convention used by the Sourdough protocol.
     *
     * Payload layout:
     *   Header: chainId(32) + accountAddress(32) + sequence(32) + count(32) = 128 bytes
     *   Body:   count * [target(32) + value(32) + dataLen(32) + data(padded)]
     *
     * @param payload The encoded operations payload.
     * @param signature The 65-byte ECDSA signature (r(32) + s(32) + v(1)).
     */
    function handleOps(bytes calldata payload, bytes calldata signature) external onlyEntryPoint {
        // 1. Verify signature
        _verifySignature(payload, signature);

        // 2. Parse and validate header
        if (payload.length < ROUTING_HEADER_SIZE) revert PayloadTooShort();

        (uint256 chainId, address accountAddress, uint256 sequence, uint256 count) = abi.decode(
            payload[:ROUTING_HEADER_SIZE],
            (uint256, address, uint256, uint256)
        );

        if (chainId != block.chainid) revert InvalidChainId();
        if (accountAddress != address(this)) revert InvalidAccountAddress();
        if (sequence != nonce) revert InvalidNonce();

        // 3. Increment nonce before external calls (CEI pattern)
        nonce = sequence + 1;

        // 4. Execute calls
        uint256 offset = ROUTING_HEADER_SIZE;
        for (uint256 i = 0; i < count; i++) {
            if (payload.length < offset + CALL_HEADER_SIZE) revert PayloadTooShort();

            (address target, uint256 value, uint256 dataLen) = abi.decode(
                payload[offset:offset + CALL_HEADER_SIZE],
                (address, uint256, uint256)
            );
            offset += CALL_HEADER_SIZE;

            bytes calldata data = payload[offset:offset + dataLen];
            offset += dataLen;
            // Align to 32-byte boundary
            if (dataLen % 32 != 0) {
                offset += 32 - (dataLen % 32);
            }

            (bool success, ) = target.call{value: value}(data);
            if (!success) revert CallFailed(i);

            emit CallExecuted(target, value, data);
        }

        emit OpsHandled(sequence);
    }

    /**
     * @dev Verifies the ECDSA signature over the payload.
     * Reconstructs: sha256('{"tx_hash":"0x' + hex(keccak256(payload)) + '"}')
     * Then recovers the signer and checks it matches routingKeyAddress.
     * @param payload The operations payload to verify.
     * @param signature The 65-byte ECDSA signature (r + s + v).
     */
    function _verifySignature(bytes calldata payload, bytes calldata signature) internal view {
        if (signature.length != 65) revert InvalidSignature();

        // Construct the signed message: sha256(json({"tx_hash":"0x<hex(keccak256(payload))>"}))
        bytes32 payloadHash = keccak256(payload);
        bytes memory hexHash = _toHex(payloadHash);

        // Build JSON: {"tx_hash":"0x..."}
        bytes memory jsonMessage = abi.encodePacked('{"tx_hash":"0x', hexHash, '"}');
        bytes32 messageHash = sha256(jsonMessage);

        // Extract signature components
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);

        // Normalize v value (support both 0/1 and 27/28)
        if (v < 27) {
            v += 27;
        }

        address recovered = ecrecover(messageHash, v, r, s);
        if (recovered == address(0) || recovered != routingKeyAddress) revert InvalidSignature();
    }

    /**
     * @dev Converts a bytes32 value to its lowercase hexadecimal string representation.
     * @param data The bytes32 value to convert.
     * @return The hex string (64 characters, no 0x prefix).
     */
    function _toHex(bytes32 data) internal pure returns (bytes memory) {
        bytes memory result = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            result[i * 2] = HEX_DIGITS[uint8(data[i]) >> 4];
            result[i * 2 + 1] = HEX_DIGITS[uint8(data[i]) & 0x0f];
        }
        return result;
    }
}
