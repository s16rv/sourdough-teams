import { ethers } from "hardhat";
import dotenv from "dotenv";
import { RoutingRailgun } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    const RoutingRailgunContract = await ethers.getContractFactory("RoutingRailgun");
    let routingRailgun: RoutingRailgun;

    const routingRailgunAddress = process.env.ROUTING_RAILGUN_ADDRESS as string;
    if (!routingRailgunAddress) {
        const routingKeyAddress = process.env.ROUTING_KEY_ADDRESS as string;
        const railgunAddress = process.env.RAILGUN_ADDRESS as string;
        const entryPointAddress = process.env.ENTRY_POINT_ADDRESS as string;

        routingRailgun = await RoutingRailgunContract.deploy(routingKeyAddress, railgunAddress, entryPointAddress);
        await routingRailgun.waitForDeployment();
        console.log("RoutingRailgun deployed to:", routingRailgun.target);
    } else {
        routingRailgun = RoutingRailgunContract.attach(routingRailgunAddress) as RoutingRailgun;
        console.log("RoutingRailgun Address:", await routingRailgun.getAddress());
    }

    console.log("\n=== Deployment Summary ===");
    console.log("RoutingRailgun:", routingRailgun.target);
    console.log("  routingKeyAddress:", await routingRailgun.routingKeyAddress());
    console.log("  railgunAddress:", await routingRailgun.railgunAddress());
    console.log("  entryPoint:", await routingRailgun.entryPoint());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
