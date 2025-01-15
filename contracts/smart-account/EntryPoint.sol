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

    /**
     * @dev Constructor to initialize the EntryPoint contract with the Axelar gateway and account factory addresses.
     * @param _gateway Address of the Axelar gateway on the deployed chain.
     * @param _accountFactory Address of the account factory that manages account creation.
     */
    constructor(address _gateway, address _accountFactory) AxelarExecutable(_gateway) {
        accountFactory = IAccountFactory(_accountFactory);
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
            (address recover, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 x, bytes32 y) = abi.decode(
                _payload[32:],
                (address, bytes32, bytes32, bytes32, bytes32, bytes32)
            );
            _createAccount(recover, messageHash, r, s, x, y, _sourceAddress);
        } else if (category == 2) {
            if (_payload.length < 192 + 20) revert PayloadTooShort();

            (address target, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 proof) = abi.decode(
                _payload[32:192],
                (address, bytes32, bytes32, bytes32, bytes32)
            );

            bytes calldata txPayload = _payload[192:];

            _handleTransaction(target, messageHash, r, s, proof, _sourceAddress, txPayload);
        } else if (category == 3) {
            // == proof part ==
            // category             32 bytes
            // target               20 bytes
            // messageHash          32 bytes
            // r                    32 bytes
            // s                    32 bytes
            // proof                32 bytes

            // == authorization part ==
            // expirationTs         32 bytes - this will identify the expiration timestamp (uint256)
            // authLength           32 bytes - this will identify the length of authorization data length (uint16)
            // authPayload          bytes    - parsed by length

            // == smart contract payload part ==
            // txPayload            bytes

            // 192 is for the proof part
            // 64 is for expiration timestamp and length
            // 20 is for payload
            // the rest can be optional
            if (_payload.length < 192 + 64 + 20) revert PayloadTooShort();

            (address target, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 proof) = abi.decode(
                _payload[32:192],
                (address, bytes32, bytes32, bytes32, bytes32)
            );

            (uint32 expTs, uint16 authLength) = abi.decode(_payload[192:256], (uint32, uint16));

            bytes calldata authPayload = _payload[256:(256 + authLength)];

            bytes calldata txPayload = _payload[(256 + authLength):];

            _handleCreateIcauthz(target, messageHash, r, s, proof, _sourceAddress, txPayload, expTs, authPayload);
        } else if (category == 4) {
            if (_payload.length < 192 + 20) revert PayloadTooShort();

            (address target, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 proof) = abi.decode(
                _payload[32:192],
                (address, bytes32, bytes32, bytes32, bytes32)
            );

            bytes calldata txPayload = _payload[192:];

            _handleExecuteIcauthz(target, messageHash, r, s, proof, _sourceAddress, txPayload);
        } else if (category == 5) {
            if (_payload.length < 192 + 20) revert PayloadTooShort();

            (address target, bytes32 messageHash, bytes32 r, bytes32 s, bytes32 proof) = abi.decode(
                _payload[32:192],
                (address, bytes32, bytes32, bytes32, bytes32)
            );

            bytes calldata txPayload = _payload[192:];

            _handleRevokeIcauthz(target, messageHash, r, s, proof, _sourceAddress, txPayload);
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
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal {
        bool valid = IAccount(payable(target)).validateOperation(sourceAddress, messageHash, r, s, proof, txPayload);
        if (!valid) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r, s);

        (address dest, uint256 value) = abi.decode(txPayload, (address, uint256));

        bool success = IAccount(payable(target)).executeTransaction(dest, value, txPayload);
        if (!success) {
            revert TransactionFailed();
        }

        emit TransactionExecuted(target, dest, value, txPayload);
    }

    /**
     * @dev Creates a new account by calling the `createAccount` function in the account factory.
     * @param recover The address that has recovery rights for the new account.
     * @param messageHash The hash of the message used for signature verification.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly created account.
     */
    function _createAccount(
        address recover,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y,
        string calldata sourceAddress
    ) internal returns (address) {
        address accountAddress = accountFactory.createAccount(
            recover,
            address(this),
            messageHash,
            r,
            s,
            x,
            y,
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
        string calldata sourceAddress,
        bytes calldata txPayload,
        uint32 expTimestamp,
        bytes calldata authPayload
    ) internal {
        bool valid = IAccount(payable(target)).validateOperation(sourceAddress, messageHash, r, s, proof, txPayload);
        if (!valid) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r, s);

        (address dest, uint256 value) = abi.decode(txPayload, (address, uint256));

        IAccount(payable(target)).createStoredContract(dest, value, txPayload, expTimestamp, authPayload);
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
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal {
        bool validOperation = IAccount(payable(target)).validateOperation(
            sourceAddress,
            messageHash,
            r,
            s,
            proof,
            txPayload
        );
        if (!validOperation) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r, s);

        (address dest, uint256 value) = abi.decode(txPayload, (address, uint256));

        bool validAuth = IAccount(payable(target)).validateAuthorization(dest, value, txPayload);
        if (!validAuth) {
            revert InvalidAuthorization();
        }

        bool success = IAccount(payable(target)).executeTransaction(dest, value, txPayload);
        if (!success) {
            revert TransactionFailed();
        }

        emit TransactionExecuted(target, dest, value, txPayload);
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
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal {
        bool validOperation = IAccount(payable(target)).validateOperation(
            sourceAddress,
            messageHash,
            r,
            s,
            proof,
            txPayload
        );
        if (!validOperation) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r, s);

        IAccount(payable(target)).revokeStoredContract();
    }
}
