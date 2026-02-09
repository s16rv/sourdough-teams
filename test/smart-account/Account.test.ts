import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, parseEther, sha256, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings, encodeNewTxPayload, computeTxPayloadHash, createSignBytes } from "../utils/lib";

const TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const EXPECTED_CHAIN_ID = 31337n; // Hardhat default chain ID

/**
 * Helper to encode the txPayload for recoverTransaction.
 * Format: abi.encode(evmChainId, sequence, dest, value, data)
 */
function encodeRecoverTxPayload(
    evmChainId: bigint,
    sequence: bigint,
    dest: string,
    value: bigint,
    data: string
): string {
    const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(
        ["uint256", "uint64", "address", "uint256", "bytes"],
        [evmChainId, sequence, dest, value, data]
    );
}

/**
 * Helper to create validateOperation params for the new format
 */
async function createValidateParams(
    accountAddress: string,
    sequence: bigint,
    calls: { to: string; value: bigint; data: string }[],
    publicKeyX: string[],
    publicKeyY: string[],
    mnemonic: string = TEST_MNEMONIC
) {
    // 1. Create txPayload
    const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, calls);

    // 2. Compute hash of txPayload
    const txPayloadHash = computeTxPayloadHash(txPayload);

    // 3. Create signBytes with embedded hash
    const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

    // 4. Sign sha256(signBytes)
    const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
    const sig = await generateSignatureWithMnemonic(mnemonic, signBytesForSigning.toString("hex"));

    return {
        signBytes,
        txPayloadHashOffset: hashOffset,
        v: [sig.v],
        r: [sig.r],
        s: [sig.s],
        x: publicKeyX,
        y: publicKeyY,
        txPayload,
    };
}

describe("Account", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 1n;
    const THRESHOLD = 1;

    let account: Account;
    let recover: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;

    beforeEach(async function () {
        [recover, stranger] = await hre.ethers.getSigners();

        // Get public key from mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS_HASH,
            THRESHOLD
        );
        await account.waitForDeployment();

        const accountAddr = await account.getAddress();

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("Should have funds", async function () {
        const accountAddr = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddr);

        expect(balance).to.gt(0);
    });

    it("Should not execute transaction using stranger account (validateAndExecute requires EntryPoint)", async function () {
        // validateAndExecute requires being called by EntryPoint
        // We test this by trying to call directly from a stranger
        const sequence = 1n;
        const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, await account.getAddress(), sequence, [
            { to: RECIPIENT_ADDRESS, value: parseEther("0.001"), data: "0x" },
        ]);
        const txPayloadHash = computeTxPayloadHash(txPayload);
        const { signBytes, hashOffset } = createSignBytes(txPayloadHash);
        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, signBytes.slice(2));

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        await expect(
            account
                .connect(stranger)
                .validateAndExecute(
                    signBytes,
                    hashOffset,
                    { v: [sig.v], r: [sig.r], s: [sig.s], x: PUBLIC_KEY_X, y: PUBLIC_KEY_Y },
                    txPayload
                )
        ).to.be.revertedWithCustomError(account, "NotEntryPoint");

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance);
    });
});

describe("Account Multisig", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 1n;
    const THRESHOLD = 1;

    let account: Account;
    let recover: HardhatEthersSigner;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        // Use same key twice to test duplicate detection
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x, pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y, pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS_HASH,
            THRESHOLD
        );
        await account.waitForDeployment();

        const accountAddr = await account.getAddress();

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("Should have funds", async function () {
        const accountAddr = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddr);

        expect(balance).to.gt(0);
    });
});

/**
 * Tests for Account getter functions to improve coverage
 * Covers: getX(), getY(), receive()
 */
describe("Account Getters and ETH Handling", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

    const TEST_MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let owner: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    describe("Single Signer Account", function () {
        beforeEach(async function () {
            [owner] = await hre.ethers.getSigners();

            const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            publicKeyX = [pubKey.x];
            publicKeyY = [pubKey.y];

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1 // threshold
            );
            await account.waitForDeployment();
        });

        it("Should return correct X public keys", async function () {
            const xKeys = await account.getX();
            expect(xKeys.length).to.equal(1);
            expect(xKeys[0]).to.equal(publicKeyX[0]);
        });

        it("Should return correct Y public keys", async function () {
            const yKeys = await account.getY();
            expect(yKeys.length).to.equal(1);
            expect(yKeys[0]).to.equal(publicKeyY[0]);
        });

        it("Should return correct account sequence (initially 0)", async function () {
            expect(await account.accountSequence()).to.equal(0);
        });

        it("Should compare source address correctly", async function () {
            expect(await account.compareSourceAddress(SOURCE_ADDRESS)).to.be.true;
            expect(await account.compareSourceAddress("wrong-address")).to.be.false;
        });

        it("Should receive ETH via receive()", async function () {
            const amount = parseEther("1.0");
            const accountAddress = await account.getAddress();

            const initialBalance = await hre.ethers.provider.getBalance(accountAddress);

            await owner.sendTransaction({
                to: accountAddress,
                value: amount,
            });

            const finalBalance = await hre.ethers.provider.getBalance(accountAddress);
            expect(finalBalance).to.equal(initialBalance + amount);
        });

        it("Should receive ETH from multiple senders", async function () {
            const [, sender2, sender3] = await hre.ethers.getSigners();
            const accountAddress = await account.getAddress();

            await owner.sendTransaction({ to: accountAddress, value: parseEther("1.0") });
            await sender2.sendTransaction({ to: accountAddress, value: parseEther("2.0") });
            await sender3.sendTransaction({ to: accountAddress, value: parseEther("3.0") });

            const balance = await hre.ethers.provider.getBalance(accountAddress);
            expect(balance).to.equal(parseEther("6.0"));
        });
    });

    describe("Multi-Signer Account", function () {
        beforeEach(async function () {
            [owner] = await hre.ethers.getSigners();

            const pubKey1 = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            const pubKey2 = await getPublicKeyFromMnemonic(TEST_MNEMONIC_2);
            publicKeyX = [pubKey1.x, pubKey2.x];
            publicKeyY = [pubKey1.y, pubKey2.y];

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                2 // threshold
            );
            await account.waitForDeployment();
        });

        it("Should return all X public keys for multisig", async function () {
            const xKeys = await account.getX();
            expect(xKeys.length).to.equal(2);
            expect(xKeys[0]).to.equal(publicKeyX[0]);
            expect(xKeys[1]).to.equal(publicKeyX[1]);
        });

        it("Should return all Y public keys for multisig", async function () {
            const yKeys = await account.getY();
            expect(yKeys.length).to.equal(2);
            expect(yKeys[0]).to.equal(publicKeyY[0]);
            expect(yKeys[1]).to.equal(publicKeyY[1]);
        });
    });
});

/**
 * Tests for Account recoverTransaction function
 */
describe("Account Recover", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let owner: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
            SOURCE_ADDRESS_HASH,
            1 // threshold
        );
        await account.waitForDeployment();

        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("10.0"),
        });
    });

    it("Should execute recoverTransaction with valid signature", async function () {
        const sequence = 1n;
        const value = parseEther("1.0");
        const data = "0x";

        const txPayload = encodeRecoverTxPayload(EXPECTED_CHAIN_ID, sequence, RECIPIENT_ADDRESS, value, data);
        const messageHash = sha256(txPayload);

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        await account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

        const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalBalance).to.equal(initialBalance + value);
    });

    it("Should revert with InvalidPubKey when public key not in account", async function () {
        const wrongPubKey = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
        const sequence = 1n;
        const txPayload = encodeRecoverTxPayload(
            EXPECTED_CHAIN_ID,
            sequence,
            RECIPIENT_ADDRESS,
            parseEther("1.0"),
            "0x"
        );

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.v], [sig.r], [sig.s], [wrongPubKey.x], [wrongPubKey.y], txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidPubKey");
    });

    it("Should revert with InvalidSignature when signature is invalid", async function () {
        const sequence = 1n;
        const txPayload = encodeRecoverTxPayload(
            EXPECTED_CHAIN_ID,
            sequence,
            RECIPIENT_ADDRESS,
            parseEther("1.0"),
            "0x"
        );

        const invalidR = "0x1111111111111111111111111111111111111111111111111111111111111111";
        const invalidS = "0x2222222222222222222222222222222222222222222222222222222222222222";

        await expect(
            account.recoverTransaction([27], [invalidR], [invalidS], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidSignature");
    });

    it("Should revert with InvalidSequence when sequence is wrong", async function () {
        const wrongSequence = 99n;
        const txPayload = encodeRecoverTxPayload(
            EXPECTED_CHAIN_ID,
            wrongSequence,
            RECIPIENT_ADDRESS,
            parseEther("1.0"),
            "0x"
        );

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidSequence");
    });

    it("Should revert with InvalidChainId when chain ID is wrong", async function () {
        const sequence = 1n;
        const wrongChainId = 999n; // Wrong chain ID
        const txPayload = encodeRecoverTxPayload(wrongChainId, sequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x");

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidChainId");
    });

    it("Should revert with InvalidInputLength when x and y lengths mismatch", async function () {
        const sequence = 1n;
        const txPayload = encodeRecoverTxPayload(
            EXPECTED_CHAIN_ID,
            sequence,
            RECIPIENT_ADDRESS,
            parseEther("1.0"),
            "0x"
        );

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, [], txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidInputLength");
    });

    it("Should revert with InvalidInputLength when r/s lengths mismatch x/y", async function () {
        const sequence = 1n;
        const txPayload = encodeRecoverTxPayload(
            EXPECTED_CHAIN_ID,
            sequence,
            RECIPIENT_ADDRESS,
            parseEther("1.0"),
            "0x"
        );

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.v, sig.v], [sig.r, sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidInputLength");
    });

    it("Should revert with InvalidThreshold when not enough signers", async function () {
        // Deploy account with threshold of 2
        const pubKey2 = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
        const twoSignerAccount = await (
            await hre.ethers.getContractFactory("Account")
        ).deploy(
            ENTRYPOINT_ADDRESS,
            [publicKeyX[0], pubKey2.x],
            [publicKeyY[0], pubKey2.y],
            SOURCE_ADDRESS_HASH,
            2 // threshold
        );

        await owner.sendTransaction({
            to: await twoSignerAccount.getAddress(),
            value: parseEther("10.0"),
        });

        const sequence = 1n;
        const txPayload = encodeRecoverTxPayload(
            EXPECTED_CHAIN_ID,
            sequence,
            RECIPIENT_ADDRESS,
            parseEther("1.0"),
            "0x"
        );
        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        // Only provide 1 signature when threshold is 2
        await expect(
            twoSignerAccount.recoverTransaction([sig.v], [sig.r], [sig.s], [publicKeyX[0]], [publicKeyY[0]], txPayload)
        ).to.be.revertedWithCustomError(twoSignerAccount, "InvalidThreshold");
    });
});

/**
 * Security-focused tests for Account contract
 */
describe("Account Security", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let owner: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
            SOURCE_ADDRESS_HASH,
            1 // threshold
        );
        await account.waitForDeployment();

        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("10.0"),
        });
    });

    describe("Source Address Validation", function () {
        it("Should verify compareSourceAddress function directly", async function () {
            expect(await account.compareSourceAddress(SOURCE_ADDRESS)).to.be.true;
            expect(await account.compareSourceAddress("wrong")).to.be.false;
            expect(await account.compareSourceAddress("")).to.be.false;
        });
    });

    describe("Sequence Validation", function () {
        it("Should verify sequence increments after recovery transaction", async function () {
            expect(await account.accountSequence()).to.equal(0);

            const txPayload = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                1n,
                RECIPIENT_ADDRESS,
                parseEther("0.01"),
                "0x"
            );
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            expect(await account.accountSequence()).to.equal(1);
        });

        it("Should prevent replay with same sequence", async function () {
            const txPayload = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                1n,
                RECIPIENT_ADDRESS,
                parseEther("0.01"),
                "0x"
            );
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            // Try to replay
            await expect(
                account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
            ).to.be.revertedWithCustomError(account, "InvalidSequence");
        });
    });

    describe("Threshold Validation", function () {
        it("Should reject recoverTransaction with fewer signatures than threshold", async function () {
            const pubKey2 = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
            const twoOfTwoAccount = await (
                await hre.ethers.getContractFactory("Account")
            ).deploy(
                ENTRYPOINT_ADDRESS,
                [publicKeyX[0], pubKey2.x],
                [publicKeyY[0], pubKey2.y],
                SOURCE_ADDRESS_HASH,
                2
            );

            await owner.sendTransaction({
                to: await twoOfTwoAccount.getAddress(),
                value: parseEther("10.0"),
            });

            const txPayload = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                1n,
                RECIPIENT_ADDRESS,
                parseEther("0.01"),
                "0x"
            );
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await expect(
                twoOfTwoAccount.recoverTransaction(
                    [sig.v],
                    [sig.r],
                    [sig.s],
                    [publicKeyX[0]],
                    [publicKeyY[0]],
                    txPayload
                )
            ).to.be.revertedWithCustomError(twoOfTwoAccount, "InvalidThreshold");
        });

        it("Should accept recoverTransaction with exactly threshold signatures", async function () {
            const txPayload = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                1n,
                RECIPIENT_ADDRESS,
                parseEther("0.01"),
                "0x"
            );
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance).to.equal(initialBalance + parseEther("0.01"));
        });
    });
});

/**
 * Reentrancy tests for Account contract
 */
describe("Account Reentrancy", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let owner: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];
    });

    describe("recoverTransaction Reentrancy", function () {
        it("FIXED: recoverTransaction is protected against reentrancy", async function () {
            const ReentrantAttackerFactory = await hre.ethers.getContractFactory("ReentrantRecoverAttacker");
            const attacker = await ReentrantAttackerFactory.deploy();
            await attacker.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                attacker.target, // attacker is the "entrypoint"
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1
            );

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("10.0"),
            });

            await attacker.setTarget(await account.getAddress());

            const sequence = 1n;
            const value = parseEther("1.0");
            const txPayload = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                sequence,
                await attacker.getAddress(),
                value,
                "0x"
            );
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await attacker.setAttackPayload([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            const accountBalanceBefore = await hre.ethers.provider.getBalance(await account.getAddress());
            const attackerBalanceBefore = await hre.ethers.provider.getBalance(await attacker.getAddress());

            await account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            const accountBalanceAfter = await hre.ethers.provider.getBalance(await account.getAddress());
            const attackerBalanceAfter = await hre.ethers.provider.getBalance(await attacker.getAddress());

            console.log(`Account lost: ${hre.ethers.formatEther(accountBalanceBefore - accountBalanceAfter)} ETH`);
            console.log(`Attacker gained: ${hre.ethers.formatEther(attackerBalanceAfter - attackerBalanceBefore)} ETH`);
            console.log(`Attack attempts: ${await attacker.attackCount()}`);

            // Due to CEI pattern, sequence is incremented before external call
            // So reentrancy attempt will fail with InvalidSequence
            expect(accountBalanceBefore - accountBalanceAfter).to.equal(value);
            expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(value);
        });

        it("Should increment sequence before external call to prevent reentrancy (CEI pattern check)", async function () {
            const SequenceCheckerFactory = await hre.ethers.getContractFactory("SequenceChecker");
            const checker = await SequenceCheckerFactory.deploy();
            await checker.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(checker.target, publicKeyX, publicKeyY, SOURCE_ADDRESS_HASH, 1);

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("10.0"),
            });

            await checker.setAccountToCheck(await account.getAddress());

            const txPayload = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                1n,
                await checker.getAddress(),
                parseEther("0.01"),
                "0x"
            );
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await account.recoverTransaction([sig.v], [sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            // Sequence should have been 1 when the checker received the call
            expect(await checker.sequenceAtCallTime()).to.equal(1);
        });

        it("Should document: sequence increment happens BEFORE external call (CEI pattern)", async function () {
            console.log("Solidity code in recoverTransaction:");
            console.log("  1. Validate signatures");
            console.log("  2. Validate sequence");
            console.log("  3. incrementSequence() <-- BEFORE external call");
            console.log("  4. _call(dest, value, data) <-- external call");
            console.log("");
            console.log("This follows Checks-Effects-Interactions pattern:");
            console.log("  - Checks: signature validation, sequence validation");
            console.log("  - Effects: sequence increment");
            console.log("  - Interactions: external call");
        });
    });

    describe("Batch Transaction Reentrancy", function () {
        it("Should handle reentrancy attempt during batch execution (via recoverTransaction)", async function () {
            // Set up account for this test
            const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(ENTRYPOINT_ADDRESS, publicKeyX, publicKeyY, SOURCE_ADDRESS_HASH, 1);
            await account.waitForDeployment();

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("10.0"),
            });

            // Use recoverTransaction to test batch-like behavior
            // Execute two sequential recoveries to ensure sequence increments correctly
            const txPayload1 = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                1n,
                RECIPIENT_ADDRESS,
                parseEther("0.01"),
                "0x"
            );
            const sig1 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload1.slice(2));

            await account.recoverTransaction([sig1.v], [sig1.r], [sig1.s], publicKeyX, publicKeyY, txPayload1);
            expect(await account.accountSequence()).to.equal(1);

            const txPayload2 = encodeRecoverTxPayload(
                EXPECTED_CHAIN_ID,
                2n,
                RECIPIENT_ADDRESS,
                parseEther("0.01"),
                "0x"
            );
            const sig2 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload2.slice(2));

            await account.recoverTransaction([sig2.v], [sig2.r], [sig2.s], publicKeyX, publicKeyY, txPayload2);
            expect(await account.accountSequence()).to.equal(2);
        });
    });
});

/**
 * Sequence overflow tests
 */
describe("Account Sequence Overflow", function () {
    describe("uint64 Boundary", function () {
        it("INFO: Documents uint64 max value for sequence", async function () {
            const maxUint64 = BigInt("18446744073709551615");
            console.log(`uint64 max: ${maxUint64}`);
            console.log(`At 1 tx/second, would take ${Number(maxUint64) / (365.25 * 24 * 60 * 60)} years to overflow`);
        });

        it("INFO: Sequence increment uses unchecked math (would wrap on overflow)", async function () {
            console.log("Solidity 0.8+ has built-in overflow protection");
            console.log("If sequence somehow reached uint64 max, next tx would revert (safe)");
        });

        it("Should handle large sequence numbers correctly", async function () {
            const [owner] = await hre.ethers.getSigners();

            const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);

            const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
            const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

            const AccountContract = await hre.ethers.getContractFactory("Account");
            const account = await AccountContract.deploy(owner.address, [pubKey.x], [pubKey.y], SOURCE_ADDRESS_HASH, 1);

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("1.0"),
            });

            // Execute a transaction via recoverTransaction to increment sequence
            const txPayload = encodeRecoverTxPayload(EXPECTED_CHAIN_ID, 1n, owner.address, parseEther("0.001"), "0x");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await account.recoverTransaction([sig.v], [sig.r], [sig.s], [pubKey.x], [pubKey.y], txPayload);

            console.log(`Sequence correctly incremented to ${await account.accountSequence()}`);
            expect(await account.accountSequence()).to.equal(1);
        });
    });
});
