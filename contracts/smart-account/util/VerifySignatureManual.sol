// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./P256.sol";

contract VerifySignatureManual {
    function verifySignature(
        address verifier,    // Add verifier address as parameter
        bytes32 msgHash,     // Hashed message (bytes32)
        uint256 r,           // r value of the signature
        uint256 s,           // s value of the signature
        uint256 publicKeyX,  // Public key X coordinate
        uint256 publicKeyY   // Public key Y coordinate
    ) public view returns (bool) {
        bool valid = P256.verifySignatureAllowMalleability(verifier, msgHash, r, s, publicKeyX, publicKeyY);
        return valid;
    }
}
