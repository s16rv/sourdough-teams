// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../smart-account/interfaces/IEntryPoint.sol";
import "../smart-account/interfaces/IAccount.sol";

contract MockEntryPoint is IEntryPoint {
    bool private shouldSucceed = true;
    address private owner;
    address private _mpcGateway;

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

    function setMPCGateway(address mpcGateway_) external override {
        require(msg.sender == owner, "Only owner can set MPCGateway");
        _mpcGateway = mpcGateway_;
    }

    function mpcGateway() external view returns (address) {
        return _mpcGateway;
    }

    // Helper for testing: call validateAndExecute on an Account
    function callValidateAndExecute(
        address account,
        bytes calldata signBytes,
        uint256 txPayloadHashOffset,
        IAccount.SignatureData calldata sigs,
        bytes calldata txPayload
    ) external returns (bool) {
        return
            IAccount(payable(account)).validateAndExecute(signBytes, txPayloadHashOffset, sigs, txPayload);
    }
}
