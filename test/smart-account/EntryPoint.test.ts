import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, keccak256, parseEther, sha256, toUtf8Bytes } from "ethers";

import { Account, AccountFactory, EntryPoint, MyToken, Secp256k1Verifier } from "../../typechain-types";
import { combineHexStrings, encodeMultiPayload } from "../utils/lib";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

describe("EntryPoint", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 1;
    const PUBLIC_KEY_X = ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"];
    const PUBLIC_KEY_Y = ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"];
    const THRESHOLD = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let executor: HardhatEthersSigner;
    let account: Account;
    let accountFactory: AccountFactory;

    beforeEach(async function () {
        [recover, executor] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(verifier.target);
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
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute payload directly when called by owner", async function () {
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute payload when called by authorized executor", async function () {
        await entryPoint.setExecutor(executor.address, true);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(true);

        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.connect(executor).executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should revert when executePayload is called by unauthorized address", async function () {
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

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
        await expect(entryPoint.connect(executor).setExecutor(executor.address, true)).to.be.revertedWith(
            "Only owner can set executor"
        );
    });
});

describe("EntryPoint Multi-Payload", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const PUBLIC_KEY_X = ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"];
    const PUBLIC_KEY_Y = ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"];
    const THRESHOLD = 1;
    const totalSigners = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;

    this.beforeAll(async function () {
        [recover] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
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
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

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

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

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
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const accountAddress = await account.getAddress();
        const ethAmount = parseEther("0.001");

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: ethAmount, data: "0x" }]);

        const accountSequence = await account.accountSequence();

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        const ethStart = await hre.ethers.provider.getBalance(accountAddress);
        const tx = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload);
        await tx.wait();
        const ethEnd = await hre.ethers.provider.getBalance(accountAddress);
        expect(ethEnd).to.equal(ethStart - ethAmount);
    });

    it("batch: ether transfer + erc20 transfer", async function () {
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const accountAddress = await account.getAddress();
        const ethAmount = parseEther("0.001");
        const tokenAmount = parseEther("0.001");

        const transferData = myToken.interface.encodeFunctionData("transfer", [RECIPIENT_ADDRESS, tokenAmount]);

        const txPayload = encodeMultiPayload([
            { dest: RECIPIENT_ADDRESS, value: ethAmount, data: "0x" },
            { dest: myToken.target as string, value: 0n, data: transferData },
        ]);

        const accountSequence = await account.accountSequence();

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

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
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const coder = new AbiCoder();
        const txPayload = coder.encode(["uint64"], [0]);
        const accountSequence = await account.accountSequence();
        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await expect(entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload)).to.be.revertedWithCustomError(
            entryPoint,
            "InvalidPayloadArray"
        );
    });

    it("edge: malformed item reverts", async function () {
        const accountAddress = await account.getAddress();
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const coder = new AbiCoder();
        const magic = coder.encode(["uint64"], [1]);
        const fixed = coder.encode(["address", "uint256", "uint256"], [RECIPIENT_ADDRESS, parseEther("0.001"), 10]);
        const truncatedData = "0x0102";
        const txPayload = combineHexStrings(magic, fixed);
        const txPayloadMalformed = combineHexStrings(txPayload, truncatedData);

        const proof = sha256(combineHexStrings(messageHash, txPayloadMalformed));
        const accountSequence = await account.accountSequence();
        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayloadMalformed);

        await expect(entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payload)).to.be.revertedWithCustomError(
            entryPoint,
            "PayloadTooShort"
        );
    });

    it("gas: batch vs two singles", async function () {
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const accountAddress = await account.getAddress();
        const amount = parseEther("0.001");

        const approveData = myToken.interface.encodeFunctionData("approve", [accountAddress, amount]);
        const transferFromData = myToken.interface.encodeFunctionData("transferFrom", [
            accountAddress,
            RECIPIENT_ADDRESS,
            amount,
        ]);

        const coder = new AbiCoder();
        const approveLen = BigInt((approveData.length - 2) / 2);
        const approveHeader = coder.encode(
            ["address", "uint256", "uint256"],
            [myToken.target as string, 0n, approveLen]
        );
        const approveItem = combineHexStrings(approveHeader, approveData);
        const singleCount = coder.encode(["uint64"], [1n]);
        const txPayloadApprove = combineHexStrings(singleCount, approveItem);
        const proofApprove = sha256(combineHexStrings(messageHash, txPayloadApprove));
        const pApprove = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proofApprove,
                (await account.accountSequence()) + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payloadApprove = combineHexStrings(pApprove, txPayloadApprove);
        const tx1 = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payloadApprove);
        const receipt1 = await tx1.wait();

        const tfLen = BigInt((transferFromData.length - 2) / 2);
        const tfHeader = coder.encode(["address", "uint256", "uint256"], [myToken.target as string, 0n, tfLen]);
        const tfItem = combineHexStrings(tfHeader, transferFromData);
        const txPayloadTransferFrom = combineHexStrings(singleCount, tfItem);
        const proofTransferFrom = sha256(combineHexStrings(messageHash, txPayloadTransferFrom));
        const pTransferFrom = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proofTransferFrom,
                (await account.accountSequence()) + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payloadTransferFrom = combineHexStrings(pTransferFrom, txPayloadTransferFrom);
        const tx2 = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payloadTransferFrom);
        const receipt2 = await tx2.wait();

        const gasSingles = receipt1!.gasUsed + receipt2!.gasUsed;

        const batchTxPayload = encodeMultiPayload([
            { dest: myToken.target as string, value: 0n, data: approveData },
            { dest: myToken.target as string, value: 0n, data: transferFromData },
        ]);
        const batchProof = sha256(combineHexStrings(messageHash, batchTxPayload));
        const pBatch = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                batchProof,
                (await account.accountSequence()) + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payloadBatch = combineHexStrings(pBatch, batchTxPayload);
        const txBatch = await entryPoint.executePayload("sourceChain", SOURCE_ADDRESS, payloadBatch);
        const receiptBatch = await txBatch.wait();

        expect(receiptBatch!.gasUsed).to.be.lessThan(gasSingles);
    });
});

describe("EntryPoint Multisig 2 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 2;
    const PUBLIC_KEY_X = [
        "0x136ea3f63279bc540c8fed8f11f08427d55736aaf2ce2859fd2348282035c17f",
        "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
    ];
    const PUBLIC_KEY_Y = [
        "0x6578e8e0a5f7bd39687d1d46205bb25afeef52bc261249e7637cb65f55e817c4",
        "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
    ];
    const THRESHOLD = 2;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
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

    it("should execute transactions from Account contract", async function () {
        const messageHash = "0xc5d5353eb37e8606d9ee377aa5fe19efcb9a11ff6551e0a4c642f9e4a2a2b94b";
        const r = [
            "0xf71104d22f55094dbf973f65c6cff43d18d2aadc87a8de2234635ff0128a75aa",
            "0x543c159b6a4179f7b6b486554ba3bfcd11a9268f76fe7a052c5c31888c630399",
        ];
        const s = [
            "0x2775621757741923cb8921e42b09c393f486439e54860c0852a02fa036c5efeb",
            "0x4094056e2994f0e5b52f2776b01ab91bcc7b2827791a29eb39a1aa93e5e723c7",
        ];
        const numberSigners = 2;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            [
                "uint8",
                "address",
                "bytes32",
                "bytes32",
                "uint64",
                "uint64",
                "bytes32",
                "bytes32",
                "bytes32",
                "bytes32",
                "bytes32",
                "bytes32",
                "bytes32",
                "bytes32",
            ],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
                r[1],
                s[1],
                PUBLIC_KEY_X[1],
                PUBLIC_KEY_Y[1],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});

describe("EntryPoint Multisig 1 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 2;
    const PUBLIC_KEY_X = [
        "0x136ea3f63279bc540c8fed8f11f08427d55736aaf2ce2859fd2348282035c17f",
        "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
    ];
    const PUBLIC_KEY_Y = [
        "0x6578e8e0a5f7bd39687d1d46205bb25afeef52bc261249e7637cb65f55e817c4",
        "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
    ];
    const THRESHOLD = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
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
        const messageHash = "0xc5d5353eb37e8606d9ee377aa5fe19efcb9a11ff6551e0a4c642f9e4a2a2b94b";
        const r = ["0xf71104d22f55094dbf973f65c6cff43d18d2aadc87a8de2234635ff0128a75aa"];
        const s = ["0x2775621757741923cb8921e42b09c393f486439e54860c0852a02fa036c5efeb"];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute transactions with second signer", async function () {
        const messageHash = "0xc5d5353eb37e8606d9ee377aa5fe19efcb9a11ff6551e0a4c642f9e4a2a2b94b";
        const r = ["0x543c159b6a4179f7b6b486554ba3bfcd11a9268f76fe7a052c5c31888c630399"];
        const s = ["0x4094056e2994f0e5b52f2776b01ab91bcc7b2827791a29eb39a1aa93e5e723c7"];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[1],
                PUBLIC_KEY_Y[1],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

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
    let secp256k1Verifier: Secp256k1Verifier;
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

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierContract.deploy();
        await secp256k1Verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(secp256k1Verifier.target);
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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            return combineHexStrings(entryPointPayload, txPayload);
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

        it("Should handle validation failure gracefully (returns silently)", async function () {
            const wrongSequence = 999n;
            const payload = await createSignedPayload(wrongSequence, [
                { dest: owner.address, value: parseEther("0.1"), data: "0x" },
            ]);

            const balanceBefore = await hre.ethers.provider.getBalance(owner.address);

            // Should not revert, just return silently
            const tx = await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);
            await tx.wait();

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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            const fullPayload = combineHexStrings(entryPointPayload, truncatedTxPayload);

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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, wrongTarget, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            const fullPayload = combineHexStrings(entryPointPayload, txPayload);

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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            const fullPayload = combineHexStrings(entryPointPayload, shortTxPayload);

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

            await expect(entryPoint.connect(nonOwner).setExecutor(newExecutor.address, true)).to.be.revertedWith(
                "Only owner can set executor"
            );
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
    let secp256k1Verifier: Secp256k1Verifier;
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

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierContract.deploy();
        await secp256k1Verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(secp256k1Verifier.target);
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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            const fullPayload = combineHexStrings(entryPointPayload, txPayload);

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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            const fullPayload = combineHexStrings(entryPointPayload, txPayload);

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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            const fullPayload = combineHexStrings(entryPointPayload, txPayload);

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

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
            );

            const fullPayload = combineHexStrings(entryPointPayload, txPayload);

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
    let secp256k1Verifier: Secp256k1Verifier;
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

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierContract.deploy();
        await secp256k1Verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(secp256k1Verifier.target);
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

        const entryPointPayload = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [2, accountAddress, messageHash, proof, sequence, 1, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]]
        );

        return combineHexStrings(entryPointPayload, txPayload);
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

    const PUBLIC_KEY_X = ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"];
    const PUBLIC_KEY_Y = ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"];

    const THRESHOLD = 1;
    const totalSigners = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;

    this.beforeAll(async function () {
        [recover] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
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
        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = ["0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61"];
        const s = ["0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b"];
        const numberSigners = 1;

        const initialRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("0.001");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const transferData = myToken.interface.encodeFunctionData("transfer", [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = encodeMultiPayload([{ dest: myToken.target as string, value: 0n, data: transferData }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute erc20 approve from Account contract", async function () {
        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = ["0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61"];
        const s = ["0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b"];
        const numberSigners = 1;

        const amountToSend = parseEther("0.001");
        const accountAddress = await account.getAddress();

        const sourceChain = "sourceChain";

        const initialAllowance = await myToken.allowance(accountAddress, RECIPIENT_ADDRESS);
        expect(initialAllowance).to.equal(0);

        const approveData = myToken.interface.encodeFunctionData("approve", [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = encodeMultiPayload([{ dest: myToken.target as string, value: 0n, data: approveData }]);

        const proof = sha256(combineHexStrings(messageHash, txPayload));
        const accountSequence = await account.accountSequence();

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                accountSequence + 1n,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientAllowance = await myToken.allowance(accountAddress, RECIPIENT_ADDRESS);
        expect(finalRecipientAllowance).to.equal(amountToSend);
    });
});
