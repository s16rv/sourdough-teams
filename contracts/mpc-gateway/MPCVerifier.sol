// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../smart-account/util/SignatureVerifier.sol";

contract MPCVerifier {
    address private ownerAddress;
    bytes32 private publicKeyX;
    bytes32 private publicKeyY;
    address private immutable verifierAddress; // Secp256k1 verifier address

    /**
     * @notice Initializes the MPC verifier contract
     * @param _ownerAddress Address of the contract owner
     * @param _verifierAddress Address of the Secp256k1 signature verifier
     * @param _publicKeyX X coordinate of the MPC public key
     * @param _publicKeyY Y coordinate of the MPC public key
     */
    constructor(
        address _ownerAddress,
        address _verifierAddress,
        bytes32 _publicKeyX,
        bytes32 _publicKeyY
    ) {
        ownerAddress = _ownerAddress;
        verifierAddress = _verifierAddress;
        publicKeyX = _publicKeyX;
        publicKeyY = _publicKeyY;
    }

    /**
     * @notice Validates the MPC signature
     * @param payloadHash Hash of the payload to be signed
     * @param r X coordinate of the signature
     * @param s Y coordinate of the signature
     * @return bool True if the signature is valid, false otherwise
     */
    function validateMPCSignature(bytes32 payloadHash, bytes32 r, bytes32 s) external view returns (bool) {
        return SignatureVerifier.verifySignature(
            verifierAddress,
            payloadHash,
            r,
            s,
            publicKeyX,
            publicKeyY
        );
    }

    /**
     * @notice Updates the MPC public key
     * @param newPublicKeyX X coordinate of the new MPC public key
     * @param newPublicKeyY Y coordinate of the new MPC public key
     * @dev Only the contract owner can update the public key
     */
    function updateMPCPublicKey(
        bytes32 newPublicKeyX,
        bytes32 newPublicKeyY
    ) public {
        require(msg.sender == ownerAddress, "Only owner can update public key");
        publicKeyX = newPublicKeyX;
        publicKeyY = newPublicKeyY;
    }
}