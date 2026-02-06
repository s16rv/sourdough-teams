// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMPCVerifier {
    /**
     * @dev Error thrown when a zero address is provided.
     */
    error ZeroAddress();

    /**
     * @dev Error thrown when caller is not the owner.
     */
    error OnlyOwner();

    /**
     * @dev Error thrown when signature has invalid s value (malleability check).
     */
    error InvalidSignatureS();

    /**
     * @notice Emitted when the MPC public key is updated.
     * @dev Event emitted when the MPC public key is updated.
     * @param publicKeyX The previous X component of the MPC public key.
     * @param publicKeyY The previous Y component of the MPC public key.
     * @param newPublicKeyX The new X component of the MPC public key.
     * @param newPublicKeyY The new Y component of the MPC public key.
     */
    event MPCPublicKeyUpdated(
        bytes32 publicKeyX,
        bytes32 publicKeyY,
        bytes32 newPublicKeyX,
        bytes32 newPublicKeyY
    );

    /**
     * @notice Verifies the MPC signature using native ecrecover.
     * @dev This function is called by the relayer on the destination chain to verify the MPC signature.
     * @param payloadHash Hash of the payload
     * @param v Recovery parameter of the signature.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @return bool True if the signature is valid, false otherwise.
     */
    function validateMPCSignature(
        bytes32 payloadHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view returns (bool);
}
