// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../smart-account/interfaces/IAccount.sol";

/**
 * @dev Contract to test reentrancy protection in recoverTransaction
 */
contract ReentrantRecoverAttacker {
    address public target;
    uint8[] public v;
    bytes32[] public r;
    bytes32[] public s;
    bytes32[] public x;
    bytes32[] public y;
    bytes public payload;
    uint256 public attackCount;

    function setTarget(address _target) external {
        target = _target;
    }

    function setAttackPayload(
        uint8[] calldata _v,
        bytes32[] calldata _r,
        bytes32[] calldata _s,
        bytes32[] calldata _x,
        bytes32[] calldata _y,
        bytes calldata _payload
    ) external {
        v = _v;
        r = _r;
        s = _s;
        x = _x;
        y = _y;
        payload = _payload;
    }

    receive() external payable {
        attackCount++;
        if (attackCount < 3 && address(target).balance > 0) {
            try IAccount(payable(target)).recoverTransaction(v, r, s, x, y, payload) {
                // Reentrancy succeeded (unexpected if protected)
            } catch {
                // Reentrancy blocked (expected)
            }
        }
    }
}

/**
 * @dev Interface to get account sequence
 */
interface IAccountSequence {
    function accountSequence() external view returns (uint64);
}

/**
 * @dev Contract to check that sequence is incremented before external call
 */
contract SequenceChecker {
    address public accountToCheck;
    uint64 public sequenceAtCallTime;

    function setAccountToCheck(address _account) external {
        accountToCheck = _account;
    }

    receive() external payable {
        // Read the sequence at the time of the external call
        sequenceAtCallTime = IAccountSequence(accountToCheck).accountSequence();
    }
}
