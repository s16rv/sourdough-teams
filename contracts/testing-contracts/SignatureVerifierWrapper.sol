// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../smart-account/util/SignatureVerifier.sol";

/**
 * @title SignatureVerifierWrapper
 * @dev Wrapper contract to expose SignatureVerifier library functions for testing
 */
contract SignatureVerifierWrapper {
    /**
     * @dev Exposes SignatureVerifier.verifySignature for testing
     */
    function testVerify(
        address verifier,
        bytes32 message_hash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y
    ) external view returns (bool) {
        return SignatureVerifier.verifySignature(verifier, message_hash, r, s, x, y);
    }
}
