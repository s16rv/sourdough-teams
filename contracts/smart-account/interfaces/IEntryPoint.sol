// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IEntryPoint {
    // Errors
    error PayloadTooShort();
    error UnsupportedCategory();
    error InvalidSignature();
    error TransactionFailed();

    // Events
    event Executed(string sourceChain, string sourceAddress);
    event AccountCreated(address indexed accountAddress, address indexed recoveryAddress);
    event SignatureValidated(bytes32 messageHash, bytes32 r, bytes32 s);
    event TransactionExecuted(address indexed traget, address indexed dest, uint256 value, bytes data);
}
