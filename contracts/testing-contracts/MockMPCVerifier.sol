// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../mpc-gateway/interfaces/IMPCVerifier.sol";

contract MockMPCVerifier is IMPCVerifier {
    bool private shouldValidate = true;
    address private owner;
    address public mpcSignerAddress;

    constructor() {
        owner = msg.sender;
    }

    function setShouldValidate(bool _shouldValidate) external {
        require(msg.sender == owner, "Only owner can set validation behavior");
        shouldValidate = _shouldValidate;
    }

    function validateMPCSignature(
        bytes32 payloadHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view override returns (bool) {
        // Return the configured validation result
        return shouldValidate;
    }

    function updateMPCSigner(address newSignerAddress) external override {
        require(msg.sender == owner, "Only owner can update signer");
        mpcSignerAddress = newSignerAddress;
    }
}
