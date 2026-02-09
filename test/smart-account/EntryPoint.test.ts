import hre, { upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, keccak256, parseEther, sha256, toUtf8Bytes } from "ethers";

import { Account, AccountFactory, EntryPoint, MyToken } from "../../typechain-types";
import {
    combineHexStrings,
    encodeMultiPayload,
    encodeNewTxPayload,
    computeTxPayloadHash,
    createSignBytes,
    encodeNewPayload,
    encodeCreateAccountPayload,
    DEFAULT_SALT,
} from "../utils/lib";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

const TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const EXPECTED_CHAIN_ID = 31337n; // Hardhat default chain ID

/**
 * Helper to deploy AccountFactory and EntryPoint proxies
 */
async function deployProxies(
    owner: string,
    mpcGatewayAddress: string
): Promise<{ accountFactory: AccountFactory; entryPoint: EntryPoint }> {
    const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
    const accountFactory = (await upgrades.deployProxy(AccountFactoryContract, [hre.ethers.ZeroAddress, owner], {
        kind: "uups",
    })) as unknown as AccountFactory;
    await accountFactory.waitForDeployment();

    const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
    const entryPoint = (await upgrades.deployProxy(
        EntryPointContract,
        [await accountFactory.getAddress(), owner, mpcGatewayAddress],
        { kind: "uups" }
    )) as unknown as EntryPoint;
    await entryPoint.waitForDeployment();

    await accountFactory.setEntryPoint(await entryPoint.getAddress());

    return { accountFactory, entryPoint };
}

/**
 * Helper to create a signed payload for the new format
 */
async function createNewFormatPayload(
    account: Account,
    sourceAddress: string,
    calls: { to: string; value: bigint; data: string }[],
    publicKeyX: string[],
    publicKeyY: string[]
): Promise<string> {
    const accountAddress = await account.getAddress();
    const sequence = (await account.accountSequence()) + 1n;

    // 1. Create txPayload with new structure
    const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, calls);

    // 2. Compute hash of txPayload
    const txPayloadHash = computeTxPayloadHash(txPayload);

    // 3. Create signBytes with embedded hash
    const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

    // 4. Sign sha256(signBytes)
    const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
    const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytesForSigning.toString("hex"));

    // 5. Create full payload
    const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: publicKeyX[0], y: publicKeyY[0] }];
    return encodeNewPayload(signBytes, hashOffset, signatures, txPayload);
}

describe("EntryPoint", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 1;
    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];
    const THRESHOLD = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;
    let account: Account;
    let accountFactory: AccountFactory;

    beforeEach(async function () {
        [owner, mpcGateway] = await hre.ethers.getSigners();

        // Get public key from mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y];

        const deployed = await deployProxies(owner.address, mpcGateway.address);
        accountFactory = deployed.accountFactory;
        entryPoint = deployed.entryPoint;

        const sourceChain = "sourceChain";

        const payload = encodeCreateAccountPayload(totalSigners, THRESHOLD, DEFAULT_SALT, PUBLIC_KEY_X, PUBLIC_KEY_Y);

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));
    });

    it("should execute transactions from Account contract", async function () {
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");

        const sourceChain = "sourceChain";

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should revert when executePayload is called by non-MPCGateway", async function () {
        const amountToSend = parseEther("1.0");

        const sourceChain = "sourceChain";

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        const [, , unauthorized] = await hre.ethers.getSigners();

        await expect(
            entryPoint.connect(unauthorized).executePayload(sourceChain, SOURCE_ADDRESS, payload)
        ).to.be.revertedWithCustomError(entryPoint, "NotMPCGateway");
    });

    it("should allow owner to set MPCGateway", async function () {
        const [, , newMPCGateway] = await hre.ethers.getSigners();

        await entryPoint.connect(owner).setMPCGateway(newMPCGateway.address);
        expect(await entryPoint.mpcGateway()).to.equal(newMPCGateway.address);
    });

    it("should revert when non-owner tries to set MPCGateway", async function () {
        const [, , nonOwner] = await hre.ethers.getSigners();

        await expect(entryPoint.connect(nonOwner).setMPCGateway(nonOwner.address)).to.be.revertedWithCustomError(
            entryPoint,
            "OwnableUnauthorizedAccount"
        );
    });
});

describe("EntryPoint Multi-Payload", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];
    const THRESHOLD = 1;
    const totalSigners = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;

    this.beforeAll(async function () {
        [owner, mpcGateway] = await hre.ethers.getSigners();

        // Get public key from mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y];

        const deployed = await deployProxies(owner.address, mpcGateway.address);
        const accountFactory = deployed.accountFactory;
        entryPoint = deployed.entryPoint;

        const sourceChain = "sourceChain";

        const payload = encodeCreateAccountPayload(totalSigners, THRESHOLD, DEFAULT_SALT, PUBLIC_KEY_X, PUBLIC_KEY_Y);

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({ to: accountAddr, value: parseEther("2.0") });

        const MyTokenContract = await hre.ethers.getContractFactory("MyToken");
        myToken = await MyTokenContract.deploy("MyToken", "MTK", 18);
        await myToken.waitForDeployment();

        await myToken.transfer(accountAddr, parseEther("3.0"));
    });

    it("batch: approve and transferFrom in one call", async function () {
        const accountAddress = await account.getAddress();
        const amount = parseEther("0.001");

        const approveData = myToken.interface.encodeFunctionData("approve", [accountAddress, amount]);
        const transferFromData = myToken.interface.encodeFunctionData("transferFrom", [
            accountAddress,
            RECIPIENT_ADDRESS,
            amount,
        ]);

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [
                { to: myToken.target as string, value: 0n, data: approveData },
                { to: myToken.target as string, value: 0n, data: transferFromData },
            ],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        const startAllowance = await myToken.allowance(accountAddress, accountAddress);
        expect(startAllowance).to.equal(0);

        const startRecipient = await myToken.balanceOf(RECIPIENT_ADDRESS);

        const tx = await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload);
        await tx.wait();

        const endAllowance = await myToken.allowance(accountAddress, accountAddress);
        expect(endAllowance).to.equal(0);

        const endRecipient = await myToken.balanceOf(RECIPIENT_ADDRESS);
        expect(endRecipient).to.equal(startRecipient + amount);
    });

    it("single: ether transfer count=1", async function () {
        const accountAddress = await account.getAddress();
        const ethAmount = parseEther("0.001");

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [{ to: RECIPIENT_ADDRESS, value: ethAmount, data: "0x" }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        const ethStart = await hre.ethers.provider.getBalance(accountAddress);
        const tx = await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload);
        await tx.wait();
        const ethEnd = await hre.ethers.provider.getBalance(accountAddress);
        expect(ethEnd).to.equal(ethStart - ethAmount);
    });

    it("batch: ether transfer + erc20 transfer", async function () {
        const accountAddress = await account.getAddress();
        const ethAmount = parseEther("0.001");
        const tokenAmount = parseEther("0.001");

        const transferData = myToken.interface.encodeFunctionData("transfer", [RECIPIENT_ADDRESS, tokenAmount]);

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [
                { to: RECIPIENT_ADDRESS, value: ethAmount, data: "0x" },
                { to: myToken.target as string, value: 0n, data: transferData },
            ],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        const ethStart = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const tokenStart = await myToken.balanceOf(RECIPIENT_ADDRESS);

        const tx = await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload);
        await tx.wait();

        const ethEnd = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const tokenEnd = await myToken.balanceOf(RECIPIENT_ADDRESS);

        expect(ethEnd).to.equal(ethStart + ethAmount);
        expect(tokenEnd).to.equal(tokenStart + tokenAmount);
    });
});

describe("EntryPoint Multisig 2 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    // For 2-of-2, we need two different mnemonics
    const MNEMONIC_1 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

    const totalSigners = 2;
    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];
    const THRESHOLD = 2;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [owner, mpcGateway] = await hre.ethers.getSigners();

        // Get public keys from both mnemonics
        const pubKey1 = await getPublicKeyFromMnemonic(MNEMONIC_1);
        const pubKey2 = await getPublicKeyFromMnemonic(MNEMONIC_2);
        PUBLIC_KEY_X = [pubKey1.x, pubKey2.x];
        PUBLIC_KEY_Y = [pubKey1.y, pubKey2.y];

        const deployed = await deployProxies(owner.address, mpcGateway.address);
        const accountFactory = deployed.accountFactory;
        entryPoint = deployed.entryPoint;

        const sourceChain = "sourceChain";

        const payload = encodeCreateAccountPayload(totalSigners, THRESHOLD, DEFAULT_SALT, PUBLIC_KEY_X, PUBLIC_KEY_Y);

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));
    });

    it("should execute transactions from Account contract with 2 signers", async function () {
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";
        const sequence = (await account.accountSequence()) + 1n;

        // Create txPayload
        const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, [
            { to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" },
        ]);

        // Compute hash and create signBytes
        const txPayloadHash = computeTxPayloadHash(txPayload);
        const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

        // Get signatures from both signers
        const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
        const sig1 = await generateSignatureWithMnemonic(MNEMONIC_1, signBytesForSigning.toString("hex"));
        const sig2 = await generateSignatureWithMnemonic(MNEMONIC_2, signBytesForSigning.toString("hex"));

        const signatures = [
            { v: sig1.v, r: sig1.r, s: sig1.s, x: PUBLIC_KEY_X[0], y: PUBLIC_KEY_Y[0] },
            { v: sig2.v, r: sig2.r, s: sig2.s, x: PUBLIC_KEY_X[1], y: PUBLIC_KEY_Y[1] },
        ];

        const payload = encodeNewPayload(signBytes, hashOffset, signatures, txPayload);

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});

describe("EntryPoint Multisig 1 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const MNEMONIC_1 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

    const totalSigners = 2;
    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];
    const THRESHOLD = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [owner, mpcGateway] = await hre.ethers.getSigners();

        const pubKey1 = await getPublicKeyFromMnemonic(MNEMONIC_1);
        const pubKey2 = await getPublicKeyFromMnemonic(MNEMONIC_2);
        PUBLIC_KEY_X = [pubKey1.x, pubKey2.x];
        PUBLIC_KEY_Y = [pubKey1.y, pubKey2.y];

        const deployed = await deployProxies(owner.address, mpcGateway.address);
        const accountFactory = deployed.accountFactory;
        entryPoint = deployed.entryPoint;

        const sourceChain = "sourceChain";

        const payload = encodeCreateAccountPayload(totalSigners, THRESHOLD, DEFAULT_SALT, PUBLIC_KEY_X, PUBLIC_KEY_Y);

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));
    });

    it("should execute transactions with first signer", async function () {
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");

        const sourceChain = "sourceChain";

        // Use helper with first signer's key
        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
            [PUBLIC_KEY_X[0]],
            [PUBLIC_KEY_Y[0]]
        );

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute transactions with second signer", async function () {
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";
        const sequence = (await account.accountSequence()) + 1n;

        // Create txPayload
        const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, [
            { to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" },
        ]);

        // Compute hash and create signBytes
        const txPayloadHash = computeTxPayloadHash(txPayload);
        const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

        // Sign with second signer (MNEMONIC_2)
        const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
        const sig = await generateSignatureWithMnemonic(MNEMONIC_2, signBytesForSigning.toString("hex"));

        const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: PUBLIC_KEY_X[1], y: PUBLIC_KEY_Y[1] }];

        const payload = encodeNewPayload(signBytes, hashOffset, signatures, txPayload);

        await entryPoint.connect(mpcGateway).executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});

/**
 * Tests for EntryPoint error handling paths
 */
describe("EntryPoint Error Paths", function () {
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let account: Account;

    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, mpcGateway] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const deployed = await deployProxies(owner.address, mpcGateway.address);
        accountFactory = deployed.accountFactory;
        entryPoint = deployed.entryPoint;

        const createAccountPayload = encodeCreateAccountPayload(1, 1, DEFAULT_SALT, publicKeyX, publicKeyY);

        await entryPoint.connect(mpcGateway).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, createAccountPayload);

        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("10.0"),
        });
    });

    describe("Transaction Error Handling", function () {
        it("Should revert with TransactionFailed when Account execution reverts", async function () {
            const RejectETHFactory = await hre.ethers.getContractFactory("RejectETH");
            const rejectETH = await RejectETHFactory.deploy();
            await rejectETH.waitForDeployment();

            const payload = await createNewFormatPayload(
                account,
                SOURCE_ADDRESS,
                [{ to: await rejectETH.getAddress(), value: parseEther("1.0"), data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            await expect(
                entryPoint.connect(mpcGateway).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "TransactionFailed");
        });

        it("Should revert with TransactionFailed when validation fails (wrong sequence)", async function () {
            const accountAddress = await account.getAddress();
            const wrongSequence = 999n;

            // Create txPayload with wrong sequence
            const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, wrongSequence, [
                { to: owner.address, value: parseEther("0.1"), data: "0x" },
            ]);

            const txPayloadHash = computeTxPayloadHash(txPayload);
            const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

            const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytesForSigning.toString("hex"));

            const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: publicKeyX[0], y: publicKeyY[0] }];
            const payload = encodeNewPayload(signBytes, hashOffset, signatures, txPayload);

            const balanceBefore = await hre.ethers.provider.getBalance(owner.address);

            // Should revert with TransactionFailed (Account validation fails with InvalidSequence)
            await expect(
                entryPoint.connect(mpcGateway).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "TransactionFailed");

            // Verify no funds were transferred (validation failed)
            const balanceAfter = await hre.ethers.provider.getBalance(owner.address);
            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("Should revert with TransactionFailed when chainId doesn't match", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            // Create txPayload with wrong chainId (use 99999 instead of 31337)
            const txPayload = encodeNewTxPayload(99999n, accountAddress, sequence, [
                { to: owner.address, value: parseEther("0.01"), data: "0x" },
            ]);

            const txPayloadHash = computeTxPayloadHash(txPayload);
            const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

            const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytesForSigning.toString("hex"));

            const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: publicKeyX[0], y: publicKeyY[0] }];
            const payload = encodeNewPayload(signBytes, hashOffset, signatures, txPayload);

            // Account validates chainId and reverts with InvalidChainId, wrapped as TransactionFailed
            await expect(
                entryPoint.connect(mpcGateway).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "TransactionFailed");
        });
    });

    describe("Access Control", function () {
        it("Should allow owner to set MPCGateway", async function () {
            const [, , newMPCGateway] = await hre.ethers.getSigners();

            await entryPoint.connect(owner).setMPCGateway(newMPCGateway.address);

            expect(await entryPoint.mpcGateway()).to.equal(newMPCGateway.address);
        });

        it("Should reject non-owner from setting MPCGateway", async function () {
            const [, , , nonOwner] = await hre.ethers.getSigners();

            await expect(entryPoint.connect(nonOwner).setMPCGateway(nonOwner.address)).to.be.revertedWithCustomError(
                entryPoint,
                "OwnableUnauthorizedAccount"
            );
        });

        it("Should reject non-MPCGateway from executing payload", async function () {
            const [, , nonMPCGateway] = await hre.ethers.getSigners();

            const payload = encodeCreateAccountPayload(1, 1, DEFAULT_SALT, publicKeyX, publicKeyY);

            await expect(
                entryPoint.connect(nonMPCGateway).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "NotMPCGateway");
        });
    });
});

/**
 * Tests for multiple accounts per sourceAddress
 */
describe("EntryPoint Multiple Accounts", function () {
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, mpcGateway] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const deployed = await deployProxies(owner.address, mpcGateway.address);
        accountFactory = deployed.accountFactory;
        entryPoint = deployed.entryPoint;
    });

    it("Should create multiple accounts for the same sourceAddress with different salts", async function () {
        const salt1 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("salt1"));
        const salt2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("salt2"));

        const payload1 = encodeCreateAccountPayload(1, 1, salt1, publicKeyX, publicKeyY);
        const payload2 = encodeCreateAccountPayload(1, 1, salt2, publicKeyX, publicKeyY);

        await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload1);
        await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload2);

        const accounts = await accountFactory.getAccounts(SOURCE_ADDRESS);
        expect(accounts.length).to.equal(2);
        expect(accounts[0]).to.not.equal(accounts[1]);
    });

    it("Should return first account via getAccount for backward compatibility", async function () {
        const salt1 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("salt1"));
        const salt2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("salt2"));

        const payload1 = encodeCreateAccountPayload(1, 1, salt1, publicKeyX, publicKeyY);
        const payload2 = encodeCreateAccountPayload(1, 1, salt2, publicKeyX, publicKeyY);

        await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload1);
        await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload2);

        const firstAccount = await accountFactory.getAccount(SOURCE_ADDRESS);
        const allAccounts = await accountFactory.getAccounts(SOURCE_ADDRESS);

        expect(firstAccount).to.equal(allAccounts[0]);
    });
});

/**
 * Tests for Team Grant validation
 */
describe("EntryPoint Team Grant", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    // Granter uses MNEMONIC_1, Grantee uses MNEMONIC_2
    const GRANTER_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const GRANTEE_MNEMONIC = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

    let GRANTER_PUBLIC_KEY_X: string;
    let GRANTER_PUBLIC_KEY_Y: string;
    let GRANTEE_PUBLIC_KEY_X: string;
    let GRANTEE_PUBLIC_KEY_Y: string;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [owner, mpcGateway] = await hre.ethers.getSigners();

        // Get public keys
        const granterPubKey = await getPublicKeyFromMnemonic(GRANTER_MNEMONIC);
        const granteePubKey = await getPublicKeyFromMnemonic(GRANTEE_MNEMONIC);
        GRANTER_PUBLIC_KEY_X = granterPubKey.x;
        GRANTER_PUBLIC_KEY_Y = granterPubKey.y;
        GRANTEE_PUBLIC_KEY_X = granteePubKey.x;
        GRANTEE_PUBLIC_KEY_Y = granteePubKey.y;

        const deployed = await deployProxies(owner.address, mpcGateway.address);
        const accountFactory = deployed.accountFactory;
        entryPoint = deployed.entryPoint;

        // Create account with granter's public key (granter is account owner)
        const payload = encodeCreateAccountPayload(1, 1, DEFAULT_SALT, [GRANTER_PUBLIC_KEY_X], [GRANTER_PUBLIC_KEY_Y]);

        await entryPoint.connect(mpcGateway).executePayload("sourceChain", SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));
    });

    // Additional grant tests can be added here once the backend provides sample payloads
    // For now, this test suite demonstrates the structure
});
