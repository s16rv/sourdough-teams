// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IRoutingRailgunFactory {
    event RoutingRailgunCreated(address contractAddress, address railgunAddress);
    function createRoutingRailgun(address railgunAddress) external returns (address);
}
