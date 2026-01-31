// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @title RejectETH
 * @dev A contract that always rejects ETH transfers (for testing error paths)
 */
contract RejectETH {
    error ETHNotAccepted();

    receive() external payable {
        revert ETHNotAccepted();
    }

    fallback() external payable {
        revert ETHNotAccepted();
    }
}

/**
 * @title AssertFailer
 * @dev A contract that fails with assert (for testing catch-all error path)
 */
contract AssertFailer {
    function failWithAssert() external pure {
        assert(false);
    }

    receive() external payable {
        assert(false);
    }
}
