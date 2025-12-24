import { ethers } from "hardhat";
import dotenv from "dotenv";
import { MyToken } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    const MyTokenContract = await ethers.getContractFactory("MyToken");
    let testUSDC: MyToken;

    const testUSDCAddress = process.env.TEST_USDC_ADDRESS as string;
    if (!testUSDCAddress) {
        // Deploy Test USDC with 6 decimals (like real USDC)
        testUSDC = await MyTokenContract.deploy("Test USDC", "TestUSDC", 6);
        await testUSDC.waitForDeployment();
        console.log("Test USDC deployed to:", testUSDC.target);
    } else {
        testUSDC = MyTokenContract.attach(testUSDCAddress) as MyToken;
        console.log("Test USDC Address:", await testUSDC.getAddress());
    }

    // Log token details
    console.log("\nToken Details:");
    console.log("  Name:", await testUSDC.name());
    console.log("  Symbol:", await testUSDC.symbol());
    console.log("  Decimals:", await testUSDC.decimals());
    console.log("  Total Supply:", ethers.formatUnits(await testUSDC.totalSupply(), 6), "TestUSDC");
    console.log("  Deployer Balance:", ethers.formatUnits(await testUSDC.balanceOf(deployer.address), 6), "TestUSDC");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
