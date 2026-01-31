import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, parseEther, toUtf8Bytes, sha256 } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, AccountFactory, EntryPoint, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings } from "../utils/lib";

/**
 * Tests for batch transaction limits
 * EntryPoint.sol defines MAX_BATCH_SIZE = 20
 */
describe("Batch Transaction Limits", function () {
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

        // Create account via EntryPoint
        const createAccountPayload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, 1, 1, publicKeyX[0], publicKeyY[0]]
        );

        await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, createAccountPayload);

        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        // Fund the account generously for batch tests
        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("100.0"),
        });
    });

    /**
     * Helper to create a batch payload with N transactions
     */
    function encodeBatchPayload(count: number, dest: string, value: bigint): string {
        let payload = "0x" + count.toString(16).padStart(64, "0");

        for (let i = 0; i < count; i++) {
            // Each item: dest (32 bytes padded), value (32 bytes), dataLen (32 bytes), data (0 bytes)
            payload += dest.slice(2).toLowerCase().padStart(64, "0");
            payload += value.toString(16).padStart(64, "0");
            payload += "0".padStart(64, "0"); // dataLen = 0
        }

        return payload;
    }

    /**
     * Helper to create signed payload for EntryPoint
     */
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
            console.log("20 transactions executed successfully");
        });

        it("Should reject batch with 21 transactions (exceeds MAX_BATCH_SIZE)", async function () {
            const payload = await createSignedBatchPayload(21);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidPayloadArray");

            console.log("21 transactions correctly rejected");
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
