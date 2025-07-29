// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../smart-account/interfaces/IEntryPoint.sol";

contract MockEntryPoint is IEntryPoint {
    bool private shouldSucceed = true;
    mapping(address => bool) private executors;
    address private owner;

    constructor() {
        owner = msg.sender;
    }

    function setShouldSucceed(bool _shouldSucceed) external {
        shouldSucceed = _shouldSucceed;
    }

    function executePayload(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) external override returns (bool) {
        // Emit the event for testing purposes
        emit Executed(_sourceChain, _sourceAddress);
        
        // Return the configured success value
        return shouldSucceed;
    }

    function setExecutor(address _executor, bool _isExecutor) external override {
        require(msg.sender == owner, "Only owner can set executor");
        executors[_executor] = _isExecutor;
    }
}