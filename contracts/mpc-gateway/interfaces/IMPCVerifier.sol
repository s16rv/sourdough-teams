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
     * @notice Emitted when the MPC signer address is updated.
     * @dev Event emitted when the MPC signer is updated.
     * @param oldSignerAddress The previous MPC signer address.
     * @param newSignerAddress The new MPC signer address.
     */
    event MPCSignerUpdated(address oldSignerAddress, address newSignerAddress);

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

    /**
     * @notice Updates the MPC signer address.
     * @param newSignerAddress The new MPC signer address.
     * @dev Only the contract owner can update the signer address.
     */
    function updateMPCSigner(address newSignerAddress) external;
}
