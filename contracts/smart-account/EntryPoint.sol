// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { AxelarExecutable } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/executable/AxelarExecutable.sol';
import { IAxelarGateway } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol';
import { IAxelarGasService } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGasService.sol';
import "./Account.sol";

interface IAccount {
    function validateOperation(bytes32 messageHash, bytes32 r, bytes32 s) external view returns (bool);
    function executeTransaction(address dest, uint256 value, bytes calldata data) external returns (bool);
}

contract EntryPoint is AxelarExecutable {
    IAxelarGasService public immutable gasService;

    event Executed(string sourceChain, string sourceAddress);
    event TransactionExecuted(address indexed target, bytes txPayload);
    event AccountCreated(address indexed accountAddress, address indexed owner);
    event TransactionHandled(address indexed dest, uint256 value, bytes payload);
    event SignatureValidated(bytes32 messageHash, bytes32 r, bytes32 s);

    /**
     *
     * @param _gateway address of axl gateway on deployed chain
     * @param _gasReceiver address of axl gas service on deployed chain
     */
    constructor(address _gateway, address _gasReceiver) AxelarExecutable(_gateway) {
        gasService = IAxelarGasService(_gasReceiver);
    }

    /**
     * @notice Send message from chain A to chain B
     * @dev message param is passed in as gmp message
     * @param destinationChain name of the dest chain (ex. "Fantom")
     * @param destinationAddress address on dest chain this tx is going to
     * @param _message message to be sent
     */
    function setRemoteValue(
        string calldata destinationChain,
        string calldata destinationAddress,
        string calldata _message
    ) external payable {
        require(msg.value > 0, 'Gas payment is required');

        bytes memory payload = abi.encode(_message);
        gasService.payNativeGasForContractCall{ value: msg.value }(
            address(this),
            destinationChain,
            destinationAddress,
            payload,
            msg.sender
        );
        gateway.callContract(destinationChain, destinationAddress, payload);
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
            require(_payload.length > 160 + 20, "Payload too short");

            // Decode the address and the signature components
            (address target, bytes32 messageHash, bytes32 r, bytes32 s) = abi.decode(_payload[32:160], (address, bytes32, bytes32, bytes32));

            // Decode the rest as bytes
            bytes calldata txPayload = _payload[160:];

            // Call _handleTransaction with the additional parameters
            _handleTransaction(target, messageHash, r, s, txPayload);
        } 
        else {
            revert("Unsupported category");
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
        require(IAccount(target).validateOperation(messageHash, r, s), "Invalid signature");
        emit SignatureValidated(messageHash, r, s);

        (address dest, uint256 value) = abi.decode(txPayload, (address, uint256));
        emit TransactionHandled(dest, value, txPayload[64:]);

        require(IAccount(target).executeTransaction(dest, value, txPayload[64:]), "Transaction failed");
        
        emit TransactionExecuted(target, txPayload);
    }

    function _createAccount(
        address owner,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s
    ) internal returns (address) {
        Account newAccount = new Account(owner, address(this), messageHash, r, s);
        
        emit AccountCreated(address(newAccount), owner);
        return address(newAccount);
    }
}
