// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../interfaces/ISignatureVerifier.sol";

contract SignatureVerifier is ISignatureVerifier {
    /**
     * @dev Helper function to recover signer address from signature.
     * @param messageHash The hash of the message that was signed.
     * @param r The r value of the signature.
     * @param s The s value of the signature.
     * @param v The recovery id (27 or 28 usually).
     * @return Returns the address that signed the message.
     */
    function recoverSigner(
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) public pure returns (address) {
        // Recover the signer's address from the message hash and signature
        return ecrecover(messageHash, v, r, s);
    }

    /**
     * @dev Verifies a given message hash was signed by the holder of the private key corresponding to the public key.
     * @param messageHash The hash of the message that was signed.
     * @param r The r value of the signature.
     * @param s The s value of the signature.
     * @param v The recovery id (27 or 28 usually).
     * @param expectedSigner The address expected to have signed the message.
     * @return Returns true if the signature is valid and was signed by the expected signer.
     */
    function verifySignature(
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        uint8 v,
        address expectedSigner
    ) public pure returns (bool) {
        address signer = recoverSigner(messageHash, r, s, v);
        
        // Check if the recovered address matches the expected signer address
        return signer == expectedSigner;
    }
}
