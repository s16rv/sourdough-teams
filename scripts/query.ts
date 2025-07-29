import { ethers } from "hardhat";
import dotenv from "dotenv";
import { EntryPoint__factory } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    const entrypointAddress = "0xf56d63B2778Cad34bf38cab2E0B91230936B7a72";

    const entrypoint = EntryPoint__factory.connect(entrypointAddress, deployer);

    const isExecutor = await entrypoint.isExecutor("0x2148fA69d2B107d509200291E532c42BA1A5a7ec");
    console.log("isExecutor", isExecutor);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
