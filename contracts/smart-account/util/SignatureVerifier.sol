// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Helper library for external contracts to verify Secp256k1 signatures.
 **/
library SignatureVerifier {
    /**
     * @dev Verifies a Secp256k1 signature using the provided verifier contract.
     * @param verifier The address of the verifier contract.
     * @param message_hash The hash of the message that was signed.
     * @param r The r component of the signature.
     * @param s The s component of the signature.
     * @param x The x coordinate of the public key.
     * @param y The y coordinate of the public key.
     * @return bool Returns true if the signature is valid, otherwise false.
     */
    function verifySignature(
        address verifier,
        bytes32 message_hash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y
    ) internal view returns (bool) {
        bytes memory args = abi.encodePacked(message_hash, r, s, x, y);
        (bool success, bytes memory ret) = verifier.staticcall(args);
        if (!success) {
            return false;
        }

        return abi.decode(ret, (uint256)) == 1;
    }
}
