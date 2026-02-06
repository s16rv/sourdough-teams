import { ethers, upgrades } from "hardhat";
import dotenv from "dotenv";
import { MPCVerifier, AccountFactory, EntryPoint, MPCGateway } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    var MpcVerifierContract = await ethers.getContractFactory("MPCVerifier");
    const mpcVerifierAddress = process.env.MPC_VERIFIER_ADDRESS as string;
    let mpcVerifier: MPCVerifier;
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

    // 2. Deploy AccountFactory proxy (with address(0) for entryPoint initially)
    const AccountFactoryContract = await ethers.getContractFactory("AccountFactory");
    const accountFactoryAddress = process.env.ACCOUNT_FACTORY_ADDRESS as string;
    let accountFactory: AccountFactory;
    if (!accountFactoryAddress) {
        accountFactory = await upgrades.deployProxy(
            AccountFactoryContract,
            [ethers.ZeroAddress, deployer.address], // entryPoint will be set after EntryPoint deployment
            { kind: "uups" }
        );
        await accountFactory.waitForDeployment();
        console.log("AccountFactory proxy deployed to:", accountFactory.target);
    } else {
        accountFactory = AccountFactoryContract.attach(accountFactoryAddress) as AccountFactory;
        console.log("AccountFactory Address:", await accountFactory.getAddress());
    }

    // 3. Deploy EntryPoint proxy (with address(0) for mpcGateway initially)
    const EntryPointContract = await ethers.getContractFactory("EntryPoint");
    const entryPointAddress = process.env.ENTRY_POINT_ADDRESS as string;
    let entryPoint: EntryPoint;
    if (!entryPointAddress) {
        entryPoint = await upgrades.deployProxy(
            EntryPointContract,
            [accountFactory.target, deployer.address, ethers.ZeroAddress], // mpcGateway will be set after MPCGateway deployment
            { kind: "uups" }
        );
        await entryPoint.waitForDeployment();
        console.log("EntryPoint proxy deployed to:", entryPoint.target);
    } else {
        entryPoint = EntryPointContract.attach(entryPointAddress) as EntryPoint;
        console.log("EntryPoint Address:", await entryPoint.getAddress());
    }

    // 4. Deploy MPCGateway proxy
    const MpcGatewayContract = await ethers.getContractFactory("MPCGateway");
    const mpcGatewayAddress = process.env.MPC_GATEWAY_ADDRESS as string;
    let mpcGateway: MPCGateway;
    if (!mpcGatewayAddress) {
        mpcGateway = await upgrades.deployProxy(MpcGatewayContract, [mpcVerifier.target, deployer.address], {
            kind: "uups",
        });
        await mpcGateway.waitForDeployment();
        console.log("MPCGateway proxy deployed to:", mpcGateway.target);
    } else {
        mpcGateway = MpcGatewayContract.attach(mpcGatewayAddress) as MPCGateway;
        console.log("MPCGateway Address:", await mpcGateway.getAddress());
    }

    // 5. Wire up the contracts
    // Set EntryPoint in AccountFactory
    const currentEntryPoint = await accountFactory.entryPoint();
    if (currentEntryPoint !== entryPoint.target) {
        console.log(`Updating AccountFactory entryPoint from ${currentEntryPoint} to ${entryPoint.target}`);
        const tx = await accountFactory.setEntryPoint(entryPoint.target);
        await tx.wait();
        console.log("AccountFactory.entryPoint updated");
    } else {
        console.log("AccountFactory.entryPoint already set correctly");
    }

    // Set MPCGateway in EntryPoint
    const currentMPCGateway = await entryPoint.mpcGateway();
    if (currentMPCGateway !== mpcGateway.target) {
        console.log(`Updating EntryPoint mpcGateway from ${currentMPCGateway} to ${mpcGateway.target}`);
        const tx = await entryPoint.setMPCGateway(mpcGateway.target);
        await tx.wait();
        console.log("EntryPoint.mpcGateway updated");
    } else {
        console.log("EntryPoint.mpcGateway already set correctly");
    }

    console.log("\n=== Deployment Summary ===");
    console.log("MPCVerifier:", mpcVerifier.target);
    console.log("AccountFactory (proxy):", accountFactory.target);
    console.log("EntryPoint (proxy):", entryPoint.target);
    console.log("MPCGateway (proxy):", mpcGateway.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
