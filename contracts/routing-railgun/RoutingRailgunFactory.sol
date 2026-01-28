// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./RoutingRailgun.sol";
import "./interfaces/IRoutingRailgunFactory.sol";

contract RoutingRailgunFactory is IRoutingRailgunFactory {
    /**
     * @dev Creates a new RoutingRailgun contract.
     * @param railgunAddress The address of the Railgun contract.
     * @return The address of the newly created RoutingRailgun contract.
     */
    function createRoutingRailgun(address railgunAddress) external returns (address) {
        RoutingRailgun c = new RoutingRailgun(msg.sender, railgunAddress);
        emit RoutingRailgunCreated(address(c), railgunAddress);
        return address(c);
    }
}
