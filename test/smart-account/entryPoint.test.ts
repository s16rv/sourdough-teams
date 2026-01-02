import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, parseEther, sha256 } from "ethers";

import { Account, EntryPoint } from "../../typechain-types";
import { combineHexStrings, encodeMultiPayload } from "../utils/lib";
import { AccountFactory } from "../../typechain-types";

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

        // Set recover as an executor so it can call executePayload
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

        // Execute transaction from the Account contract
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

        // Prepare payload for executePayload
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

        // Call executePayload directly as owner
        await entryPoint.executePayload(sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute payload when called by authorized executor", async function () {
        // Set executor as authorized
        await entryPoint.setExecutor(executor.address, true);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(true);

        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        // Prepare payload for executePayload
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

        // Call executePayload as executor
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

        // Prepare payload for executePayload
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

        // Verify executor is not authorized
        expect(await entryPoint.isExecutor(executor.address)).to.equal(false);

        // Call executePayload as unauthorized executor should revert
        await expect(
            entryPoint.connect(executor).executePayload(sourceChain, SOURCE_ADDRESS, payload)
        ).to.be.revertedWithCustomError(entryPoint, "NotExecutor");
    });

    it("should allow setting and removing executors by owner", async function () {
        // Initially executor should not be authorized
        expect(await entryPoint.isExecutor(executor.address)).to.equal(false);

        // Set executor as authorized
        await entryPoint.setExecutor(executor.address, true);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(true);

        // Remove executor authorization
        await entryPoint.setExecutor(executor.address, false);
        expect(await entryPoint.isExecutor(executor.address)).to.equal(false);
    });

    it("should revert when non-owner tries to set executor", async function () {
        // Try to set executor as authorized from non-owner account
        await expect(entryPoint.connect(executor).setExecutor(executor.address, true)).to.be.revertedWith(
            "Only owner can set executor"
        );
    });
});
