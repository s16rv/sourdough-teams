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
     * @dev Validates an operation by verifying the provided signature against the stored signer.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param messageHash The hash of the message to be validated.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param proof The proof of the transaction.
     * @param data The data to pass to the destination contract.
     * @return A boolean indicating whether the signature is valid.
     */
    function validateOperation(
        string calldata sourceAddress,
        bytes32 messageHash,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 proof,
        uint64 sequence,
        bytes calldata data
    ) external view returns (bool, string memory) {
        if (!compareSourceAddress(sourceAddress)) {
            return (false, "InvalidSourceAddress");
        }

        if (sequence != accountSequence + 1) {
            return (false, "InvalidSequence");
        }

        bytes32 expectedProof = sha256(abi.encodePacked(messageHash, data));
        if (proof != expectedProof) {
            return (false, "InvalidProof");
        }

        if (x.length != y.length) {
            return (false, "InvalidPubKeyLength");
        }

        if (x.length != r.length || x.length != s.length) {
            return (false, "InvalidSignatureLength");
        }

        if (x.length < threshold) {
            return (false, "InvalidThreshold");
        }

        // check if x and y is included in the xPubKeys and yPubKeys
        for (uint64 i = 0; i < x.length; i++) {
            for (uint64 j = 0; j < xPubKeys.length; j++) {
                if (x[i] == xPubKeys[j] && y[i] == yPubKeys[j]) {
                    break;
                }
                if (j == xPubKeys.length - 1) {
                    return (false, "InvalidPubKey");
                }
            }
        }

        for (uint64 i = 0; i < x.length; i++) {
            bool isValidSignature = SignatureVerifier.verifySignature(verifier, messageHash, r[i], s[i], x[i], y[i]);
            if (!isValidSignature) {
                return (false, "InvalidSignature");
            }
        }

        return (true, "");
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
        bool success = true;
        for (uint256 i = 0; i < destList.length; i++) {
            success = _call(destList[i], valueList[i], dataList[i]);
            if (!success) {
                break;
            }
            emit TransactionExecuted(destList[i], valueList[i], dataList[i]);
        }
        incrementSequence();
        return success;
    }

    /**
     * @dev Recovers a transaction by validating the provided signature and executing the transaction if valid.
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
        bool success = _call(dest, value, data);
        if (!success) {
            return false;
        }
        emit TransactionExecuted(dest, value, data);
        incrementSequence();
        return true;
    }

    /**
     * @dev Payload template for recoverTransaction txPayload.
     * @param sequence The sequence number of the transaction.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether to send with the transaction.
     * @param data The data to pass to the destination contract.
     */
    function recoverProposal(uint64 sequence, address dest, uint256 value, bytes calldata data) external {
        revert NotExecutable();
    }

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
