// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../interfaces/IAccount.sol";
import "../EntryPoint.sol";

/**
 * @title Account
 * @notice Smart account with threshold multi-signature verification.
 * @dev SECURITY: This contract is the trust anchor. All validation and execution MUST be atomic
 * in a single function call to prevent TOCTOU (time-of-check-time-of-use) attacks.
 *
 * DO NOT split validation and execution into separate external functions.
 * A malicious or compromised EntryPoint could call validate() with legitimate params,
 * then call execute() with different params, bypassing signature verification.
 *
 * Safe pattern: validateAndExecute() does both in one atomic operation.
 * The recoverTransaction() function also validates and executes atomically.
 */
contract Account is IAccount {
    EntryPoint private immutable entryPoint;
    bytes32[] private xPubKeys;
    bytes32[] private yPubKeys;
    bytes32 private immutable addrHash;
    uint64 private threshold;
    uint64 public accountSequence;

    // secp256k1 curve order / 2 for malleability check (EIP-2)
    uint256 private constant SECP256K1_N_DIV_2 =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /**
     * @dev Constructor that initializes the contract with the entry point address and signer public keys.
     * Emits an `AccountInitialized` event.
     * @param _entryPointAddr The address of the entry point contract.
     * @param _x The x part of the public key.
     * @param _y The y part of the public key.
     * @param _addrHash The hash of address on the source chain where the transaction originated.
     * @param _threshold The threshold of the account.
     */
    constructor(
        address _entryPointAddr,
        bytes32[] memory _x,
        bytes32[] memory _y,
        bytes32 _addrHash,
        uint64 _threshold
    ) {
        entryPoint = EntryPoint(_entryPointAddr);
        xPubKeys = _x;
        yPubKeys = _y;
        addrHash = _addrHash;
        threshold = _threshold;

        emit AccountInitialized();
    }

    /**
     * @dev Modifier that restricts function access to the EntryPoint.
     * Reverts if called by any other address.
     */
    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) {
            revert NotEntryPoint();
        }
        _;
    }

    /**
     * @dev Internal function that performs a low-level call to the target contract with specified value and data.
     * Reverts if the call fails.
     * @param target The address of the contract to call.
     * @param value The amount of Ether to send with the call.
     * @param data The data to pass to the target contract.
     * @return success A boolean indicating whether the call was successful.
     */
    function _call(address target, uint256 value, bytes memory data) internal returns (bool) {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return success;
    }

    /**
     * @dev Derives an Ethereum address from a public key.
     * @param x The x coordinate of the public key.
     * @param y The y coordinate of the public key.
     * @return The derived Ethereum address.
     */
    function _pubKeyToAddress(bytes32 x, bytes32 y) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(x, y)))));
    }

    /**
     * @dev Recovers the signer address using ecrecover.
     * @param messageHash The hash that was signed.
     * @param v Recovery id (27 or 28).
     * @param r Signature r component.
     * @param s Signature s component.
     * @return The recovered address, or address(0) if invalid.
     */
    function _recoverSigner(
        bytes32 messageHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (address) {
        // Check for signature malleability (EIP-2)
        if (uint256(s) > SECP256K1_N_DIV_2) {
            return address(0);
        }

        // v must be 27 or 28
        if (v != 27 && v != 28) {
            return address(0);
        }

        return ecrecover(messageHash, v, r, s);
    }

    /**
     * @dev Validates an operation by verifying the provided signatures over signBytes using ecrecover.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param signBytes The AMINO_JSON message that was signed.
     * @param txPayloadHashOffset The offset to the hash in signBytes (points to "0x" prefix).
     * @param v Recovery id array (0-3, will be adjusted to 27-30 for ecrecover).
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param x Part of the public key (x).
     * @param y Part of the public key (y).
     * @param sequence The sequence number of the transaction.
     * @param txPayload The transaction payload containing chainId, accountAddress, sequence, and calls.
     * @return A boolean indicating whether the signature is valid.
     * @return A string reason for failure (empty if valid).
     */
    function validateOperation(
        string calldata sourceAddress,
        bytes calldata signBytes,
        uint256 txPayloadHashOffset,
        uint8[] memory v,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 sequence,
        bytes calldata txPayload
    ) external view returns (bool, string memory) {
        // 1. Validate source address
        if (!compareSourceAddress(sourceAddress)) {
            return (false, "InvalidSourceAddress");
        }

        // 2. Validate sequence
        if (sequence != accountSequence + 1) {
            return (false, "InvalidSequence");
        }

        // 3. Extract and verify hash commitment
        bytes32 expectedHash = _extractHashFromSignBytes(signBytes, txPayloadHashOffset);
        bytes32 actualHash = keccak256(txPayload);
        if (expectedHash != actualHash) {
            return (false, "InvalidHashCommitment");
        }

        // 4. Validate signature arrays
        if (x.length != y.length) {
            return (false, "InvalidPubKeyLength");
        }

        if (x.length != r.length || x.length != s.length || x.length != v.length) {
            return (false, "InvalidSignatureLength");
        }

        if (x.length < threshold) {
            return (false, "InvalidThreshold");
        }

        // 5. Check for duplicate public keys
        for (uint64 i = 0; i < x.length; i++) {
            for (uint64 j = i + 1; j < x.length; j++) {
                if (x[i] == x[j] && y[i] == y[j]) {
                    return (false, "DuplicatePubKey");
                }
            }
        }

        // 6. Validate public keys are authorized
        for (uint64 i = 0; i < x.length; i++) {
            bool found = false;
            for (uint64 j = 0; j < xPubKeys.length; j++) {
                if (x[i] == xPubKeys[j] && y[i] == yPubKeys[j]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return (false, "InvalidPubKey");
            }
        }

        // 7. Verify signatures against sha256(signBytes) using ecrecover
        bytes32 signBytesHash = sha256(signBytes);
        for (uint64 i = 0; i < x.length; i++) {
            address expectedAddr = _pubKeyToAddress(x[i], y[i]);
            // v is 0-3 from MPC, add 27 for ecrecover
            address recovered = _recoverSigner(signBytesHash, v[i] + 27, r[i], s[i]);

            if (recovered != expectedAddr) {
                return (false, "InvalidSignature");
            }
        }

        return (true, "");
    }

    /**
     * @dev Validates and executes a transaction atomically. This is the main entry point for the normal path.
     * Account validates everything (signatures, chainId, accountAddress, sequence) and executes calls.
     * @param signBytes The AMINO_JSON message that was signed.
     * @param txPayloadHashOffset The offset to the hash in signBytes (points to "0x" prefix).
     * @param sigs Signature data (v, r, s, x, y arrays).
     * @param txPayload The transaction payload containing evmChainId, accountAddress, sequence, count, and calls.
     * @return bool indicating whether the transaction was successful.
     */
    function validateAndExecute(
        bytes calldata signBytes,
        uint256 txPayloadHashOffset,
        SignatureData calldata sigs,
        bytes calldata txPayload
    ) external onlyEntryPoint returns (bool) {
        // 1. Validate txPayload header (chainId, accountAddress, sequence)
        uint64 count = _validateTxPayloadHeader(txPayload, txPayloadHashOffset, signBytes);

        // 2. Validate signatures
        _validateSignatures(signBytes, sigs);

        // 3. Increment sequence BEFORE external calls (CEI pattern)
        incrementSequence();

        // 4. Decode and execute calls from txPayload
        _executeCallsFromPayload(txPayload, count);

        return true;
    }

    /**
     * @dev Validates txPayload header and hash commitment.
     * @return count The number of calls to execute.
     */
    function _validateTxPayloadHeader(
        bytes calldata txPayload,
        uint256 txPayloadHashOffset,
        bytes calldata signBytes
    ) internal view returns (uint64) {
        if (txPayload.length < 128) revert InvalidPayload();

        (uint256 evmChainId, address accountAddress, uint64 sequence, uint64 count) = abi.decode(
            txPayload[:128],
            (uint256, address, uint64, uint64)
        );

        // Validate chain ID
        if (evmChainId != block.chainid) {
            revert InvalidChainId();
        }

        // Validate account address
        if (accountAddress != address(this)) {
            revert InvalidAccountAddress();
        }

        // Validate sequence
        if (sequence != accountSequence + 1) {
            revert InvalidSequence();
        }

        // Validate hash commitment
        bytes32 expectedHash = _extractHashFromSignBytes(signBytes, txPayloadHashOffset);
        bytes32 actualHash = keccak256(txPayload);
        if (expectedHash != actualHash) {
            revert InvalidHashCommitment();
        }

        // Validate count
        if (count == 0 || count > 20) {
            revert InvalidInputLength();
        }

        return count;
    }

    /**
     * @dev Validates signature arrays and verifies signatures.
     */
    function _validateSignatures(
        bytes calldata signBytes,
        SignatureData calldata sigs
    ) internal view {
        // Validate array lengths
        if (sigs.x.length != sigs.y.length) {
            revert InvalidPubKeyLength();
        }
        if (sigs.x.length != sigs.r.length || sigs.x.length != sigs.s.length || sigs.x.length != sigs.v.length) {
            revert InvalidSignatureLength();
        }
        if (sigs.x.length < threshold) {
            revert InvalidThreshold();
        }

        // Check for duplicate public keys
        for (uint64 i = 0; i < sigs.x.length; i++) {
            for (uint64 j = i + 1; j < sigs.x.length; j++) {
                if (sigs.x[i] == sigs.x[j] && sigs.y[i] == sigs.y[j]) {
                    revert DuplicatePubKey();
                }
            }
        }

        // Validate public keys are authorized and verify signatures
        bytes32 signBytesHash = sha256(signBytes);
        for (uint64 i = 0; i < sigs.x.length; i++) {
            // Check pubkey is authorized
            bool found = false;
            for (uint64 j = 0; j < xPubKeys.length; j++) {
                if (sigs.x[i] == xPubKeys[j] && sigs.y[i] == yPubKeys[j]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                revert InvalidPubKey();
            }

            // Verify signature
            address expectedAddr = _pubKeyToAddress(sigs.x[i], sigs.y[i]);
            address recovered = _recoverSigner(signBytesHash, sigs.v[i] + 27, sigs.r[i], sigs.s[i]);
            if (recovered != expectedAddr) {
                revert InvalidSignature();
            }
        }
    }

    /**
     * @dev Decodes and executes calls from txPayload.
     */
    function _executeCallsFromPayload(bytes calldata txPayload, uint64 count) internal {
        uint256 offset = 128; // Start after header
        for (uint64 i = 0; i < count; i++) {
            if (txPayload.length < offset + 96) revert InvalidPayload();

            (address dest, uint256 value, uint256 dataLen) = abi.decode(
                txPayload[offset:offset + 96],
                (address, uint256, uint256)
            );

            offset += 96;

            if (txPayload.length < offset + dataLen) revert InvalidPayload();

            bytes calldata data = txPayload[offset:offset + dataLen];
            offset += dataLen;

            _call(dest, value, data);
            emit TransactionExecuted(dest, value, data);
        }
    }

    /**
     * @dev Extract bytes32 hash from hex string in signBytes at given offset.
     * @param signBytes The signed message bytes.
     * @param offset Offset to "0x" prefix of 66-char hex string.
     * @return The parsed bytes32 hash, or bytes32(0) if parsing fails (except for out-of-bounds which reverts).
     */
    function _extractHashFromSignBytes(bytes calldata signBytes, uint256 offset) internal pure returns (bytes32) {
        // Out of bounds is a fundamental error - revert
        if (signBytes.length < offset + 66) revert InvalidHashOffset();

        // Invalid "0x" prefix - return 0 to cause hash mismatch (will be caught as InvalidHashCommitment)
        if (signBytes[offset] != "0" || signBytes[offset + 1] != "x") {
            return bytes32(0);
        }

        bytes32 result;
        for (uint256 i = 0; i < 32; i++) {
            (uint8 hi, bool hiValid) = _hexCharToValueSafe(signBytes[offset + 2 + i * 2]);
            (uint8 lo, bool loValid) = _hexCharToValueSafe(signBytes[offset + 3 + i * 2]);
            // Invalid hex character - return 0 to cause hash mismatch
            if (!hiValid || !loValid) {
                return bytes32(0);
            }
            result |= bytes32(bytes1(hi * 16 + lo)) >> (i * 8);
        }
        return result;
    }

    /**
     * @dev Convert a hex character to its numeric value (safe version that returns validity).
     * @param char The hex character (0-9, a-f, A-F).
     * @return value The numeric value (0-15).
     * @return valid Whether the character is a valid hex character.
     */
    function _hexCharToValueSafe(bytes1 char) internal pure returns (uint8 value, bool valid) {
        if (char >= "0" && char <= "9") return (uint8(char) - 48, true);
        if (char >= "a" && char <= "f") return (uint8(char) - 87, true);
        if (char >= "A" && char <= "F") return (uint8(char) - 55, true);
        return (0, false);
    }

    /**
     * @dev Recovers a transaction by validating the provided signature and executing the transaction if valid. Directly executes to the smart account.
     * @param v Recovery id array (0-3, will be adjusted to 27-30 for ecrecover).
     * @param r Part of the signature (r) from secp256k1 signature.
     * @param s Part of the signature (s) from secp256k1 signature.
     * @param x Part of the public key (x) that signed the message.
     * @param y Part of the public key (y) that signed the message.
     * @param txPayload The transaction payload containing the sequence, destination address, value, and data from recoverProposal.
     * @return A boolean indicating whether the transaction was successfully recovered.
     */
    function recoverTransaction(
        uint8[] memory v,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes calldata txPayload
    ) external returns (bool) {
        if (x.length != y.length) {
            revert InvalidInputLength();
        }

        if (x.length != r.length || x.length != s.length || x.length != v.length) {
            revert InvalidInputLength();
        }

        if (x.length < threshold) {
            revert InvalidThreshold();
        }

        bytes32 messageHash = sha256(abi.encodePacked(txPayload));
        for (uint64 i = 0; i < x.length; i++) {
            bool isPubKeyValid = false;
            for (uint64 j = 0; j < xPubKeys.length; j++) {
                if (x[i] == xPubKeys[j] && y[i] == yPubKeys[j]) {
                    isPubKeyValid = true;
                    break;
                }
            }
            if (!isPubKeyValid) {
                revert InvalidPubKey();
            }

            // Verify signature using ecrecover
            address expectedAddr = _pubKeyToAddress(x[i], y[i]);
            // v is 0-3 from MPC, add 27 for ecrecover
            address recovered = _recoverSigner(messageHash, v[i] + 27, r[i], s[i]);

            if (recovered != expectedAddr) {
                revert InvalidSignature();
            }
        }

        // Decode parameters from txPayload
        // Format: (uint256 evmChainId, uint64 sequence, address dest, uint256 value, bytes data)
        (uint256 evmChainId, uint64 sequence, address dest, uint256 value, bytes memory data) = abi.decode(
            txPayload,
            (uint256, uint64, address, uint256, bytes)
        );

        // Validate chain ID
        if (evmChainId != block.chainid) {
            revert InvalidChainId();
        }

        if (sequence != accountSequence + 1) {
            revert InvalidSequence();
        }
        // Increment sequence BEFORE external call to prevent reentrancy
        incrementSequence();
        _call(dest, value, data);
        emit TransactionExecuted(dest, value, data);
        return true;
    }

    // /**
    //  * @dev Payload template for recoverTransaction txPayload.
    //  * @param sequence The sequence number of the transaction.
    //  * @param dest The destination address of the transaction.
    //  * @param value The amount of Ether to send with the transaction.
    //  * @param data The data to pass to the destination contract.
    //  */
    // function recoverProposal(uint64 sequence, address dest, uint256 value, bytes calldata data) external {
    //     revert NotExecutable();
    // }

    /**
     * @dev Returns the x part of the public key.
     * @return The x part of the public key.
     */
    function getX() public view returns (bytes32[] memory) {
        return xPubKeys;
    }

    /**
     * @dev Returns the y part of the public key.
     * @return The y part of the public key.
     */
    function getY() public view returns (bytes32[] memory) {
        return yPubKeys;
    }

    /**
     * @dev Increments the sequence number.
     */
    function incrementSequence() internal {
        accountSequence++;
    }

    /**
     * @dev Compares the source address with the stored source address hash.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return A boolean indicating whether the source address matches the stored hash.
     */
    function compareSourceAddress(string calldata sourceAddress) public view returns (bool) {
        return addrHash == keccak256(abi.encodePacked(sourceAddress));
    }

    /**
     * @dev Allows the contract to receive Ether.
     * The fallback function to handle incoming Ether.
     */
    receive() external payable {}
}
