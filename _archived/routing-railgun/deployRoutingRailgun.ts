import { ethers } from "hardhat";
import dotenv from "dotenv";
import { RoutingRailgunFactory } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    const RoutingRailgunFactoryContract = await ethers.getContractFactory("RoutingRailgunFactory");
    let routingRailgunFactory: RoutingRailgunFactory;

    const routingRailgunFactoryAddress = process.env.ROUTING_RAILGUN_FACTORY_ADDRESS as string;
    if (!routingRailgunFactoryAddress) {
        routingRailgunFactory = await RoutingRailgunFactoryContract.deploy();
        await routingRailgunFactory.waitForDeployment();
        console.log("RoutingRailgunFactory deployed to:", routingRailgunFactory.target);
    } else {
        routingRailgunFactory = RoutingRailgunFactoryContract.attach(
            routingRailgunFactoryAddress
        ) as RoutingRailgunFactory;
        console.log("RoutingRailgunFactory Address:", await routingRailgunFactory.getAddress());
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
