// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IEntryPoint {
    // Errors
    error PayloadTooShort();
    error UnsupportedCategory();
    error InvalidSignature();
    error TransactionFailed();

    // Events
    event AccountCreated(address indexed accountAddress, address indexed recoveryAddress);
    event SignatureValidated(bytes32 messageHash, bytes32 r, bytes32 s);
    event TransactionExecuted(address indexed target, uint256 value, bytes data);
}
