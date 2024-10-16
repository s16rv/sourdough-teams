import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    const gatewayAddress = process.env.AXELAR_GATEWAY_ADDRESS as string;
    console.log("Deployer Address:", deployer.address);
    console.log("Gateway Address:", gatewayAddress);

    const Secp256k1Verifier = await ethers.getContractFactory("Secp256k1Verifier");
    const secp256k1Verifier = await Secp256k1Verifier.deploy();
    await secp256k1Verifier.waitForDeployment();
    console.log("Secp256k1Verifier deployed to:", secp256k1Verifier.target);

    const AccountFactory = await ethers.getContractFactory("AccountFactory");
    const accountFactory = await AccountFactory.deploy(secp256k1Verifier.target);
    await accountFactory.waitForDeployment();
    console.log("AccountFactory deployed to:", accountFactory.target);

    const EntryPoint = await ethers.getContractFactory("EntryPoint");

    const entryPoint = await EntryPoint.deploy(gatewayAddress, accountFactory.target);
    await entryPoint.waitForDeployment();
    console.log("EntryPoint deployed to:", entryPoint.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
