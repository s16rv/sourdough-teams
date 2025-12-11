// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IRoutingRailgunFactory {
    event RoutingRailgunCreated(address contractAddress, string zkAddress, address railgunAddress);
    function createRoutingRailgun(address ownerAddress, string memory zkAddress, address railgunAddress) external returns (address);
}
