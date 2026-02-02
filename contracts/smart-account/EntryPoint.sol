// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IEntryPoint.sol";
import "./interfaces/IAccount.sol";
import "./interfaces/IAccountFactory.sol";

uint64 constant MAX_BATCH_SIZE = 20;

// Payload parsing constants
uint64 constant SLOT_SIZE = 32;                    // Size of an ABI-encoded slot
uint64 constant PUBKEY_SIZE = 64;                  // Size of a public key (x + y)
uint64 constant SIGNER_WITH_SIG_SIZE = 128;        // Size of signer block (r + s + x + y)
uint64 constant CREATE_ACCOUNT_HEADER_SIZE = 96;   // Category 1: category(32) + totalSigners(32) + threshold(32)
uint64 constant EXECUTE_TX_HEADER_SIZE = 192;      // Category 2: category(32) + target(32) + messageHash(32) + proof(32) + sequence(32) + numberSigners(32)
uint256 constant TX_ITEM_HEADER_SIZE = 96;         // Transaction item: dest(32) + value(32) + dataLen(32)

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
            (address target, bytes32 messageHash, bytes32 proof, uint64 sequence, uint64 numberSigners) = abi.decode(
                _payload[SLOT_SIZE:EXECUTE_TX_HEADER_SIZE],
                (address, bytes32, bytes32, uint64, uint64)
            );

            uint64 offset = EXECUTE_TX_HEADER_SIZE;

            // Dynamic arrays for r, s, x, y based on the number of signers
            bytes32[] memory r = new bytes32[](numberSigners);
            bytes32[] memory s = new bytes32[](numberSigners);
            bytes32[] memory x = new bytes32[](numberSigners);
            bytes32[] memory y = new bytes32[](numberSigners);

            // Loop through the total signers to extract their signatures and public keys
            for (uint64 i = 0; i < numberSigners; i++) {
                uint64 index = offset + i * SIGNER_WITH_SIG_SIZE;

                // Decode r, s, x, and y for the current signer
                (r[i], s[i], x[i], y[i]) = abi.decode(
                    _payload[index:index + SIGNER_WITH_SIG_SIZE],
                    (bytes32, bytes32, bytes32, bytes32)
                );
            }

            uint64 txPayloadOffset = offset + numberSigners * SIGNER_WITH_SIG_SIZE;

            bytes calldata txPayload = _payload[txPayloadOffset:];

            _handleTransaction(target, messageHash, r, s, x, y, proof, sequence, _sourceAddress, txPayload);
        }

        emit Executed(_sourceChain, _sourceAddress);
    }

    /**
     * @dev Handles the execution of a transaction on the destination chain by validating the signature and calling the target account's `executeTransaction` function.
     * @param target The target address to execute the transaction.
     * @param messageHash The hash of the message used for signature verification.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param proof The proof of the transaction.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param txPayload The transaction payload containing the destination address and value.
     */
    function _handleTransaction(
        address target,
        bytes32 messageHash,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 proof,
        uint64 sequence,
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal {
        // Validate target is a known account
        address expectedAccount = accountFactory.getAccount(sourceAddress);
        if (target != expectedAccount) {
            revert InvalidTargetAccount();
        }

        (bool valid, string memory reason) = IAccount(payable(target)).validateOperation(
            sourceAddress,
            messageHash,
            r,
            s,
            x,
            y,
            proof,
            sequence,
            txPayload
        );

        if (!valid) {
            return;
        }

        emit SignatureValidated(messageHash, r, s);
        if (txPayload.length < SLOT_SIZE) {
            revert PayloadTooShort();
        }

        uint64 count = abi.decode(txPayload[:SLOT_SIZE], (uint64));
        if (count == 0) {
            revert InvalidPayloadArray();
        }

        if (count == 0 || count > MAX_BATCH_SIZE) { revert InvalidPayloadArray(); }

        address[] memory destList = new address[](count);
        uint256[] memory valueList = new uint256[](count);
        bytes[] memory dataList = new bytes[](count);
        uint256 offset = SLOT_SIZE;
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
