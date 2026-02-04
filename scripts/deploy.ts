import { ethers } from "hardhat";
import dotenv from "dotenv";
import { MPCVerifier, AccountFactory, EntryPoint, MPCGateway } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    var MpcVerifierContract = await ethers.getContractFactory("MPCVerifier");
    var mpcVerifier: MPCVerifier;
    const mpcVerifierAddress = process.env.MPC_VERIFIER_ADDRESS as string;
    if (!mpcVerifierAddress) {
        const mpcPublicKeyX = process.env.MPC_PUBLIC_KEY_X as string;
        const mpcPublicKeyY = process.env.MPC_PUBLIC_KEY_Y as string;
        mpcVerifier = await MpcVerifierContract.deploy(deployer.address, mpcPublicKeyX, mpcPublicKeyY);
        await mpcVerifier.waitForDeployment();
        console.log("MPCVerifier deployed to:", mpcVerifier.target);
    } else {
        mpcVerifier = MpcVerifierContract.attach(mpcVerifierAddress) as MPCVerifier;
        console.log("MPCVerifier Address:", await mpcVerifier.getAddress());
    }

    var AccountFactoryContract = await ethers.getContractFactory("AccountFactory");
    var accountFactory: AccountFactory;
    const accountFactoryAddress = process.env.ACCOUNT_FACTORY_ADDRESS as string;
    if (!accountFactoryAddress) {
        accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();
        console.log("AccountFactory deployed to:", accountFactory.target);
    } else {
        accountFactory = AccountFactoryContract.attach(accountFactoryAddress) as AccountFactory;
        console.log("AccountFactory Address:", await accountFactory.getAddress());
    }

    var EntryPointContract = await ethers.getContractFactory("EntryPoint");
    var entryPoint: EntryPoint;
    const entryPointAddress = process.env.ENTRY_POINT_ADDRESS as string;
    if (!entryPointAddress) {
        entryPoint = await EntryPointContract.deploy(accountFactory.target, deployer.address);
        await entryPoint.waitForDeployment();
        console.log("EntryPoint deployed to:", entryPoint.target);
    } else {
        entryPoint = EntryPointContract.attach(entryPointAddress) as EntryPoint;
        console.log("EntryPoint Address:", await entryPoint.getAddress());
    }

    var MpcGatewayContract = await ethers.getContractFactory("MPCGateway");
    var mpcGateway: MPCGateway;
    const mpcGatewayAddress = process.env.MPC_GATEWAY_ADDRESS as string;
    if (!mpcGatewayAddress) {
        mpcGateway = await MpcGatewayContract.deploy(mpcVerifier.target);
        await mpcGateway.waitForDeployment();
        console.log("MPCGateway deployed to:", mpcGateway.target);
    } else {
        mpcGateway = MpcGatewayContract.attach(mpcGatewayAddress) as MPCGateway;
        console.log("MPCGateway Address:", await mpcGateway.getAddress());
    }

    await entryPoint.setExecutor(mpcGateway.target, true);
    console.log("EntryPointExecutor set to:", mpcGateway.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
