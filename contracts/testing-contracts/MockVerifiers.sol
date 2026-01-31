// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @title BadVerifier
 * @dev Mock verifier that returns a configurable value (for testing SignatureVerifier)
 */
contract BadVerifier {
    uint256 private returnValue;

    function setReturnValue(uint256 _value) external {
        returnValue = _value;
    }

    /**
     * @dev Fallback that mimics EIP-7212 interface but returns configurable value
     */
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encodePacked(returnValue);
    }
}

/**
 * @title RevertingVerifier
 * @dev Mock verifier that always reverts (for testing failure path)
 */
contract RevertingVerifier {
    error AlwaysReverts();

    fallback() external {
        revert AlwaysReverts();
    }
}
