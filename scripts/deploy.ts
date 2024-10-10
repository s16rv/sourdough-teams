import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    // Deploy AccountFactory with higher gas limit and fees
    const AccountFactory = await ethers.getContractFactory("AccountFactory");
    const accountFactory = await AccountFactory.deploy();

    // Wait for the AccountFactory deployment to be mined
    await accountFactory.waitForDeployment();
    const accountFactoryAddress = await accountFactory.getAddress();
    console.log("AccountFactory deployed to:", accountFactoryAddress);

    // Deploy EntryPoint with higher gas settings and gas limit
    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const gatewayAddress = process.env.AXELAR_GATEWAY_ADDRESS as string;
    const entryPoint = await EntryPoint.deploy(gatewayAddress, accountFactoryAddress);

    // Wait for the EntryPoint deployment to be mined
    await entryPoint.waitForDeployment();
    const entryPointAddress = await entryPoint.getAddress();
    console.log("EntryPoint deployed to:", entryPointAddress);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
