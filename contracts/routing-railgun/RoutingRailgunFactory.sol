// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./RoutingRailgun.sol";

contract RoutingRailgunFactory {
    event RoutingRailgunCreated(address contractAddress, string zkAddress, address railgunAddress);

    function createRoutingRailgun(address ownerAddress, string memory zkAddress, address railgunAddress) external returns (address) {
        RoutingRailgun c = new RoutingRailgun(msg.sender, ownerAddress, zkAddress, railgunAddress);
        emit RoutingRailgunCreated(address(c), zkAddress, railgunAddress);
        return address(c);
    }
}
