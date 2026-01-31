import hre from "hardhat";
import { expect } from "chai";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

/**
 * Invariant Tests
 *
 * These tests verify properties that must ALWAYS hold true,
 * regardless of the sequence of operations or inputs.
 *
 * Key invariants:
 * 1. Sequence is monotonically increasing
 * 2. No replay is possible
 * 3. Funds only move with valid signatures
 */
describe("Invariants", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let verifier: Secp256k1Verifier;
    let owner: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
            SOURCE_ADDRESS_HASH,
            1
        );
        await account.waitForDeployment();

        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("10.0"),
        });
    });

    describe("Invariant 1: Sequence Monotonicity", function () {
        it("INVARIANT: Sequence starts at 0", async function () {
            expect(await account.accountSequence()).to.equal(0);
        });

        it("INVARIANT: Sequence increments by exactly 1 after each transaction", async function () {
            const initialSequence = await account.accountSequence();

            // Execute first transaction
            await executeRecoverTransaction(1n);
            expect(await account.accountSequence()).to.equal(initialSequence + 1n);

            // Execute second transaction
            await executeRecoverTransaction(2n);
            expect(await account.accountSequence()).to.equal(initialSequence + 2n);

            // Execute third transaction
            await executeRecoverTransaction(3n);
            expect(await account.accountSequence()).to.equal(initialSequence + 3n);
        });

        it("INVARIANT: Sequence never decreases", async function () {
            // Execute several transactions
            await executeRecoverTransaction(1n);
            await executeRecoverTransaction(2n);
            await executeRecoverTransaction(3n);

            const currentSequence = await account.accountSequence();
            expect(currentSequence).to.equal(3n);

            // Try to use a lower sequence - should fail
            await expect(executeRecoverTransaction(1n)).to.be.revertedWithCustomError(account, "InvalidSequence");

            await expect(executeRecoverTransaction(2n)).to.be.revertedWithCustomError(account, "InvalidSequence");

            // Sequence should remain unchanged after failed attempts
            expect(await account.accountSequence()).to.equal(3n);
        });

        it("INVARIANT: Sequence never skips values", async function () {
            // Can't skip from 0 to 2
            await expect(executeRecoverTransaction(2n)).to.be.revertedWithCustomError(account, "InvalidSequence");

            // Must use 1 first
            await executeRecoverTransaction(1n);

            // Can't skip from 1 to 3
            await expect(executeRecoverTransaction(3n)).to.be.revertedWithCustomError(account, "InvalidSequence");

            // Must use 2
            await executeRecoverTransaction(2n);
            expect(await account.accountSequence()).to.equal(2n);
        });

        it("INVARIANT: Failed transactions don't increment sequence", async function () {
            const initialSequence = await account.accountSequence();

            // Try invalid sequence
            await expect(executeRecoverTransaction(5n)).to.be.reverted;
            expect(await account.accountSequence()).to.equal(initialSequence);

            // Try with wrong signature (use wrong payload)
            const wrongPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.001"), "0xdead");
            const correctPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");

            // Sign wrong payload but submit correct one
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, wrongPayload.slice(2));

            await expect(
                account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, correctPayload)
            ).to.be.reverted;

            expect(await account.accountSequence()).to.equal(initialSequence);
        });
    });

    describe("Invariant 2: No Replay", function () {
        it("INVARIANT: Same sequence cannot be used twice", async function () {
            // Execute transaction with sequence 1
            await executeRecoverTransaction(1n);

            // Store the same signed transaction
            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            // Try to replay - should fail even with valid signature
            await expect(
                account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload)
            ).to.be.revertedWithCustomError(account, "InvalidSequence");
        });

        it("INVARIANT: Replaying N times always fails after first success", async function () {
            // Execute once
            await executeRecoverTransaction(1n);

            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            // Try to replay 10 times - all should fail
            for (let i = 0; i < 10; i++) {
                await expect(
                    account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload)
                ).to.be.revertedWithCustomError(account, "InvalidSequence");
            }

            // Sequence should still be 1
            expect(await account.accountSequence()).to.equal(1n);
        });
    });

    describe("Invariant 3: Funds Protection", function () {
        it("INVARIANT: Balance only decreases with valid signature", async function () {
            const accountAddress = await account.getAddress();
            const initialBalance = await hre.ethers.provider.getBalance(accountAddress);

            // Execute valid transaction
            await executeRecoverTransaction(1n);

            const afterFirstTx = await hre.ethers.provider.getBalance(accountAddress);
            expect(afterFirstTx).to.be.lessThan(initialBalance);

            // Try invalid transactions - balance should not change further
            const balanceBeforeInvalid = afterFirstTx;

            // Wrong sequence
            await expect(executeRecoverTransaction(1n)).to.be.reverted;

            // Wrong signature
            const badPayload = encodeTxPayload(2n, RECIPIENT_ADDRESS, parseEther("1"), "0x");
            const wrongSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, "deadbeef");

            await expect(account.recoverTransaction([wrongSig.r], [wrongSig.s], publicKeyX, publicKeyY, badPayload)).to
                .be.reverted;

            // Balance unchanged after failed attempts
            expect(await hre.ethers.provider.getBalance(accountAddress)).to.equal(balanceBeforeInvalid);
        });

        it("INVARIANT: Cannot withdraw more than balance", async function () {
            const accountAddress = await account.getAddress();
            const balance = await hre.ethers.provider.getBalance(accountAddress);

            // Try to withdraw more than balance
            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, balance + parseEther("1"), "0x");
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await expect(account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload)).to
                .be.reverted;

            // Balance unchanged
            expect(await hre.ethers.provider.getBalance(accountAddress)).to.equal(balance);
        });

        it("INVARIANT: Exact amount withdrawn matches signed amount", async function () {
            const accountAddress = await account.getAddress();
            const recipientBefore = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            const accountBefore = await hre.ethers.provider.getBalance(accountAddress);

            const withdrawAmount = parseEther("1.5");
            await executeRecoverTransactionWithAmount(1n, withdrawAmount);

            const recipientAfter = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            const accountAfter = await hre.ethers.provider.getBalance(accountAddress);

            // Recipient received exactly the signed amount
            expect(recipientAfter - recipientBefore).to.equal(withdrawAmount);

            // Account lost exactly the signed amount
            expect(accountBefore - accountAfter).to.equal(withdrawAmount);
        });
    });

    describe("Invariant 4: Signer Authority", function () {
        it("INVARIANT: Only registered signers can authorize transactions", async function () {
            // Use a different mnemonic (not registered)
            const UNREGISTERED_MNEMONIC = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");
            const sigResult = await generateSignatureWithMnemonic(UNREGISTERED_MNEMONIC, txPayload.slice(2));

            await expect(
                account.recoverTransaction([sigResult.r], [sigResult.s], [sigResult.x], [sigResult.y], txPayload)
            ).to.be.revertedWithCustomError(account, "InvalidPubKey");
        });

        it("INVARIANT: Registered signer can always authorize (censorship resistance)", async function () {
            // Registered signer can execute transactions 1, 2, 3...
            for (let i = 1n; i <= 5n; i++) {
                await executeRecoverTransaction(i);
                expect(await account.accountSequence()).to.equal(i);
            }
        });
    });

    describe("Invariant 5: Threshold Enforcement", function () {
        let multiSigAccount: Account;
        const TEST_MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

        beforeEach(async function () {
            const pubKey1 = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            const pubKey2 = await getPublicKeyFromMnemonic(TEST_MNEMONIC_2);

            const AccountContract = await hre.ethers.getContractFactory("Account");
            multiSigAccount = await AccountContract.deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                [pubKey1.x, pubKey2.x],
                [pubKey1.y, pubKey2.y],
                SOURCE_ADDRESS_HASH,
                2 // 2-of-2 threshold
            );
            await multiSigAccount.waitForDeployment();

            await owner.sendTransaction({
                to: await multiSigAccount.getAddress(),
                value: parseEther("5.0"),
            });
        });

        it("INVARIANT: Cannot execute with fewer signatures than threshold", async function () {
            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");
            const sig1 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            // Only 1 signature for 2-of-2
            await expect(
                multiSigAccount.recoverTransaction([sig1.r], [sig1.s], [sig1.x], [sig1.y], txPayload)
            ).to.be.revertedWithCustomError(multiSigAccount, "InvalidThreshold");
        });

        it("INVARIANT: Can execute with exactly threshold signatures", async function () {
            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");
            const sig1 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));
            const sig2 = await generateSignatureWithMnemonic(TEST_MNEMONIC_2, txPayload.slice(2));

            // 2 signatures for 2-of-2
            await multiSigAccount.recoverTransaction(
                [sig1.r, sig2.r],
                [sig1.s, sig2.s],
                [sig1.x, sig2.x],
                [sig1.y, sig2.y],
                txPayload
            );

            expect(await multiSigAccount.accountSequence()).to.equal(1n);
        });
    });

    // Helper functions
    async function executeRecoverTransaction(sequence: bigint) {
        return executeRecoverTransactionWithAmount(sequence, parseEther("0.001"));
    }

    async function executeRecoverTransactionWithAmount(sequence: bigint, amount: bigint) {
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amount, "0x");
        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        return account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload);
    }

    function encodeTxPayload(sequence: bigint, dest: string, value: bigint, data: string): string {
        const selector = keccak256(toUtf8Bytes("recoverProposal(uint64,address,uint256,bytes)")).slice(0, 10);
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(["uint64", "address", "uint256", "bytes"], [sequence, dest, value, data]);
        return selector + encodedParams.slice(2);
    }
});
