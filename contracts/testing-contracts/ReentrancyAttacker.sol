// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "../smart-account/account/Account.sol";

/**
 * @title ReentrancyAttacker
 * @dev Malicious contract that attempts reentrancy attacks on Account
 */
contract ReentrancyAttacker {
    Account public target;
    uint256 public attackCount;
    uint256 public maxAttacks;
    bool public attacking;

    // For recover transaction attack
    uint8[] public v;
    bytes32[] public r;
    bytes32[] public s;
    bytes32[] public x;
    bytes32[] public y;
    bytes public txPayload;

    event AttackAttempt(uint256 count, uint256 balance);
    event ReceivedETH(uint256 amount);

    constructor() {}

    function setTarget(address _target) external {
        target = Account(payable(_target));
    }

    function setAttackParams(uint256 _maxAttacks) external {
        maxAttacks = _maxAttacks;
        attackCount = 0;
    }

    function setRecoverParams(
        uint8[] calldata _v,
        bytes32[] calldata _r,
        bytes32[] calldata _s,
        bytes32[] calldata _x,
        bytes32[] calldata _y,
        bytes calldata _txPayload
    ) external {
        v = _v;
        r = _r;
        s = _s;
        x = _x;
        y = _y;
        txPayload = _txPayload;
    }

    function startAttack() external {
        attacking = true;
    }

    function stopAttack() external {
        attacking = false;
    }

    /**
     * @dev Called when this contract receives ETH
     * Attempts to re-enter the Account contract
     */
    receive() external payable {
        emit ReceivedETH(msg.value);

        if (!attacking) return;

        attackCount++;
        emit AttackAttempt(attackCount, address(target).balance);

        // Try to re-enter if we haven't hit max attacks and target has funds
        if (attackCount < maxAttacks && address(target).balance > 0) {
            // Attempt reentrancy via recoverTransaction
            // This should fail due to sequence check (sequence already incremented)
            // or revert if there's a reentrancy guard
            try target.recoverTransaction(v, r, s, x, y, txPayload) {
                // If this succeeds, reentrancy is possible!
            } catch {
                // Expected - either sequence mismatch or reentrancy guard
            }
        }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function withdraw() external {
        payable(msg.sender).transfer(address(this).balance);
    }
}

/**
 * @title MaliciousERC20
 * @dev ERC20 token that attempts reentrancy during transfers
 */
contract MaliciousERC20 {
    string public name = "Malicious Token";
    string public symbol = "MAL";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public attacker;
    Account public target;
    bool public attackOnTransfer;

    uint8[] public v;
    bytes32[] public r;
    bytes32[] public s;
    bytes32[] public x;
    bytes32[] public y;
    bytes public txPayload;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event ReentrancyAttempt(bool success);

    constructor() {
        attacker = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setAttackParams(
        address _target,
        uint8[] calldata _v,
        bytes32[] calldata _r,
        bytes32[] calldata _s,
        bytes32[] calldata _x,
        bytes32[] calldata _y,
        bytes calldata _txPayload
    ) external {
        target = Account(payable(_target));
        v = _v;
        r = _r;
        s = _s;
        x = _x;
        y = _y;
        txPayload = _txPayload;
    }

    function enableAttack() external {
        attackOnTransfer = true;
    }

    function disableAttack() external {
        attackOnTransfer = false;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);

        // Attempt reentrancy if enabled and transfer is FROM the target account
        if (attackOnTransfer && from == address(target)) {
            try target.recoverTransaction(v, r, s, x, y, txPayload) {
                emit ReentrancyAttempt(true);
            } catch {
                emit ReentrancyAttempt(false);
            }
        }

        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}
