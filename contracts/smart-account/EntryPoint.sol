// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IEntryPoint.sol";
import "./interfaces/IAccount.sol";
import "./interfaces/IAccountFactory.sol";

// Payload parsing constants
uint64 constant SLOT_SIZE = 32;                    // Size of an ABI-encoded slot
uint64 constant PUBKEY_SIZE = 64;                  // Size of a public key (x + y)
uint64 constant SIGNER_WITH_SIG_SIZE = 129;        // Size of signer block (v(1) + r(32) + s(32) + x(32) + y(32))
uint64 constant CREATE_ACCOUNT_HEADER_SIZE = 96;   // Category 1: category(32) + totalSigners(32) + threshold(32)
uint64 constant NEW_HEADER_SIZE = 128;             // Category 2: category(32) + signBytesLen(32) + hashOffset(32) + numSigners(32)

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
            // Parse payload to extract components for forwarding to Account
            (uint256 signBytesLength, uint256 txPayloadHashOffset, uint64 numberSigners) = abi.decode(
                _payload[SLOT_SIZE:NEW_HEADER_SIZE],
                (uint256, uint256, uint64)
            );

            uint256 offset = NEW_HEADER_SIZE;

            // Extract signBytes
            bytes calldata signBytes = _payload[offset:offset + signBytesLength];
            offset += signBytesLength;

            // Extract signatures and public keys into struct
            IAccount.SignatureData memory sigs;
            sigs.v = new uint8[](numberSigners);
            sigs.r = new bytes32[](numberSigners);
            sigs.s = new bytes32[](numberSigners);
            sigs.x = new bytes32[](numberSigners);
            sigs.y = new bytes32[](numberSigners);

            for (uint64 i = 0; i < numberSigners; i++) {
                uint256 index = offset + i * SIGNER_WITH_SIG_SIZE;
                sigs.v[i] = uint8(_payload[index]);
                sigs.r[i] = bytes32(_payload[index + 1:index + 33]);
                sigs.s[i] = bytes32(_payload[index + 33:index + 65]);
                sigs.x[i] = bytes32(_payload[index + 65:index + 97]);
                sigs.y[i] = bytes32(_payload[index + 97:index + 129]);
            }

            offset += numberSigners * SIGNER_WITH_SIG_SIZE;

            // Remaining is txPayload
            bytes calldata txPayload = _payload[offset:];

            // Extract target account from txPayload (address is at offset 32, after evmChainId)
            if (txPayload.length < 64) revert PayloadTooShort();
            address target = abi.decode(txPayload[32:64], (address));

            // Forward to Account.validateAndExecute()
            // Account validates everything: chainId, accountAddress, signatures, sequence, hash commitment
            // Then executes the calls atomically
            try IAccount(payable(target)).validateAndExecute(
                signBytes,
                txPayloadHashOffset,
                sigs,
                txPayload
            ) returns (bool success) {
                if (!success) {
                    revert TransactionFailed();
                }
                emit TransactionHandled(target, 0);
            } catch Error(string memory reason) {
                revert TransactionError(reason);
            } catch {
                revert TransactionFailed();
            }
        }

        emit Executed(_sourceChain, _sourceAddress);
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
