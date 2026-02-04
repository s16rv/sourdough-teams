import hre from "hardhat";
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
} from "../utils/lib";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

const TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const EXPECTED_CHAIN_ID = 31337n; // Hardhat default chain ID

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
    let recover: HardhatEthersSigner;
    let executor: HardhatEthersSigner;
    let account: Account;
    let accountFactory: AccountFactory;

    beforeEach(async function () {
        [recover, executor] = await hre.ethers.getSigners();

        // Get public key from mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(recover.address, true);

        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, totalSigners, THRESHOLD, PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0]]
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
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

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute payload directly when called by owner", async function () {
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

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute payload when called by authorized executor", async function () {
        await entryPoint.setExecutor(executor.address, true);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(true);

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

        await entryPoint.connect(executor).executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should revert when executePayload is called by unauthorized address", async function () {
        const amountToSend = parseEther("1.0");

        const sourceChain = "sourceChain";

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        expect(await entryPoint.isExecutor(executor.address)).to.equal(false);

        await expect(
            entryPoint.connect(executor).executePayload(sourceChain, SOURCE_ADDRESS, payload)
        ).to.be.revertedWithCustomError(entryPoint, "NotExecutor");
    });

    it("should allow setting and removing executors by owner", async function () {
        expect(await entryPoint.isExecutor(executor.address)).to.equal(false);

        await entryPoint.setExecutor(executor.address, true);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(true);

        await entryPoint.setExecutor(executor.address, false);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(false);
    });

    it("should revert when non-owner tries to set executor", async function () {
        await expect(entryPoint.connect(executor).setExecutor(executor.address, true)).to.be.revertedWithCustomError(
            entryPoint,
            "OnlyOwner"
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
    let recover: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;

    this.beforeAll(async function () {
        [recover] = await hre.ethers.getSigners();

        // Get public key from mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(recover.address, true);

        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, totalSigners, THRESHOLD, PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0]]
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({ to: accountAddr, value: parseEther("2.0") });

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

        const tx = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload);
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
        const tx = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload);
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

        const tx = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload);
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
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        // Get public keys from both mnemonics
        const pubKey1 = await getPublicKeyFromMnemonic(MNEMONIC_1);
        const pubKey2 = await getPublicKeyFromMnemonic(MNEMONIC_2);
        PUBLIC_KEY_X = [pubKey1.x, pubKey2.x];
        PUBLIC_KEY_Y = [pubKey1.y, pubKey2.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(recover.address, true);

        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [1, totalSigners, THRESHOLD, PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0], PUBLIC_KEY_X[1], PUBLIC_KEY_Y[1]]
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
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

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

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
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey1 = await getPublicKeyFromMnemonic(MNEMONIC_1);
        const pubKey2 = await getPublicKeyFromMnemonic(MNEMONIC_2);
        PUBLIC_KEY_X = [pubKey1.x, pubKey2.x];
        PUBLIC_KEY_Y = [pubKey1.y, pubKey2.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(recover.address, true);

        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [1, totalSigners, THRESHOLD, PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0], PUBLIC_KEY_X[1], PUBLIC_KEY_Y[1]]
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
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

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

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

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

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
    let executor: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, executor] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, owner.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(executor.address, true);

        const createAccountPayload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, 1, 1, publicKeyX[0], publicKeyY[0]]
        );

        await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, createAccountPayload);

        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("10.0"),
        });
    });

    describe("Transaction Error Handling", function () {
        it("Should revert with TransactionError when Account execution reverts with reason", async function () {
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
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "TransactionError");
        });

        it("Should handle validation failure gracefully (emits DebugReason)", async function () {
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

            // Should not revert, but emit DebugReason with the failure reason
            await expect(entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload))
                .to.emit(entryPoint, "DebugReason")
                .withArgs("InvalidSequence");

            // Verify no funds were transferred (validation failed)
            const balanceAfter = await hre.ethers.provider.getBalance(owner.address);
            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("Should revert with InvalidTargetAccount when target doesn't match factory", async function () {
            const wrongTarget = executor.address;
            const sequence = (await account.accountSequence()) + 1n;

            // Create txPayload with wrong target address
            const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, wrongTarget, sequence, [
                { to: owner.address, value: parseEther("0.01"), data: "0x" },
            ]);

            const txPayloadHash = computeTxPayloadHash(txPayload);
            const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

            const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytesForSigning.toString("hex"));

            const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: publicKeyX[0], y: publicKeyY[0] }];
            const payload = encodeNewPayload(signBytes, hashOffset, signatures, txPayload);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidTargetAccount");
        });

        it("Should revert with InvalidChainId when chainId doesn't match", async function () {
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

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidChainId");
        });

        it("Should emit DebugReason with InvalidHashCommitment when txPayload is tampered", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            // Create txPayload
            const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, [
                { to: owner.address, value: parseEther("0.01"), data: "0x" },
            ]);

            const txPayloadHash = computeTxPayloadHash(txPayload);
            const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

            const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytesForSigning.toString("hex"));

            const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: publicKeyX[0], y: publicKeyY[0] }];

            // Create a different txPayload (tampered)
            const tamperedTxPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, [
                { to: owner.address, value: parseEther("0.02"), data: "0x" }, // Different value
            ]);

            // Use original signBytes but tampered txPayload
            const payload = encodeNewPayload(signBytes, hashOffset, signatures, tamperedTxPayload);

            await expect(entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload))
                .to.emit(entryPoint, "DebugReason")
                .withArgs("InvalidHashCommitment");
        });
    });

    describe("Executor Management", function () {
        it("Should allow owner to add executor", async function () {
            const [, , newExecutor] = await hre.ethers.getSigners();

            await entryPoint.connect(owner).setExecutor(newExecutor.address, true);

            expect(await entryPoint.isExecutor(newExecutor.address)).to.be.true;
        });

        it("Should allow owner to remove executor", async function () {
            await entryPoint.connect(owner).setExecutor(executor.address, false);

            expect(await entryPoint.isExecutor(executor.address)).to.be.false;
        });

        it("Should reject non-owner from setting executor", async function () {
            const [, , nonOwner, newExecutor] = await hre.ethers.getSigners();

            await expect(
                entryPoint.connect(nonOwner).setExecutor(newExecutor.address, true)
            ).to.be.revertedWithCustomError(entryPoint, "OnlyOwner");
        });

        it("Should reject non-executor from executing payload", async function () {
            const [, , nonExecutor] = await hre.ethers.getSigners();

            const payload = new AbiCoder().encode(
                ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
                [1, 1, 1, publicKeyX[0], publicKeyY[0]]
            );

            await expect(
                entryPoint.connect(nonExecutor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "NotExecutor");
        });
    });
});

/**
 * Edge case tests for various boundary conditions
 */
describe("EntryPoint Edge Cases", function () {
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let account: Account;

    let owner: HardhatEthersSigner;
    let executor: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, executor] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, owner.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(executor.address, true);

        const createAccountPayload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, 1, 1, publicKeyX[0], publicKeyY[0]]
        );

        await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, createAccountPayload);

        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("10.0"),
        });
    });

    describe("Large Payload Handling", function () {
        it("Should handle transaction with large calldata (1KB)", async function () {
            const largeData = "0x" + "ab".repeat(1024);

            const payload = await createNewFormatPayload(
                account,
                SOURCE_ADDRESS,
                [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: largeData }],
                publicKeyX,
                publicKeyY
            );

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.01"));
        });

        it("Should execute large batch of small transactions", async function () {
            const transactions = [];
            for (let i = 0; i < 20; i++) {
                transactions.push({
                    to: RECIPIENT_ADDRESS,
                    value: parseEther("0.001"),
                    data: "0x",
                });
            }

            const payload = await createNewFormatPayload(account, SOURCE_ADDRESS, transactions, publicKeyX, publicKeyY);

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.02"));
        });
    });

    describe("Zero Value Transactions", function () {
        it("Should handle zero-value transaction", async function () {
            const payload = await createNewFormatPayload(
                account,
                SOURCE_ADDRESS,
                [{ to: RECIPIENT_ADDRESS, value: 0n, data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            expect(await account.accountSequence()).to.equal(1n);
        });
    });

    describe("Hash Commitment Validation", function () {
        it("Should reject signBytes with invalid hex prefix", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, [
                { to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" },
            ]);

            const txPayloadHash = computeTxPayloadHash(txPayload);
            // Create signBytes with invalid prefix (no "0x")
            const invalidSignBytes =
                "0x" + Buffer.from('{"tx_hash":"' + txPayloadHash.slice(2) + '"}', "utf8").toString("hex");
            const hashOffset = 12; // Points to where "0x" should be, but it's not there

            const signBytesForSigning = Buffer.from(invalidSignBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytesForSigning.toString("hex"));

            const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: publicKeyX[0], y: publicKeyY[0] }];
            const payload = encodeNewPayload(invalidSignBytes, hashOffset, signatures, txPayload);

            // Should fail validation due to invalid hex prefix
            await expect(entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload))
                .to.emit(entryPoint, "DebugReason")
                .withArgs("InvalidHashCommitment");
        });

        it("Should reject signBytes with offset out of bounds", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, [
                { to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" },
            ]);

            const txPayloadHash = computeTxPayloadHash(txPayload);
            const { signBytes } = createSignBytes(txPayloadHash);
            const invalidOffset = 1000; // Way beyond signBytes length

            const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytesForSigning.toString("hex"));

            const signatures = [{ v: sig.v, r: sig.r, s: sig.s, x: publicKeyX[0], y: publicKeyY[0] }];
            const payload = encodeNewPayload(signBytes, invalidOffset, signatures, txPayload);

            // Should revert with InvalidHashOffset
            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(account, "InvalidHashOffset");
        });
    });
});

describe("EntryPoint Batch Transaction Limits", function () {
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let account: Account;

    let owner: HardhatEthersSigner;
    let executor: HardhatEthersSigner;
    let recipient: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, executor, recipient] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, owner.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(executor.address, true);

        const createAccountPayload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, 1, 1, publicKeyX[0], publicKeyY[0]]
        );

        await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, createAccountPayload);

        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("100.0"),
        });
    });

    describe("MAX_BATCH_SIZE Enforcement", function () {
        it("Should accept batch with exactly 20 transactions (MAX_BATCH_SIZE)", async function () {
            const transactions = [];
            for (let i = 0; i < 20; i++) {
                transactions.push({
                    to: recipient.address,
                    value: parseEther("0.01"),
                    data: "0x",
                });
            }

            const payload = await createNewFormatPayload(account, SOURCE_ADDRESS, transactions, publicKeyX, publicKeyY);

            const initialBalance = await hre.ethers.provider.getBalance(recipient.address);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(recipient.address);
            const expectedGain = parseEther("0.01") * 20n;

            expect(finalBalance - initialBalance).to.equal(expectedGain);
        });

        it("Should reject batch with 21 transactions (exceeds MAX_BATCH_SIZE)", async function () {
            const transactions = [];
            for (let i = 0; i < 21; i++) {
                transactions.push({
                    to: recipient.address,
                    value: parseEther("0.01"),
                    data: "0x",
                });
            }

            const payload = await createNewFormatPayload(account, SOURCE_ADDRESS, transactions, publicKeyX, publicKeyY);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidPayloadArray");
        });

        it("Should accept batch with 1 transaction", async function () {
            const payload = await createNewFormatPayload(
                account,
                SOURCE_ADDRESS,
                [{ to: recipient.address, value: parseEther("0.01"), data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            const initialBalance = await hre.ethers.provider.getBalance(recipient.address);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(recipient.address);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.01"));
        });
    });
});

describe("EntryPoint ERC20 Operations", function () {
    const RECIPIENT_ADDRESS = "0x390dc2368bfde7e7a370af46c0b834b718d570c1";

    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];

    const THRESHOLD = 1;
    const totalSigners = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;

    this.beforeAll(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y];

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        await entryPoint.setExecutor(recover.address, true);

        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, totalSigners, THRESHOLD, PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0]]
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });

        const MyTokenContract = await hre.ethers.getContractFactory("MyToken");
        myToken = await MyTokenContract.deploy("MyToken", "MTK", 18);
        await myToken.waitForDeployment();

        await myToken.transfer(accountAddr, parseEther("3.0"));
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));

        const myTokenBalance = await myToken.balanceOf(accountAddress);
        expect(myTokenBalance).to.equal(parseEther("3.0"));
    });

    it("should execute erc20 transfer from Account contract", async function () {
        const initialRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("0.001");

        const sourceChain = "sourceChain";

        const transferData = myToken.interface.encodeFunctionData("transfer", [RECIPIENT_ADDRESS, amountToSend]);

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [{ to: myToken.target as string, value: 0n, data: transferData }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute erc20 approve from Account contract", async function () {
        const amountToSend = parseEther("0.001");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const initialAllowance = await myToken.allowance(accountAddress, RECIPIENT_ADDRESS);
        expect(initialAllowance).to.equal(0);

        const approveData = myToken.interface.encodeFunctionData("approve", [RECIPIENT_ADDRESS, amountToSend]);

        const payload = await createNewFormatPayload(
            account,
            SOURCE_ADDRESS,
            [{ to: myToken.target as string, value: 0n, data: approveData }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientAllowance = await myToken.allowance(accountAddress, RECIPIENT_ADDRESS);
        expect(finalRecipientAllowance).to.equal(amountToSend);
    });
});
