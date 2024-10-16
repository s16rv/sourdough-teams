// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import { AxelarExecutable } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { IAxelarGateway } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol';
import { IAxelarGasService } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol';
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
        (uint8 category) = abi.decode(_payload[:32], (uint8));

        if (category == 1) {
            (
                address recover,
                bytes32 messageHash,
                bytes32 r,
                bytes32 s,
                bytes32 x,
                bytes32 y
            ) = abi.decode(_payload[32:], (address, bytes32, bytes32, bytes32, bytes32, bytes32));
            _createAccount(recover, messageHash, r, s, x, y);
        } 
        else if (category == 2) {
            if (_payload.length < 160 + 20) revert PayloadTooShort();

            (
                address target,
                bytes32 messageHash,
                bytes32 r,
                bytes32 s
            ) = abi.decode(_payload[32:160], (address, bytes32, bytes32, bytes32));

            bytes calldata txPayload = _payload[160:];

            _handleTransaction(target, messageHash, r, s, txPayload);
        } 
        else {
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
     * @param txPayload The transaction payload containing the destination address and value.
     */
    function _handleTransaction(
        address target,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes calldata txPayload
    ) internal {
        bool valid = IAccount(payable(target)).validateOperation(messageHash, r, s);
        if (!valid) {
            revert InvalidSignature();
        }

        emit SignatureValidated(messageHash, r, s);

        (address dest, uint256 value) = abi.decode(txPayload, (address, uint256));

        bool success = IAccount(payable(target)).executeTransaction(dest, value, txPayload[64:]);
        if (!success) {
            revert TransactionFailed();
        }

        emit TransactionExecuted(target, dest, value, txPayload[64:]);
    }

    /**
     * @dev Creates a new account by calling the `createAccount` function in the account factory.
     * @param recover The address that has recovery rights for the new account.
     * @param messageHash The hash of the message used for signature verification.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @return accountAddress The address of the newly created account.
     */
    function _createAccount(
        address recover,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y
    ) internal returns (address) {
        address accountAddress = accountFactory.createAccount(recover, address(this), messageHash, r, s, x, y);

        emit AccountCreated(accountAddress, recover);
        return accountAddress;
    }
}
