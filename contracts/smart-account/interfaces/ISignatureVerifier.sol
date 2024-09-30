// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ISignatureVerifier {

    /**
     * @dev Recovers the signer address from the message hash and signature.
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
    ) external pure returns (address);

    /**
     * @dev Verifies if a message hash was signed by the expected signer.
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
    ) external pure returns (bool);
}
