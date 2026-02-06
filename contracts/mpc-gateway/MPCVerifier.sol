// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IMPCVerifier.sol";

contract MPCVerifier is IMPCVerifier {
    // secp256k1 curve order / 2 for malleability check (EIP-2)
    uint256 private constant SECP256K1_N_DIV_2 =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address private immutable ownerAddress;
    bytes32 public publicKeyX;
    bytes32 public publicKeyY;

    /**
     * @notice Initializes the MPC verifier contract
     * @param _ownerAddress Address of the contract owner
     * @param _publicKeyX X coordinate of the MPC public key
     * @param _publicKeyY Y coordinate of the MPC public key
     */
    constructor(
        address _ownerAddress,
        bytes32 _publicKeyX,
        bytes32 _publicKeyY
    ) {
        if (_ownerAddress == address(0)) revert ZeroAddress();
        ownerAddress = _ownerAddress;
        publicKeyX = _publicKeyX;
        publicKeyY = _publicKeyY;
    }

    /**
     * @notice Validates the MPC signature using native ecrecover
     * @param payloadHash Hash of the payload to be signed
     * @param v Recovery parameter of the signature
     * @param r X coordinate of the signature
     * @param s Y coordinate of the signature
     * @return bool True if the signature is valid, false otherwise
     */
    function validateMPCSignature(
        bytes32 payloadHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view returns (bool) {
        address expectedAddr = _pubKeyToAddress(publicKeyX, publicKeyY);
        // v is 0-3 from MPC, add 27 for ecrecover
        address recovered = _recoverSigner(payloadHash, v + 27, r, s);

        return recovered == expectedAddr;
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
        if (msg.sender != ownerAddress) revert OnlyOwner();
        emit MPCPublicKeyUpdated(publicKeyX, publicKeyY, newPublicKeyX, newPublicKeyY);
        publicKeyX = newPublicKeyX;
        publicKeyY = newPublicKeyY;
    }

    /**
     * @dev Derives an Ethereum address from a public key.
     * @param x The x coordinate of the public key.
     * @param y The y coordinate of the public key.
     * @return The derived Ethereum address.
     */
    function _pubKeyToAddress(bytes32 x, bytes32 y) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(x, y)))));
    }

    /**
     * @dev Recovers the signer address using ecrecover.
     * @param messageHash The hash that was signed.
     * @param v Recovery id (27 or 28).
     * @param r Signature r component.
     * @param s Signature s component.
     * @return The recovered address, or address(0) if invalid.
     */
    function _recoverSigner(
        bytes32 messageHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (address) {
        // Check for signature malleability (EIP-2)
        if (uint256(s) > SECP256K1_N_DIV_2) {
            return address(0);
        }

        // v must be 27 or 28
        if (v != 27 && v != 28) {
            return address(0);
        }

        return ecrecover(messageHash, v, r, s);
    }
}
