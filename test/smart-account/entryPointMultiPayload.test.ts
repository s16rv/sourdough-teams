import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, parseEther, sha256 } from "ethers";

import { Account, EntryPoint, MyToken } from "../../typechain-types";
import { combineHexStrings, encodeMultiPayload } from "../utils/lib";

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
            ["uint8", "address", "uint64", "uint64", "bytes32", "bytes32"],
            [1, recover.address, totalSigners, THRESHOLD, PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0]]
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

        // if successfuly transferFrom, allowance should be 0
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
        const truncatedData = "0x0102"; // only 2 bytes while declaring length 10
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

        // Two single calls encoded as count=1
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

        // Batch call
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
