// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IRoutingRailgunFactory {
    /**
     * @dev Emitted when a new RoutingRailgun contract is created.
     * @param contractAddress The address of the newly created RoutingRailgun contract.
     * @param railgunAddress The address of the Railgun contract associated with it.
     */
    event RoutingRailgunCreated(address contractAddress, address railgunAddress);

    /**
     * @dev Creates a new RoutingRailgun contract.
     * @param railgunAddress The address of the Railgun contract.
     * @return The address of the newly created RoutingRailgun contract.
     */
    function createRoutingRailgun(address railgunAddress) external returns (address);
}
