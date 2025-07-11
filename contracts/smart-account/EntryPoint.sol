// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {AxelarExecutable} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol";
import {IAxelarGateway} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol";
import {IAxelarGasService} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol";
import "./interfaces/IEntryPoint.sol";
import "./interfaces/IAccount.sol";
import "./interfaces/IAccountFactory.sol";

contract EntryPoint is IEntryPoint, AxelarExecutable {
    IAccountFactory public immutable accountFactory;
    address[] public executors;

    /**
     * @dev Constructor to initialize the EntryPoint contract with the Axelar gateway and account factory addresses.
     * @param _gateway Address of the Axelar gateway on the deployed chain.
     * @param _accountFactory Address of the account factory that manages account creation.
     */
    constructor(address _gateway, address _accountFactory, address[] memory _executors) AxelarExecutable(_gateway) {
        accountFactory = IAccountFactory(_accountFactory);
        executors = _executors;
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
            return false;
        }
        
        _execute(_sourceChain, _sourceAddress, _payload);

        return true;
    }

    /**
     * @notice Logic to be executed on the destination chain.
     * @dev This function is triggered automatically by the relayer when a cross-chain message is received.
     * It decodes the payload to identify which function to execute based on the `category`.
     * @param _sourceChain The blockchain where the transaction originated.
     * @param _sourceAddress The address on the source chain where the transaction originated.
     * @param _payload The encoded GMP (General Message Passing) message sent from the source chain.
     */
    function _execute(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) internal override {
        uint8 category = abi.decode(_payload[:32], (uint8));

        if (category == 1) {
            (address recover, uint64 totalSigners, uint64 threshold) = abi.decode(
            _payload[32:128],
            (address, uint64, uint64)
            );

            uint64 offset = 128;

            // Dynamic arrays for x, y based on the total signers
            bytes32[] memory x = new bytes32[](totalSigners);
            bytes32[] memory y = new bytes32[](totalSigners);

            // Loop through the total signers to extract their public keys
            for (uint64 i = 0; i < totalSigners ; i++) {
                uint64 index = offset + i * 64; // Each signer consists of 64 bytes

                // Decode x, y for the current signer
                (x[i], y[i]) = abi.decode(_payload[index:index + 64], (bytes32, bytes32));
            }

            _createAccount(recover, x, y, threshold, _sourceAddress);
        } else if (category == 2) {
            (address target, bytes32 messageHash, bytes32 proof, uint64 sequence, uint64 numberSigners) = abi.decode(
                _payload[32:192],
                (address, bytes32, bytes32, uint64, uint64)
            );

            uint64 offset = 192;

            // Dynamic arrays for r, s, x, y based on the number of signers
            bytes32[] memory r = new bytes32[](numberSigners);
            bytes32[] memory s = new bytes32[](numberSigners);
            bytes32[] memory x = new bytes32[](numberSigners);
            bytes32[] memory y = new bytes32[](numberSigners);

            // Loop through the total signers to extract their signatures and public keys
            for (uint64 i = 0; i < numberSigners ; i++) {
                uint64 index = offset + i * 128; // Each signer consists of 128 bytes

                // Decode r, s, x, and y for the current signer
                (r[i], s[i], x[i], y[i]) = abi.decode(_payload[index:index + 128], (bytes32, bytes32, bytes32, bytes32));
            }

            uint64 txPayloadOffset = offset + numberSigners * 128;

            bytes calldata txPayload = _payload[txPayloadOffset:];

            _handleTransaction(target, messageHash, r, s, x, y, proof, sequence, _sourceAddress, txPayload);
        } else if (category == 3) {
            // 192 is for the proof part
            // 6 is for expiration timestamp and length
            // 10++ is for payload
            // the rest can be optional
            if (_payload.length < 224 + 6 + 10) revert PayloadTooShort();

            (address target, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 proof, uint64 sequence) = abi.decode(
                _payload[32:224],
                (address, bytes32, bytes32, bytes32, bytes32, uint64)
            );

            // Manually extract and decode
            uint32 expTs = uint32(bytes4(_payload[224:228]));
            uint16 authLength = uint16(bytes2(_payload[228:230]));

            bytes calldata authPayload = _payload[230:(230 + authLength)];
            bytes calldata txPayload = _payload[(230 + authLength):];

            _handleCreateIcauthz(target, messageHash, r, s, proof, sequence, _sourceAddress, txPayload, expTs, authPayload);
        } else if (category == 4) {
            if (_payload.length < 224 + 20) revert PayloadTooShort();

            (address target, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 proof, uint64 sequence) = abi.decode(
                _payload[32:224],
                (address, bytes32, bytes32, bytes32, bytes32, uint64)
            );

            bytes calldata txPayload = _payload[224:];

            _handleExecuteIcauthz(target, messageHash, r, s, proof, sequence, _sourceAddress, txPayload);
        } else if (category == 5) {
            if (_payload.length < 224 + 20) revert PayloadTooShort();

            (address target, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 proof, uint64 sequence) = abi.decode(
                _payload[32:224],
                (address, bytes32, bytes32, bytes32, bytes32, uint64)
            );

            bytes calldata txPayload = _payload[224:];

            _handleRevokeIcauthz(target, messageHash, r, s, proof, sequence, _sourceAddress, txPayload);
        } else {
            revert UnsupportedCategory();
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
        bool valid = IAccount(payable(target)).validateOperation(
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
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r, s);

        (address dest, uint256 value) = abi.decode(txPayload, (address, uint256));
        bytes calldata data = txPayload[64:];

        bool success = IAccount(payable(target)).executeTransaction(dest, value, data);
        if (!success) {
            revert TransactionFailed();
        }

        emit TransactionHandled(target, dest, value, data);
    }

    /**
     * @dev Creates a new account by calling the `createAccount` function in the account factory.
     * @param recover The address that has recovery rights for the new account.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param threshold The threshold of the account.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly created account.
     */
    function _createAccount(
        address recover,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 threshold,
        string calldata sourceAddress
    ) internal returns (address) {
        address accountAddress = accountFactory.createAccount(
            recover,
            address(this),
            x,
            y,
            threshold,
            sourceAddress
        );

        emit AccountCreated(accountAddress, recover);
        return accountAddress;
    }

    /**
     * @dev Handles the creation of icauthz on the destination chain by validating the signature and store the tx details.
     * @param target The target address to execute the transaction.
     * @param messageHash The hash of the message used for signature verification.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param proof The proof of the transaction.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param txPayload The transaction payload containing the destination address and value.
     * @param expTimestamp Expiration Timestamp
     * @param authPayload Auth Payload
     */
    function _handleCreateIcauthz(
        address target,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        uint64 sequence,
        string calldata sourceAddress,
        bytes calldata txPayload,
        uint32 expTimestamp,
        bytes calldata authPayload
    ) internal {
        bytes32[] memory r1 = new bytes32[](1);
        bytes32[] memory s1 = new bytes32[](1);
        bytes32[] memory x1 = new bytes32[](1);
        bytes32[] memory y1 = new bytes32[](1);

        bool valid = IAccount(payable(target)).validateOperation(sourceAddress, messageHash, r1, s1, x1, y1, proof, sequence, txPayload);
        if (!valid) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r1, s1);
        IAccount(payable(target)).createStoredContract(txPayload, expTimestamp, authPayload);
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
    function _handleExecuteIcauthz(
        address target,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        uint64 sequence,
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal {
        bytes32[] memory r1 = new bytes32[](1);
        bytes32[] memory s1 = new bytes32[](1);
        bytes32[] memory x1 = new bytes32[](1);
        bytes32[] memory y1 = new bytes32[](1);

        bool validOperation = IAccount(payable(target)).validateOperation(
            sourceAddress,
            messageHash,
            r1,
            s1,
            x1,
            y1,
            proof,
            sequence,
            txPayload
        );
        if (!validOperation) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r1, s1);

        (address dest, uint256 value) = abi.decode(txPayload, (address, uint256));

        bool validAuth = IAccount(payable(target)).validateAuthorization(txPayload);
        if (!validAuth) {
            revert InvalidAuthorization();
        }

        bool success = IAccount(payable(target)).executeTransaction(dest, value, txPayload);
        if (!success) {
            revert TransactionFailed();
        }

        emit TransactionHandled(target, dest, value, txPayload);
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
    function _handleRevokeIcauthz(
        address target,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        uint64 sequence,
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal {
        bytes32[] memory r1 = new bytes32[](1);
        bytes32[] memory s1 = new bytes32[](1);
        bytes32[] memory x1 = new bytes32[](1);
        bytes32[] memory y1 = new bytes32[](1);

        bool validOperation = IAccount(payable(target)).validateOperation(
            sourceAddress,
            messageHash,
            r1,
            s1,
            x1,
            y1,
            proof,
            sequence,
            txPayload
        );
        if (!validOperation) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r1, s1);

        IAccount(payable(target)).revokeStoredContract();
    }

    /**
     * @dev Checks if an address is an executor.
     * @param sender The address to check.
     * @return True if the address is an executor, false otherwise.
     */
    function isExecutor(address sender) internal view returns (bool) {
        for (uint256 i = 0; i < executors.length; i++) {
            if (sender == executors[i]) {
                return true;
            }
        }
        return false;
    }
}
