// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../routing-railgun/interfaces/IRoutingRailgun.sol";

/**
 * @title RoutingRailgunReentrancyAttacker
 * @dev Malicious contract that attempts to re-enter RoutingRailgun during receive()
 */
contract RoutingRailgunReentrancyAttacker {
    address public target;
    uint256 public attackType; // 1 = refund, 2 = executeRailgunCall
    uint256 public attackCount;

    function setTarget(address _target) external {
        target = _target;
    }

    function setAttackType(uint256 _type) external {
        attackType = _type;
    }

    receive() external payable {
        attackCount++;

        // Only try to re-enter once to avoid infinite loop
        if (attackCount == 1 && target != address(0)) {
            if (attackType == 1) {
                // Try to re-enter refund
                try IRoutingRailgun(target).refund(address(0), address(this), 1 ether) {
                    // If this succeeds, reentrancy worked (vulnerability!)
                    attackCount = 100; // Mark success
                } catch {
                    // Expected: NotController revert
                }
            } else if (attackType == 2) {
                // Try to re-enter executeRailgunCall
                try IRoutingRailgun(target).executeRailgunCall(address(this), 1 ether, "") {
                    attackCount = 100; // Mark success
                } catch {
                    // Expected: NotController revert
                }
            }
        }
    }

    // Fallback for executeRailgunCall
    fallback() external payable {
        attackCount++;

        if (attackCount == 1 && target != address(0) && attackType == 2) {
            try IRoutingRailgun(target).executeRailgunCall(address(this), 1 ether, "") {
                attackCount = 100;
            } catch {
                // Expected: NotController revert
            }
        }
    }
}

/**
 * @title ReentrantToken
 * @dev Malicious ERC20 that attempts to re-enter RoutingRailgun during transfer
 */
contract ReentrantToken is ERC20 {
    address public target;
    uint256 public attackCount;

    constructor() ERC20("Reentrant Token", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(address _target) external {
        target = _target;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        // Attempt reentrancy before transfer completes
        if (target != address(0) && attackCount == 0) {
            attackCount++;
            try IRoutingRailgun(target).refund(address(this), msg.sender, amount) {
                // If this succeeds, reentrancy worked (vulnerability!)
                attackCount = 100;
            } catch {
                // Expected: NotController revert
            }
        }

        return super.transfer(to, amount);
    }
}
