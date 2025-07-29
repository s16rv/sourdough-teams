// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../mpc-gateway/interfaces/IMPCVerifier.sol";

contract MockMPCVerifier is IMPCVerifier {
    bool private shouldValidate = true;
    address private owner;

    constructor() {
        owner = msg.sender;
    }

    function setShouldValidate(bool _shouldValidate) external {
        require(msg.sender == owner, "Only owner can set validation behavior");
        shouldValidate = _shouldValidate;
    }

    function validateMPCSignature(
        bytes32 payloadHash,
        bytes32 r,
        bytes32 s
    ) external view override returns (bool) {
        // Return the configured validation result
        return shouldValidate;
    }
}