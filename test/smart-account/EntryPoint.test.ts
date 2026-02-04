import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, keccak256, parseEther, sha256, toUtf8Bytes } from "ethers";

import { Account, AccountFactory, EntryPoint, MyToken } from "../../typechain-types";
import { combineHexStrings, encodeMultiPayload, encodeSignerBlock } from "../utils/lib";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

describe("EntryPoint", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const totalSigners = 1;
    const THRESHOLD = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let executor: HardhatEthersSigner;
    let account: Account;
    let accountFactory: AccountFactory;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [recover, executor] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

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
            [1, totalSigners, THRESHOLD, publicKeyX[0], publicKeyY[0]]
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
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        // Generate signature
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes: v + r + s + x + y, tight-packed)
        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute payload directly when called by owner", async function () {
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        // Generate signature
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes: v + r + s + x + y, tight-packed)
        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute payload when called by authorized executor", async function () {
        await entryPoint.setExecutor(executor.address, true);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(true);

        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        // Generate signature
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes: v + r + s + x + y, tight-packed)
        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await entryPoint.connect(executor).executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should revert when executePayload is called by unauthorized address", async function () {
        const numberSigners = 1;

        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        // Generate signature
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes: v + r + s + x + y, tight-packed)
        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

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

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const THRESHOLD = 1;
    const totalSigners = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;
    let publicKeyX: string[];
    let publicKeyY: string[];

    this.beforeAll(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

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
            [1, totalSigners, THRESHOLD, publicKeyX[0], publicKeyY[0]]
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

    // Helper function to create signed payload with 129-byte format
    async function createSignedPayload(
        txPayload: string,
        destForPreimage: string,
        valueForPreimage: bigint
    ): Promise<string> {
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, destForPreimage, valueForPreimage]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, 1]
        );

        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        return combineHexStrings(combineHexStrings(header, signerBlock), txPayload);
    }

    it("batch: approve and transferFrom in one call", async function () {
        const accountAddress = await account.getAddress();
        const amount = parseEther("0.001");

        const approveData = myToken.interface.encodeFunctionData("approve", [accountAddress, amount]);
        const transferFromData = myToken.interface.encodeFunctionData("transferFrom", [
            accountAddress,
            RECIPIENT_ADDRESS,
            amount,
        ]);

        const txPayload = encodeMultiPayload([
            { dest: myToken.target as string, value: 0n, data: approveData },
            { dest: myToken.target as string, value: 0n, data: transferFromData },
        ]);

        const payload = await createSignedPayload(txPayload, myToken.target as string, 0n);

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

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: ethAmount, data: "0x" }]);

        const payload = await createSignedPayload(txPayload, RECIPIENT_ADDRESS, ethAmount);

        const ethStart = await hre.ethers.provider.getBalance(accountAddress);
        const tx = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload);
        await tx.wait();
        const ethEnd = await hre.ethers.provider.getBalance(accountAddress);
        expect(ethEnd).to.equal(ethStart - ethAmount);
    });

    it("batch: ether transfer + erc20 transfer", async function () {
        const ethAmount = parseEther("0.001");
        const tokenAmount = parseEther("0.001");

        const transferData = myToken.interface.encodeFunctionData("transfer", [RECIPIENT_ADDRESS, tokenAmount]);

        const txPayload = encodeMultiPayload([
            { dest: RECIPIENT_ADDRESS, value: ethAmount, data: "0x" },
            { dest: myToken.target as string, value: 0n, data: transferData },
        ]);

        const payload = await createSignedPayload(txPayload, RECIPIENT_ADDRESS, ethAmount);

        const ethStart = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const tokenStart = await myToken.balanceOf(RECIPIENT_ADDRESS);

        const tx = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload);
        await tx.wait();

        const ethEnd = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const tokenEnd = await myToken.balanceOf(RECIPIENT_ADDRESS);

        expect(ethEnd).to.equal(ethStart + ethAmount);
        expect(tokenEnd).to.equal(tokenStart + tokenAmount);
    });

    it("edge: empty payload array reverts", async function () {
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const coder = new AbiCoder();
        const txPayload = coder.encode(["uint64"], [0]);

        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, 0n]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, 1]
        );

        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await expect(entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload)).to.be.revertedWithCustomError(
            entryPoint,
            "InvalidPayloadArray"
        );
    });

    it("edge: malformed item reverts", async function () {
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const coder = new AbiCoder();
        const magic = coder.encode(["uint64"], [1]);
        const fixed = coder.encode(["address", "uint256", "uint256"], [RECIPIENT_ADDRESS, parseEther("0.001"), 10]);
        const truncatedData = "0x0102";
        const txPayload = combineHexStrings(magic, fixed);
        const txPayloadMalformed = combineHexStrings(txPayload, truncatedData);

        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, parseEther("0.001")]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayloadMalformed));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, 1]
        );

        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayloadMalformed);

        await expect(entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload)).to.be.revertedWithCustomError(
            entryPoint,
            "PayloadTooShort"
        );
    });

    it("gas: batch vs two singles", async function () {
        const accountAddress = await account.getAddress();
        const amount = parseEther("0.001");

        const approveData = myToken.interface.encodeFunctionData("approve", [accountAddress, amount]);
        const transferFromData = myToken.interface.encodeFunctionData("transferFrom", [
            accountAddress,
            RECIPIENT_ADDRESS,
            amount,
        ]);

        // First single: approve
        const txPayloadApprove = encodeMultiPayload([{ dest: myToken.target as string, value: 0n, data: approveData }]);
        const payloadApprove = await createSignedPayload(txPayloadApprove, myToken.target as string, 0n);
        const tx1 = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payloadApprove);
        const receipt1 = await tx1.wait();

        // Second single: transferFrom
        const txPayloadTransferFrom = encodeMultiPayload([
            { dest: myToken.target as string, value: 0n, data: transferFromData },
        ]);
        const payloadTransferFrom = await createSignedPayload(txPayloadTransferFrom, myToken.target as string, 0n);
        const tx2 = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payloadTransferFrom);
        const receipt2 = await tx2.wait();

        const gasSingles = receipt1!.gasUsed + receipt2!.gasUsed;

        // Batch: approve + transferFrom
        const batchTxPayload = encodeMultiPayload([
            { dest: myToken.target as string, value: 0n, data: approveData },
            { dest: myToken.target as string, value: 0n, data: transferFromData },
        ]);
        const payloadBatch = await createSignedPayload(batchTxPayload, myToken.target as string, 0n);
        const txBatch = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payloadBatch);
        const receiptBatch = await txBatch.wait();

        expect(receiptBatch!.gasUsed).to.be.lessThan(gasSingles);
    });
});

describe("EntryPoint Multisig 2 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 2;
    const THRESHOLD = 2;

    // Two different mnemonics for two signers
    const MNEMONIC_1 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const MNEMONIC_2 = "test test test test test test test test test test test junk";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey1 = await getPublicKeyFromMnemonic(MNEMONIC_1);
        const pubKey2 = await getPublicKeyFromMnemonic(MNEMONIC_2);
        publicKeyX = [pubKey1.x, pubKey2.x];
        publicKeyY = [pubKey1.y, pubKey2.y];

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
            [1, totalSigners, THRESHOLD, publicKeyX[0], publicKeyY[0], publicKeyX[1], publicKeyY[1]]
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
        const numberSigners = 2;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        // Generate signatures from both signers
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sig1 = await generateSignatureWithMnemonic(MNEMONIC_1, messageHashPreimage.slice(2));
        const sig2 = await generateSignatureWithMnemonic(MNEMONIC_2, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Two signer blocks (129 bytes each)
        const signerBlock1 = encodeSignerBlock(sig1.v, sig1.r, sig1.s, publicKeyX[0], publicKeyY[0]);
        const signerBlock2 = encodeSignerBlock(sig2.v, sig2.r, sig2.s, publicKeyX[1], publicKeyY[1]);

        // Combine: header + signerBlock1 + signerBlock2 + txPayload
        const payload = combineHexStrings(
            combineHexStrings(combineHexStrings(header, signerBlock1), signerBlock2),
            txPayload
        );

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});

describe("EntryPoint Multisig 1 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 2;
    const THRESHOLD = 1;

    // Two different mnemonics for two signers
    const MNEMONIC_1 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const MNEMONIC_2 = "test test test test test test test test test test test junk";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey1 = await getPublicKeyFromMnemonic(MNEMONIC_1);
        const pubKey2 = await getPublicKeyFromMnemonic(MNEMONIC_2);
        publicKeyX = [pubKey1.x, pubKey2.x];
        publicKeyY = [pubKey1.y, pubKey2.y];

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
            [1, totalSigners, THRESHOLD, publicKeyX[0], publicKeyY[0], publicKeyX[1], publicKeyY[1]]
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
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        // Generate signature from first signer
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sig1 = await generateSignatureWithMnemonic(MNEMONIC_1, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes)
        const signerBlock = encodeSignerBlock(sig1.v, sig1.r, sig1.s, publicKeyX[0], publicKeyY[0]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute transactions with second signer", async function () {
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        // Generate signature from second signer
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sig2 = await generateSignatureWithMnemonic(MNEMONIC_2, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes) - using second signer's key
        const signerBlock = encodeSignerBlock(sig2.v, sig2.r, sig2.s, publicKeyX[1], publicKeyY[1]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});

/**
 * Tests for EntryPoint error handling paths
 */
describe("EntryPoint Error Paths", function () {
    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
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
        async function createSignedPayload(
            sequence: bigint,
            destList: { dest: string; value: bigint; data: string }[]
        ) {
            const accountAddress = await account.getAddress();

            const txPayload = encodeMultiPayload(destList);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, destList[0].dest, destList[0].value]
            );
            const messageHash = sha256(messageHashPreimage);

            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            // Combine: header + signerBlock + txPayload
            return combineHexStrings(combineHexStrings(header, signerBlock), txPayload);
        }

        it("Should revert with TransactionError when Account execution reverts with reason", async function () {
            const RejectETHFactory = await hre.ethers.getContractFactory("RejectETH");
            const rejectETH = await RejectETHFactory.deploy();
            await rejectETH.waitForDeployment();

            const sequence = (await account.accountSequence()) + 1n;
            const payload = await createSignedPayload(sequence, [
                { dest: await rejectETH.getAddress(), value: parseEther("1.0"), data: "0x" },
            ]);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "TransactionError");
        });

        it("Should handle validation failure gracefully (emits DebugReason)", async function () {
            const wrongSequence = 999n;
            const payload = await createSignedPayload(wrongSequence, [
                { dest: owner.address, value: parseEther("0.1"), data: "0x" },
            ]);

            const balanceBefore = await hre.ethers.provider.getBalance(owner.address);

            // Should not revert, but emit DebugReason with the failure reason
            await expect(entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload))
                .to.emit(entryPoint, "DebugReason")
                .withArgs("InvalidSequence");

            // Verify no funds were transferred (validation failed)
            const balanceAfter = await hre.ethers.provider.getBalance(owner.address);
            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("Should revert with PayloadTooShort when batch item is truncated", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            const count = 2n;
            const dest1 = owner.address;
            const value1 = parseEther("0.01");
            const dataLen1 = 0n;

            const truncatedTxPayload =
                "0x" +
                count.toString(16).padStart(64, "0") +
                dest1.slice(2).toLowerCase().padStart(64, "0") +
                value1.toString(16).padStart(64, "0") +
                dataLen1.toString(16).padStart(64, "0");

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, dest1, value1]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, truncatedTxPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), truncatedTxPayload);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload)
            ).to.be.revertedWithCustomError(entryPoint, "PayloadTooShort");
        });

        it("Should revert with InvalidTargetAccount when target doesn't match factory", async function () {
            const sequence = (await account.accountSequence()) + 1n;
            const dest = owner.address;
            const value = parseEther("0.01");

            const txPayload = encodeMultiPayload([{ dest, value, data: "0x" }]);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, dest, value]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            const wrongTarget = executor.address;

            // Header part (ABI-encoded) with wrong target
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, wrongTarget, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidTargetAccount");
        });

        it("Should revert with PayloadTooShort when txPayload has no count", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;
            const dest = owner.address;
            const value = parseEther("0.01");

            const shortTxPayload = "0x00";

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, dest, value]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, shortTxPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), shortTxPayload);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload)
            ).to.be.revertedWithCustomError(entryPoint, "PayloadTooShort");
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
    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
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

    describe("Empty Source Address", function () {
        it("Should reject empty sourceAddress in validateOperation", async function () {
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                ["", 1, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            const [isValid, reason] = await account.validateOperation(
                "",
                messageHash,
                [sigResult.v],
                [sigResult.r],
                [sigResult.s],
                publicKeyX,
                publicKeyY,
                proof,
                1,
                data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSourceAddress");
        });

        it("Should reject empty sourceAddress in compareSourceAddress", async function () {
            const result = await account.compareSourceAddress("");
            expect(result).to.be.false;
        });

        it("INFO: Empty sourceAddress creates different hash than valid address", async function () {
            const emptyHash = keccak256(toUtf8Bytes(""));
            const validHash = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

            expect(emptyHash).to.not.equal(validHash);
        });
    });

    describe("Large Payload Handling", function () {
        it("Should handle transaction with large calldata (1KB)", async function () {
            const largeData = "0x" + "ab".repeat(1024);

            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            const txPayload = encodeMultiPayload([
                { dest: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: largeData },
            ]);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.01"));
        });

        it("Should handle transaction with large calldata (10KB)", async function () {
            const largeData = "0x" + "cd".repeat(10240);

            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            const txPayload = encodeMultiPayload([
                { dest: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: largeData },
            ]);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.01"));
        });

        it("Should execute large batch of small transactions", async function () {
            const transactions = [];
            for (let i = 0; i < 20; i++) {
                transactions.push({
                    dest: RECIPIENT_ADDRESS,
                    value: parseEther("0.001"),
                    data: "0x",
                });
            }

            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            const txPayload = encodeMultiPayload(transactions);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, parseEther("0.001")]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.02"));
        });
    });

    describe("Whitespace in Source Address", function () {
        it("Should reject sourceAddress with only spaces", async function () {
            const result = await account.compareSourceAddress("   ");
            expect(result).to.be.false;
        });

        it("Should reject sourceAddress with leading/trailing whitespace", async function () {
            const resultLeading = await account.compareSourceAddress(" " + SOURCE_ADDRESS);
            const resultTrailing = await account.compareSourceAddress(SOURCE_ADDRESS + " ");

            expect(resultLeading).to.be.false;
            expect(resultTrailing).to.be.false;
        });
    });

    describe("Zero Value Transactions", function () {
        it("Should handle zero-value transaction", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: 0n, data: "0x" }]);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, 0n]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, sequence, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload);

            expect(await account.accountSequence()).to.equal(1n);
        });
    });
});

/**
 * Tests for batch transaction limits
 * EntryPoint.sol defines MAX_BATCH_SIZE = 20
 */
describe("EntryPoint Batch Transaction Limits", function () {
    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
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

    function encodeBatchPayload(count: number, dest: string, value: bigint): string {
        let payload = "0x" + count.toString(16).padStart(64, "0");

        for (let i = 0; i < count; i++) {
            payload += dest.slice(2).toLowerCase().padStart(64, "0");
            payload += value.toString(16).padStart(64, "0");
            payload += "0".padStart(64, "0");
        }

        return payload;
    }

    async function createSignedBatchPayload(batchCount: number) {
        const accountAddress = await account.getAddress();
        const sequence = (await account.accountSequence()) + 1n;
        const dest = recipient.address;
        const value = parseEther("0.01");

        const txPayload = encodeBatchPayload(batchCount, dest, value);

        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, sequence, dest, value]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, sequence, 1]
        );

        // Signer block (129 bytes: v + r + s + x + y, tight-packed)
        const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

        return combineHexStrings(combineHexStrings(header, signerBlock), txPayload);
    }

    describe("MAX_BATCH_SIZE Enforcement", function () {
        it("Should accept batch with exactly 20 transactions (MAX_BATCH_SIZE)", async function () {
            const payload = await createSignedBatchPayload(20);

            const initialBalance = await hre.ethers.provider.getBalance(recipient.address);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(recipient.address);
            const expectedGain = parseEther("0.01") * 20n;

            expect(finalBalance - initialBalance).to.equal(expectedGain);
        });

        it("Should reject batch with 21 transactions (exceeds MAX_BATCH_SIZE)", async function () {
            const payload = await createSignedBatchPayload(21);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidPayloadArray");
        });

        it("Should accept batch with 1 transaction", async function () {
            const payload = await createSignedBatchPayload(1);

            const initialBalance = await hre.ethers.provider.getBalance(recipient.address);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(recipient.address);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.01"));
        });

        it("Should reject batch with 0 transactions", async function () {
            const payload = await createSignedBatchPayload(0);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidPayloadArray");
        });
    });

    describe("Batch Size Edge Cases", function () {
        it("Should handle batch with 10 transactions", async function () {
            const payload = await createSignedBatchPayload(10);

            const initialBalance = await hre.ethers.provider.getBalance(recipient.address);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(recipient.address);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.1"));
        });

        it("Should handle batch with 19 transactions (just under limit)", async function () {
            const payload = await createSignedBatchPayload(19);

            const initialBalance = await hre.ethers.provider.getBalance(recipient.address);

            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);

            const finalBalance = await hre.ethers.provider.getBalance(recipient.address);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.19"));
        });
    });
});

describe("EntryPoint ERC20 Operations", function () {
    const RECIPIENT_ADDRESS = "0x390dc2368bfde7e7a370af46c0b834b718d570c1";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const THRESHOLD = 1;
    const totalSigners = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;
    let publicKeyX: string[];
    let publicKeyY: string[];

    this.beforeAll(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

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
            [1, totalSigners, THRESHOLD, publicKeyX[0], publicKeyY[0]]
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
        const numberSigners = 1;

        const initialRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("0.001");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const transferData = myToken.interface.encodeFunctionData("transfer", [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = encodeMultiPayload([{ dest: myToken.target as string, value: 0n, data: transferData }]);

        // Generate signature
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, myToken.target, 0n]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes: v + r + s + x + y, tight-packed)
        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute erc20 approve from Account contract", async function () {
        const numberSigners = 1;

        const amountToSend = parseEther("0.001");
        const accountAddress = await account.getAddress();
        const accountSequence = await account.accountSequence();

        const sourceChain = "sourceChain";

        const initialAllowance = await myToken.allowance(accountAddress, RECIPIENT_ADDRESS);
        expect(initialAllowance).to.equal(0);

        const approveData = myToken.interface.encodeFunctionData("approve", [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = encodeMultiPayload([{ dest: myToken.target as string, value: 0n, data: approveData }]);

        // Generate signature
        const messageHashPreimage = new AbiCoder().encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, accountSequence + 1n, myToken.target, 0n]
        );
        const messageHash = sha256(messageHashPreimage);
        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

        // Header part (ABI-encoded)
        const header = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
            [2, accountAddress, messageHash, proof, accountSequence + 1n, numberSigners]
        );

        // Signer block (129 bytes: v + r + s + x + y, tight-packed)
        const signerBlock = encodeSignerBlock(sigResult.v, sigResult.r, sigResult.s, publicKeyX[0], publicKeyY[0]);

        // Combine: header + signerBlock + txPayload
        const payload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientAllowance = await myToken.allowance(accountAddress, RECIPIENT_ADDRESS);
        expect(finalRecipientAllowance).to.equal(amountToSend);
    });
});
