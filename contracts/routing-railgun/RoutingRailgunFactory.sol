// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./RoutingRailgun.sol";
import "./interfaces/IRoutingRailgunFactory.sol";

contract RoutingRailgunFactory is IRoutingRailgunFactory {
    function createRoutingRailgun(address railgunAddress) external returns (address) {
        RoutingRailgun c = new RoutingRailgun(msg.sender, railgunAddress);
        emit RoutingRailgunCreated(address(c), railgunAddress);
        return address(c);
    }
}
