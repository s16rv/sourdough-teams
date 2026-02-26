/**
 * E2E deployment script for Anvil local chain.
 *
 * Deploys all contracts (MPCVerifier, AccountFactory, EntryPoint, MPCGateway),
 * wires them up, and outputs JSON addresses to stdout for the Go test harness.
 *
 * Required env vars: MPC_PUBLIC_KEY_X, MPC_PUBLIC_KEY_Y
 *
 * Usage:
 *   MPC_PUBLIC_KEY_X=... MPC_PUBLIC_KEY_Y=... \
 *     npx hardhat run scripts/deploy-e2e.ts --network anvil-local
 */
import { ethers, upgrades } from "hardhat";

async function main() {
    const mpcPublicKeyX = process.env.MPC_PUBLIC_KEY_X;
    const mpcPublicKeyY = process.env.MPC_PUBLIC_KEY_Y;

    if (!mpcPublicKeyX || !mpcPublicKeyY) {
        throw new Error("MPC_PUBLIC_KEY_X and MPC_PUBLIC_KEY_Y env vars are required");
    }

    // Ensure 0x prefix and zero-pad to 64 hex chars (bytes32).
    // MPC keygen outputs raw hex and may strip leading zero bytes.
    const rawX = mpcPublicKeyX.replace(/^0x/, "");
    const rawY = mpcPublicKeyY.replace(/^0x/, "");
    const keyX = "0x" + rawX.padStart(64, "0");
    const keyY = "0x" + rawY.padStart(64, "0");

    const [deployer] = await ethers.getSigners();

    // 1. Deploy MPCVerifier (immutable)
    const MPCVerifierFactory = await ethers.getContractFactory("MPCVerifier");
    const mpcVerifier = await MPCVerifierFactory.deploy(deployer.address, keyX, keyY);
    await mpcVerifier.waitForDeployment();

    // 2. Deploy AccountFactory proxy (entryPoint = address(0) initially)
    const AccountFactoryFactory = await ethers.getContractFactory("AccountFactory");
    const accountFactory = await upgrades.deployProxy(AccountFactoryFactory, [ethers.ZeroAddress, deployer.address], {
        kind: "uups",
    });
    await accountFactory.waitForDeployment();

    // 3. Deploy EntryPoint proxy (mpcGateway = address(0) initially)
    const EntryPointFactory = await ethers.getContractFactory("EntryPoint");
    const entryPoint = await upgrades.deployProxy(
        EntryPointFactory,
        [accountFactory.target, deployer.address, ethers.ZeroAddress],
        { kind: "uups" }
    );
    await entryPoint.waitForDeployment();

    // 4. Deploy MPCGateway proxy
    const MPCGatewayFactory = await ethers.getContractFactory("MPCGateway");
    const mpcGateway = await upgrades.deployProxy(MPCGatewayFactory, [mpcVerifier.target, deployer.address], {
        kind: "uups",
    });
    await mpcGateway.waitForDeployment();

    // 5. Wire up contracts
    const txSetEntryPoint = await (accountFactory as any).setEntryPoint(entryPoint.target);
    await txSetEntryPoint.wait();

    const txSetMPCGateway = await (entryPoint as any).setMPCGateway(mpcGateway.target);
    await txSetMPCGateway.wait();

    // Output JSON to stdout (Go test harness parses this)
    const result = {
        mpcVerifier: await mpcVerifier.getAddress(),
        mpcGateway: await mpcGateway.getAddress(),
        entryPoint: await entryPoint.getAddress(),
        accountFactory: await accountFactory.getAddress(),
    };

    // Use stderr for logs so stdout is clean JSON
    console.error("=== E2E Deployment Complete ===");
    console.error("MPCVerifier:", result.mpcVerifier);
    console.error("MPCGateway:", result.mpcGateway);
    console.error("EntryPoint:", result.entryPoint);
    console.error("AccountFactory:", result.accountFactory);

    // Clean JSON to stdout
    process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
