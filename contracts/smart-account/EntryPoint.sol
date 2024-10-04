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
     *
     * @param _gateway address of axl gateway on deployed chain
     */
    constructor(address _gateway, address _accountFactory) AxelarExecutable(_gateway) {
        accountFactory = IAccountFactory(_accountFactory);
    }

    /**
     * @notice logic to be executed on dest chain
     * @dev this is triggered automatically by relayer
     * @param _sourceChain blockchain where tx is originating from
     * @param _sourceAddress address on src chain where tx is originating from
     * @param _payload encoded gmp message sent from src chain
     */
    function _execute(string calldata _sourceChain, string calldata _sourceAddress, bytes calldata _payload) internal override {
        // Decode the first part of the payload to identify which function to execute
        (uint8 category) = abi.decode(_payload[:32], (uint8));

        if (category == 1) {
            // Handle category 2: createAccount
            (address owner, bytes32 messageHash, bytes32 r, bytes32 s) = abi.decode(_payload[32:], (address, bytes32, bytes32, bytes32));
            
            _createAccount(owner, messageHash, r, s);
        } 
        else if (category == 2) {
            // Handle category 2: handleTransaction
            // Check that the payload is large enough to contain both an address and the data
            if (_payload.length < 160 + 20) revert PayloadTooShort();

            // Decode the address and the signature components
            (address target, bytes32 messageHash, bytes32 r, bytes32 s) = abi.decode(_payload[32:160], (address, bytes32, bytes32, bytes32));

            // Decode the rest as bytes
            bytes calldata txPayload = _payload[160:];

            // Call _handleTransaction with the additional parameters
            _handleTransaction(target, messageHash, r, s, txPayload);
        } 
        else {
            revert UnsupportedCategory();
        }

        // Emit the executed event
        emit Executed(_sourceChain, _sourceAddress);
    }

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

    function _createAccount(
        address recover,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s
    ) internal returns (address) {
        address accountAddress = accountFactory.createAccount(recover, address(this), messageHash, r, s);
        
        emit AccountCreated(accountAddress, recover);
        return accountAddress;
    }
}
