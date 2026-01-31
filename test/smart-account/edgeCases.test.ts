import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, parseEther, toUtf8Bytes, sha256 } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, AccountFactory, EntryPoint, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings, encodeMultiPayload } from "../utils/lib";

/**
 * Edge case tests for various boundary conditions
 */
describe("Edge Cases", function () {
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

        // Create account
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
                ["", 1, RECIPIENT_ADDRESS, parseEther("0.01")] // Empty source address
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            // Empty string should not match the stored sourceAddress hash
            const [isValid, reason] = await account.validateOperation(
                "", // Empty source address
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
            console.log("Empty sourceAddress correctly rejected");
        });

        it("Should reject empty sourceAddress in compareSourceAddress", async function () {
            const result = await account.compareSourceAddress("");
            expect(result).to.be.false;
            console.log("compareSourceAddress('') returns false");
        });

        it("INFO: Empty sourceAddress creates different hash than valid address", async function () {
            const emptyHash = keccak256(toUtf8Bytes(""));
            const validHash = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

            expect(emptyHash).to.not.equal(validHash);
            console.log("Empty hash:", emptyHash);
            console.log("Valid hash:", validHash);
        });
    });

    describe("Large Payload Handling", function () {
        it("Should handle transaction with large calldata (1KB)", async function () {
            // Create a payload with 1KB of data
            const largeData = "0x" + "ab".repeat(1024); // 1KB of data

            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            // Create payload with large data - sending to EOA which ignores calldata
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

            // Large payload should be parsed and executed successfully
            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.01"));

            console.log("Large payload (1KB data) executed successfully");
        });

        it("Should handle transaction with large calldata (10KB)", async function () {
            const largeData = "0x" + "cd".repeat(10240); // 10KB of data

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

            // Large payload should be parsed and executed successfully
            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance - initialBalance).to.equal(parseEther("0.01"));

            console.log("Large payload (10KB data) executed successfully");
        });

        it("Should execute large batch of small transactions", async function () {
            // 20 transactions (max batch size), each with small data
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
            expect(finalBalance - initialBalance).to.equal(parseEther("0.02")); // 20 * 0.001

            console.log("Max batch (20 transactions) executed successfully");
        });
    });

    describe("Whitespace in Source Address", function () {
        it("Should reject sourceAddress with only spaces", async function () {
            const result = await account.compareSourceAddress("   ");
            expect(result).to.be.false;
        });

        it("Should reject sourceAddress with leading/trailing whitespace", async function () {
            // Adding whitespace to valid address should fail
            const resultLeading = await account.compareSourceAddress(" " + SOURCE_ADDRESS);
            const resultTrailing = await account.compareSourceAddress(SOURCE_ADDRESS + " ");

            expect(resultLeading).to.be.false;
            expect(resultTrailing).to.be.false;
            console.log("Whitespace variants correctly rejected");
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

            // Zero-value transaction should succeed
            await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload);

            expect(await account.accountSequence()).to.equal(1n);
            console.log("Zero-value transaction executed successfully");
        });
    });
});
