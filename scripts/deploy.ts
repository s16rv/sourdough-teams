import { ethers } from "hardhat";
import dotenv from "dotenv";
import { MPCVerifier, Secp256k1Verifier } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    const axelarGatewayAddress = process.env.AXELAR_GATEWAY_ADDRESS as string;
    console.log("Deployer Address:", deployer.address);
    console.log("Axelar Gateway Address:", axelarGatewayAddress);

    var Secp256k1VerifierContract = await ethers.getContractFactory("Secp256k1Verifier");
    var secp256k1Verifier: Secp256k1Verifier;
    const secp256k1VerifierAddress = process.env.SECP256K1_VERIFIER_ADDRESS as string;
    if (!secp256k1VerifierAddress) {
        secp256k1Verifier = await Secp256k1VerifierContract.deploy();
        await secp256k1Verifier.waitForDeployment();
        console.log("Secp256k1Verifier deployed to:", secp256k1Verifier.target);
    } else {
        secp256k1Verifier = Secp256k1VerifierContract.attach(secp256k1VerifierAddress) as Secp256k1Verifier;
        console.log("Secp256k1Verifier Address:", await secp256k1Verifier.getAddress());
    }

    var MpcVerifierContract = await ethers.getContractFactory("MPCVerifier");
    var mpcVerifier: MPCVerifier;
    const mpcVerifierAddress = process.env.MPC_VERIFIER_ADDRESS as string;
    if (!mpcVerifierAddress) {
        const mpcPublicKeyX = process.env.MPC_PUBLIC_KEY_X as string;
        const mpcPublicKeyY = process.env.MPC_PUBLIC_KEY_Y as string;
        mpcVerifier = await MpcVerifierContract.deploy(
            deployer.address,
            secp256k1Verifier.target,
            mpcPublicKeyX,
            mpcPublicKeyY
        );
        await mpcVerifier.waitForDeployment();
        console.log("MPCVerifier deployed to:", mpcVerifier.target);
    } else {
        mpcVerifier = MpcVerifierContract.attach(mpcVerifierAddress) as MPCVerifier;
        console.log("MPCVerifier Address:", await secp256k1Verifier.getAddress());
    }

    var AccountFactoryContract = await ethers.getContractFactory("AccountFactory");
    var accountFactory;
    const accountFactoryAddress = process.env.ACCOUNT_FACTORY_ADDRESS as string;
    if (!accountFactoryAddress) {
        accountFactory = await AccountFactoryContract.deploy(secp256k1Verifier.target);
        await accountFactory.waitForDeployment();
        console.log("AccountFactory deployed to:", accountFactory.target);
    } else {
        accountFactory = AccountFactoryContract.attach(accountFactoryAddress);
        console.log("AccountFactory Address:", await accountFactory.getAddress());
    }

    var EntryPointContract = await ethers.getContractFactory("EntryPoint");
    var entryPoint;
    const entryPointAddress = process.env.ENTRY_POINT_ADDRESS as string;
    if (!entryPointAddress) {
        entryPoint = await EntryPointContract.deploy(axelarGatewayAddress, accountFactory.target, deployer.address);
        await entryPoint.waitForDeployment();
        console.log("EntryPoint deployed to:", entryPoint.target);
    } else {
        entryPoint = EntryPointContract.attach(entryPointAddress);
        console.log("EntryPoint Address:", await entryPoint.getAddress());
    }

    const MpcGateway = await ethers.getContractFactory("MPCGateway");
    const mpcGateway = await MpcGateway.deploy(mpcVerifier.target);
    await mpcGateway.waitForDeployment();
    console.log("MPCGateway deployed to:", mpcGateway.target);

    const entryPointContract = await ethers.getContractAt("EntryPoint", entryPoint.target);
    await entryPointContract.setExecutor(mpcGateway.target, true);
    console.log("EntryPointExecutor set to:", mpcGateway.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
