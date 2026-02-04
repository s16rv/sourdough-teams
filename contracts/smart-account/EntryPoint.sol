// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IEntryPoint.sol";
import "./interfaces/IAccount.sol";
import "./interfaces/IAccountFactory.sol";

uint64 constant MAX_BATCH_SIZE = 20;

// Payload parsing constants
uint64 constant SLOT_SIZE = 32;                    // Size of an ABI-encoded slot
uint64 constant PUBKEY_SIZE = 64;                  // Size of a public key (x + y)
uint64 constant SIGNER_WITH_SIG_SIZE = 129;        // Size of signer block (v(1) + r(32) + s(32) + x(32) + y(32))
uint64 constant CREATE_ACCOUNT_HEADER_SIZE = 96;   // Category 1: category(32) + totalSigners(32) + threshold(32)
uint64 constant NEW_HEADER_SIZE = 128;             // Category 2 (new): category(32) + signBytesLen(32) + hashOffset(32) + numSigners(32)
uint256 constant TX_ITEM_HEADER_SIZE = 96;         // Transaction item: dest(32) + value(32) + dataLen(32)

// No chain ID constant needed - we use block.chainid for validation

contract EntryPoint is IEntryPoint {
    IAccountFactory public immutable accountFactory;
    address public immutable ownerAddress;
    mapping(address => bool) public executor;

    /**
     * @dev Constructor to initialize the EntryPoint contract with the Axelar gateway and account factory addresses.
     * @param _accountFactory Address of the account factory that manages account creation.
     * @param _ownerAddress Address of the owner that has the ability to set executors.
     */
    constructor(address _accountFactory, address _ownerAddress) {
        if (_accountFactory == address(0)) revert ZeroAddress();
        if (_ownerAddress == address(0)) revert ZeroAddress();
        accountFactory = IAccountFactory(_accountFactory);
        ownerAddress = _ownerAddress;
    }

    /**
     * @notice Executes a payload on the destination chain.
     * @dev This function is called by the relayer on the destination chain to execute a payload.
     * It verifies the executor and then calls the internal `_execute` function.
     * @param _sourceChain The blockchain where the transaction originated.
     * @param _sourceAddress The address on the source chain where the transaction originated.
     * @param _payload The encoded GMP (General Message Passing) message sent from the source chain.
     */
    function executePayload(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) external returns (bool) {
        if (!isExecutor(msg.sender)) {
            revert NotExecutor();
        }

        _execute(_sourceChain, _sourceAddress, _payload);

        return true;
    }

    /**
     * @notice Sets the executor status for a given address.
     * @dev Only the owner can set the executor status.
     * @param _executor The address to be set as an executor.
     * @param _isExecutor The boolean value indicating whether the address should be an executor.
     */
    function setExecutor(address _executor, bool _isExecutor) public {
        if (msg.sender != ownerAddress) revert OnlyOwner();
        executor[_executor] = _isExecutor;
    }

    /**
     * @notice Retrieves the executor status for a given address.
     * @dev This function can be called by anyone.
     * @param _executor The address to check the executor status.
     * @return bool Returns true if the address is an executor, otherwise returns false.
     */
    function isExecutor(address _executor) public view returns (bool) {
        return executor[_executor];
    }

    /**
     * @notice Logic to be executed on the destination chain.
     * @dev This function is triggered automatically by the relayer when a cross-chain message is received.
     * It decodes the payload to identify which function to execute based on the `category`.
     * @param _sourceChain The blockchain where the transaction originated.
     * @param _sourceAddress The address on the source chain where the transaction originated.
     * @param _payload The encoded GMP (General Message Passing) message sent from the source chain.
     */
    function _execute(string calldata _sourceChain, string calldata _sourceAddress, bytes calldata _payload) internal {
        uint8 category = abi.decode(_payload[:SLOT_SIZE], (uint8));

        if (category == 1) {
            (uint64 totalSigners, uint64 threshold) = abi.decode(_payload[SLOT_SIZE:CREATE_ACCOUNT_HEADER_SIZE], (uint64, uint64));

            uint64 offset = CREATE_ACCOUNT_HEADER_SIZE;

            // Dynamic arrays for x, y based on the total signers
            bytes32[] memory x = new bytes32[](totalSigners);
            bytes32[] memory y = new bytes32[](totalSigners);

            // Loop through the total signers to extract their public keys
            for (uint64 i = 0; i < totalSigners; i++) {
                uint64 index = offset + i * PUBKEY_SIZE;

                // Decode x, y for the current signer
                (x[i], y[i]) = abi.decode(_payload[index:index + PUBKEY_SIZE], (bytes32, bytes32));
            }

            _createAccount(x, y, threshold, _sourceAddress);
        } else if (category == 2) {
            // Parse new payload format
            (uint256 signBytesLength, uint256 txPayloadHashOffset, uint64 numberSigners) = abi.decode(
                _payload[SLOT_SIZE:NEW_HEADER_SIZE],
                (uint256, uint256, uint64)
            );

            uint256 offset = NEW_HEADER_SIZE;

            // Extract signBytes
            bytes calldata signBytes = _payload[offset:offset + signBytesLength];
            offset += signBytesLength;

            // Dynamic arrays for v, r, s, x, y based on the number of signers
            uint8[] memory v = new uint8[](numberSigners);
            bytes32[] memory r = new bytes32[](numberSigners);
            bytes32[] memory s = new bytes32[](numberSigners);
            bytes32[] memory x = new bytes32[](numberSigners);
            bytes32[] memory y = new bytes32[](numberSigners);

            // Loop through the total signers to extract their signatures and public keys
            // New payload format per signer: v(1) + r(32) + s(32) + x(32) + y(32) = 129 bytes
            for (uint64 i = 0; i < numberSigners; i++) {
                uint256 index = offset + i * SIGNER_WITH_SIG_SIZE;

                // Manual byte extraction for tight-packed format
                v[i] = uint8(_payload[index]);
                r[i] = bytes32(_payload[index + 1:index + 33]);
                s[i] = bytes32(_payload[index + 33:index + 65]);
                x[i] = bytes32(_payload[index + 65:index + 97]);
                y[i] = bytes32(_payload[index + 97:index + 129]);
            }

            offset += numberSigners * SIGNER_WITH_SIG_SIZE;

            // Remaining is txPayload
            bytes calldata txPayload = _payload[offset:];

            // Decode txPayload header to get evmChainId, target, and sequence
            (uint256 evmChainId, address target, uint64 sequence) = _decodeTxPayloadHeader(txPayload);

            // Validate chain ID against current chain
            if (evmChainId != block.chainid) {
                revert InvalidChainId();
            }

            // Validate target account
            address expectedAccount = accountFactory.getAccount(_sourceAddress);
            if (target != expectedAccount) {
                revert InvalidTargetAccount();
            }

            _handleTransaction(target, signBytes, txPayloadHashOffset, v, r, s, x, y, sequence, _sourceAddress, txPayload);
        }

        emit Executed(_sourceChain, _sourceAddress);
    }

    /**
     * @dev Handles the execution of a transaction on the destination chain by validating the signature and calling the target account's `executeTransaction` function.
     * @param target The target address to execute the transaction.
     * @param signBytes The AMINO_JSON message that was signed.
     * @param txPayloadHashOffset The offset to the hash in signBytes.
     * @param v Recovery id array (0-3 from MPC).
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param x Part of the public key (x).
     * @param y Part of the public key (y).
     * @param sequence The sequence number of the transaction.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param txPayload The transaction payload containing chainId, accountAddress, sequence, and calls.
     */
    function _handleTransaction(
        address target,
        bytes calldata signBytes,
        uint256 txPayloadHashOffset,
        uint8[] memory v,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 sequence,
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal {
        (bool valid, string memory reason) = IAccount(payable(target)).validateOperation(
            sourceAddress,
            signBytes,
            txPayloadHashOffset,
            v,
            r,
            s,
            x,
            y,
            sequence,
            txPayload
        );

        if (!valid) {
            emit DebugReason(reason);
            return;
        }

        bytes32 signBytesHash = sha256(signBytes);
        emit SignatureValidated(signBytesHash, r, s);

        // txPayload is ABI-encoded: (uint256 evmChainId, address accountAddress, uint64 sequence, uint64 count)
        // followed by packed calls data
        // Count is at fixed offset 96 (slot 3: after evmChainId, address, sequence)
        if (txPayload.length < 128) {
            revert PayloadTooShort();
        }

        uint64 count = abi.decode(txPayload[96:128], (uint64));
        if (count == 0 || count > MAX_BATCH_SIZE) {
            revert InvalidPayloadArray();
        }

        // Packed calls start after the entire ABI header (including string data)
        uint256 callsStartOffset = _getCallsOffset(txPayload);
        if (txPayload.length < callsStartOffset) {
            revert PayloadTooShort();
        }

        address[] memory destList = new address[](count);
        uint256[] memory valueList = new uint256[](count);
        bytes[] memory dataList = new bytes[](count);
        uint256 offset = callsStartOffset;
        for (uint64 i = 0; i < count; i++) {
            address dest;
            uint256 value;
            bytes calldata data;
            uint256 dataLen;
            if (txPayload.length < offset + TX_ITEM_HEADER_SIZE) {
                revert PayloadTooShort();
            }
            (dest, value, dataLen) = abi.decode(txPayload[offset:offset + TX_ITEM_HEADER_SIZE], (address, uint256, uint256));
            uint256 dataStart = offset + TX_ITEM_HEADER_SIZE;
            uint256 dataEnd = dataStart + dataLen;
            if (txPayload.length < dataEnd) {
                revert PayloadTooShort();
            }
            data = txPayload[dataStart:dataEnd];
            offset = dataEnd;

            destList[i] = dest;
            valueList[i] = value;
            dataList[i] = data;
        }

        try IAccount(payable(target)).executeTransactions(destList, valueList, dataList) returns (bool success) {
            if (!success) {
                revert TransactionFailed();
            }
        } catch Error(string memory reason2) {
            // catch failing revert() and require()
            revert TransactionError(reason2);
        } catch {
            // catch failing assert()
            revert TransactionError("Assertion failed");
        }

        emit TransactionHandled(target, sequence);
    }

    /**
     * @dev Decodes the txPayload header to extract evmChainId, target address, and sequence.
     * @param txPayload The transaction payload.
     * @return evmChainId The EVM chain ID (e.g., 1 for Ethereum, 137 for Polygon).
     * @return target The target account address.
     * @return sequence The sequence number.
     */
    function _decodeTxPayloadHeader(bytes calldata txPayload) internal pure returns (uint256, address, uint64) {
        // txPayload is ABI-encoded: (uint256 evmChainId, address accountAddress, uint64 sequence, uint64 count, calls[])
        // We decode evmChainId, accountAddress, and sequence
        (uint256 evmChainId, address target, uint64 sequence) = abi.decode(
            txPayload,
            (uint256, address, uint64)
        );
        return (evmChainId, target, sequence);
    }

    /**
     * @dev Gets the offset where packed calls data starts in txPayload.
     * @param txPayload The transaction payload (ABI-encoded header + packed calls).
     * @return The offset where packed calls data begins.
     */
    function _getCallsOffset(bytes calldata txPayload) internal pure returns (uint256) {
        // ABI encoding layout for (uint256, address, uint64, uint64):
        // - Slot 0 (0-32): uint256 evmChainId
        // - Slot 1 (32-64): address accountAddress
        // - Slot 2 (64-96): uint64 sequence
        // - Slot 3 (96-128): uint64 count
        //
        // Packed calls data starts at fixed offset 128 (4 slots × 32 bytes)
        return 128;
    }

    /**
     * @dev Creates a new account by calling the `createAccount` function in the account factory.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param threshold The threshold of the account.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly created account.
     */
    function _createAccount(
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 threshold,
        string calldata sourceAddress
    ) internal returns (address) {
        address accountAddress = accountFactory.createAccount(address(this), x, y, threshold, sourceAddress);

        emit AccountCreated(accountAddress);
        return accountAddress;
    }
}
