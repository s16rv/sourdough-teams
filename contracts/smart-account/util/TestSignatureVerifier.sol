// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * Helper library for external contracts to verify Secp256k1 signatures.
 **/
library TestSignatureVerifier {
    function verifySignature(
        address verifier,
        bytes32 message_hash,
        uint256 r,
        uint256 s,
        uint256 x,
        uint256 y
    ) public view returns (bool) {
        bytes memory args = abi.encode(message_hash, r, s, x, y);
        (bool success, bytes memory ret) = verifier.staticcall(args);
        assert(success);

        return abi.decode(ret, (uint256)) == 1;
    }
}
