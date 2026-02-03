// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../interfaces/IAccount.sol";
import "../util/SignatureVerifier.sol";
import "../EntryPoint.sol";

contract Account is IAccount {
    address private immutable verifier;
    EntryPoint private immutable entryPoint;
    bytes32[] private xPubKeys;
    bytes32[] private yPubKeys;
    bytes32 private immutable addrHash;
    uint64 private threshold;
    uint64 public accountSequence;

    /**
     * @dev Constructor that initializes the contract with the verifier address, signer address, and entry point address.
     * Emits an `AccountInitialized` event.
     * @param _verifierAddr The address of the secp256k1 verifier contract.
     * @param _entryPointAddr The address of the entry point contract.
     * @param _x The x part of the public key.
     * @param _y The y part of the public key.
     * @param _addrHash The hash of address on the source chain where the transaction originated.
     * @param _threshold The threshold of the account.
     */
    constructor(
        address _verifierAddr,
        address _entryPointAddr,
        bytes32[] memory _x,
        bytes32[] memory _y,
        bytes32 _addrHash,
        uint64 _threshold
    ) {
        verifier = _verifierAddr;
        entryPoint = EntryPoint(_entryPointAddr);
        xPubKeys = _x;
        yPubKeys = _y;
        addrHash = _addrHash;
        threshold = _threshold;

        emit AccountInitialized(verifier);
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
     * @dev Validates an operation by verifying the provided signatures over signBytes.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param signBytes The AMINO_JSON message that was signed.
     * @param txPayloadHashOffset The offset to the hash in signBytes (points to "0x" prefix).
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

        if (x.length != r.length || x.length != s.length) {
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

        // 7. Verify signatures against sha256(signBytes)
        bytes32 signBytesHash = sha256(signBytes);
        for (uint64 i = 0; i < x.length; i++) {
            bool isValidSignature = SignatureVerifier.verifySignature(verifier, signBytesHash, r[i], s[i], x[i], y[i]);
            if (!isValidSignature) {
                return (false, "InvalidSignature");
            }
        }

        return (true, "");
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
     * @dev Allows the contract to execute arbitrary transactions, restricted to the EntryPoint.
     * Emits a `TransactionExecuted` event.
     * @param destList The list of destination addresses of the transactions.
     * @param valueList The list of amounts of Ether to send with the transactions.
     * @param dataList The list of data to pass to the destination contracts.
     * @return success A boolean indicating whether the transactions were successful.
     */
    function executeTransactions(
        address[] calldata destList,
        uint256[] calldata valueList,
        bytes[] calldata dataList
    ) external onlyEntryPoint returns (bool) {
        if (destList.length != valueList.length || destList.length != dataList.length) {
            revert InvalidInputLength();
        }
        // Increment sequence BEFORE external calls to prevent reentrancy
        incrementSequence();
        bool success = true;
        for (uint256 i = 0; i < destList.length; i++) {
            success = _call(destList[i], valueList[i], dataList[i]);
            if (!success) {
                break;
            }
            emit TransactionExecuted(destList[i], valueList[i], dataList[i]);
        }
        return success;
    }

    /**
     * @dev Recovers a transaction by validating the provided signature and executing the transaction if valid. Directly executes to the smart account.
     * @param r Part of the signature (r) from secp256k1 signature.
     * @param s Part of the signature (s) from secp256k1 signature.
     * @param x Part of the public key (x) that signed the message.
     * @param y Part of the public key (y) that signed the message.
     * @param txPayload The transaction payload containing the sequence, destination address, value, and data from recoverProposal.
     * @return A boolean indicating whether the transaction was successfully recovered.
     */
    function recoverTransaction(
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes calldata txPayload
    ) external returns (bool) {
        if (x.length != y.length) {
            revert InvalidInputLength();
        }

        if (x.length != r.length || x.length != s.length) {
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
            bool isValidSignature = SignatureVerifier.verifySignature(verifier, messageHash, r[i], s[i], x[i], y[i]);
            if (!isValidSignature) {
                revert InvalidSignature();
            }
        }

        // Validate the function selector matches recoverProposal(uint64,address,uint256,bytes)
        bytes4 expectedSelector = bytes4(keccak256("recoverProposal(uint64,address,uint256,bytes)"));
        bytes4 actualSelector = bytes4(txPayload[:4]);
        if (actualSelector != expectedSelector) {
            revert InvalidPayload();
        }

        // Decode parameters after the 4-byte selector
        (uint64 sequence, address dest, uint256 value, bytes memory data) = abi.decode(
            txPayload[4:],
            (uint64, address, uint256, bytes)
        );
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
     * @dev Returns the verifier address.
     * @return The address of the verifier.
     */
    function getVerifier() public view returns (address) {
        return verifier;
    }

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
