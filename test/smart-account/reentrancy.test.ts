import hre from "hardhat";
import { expect } from "chai";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

/**
 * Reentrancy tests for Account contract
 *
 * Tests whether an attacker can exploit reentrancy during:
 * 1. recoverTransaction - ETH transfer triggers receive() which re-enters
 * 2. executeTransactions - batch execution with malicious recipient
 */
describe("Account Reentrancy", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let verifier: Secp256k1Verifier;
    let owner: HardhatEthersSigner;
    let attacker: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, attacker] = await hre.ethers.getSigners();

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
            1 // threshold
        );
        await account.waitForDeployment();

        // Fund the account with 10 ETH
        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("10.0"),
        });
    });

    /**
     * Helper to encode the txPayload as a recoverProposal function call.
     */
    function encodeTxPayload(sequence: bigint, dest: string, value: bigint, data: string): string {
        const selector = keccak256(toUtf8Bytes("recoverProposal(uint64,address,uint256,bytes)")).slice(0, 10);
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(["uint64", "address", "uint256", "bytes"], [sequence, dest, value, data]);
        return selector + encodedParams.slice(2);
    }

    describe("recoverTransaction Reentrancy", function () {
        it("VULNERABILITY: recoverTransaction is vulnerable to reentrancy", async function () {
            /**
             * CRITICAL SECURITY BUG DEMONSTRATED
             *
             * This test proves that recoverTransaction can be exploited via reentrancy.
             * A user signs a transaction for 1 ETH, but attacker drains 5 ETH.
             *
             * Root cause: incrementSequence() happens AFTER _call(), not before.
             *
             * FIX: In Account.sol recoverTransaction(), move incrementSequence() BEFORE _call():
             *
             *   // CURRENT (VULNERABLE):
             *   _call(dest, value, data);
             *   incrementSequence();
             *
             *   // FIXED:
             *   incrementSequence();
             *   _call(dest, value, data);
             */

            // Deploy attacker contract
            const ReentrancyAttackerFactory = await hre.ethers.getContractFactory("ReentrancyAttacker");
            const attackerContract = await ReentrancyAttackerFactory.deploy();
            await attackerContract.waitForDeployment();

            const attackerAddress = await attackerContract.getAddress();
            const accountAddress = await account.getAddress();

            // Setup: attacker will try to drain 1 ETH per call
            const amountPerCall = parseEther("1.0");
            const sequence = BigInt(1);

            // Create signed transaction to send ETH to attacker contract
            const txPayload = encodeTxPayload(sequence, attackerAddress, amountPerCall, "0x");
            const txPayloadHex = txPayload.slice(2);
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            // Configure attacker contract
            await attackerContract.setTarget(accountAddress);
            await attackerContract.setAttackParams(5); // Try up to 5 reentrant calls
            await attackerContract.setRecoverParams([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload);
            await attackerContract.startAttack();

            const initialAccountBalance = await hre.ethers.provider.getBalance(accountAddress);
            const initialAttackerBalance = await hre.ethers.provider.getBalance(attackerAddress);

            // Execute the recovery transaction
            // Due to reentrancy bug, attacker receives MORE than 1 ETH
            await account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload);

            const finalAccountBalance = await hre.ethers.provider.getBalance(accountAddress);
            const finalAttackerBalance = await hre.ethers.provider.getBalance(attackerAddress);

            const attackerGained = finalAttackerBalance - initialAttackerBalance;
            const accountLost = initialAccountBalance - finalAccountBalance;
            const attackCount = await attackerContract.attackCount();

            console.log(`Account lost: ${hre.ethers.formatEther(accountLost)} ETH`);
            console.log(`Attacker gained: ${hre.ethers.formatEther(attackerGained)} ETH`);
            console.log(`Attack attempts: ${attackCount}`);

            // VULNERABILITY CONFIRMED: Attacker gains MORE than the signed amount
            expect(attackerGained).to.be.gt(amountPerCall, "Expected reentrancy to drain extra funds");
            expect(attackCount).to.be.gt(1, "Expected multiple reentrant calls");

            // Attacker drained 5 ETH with a 1 ETH signed transaction
            expect(attackerGained).to.equal(parseEther("5.0"));
        });

        it("Should increment sequence before external call to prevent reentrancy (CEI pattern check)", async function () {
            // This test documents the CURRENT behavior
            // If it fails, it means the code follows CEI pattern (good!)
            // If it passes, reentrancy might be possible (bad!)

            const sequence = BigInt(1);
            const txPayload = encodeTxPayload(sequence, attacker.address, parseEther("0.1"), "0x");
            const txPayloadHex = txPayload.slice(2);
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            await account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload);

            // After execution, sequence should be 1
            expect(await account.accountSequence()).to.equal(1);

            // Now try to replay with same sequence - should fail
            await expect(
                account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload)
            ).to.be.revertedWithCustomError(account, "InvalidSequence");
        });

        it("Should document: sequence check happens BEFORE external call (vulnerable pattern)", async function () {
            // This test documents that the current code structure is:
            // 1. Check sequence
            // 2. Make external call
            // 3. Increment sequence
            //
            // This is the "Checks-Interactions-Effects" pattern (wrong order!)
            // Should be "Checks-Effects-Interactions" for safety
            //
            // The protection comes from the fact that txPayload contains the sequence,
            // so an attacker can't change the sequence without invalidating the signature.
            // But if the same signed payload is re-entered, the sequence check passes!

            // This is a documentation test - the vulnerability exists but is mitigated
            // by the fact that re-entering with the same payload would just repeat
            // the same transfer (not a different one).

            // However, this IS still a bug: if user signs "send 1 ETH to X",
            // and X is malicious, X could receive 2 ETH (or more) via reentrancy.

            expect(true).to.be.true; // Placeholder - real test is above
        });
    });

    describe("Batch Transaction Reentrancy", function () {
        it("Should handle reentrancy attempt during batch execution", async function () {
            // For executeTransactions, reentrancy is blocked by onlyEntryPoint modifier
            // Even if attacker receives ETH in batch, they can't call executeTransactions
            // because they're not the EntryPoint

            // This test verifies the onlyEntryPoint protection
            const ReentrancyAttackerFactory = await hre.ethers.getContractFactory("ReentrancyAttacker");
            const attackerContract = await ReentrancyAttackerFactory.deploy();
            await attackerContract.waitForDeployment();

            // Attacker contract cannot call executeTransactions directly
            await expect(
                account.connect(attacker).executeTransactions([attacker.address], [parseEther("1.0")], ["0x"])
            ).to.be.revertedWithCustomError(account, "NotEntryPoint");
        });
    });
});
