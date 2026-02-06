import { ethers, upgrades } from "hardhat";
import { AccountFactory, EntryPoint, MPCGateway } from "../../typechain-types";

export interface DeployedContracts {
    accountFactory: AccountFactory;
    entryPoint: EntryPoint;
    mpcGateway: MPCGateway;
}

/**
 * Deploy the full contract suite using UUPS proxies for testing
 * @param owner The owner address for all contracts
 * @param mpcVerifierAddress The address of the MPCVerifier contract
 * @returns The deployed contracts
 */
export async function deployProxies(owner: string, mpcVerifierAddress: string): Promise<DeployedContracts> {
    // Deploy AccountFactory proxy (with address(0) for entryPoint initially)
    const AccountFactoryContract = await ethers.getContractFactory("AccountFactory");
    const accountFactory = (await upgrades.deployProxy(AccountFactoryContract, [ethers.ZeroAddress, owner], {
        kind: "uups",
    })) as unknown as AccountFactory;
    await accountFactory.waitForDeployment();

    // Deploy EntryPoint proxy (with address(0) for mpcGateway initially)
    const EntryPointContract = await ethers.getContractFactory("EntryPoint");
    const entryPoint = (await upgrades.deployProxy(
        EntryPointContract,
        [await accountFactory.getAddress(), owner, ethers.ZeroAddress],
        { kind: "uups" }
    )) as unknown as EntryPoint;
    await entryPoint.waitForDeployment();

    // Deploy MPCGateway proxy
    const MpcGatewayContract = await ethers.getContractFactory("MPCGateway");
    const mpcGateway = (await upgrades.deployProxy(MpcGatewayContract, [mpcVerifierAddress, owner], {
        kind: "uups",
    })) as unknown as MPCGateway;
    await mpcGateway.waitForDeployment();

    // Wire up the contracts
    await accountFactory.setEntryPoint(await entryPoint.getAddress());
    await entryPoint.setMPCGateway(await mpcGateway.getAddress());

    return { accountFactory, entryPoint, mpcGateway };
}

/**
 * Deploy AccountFactory and EntryPoint for tests that don't need MPCGateway
 * Uses a mock address for mpcGateway that can be overridden
 */
export async function deployAccountFactoryAndEntryPoint(
    owner: string,
    mpcGatewayOverride?: string
): Promise<{ accountFactory: AccountFactory; entryPoint: EntryPoint }> {
    // Deploy AccountFactory proxy
    const AccountFactoryContract = await ethers.getContractFactory("AccountFactory");
    const accountFactory = (await upgrades.deployProxy(AccountFactoryContract, [ethers.ZeroAddress, owner], {
        kind: "uups",
    })) as unknown as AccountFactory;
    await accountFactory.waitForDeployment();

    // Deploy EntryPoint proxy
    const EntryPointContract = await ethers.getContractFactory("EntryPoint");
    const entryPoint = (await upgrades.deployProxy(
        EntryPointContract,
        [await accountFactory.getAddress(), owner, mpcGatewayOverride || ethers.ZeroAddress],
        { kind: "uups" }
    )) as unknown as EntryPoint;
    await entryPoint.waitForDeployment();

    // Wire up AccountFactory
    await accountFactory.setEntryPoint(await entryPoint.getAddress());

    return { accountFactory, entryPoint };
}

/**
 * Encode a Category 1 (createAccount) payload with salt parameter
 */
export function encodeCreateAccountPayload(
    totalSigners: number,
    threshold: number,
    salt: string,
    publicKeysX: string[],
    publicKeysY: string[]
): string {
    const coder = new ethers.AbiCoder();

    // Header: category(uint8) + totalSigners(uint64) + threshold(uint64) + salt(bytes32)
    let payload = coder.encode(["uint8", "uint64", "uint64", "bytes32"], [1, totalSigners, threshold, salt]);

    // Add public keys
    for (let i = 0; i < totalSigners; i++) {
        const pubKey = coder.encode(["bytes32", "bytes32"], [publicKeysX[i], publicKeysY[i]]);
        payload = payload + pubKey.slice(2); // Remove 0x prefix
    }

    return payload;
}
