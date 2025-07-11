// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IMPCVerifier {
    /**
     * @notice Verifies the MPC signature.
     * @dev This function is called by the relayer on the destination chain to verify the MPC signature.
     * @param payloadHash Hash of the payload
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     */
    function validateMPCSignature(
        bytes32 payloadHash,
        bytes32 r,
        bytes32 s
    ) external view returns (bool);
}