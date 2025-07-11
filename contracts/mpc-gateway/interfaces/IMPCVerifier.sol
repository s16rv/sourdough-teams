// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IMPCVerifier {
    function validateMPCSignature(
        bytes32 payloadHash,
        bytes32 r,
        bytes32 s
    ) external view returns (bool);
}