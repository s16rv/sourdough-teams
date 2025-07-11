// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../smart-account/util/SignatureVerifier.sol";

contract MPCVerifier {
    address private ownerAddress;
    bytes32 private publicKeyX;
    bytes32 private publicKeyY;
    address private immutable verifierAddress; // Secp256k1 verifier address

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

    // Validate MPC signature
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

    // Update MPC public key (for upgradability)
    function updateMPCPublicKey(
        bytes32 newPublicKeyX,
        bytes32 newPublicKeyY
    ) public {
        require(msg.sender == ownerAddress, "Only owner can update public key");
        publicKeyX = newPublicKeyX;
        publicKeyY = newPublicKeyY;
    }
}