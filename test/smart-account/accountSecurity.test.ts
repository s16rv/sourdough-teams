import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, parseEther, toUtf8Bytes, sha256 } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings } from "../utils/lib";

/**
 * Security-critical tests for Account contract
 * Phase 1: Source address, sequence, and threshold validation
 */
describe("Account Security", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const WRONG_SOURCE_ADDRESS = "neutron1wrongaddresswrongaddresswrongaddresswrongaddress";

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
            1 // threshold
        );
        await account.waitForDeployment();

        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("2.0"),
        });
    });

    describe("Source Address Validation", function () {
        /**
         * Helper to create valid validateOperation parameters.
         * generateSignatureWithMnemonic hashes the input, so we pass the preimage
         * and it computes messageHash = sha256(preimage) internally.
         */
        async function createValidateOperationParams(sequence: number) {
            // Create a preimage for the message hash
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, parseEther("0.01")]
            );

            // Compute messageHash = sha256(preimage)
            const messageHash = sha256(preimage);

            // Create txPayload (data) - simple transaction payload
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );

            // Compute proof = sha256(messageHash || data)
            const proof = sha256(combineHexStrings(messageHash, data));

            // Sign the preimage (without 0x prefix)
            // generateSignatureWithMnemonic will hash it to get messageHash
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            return {
                messageHash,
                r: [sigResult.r],
                s: [sigResult.s],
                proof,
                data,
            };
        }

        it("Should reject validateOperation with wrong source address", async function () {
            const params = await createValidateOperationParams(1);

            // Use wrong source address
            const [isValid, reason] = await account.validateOperation(
                WRONG_SOURCE_ADDRESS,
                params.messageHash,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                1, // sequence
                params.data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSourceAddress");
        });

        it("Should accept validateOperation with correct source address", async function () {
            const params = await createValidateOperationParams(1);

            // Use correct source address
            const [isValid] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.messageHash,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                1, // sequence
                params.data
            );

            expect(isValid).to.be.true;
        });

        it("Should verify compareSourceAddress function directly", async function () {
            expect(await account.compareSourceAddress(SOURCE_ADDRESS)).to.be.true;
            expect(await account.compareSourceAddress(WRONG_SOURCE_ADDRESS)).to.be.false;
            expect(await account.compareSourceAddress("")).to.be.false;
        });
    });

    describe("Sequence Validation", function () {
        /**
         * Helper to create validateOperation params with specific sequence.
         */
        async function createParamsForSequence(sequence: number) {
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            return {
                messageHash,
                r: [sigResult.r],
                s: [sigResult.s],
                proof,
                data,
            };
        }

        it("Should reject validateOperation with sequence too low", async function () {
            // Generate params with sequence=0 (wrong - should be 1)
            const params = await createParamsForSequence(0);

            // Current sequence is 0, so valid next is 1. Use 0 (same as current)
            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.messageHash,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                0, // wrong sequence (should be 1)
                params.data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSequence");
        });

        it("Should reject validateOperation with sequence too high", async function () {
            // Generate params with sequence=5 (wrong - should be 1)
            const params = await createParamsForSequence(5);

            // Current sequence is 0, so valid next is 1. Use 5 (too high)
            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.messageHash,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                5, // wrong sequence (should be 1)
                params.data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSequence");
        });

        it("Should verify sequence increments after recovery transaction", async function () {
            expect(await account.accountSequence()).to.equal(0);

            // Execute a recovery transaction
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
            const r = [sigResult.r];
            const s = [sigResult.s];

            await account.recoverTransaction(r, s, publicKeyX, publicKeyY, txPayload);

            // Sequence should now be 1
            expect(await account.accountSequence()).to.equal(1);

            // Next transaction must use sequence 2
            const sequence2 = BigInt(2);
            const txPayload2 = encodeTxPayload(sequence2, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex2 = txPayload2.slice(2);

            const sigResult2 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex2);

            await account.recoverTransaction([sigResult2.r], [sigResult2.s], publicKeyX, publicKeyY, txPayload2);

            expect(await account.accountSequence()).to.equal(2);
        });

        it("Should prevent replay with same sequence", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
            const r = [sigResult.r];
            const s = [sigResult.s];

            // First execution succeeds
            await account.recoverTransaction(r, s, publicKeyX, publicKeyY, txPayload);

            // Second execution with same sequence should fail
            await expect(
                account.recoverTransaction(r, s, publicKeyX, publicKeyY, txPayload)
            ).to.be.revertedWithCustomError(account, "InvalidSequence");
        });
    });

    describe("Threshold Validation", function () {
        let multiSigAccount: Account;
        let pubKeyX2: string[];
        let pubKeyY2: string[];

        const TEST_MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

        beforeEach(async function () {
            // Get second public key
            const pubKey2 = await getPublicKeyFromMnemonic(TEST_MNEMONIC_2);

            // Create 2-of-2 multisig account
            pubKeyX2 = [publicKeyX[0], pubKey2.x];
            pubKeyY2 = [publicKeyY[0], pubKey2.y];

            const AccountContract = await hre.ethers.getContractFactory("Account");
            multiSigAccount = await AccountContract.deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                pubKeyX2,
                pubKeyY2,
                SOURCE_ADDRESS_HASH,
                2 // threshold = 2
            );
            await multiSigAccount.waitForDeployment();

            await owner.sendTransaction({
                to: await multiSigAccount.getAddress(),
                value: parseEther("2.0"),
            });
        });

        it("Should reject recoverTransaction with fewer signatures than threshold", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            // Only sign with one key (threshold is 2)
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            await expect(
                multiSigAccount.recoverTransaction(
                    [sigResult.r],
                    [sigResult.s],
                    [publicKeyX[0]],
                    [publicKeyY[0]],
                    txPayload
                )
            ).to.be.revertedWithCustomError(multiSigAccount, "InvalidThreshold");
        });

        it("Should accept recoverTransaction with exactly threshold signatures", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            // Sign with both keys
            const sigResult1 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
            const sigResult2 = await generateSignatureWithMnemonic(TEST_MNEMONIC_2, txPayloadHex);

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await multiSigAccount.recoverTransaction(
                [sigResult1.r, sigResult2.r],
                [sigResult1.s, sigResult2.s],
                [sigResult1.x, sigResult2.x],
                [sigResult1.y, sigResult2.y],
                txPayload
            );

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance).to.equal(initialBalance + amountToSend);
        });

        it("Should reject validateOperation with fewer signatures than threshold", async function () {
            // Generate valid params with 1 signer
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, 1, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            // Only provide 1 signature but threshold is 2
            const [isValid, reason] = await multiSigAccount.validateOperation(
                SOURCE_ADDRESS,
                messageHash,
                [sigResult.r],
                [sigResult.s],
                [pubKeyX2[0]],
                [pubKeyY2[0]],
                proof,
                1,
                data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidThreshold");
        });

        it("Should reject when public key not in registered keys", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            // Use a completely different mnemonic not registered in the account
            const UNREGISTERED_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
            const sigResult = await generateSignatureWithMnemonic(UNREGISTERED_MNEMONIC, txPayloadHex);

            await expect(
                multiSigAccount.recoverTransaction(
                    [sigResult.r, sigResult.r],
                    [sigResult.s, sigResult.s],
                    [sigResult.x, sigResult.x],
                    [sigResult.y, sigResult.y],
                    txPayload
                )
            ).to.be.revertedWithCustomError(multiSigAccount, "InvalidPubKey");
        });
    });

    describe("validateOperation Edge Cases", function () {
        /**
         * Tests for coverage of Account.sol lines 112-113: InvalidSignatureLength
         * and line 136: InvalidPubKey in validateOperation
         */

        async function createBasicParams() {
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, 1, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            return { messageHash, proof, data, sigResult };
        }

        it("Should return InvalidSignatureLength when r/s length != x/y length", async function () {
            const { messageHash, proof, data, sigResult } = await createBasicParams();

            // Provide 1 x/y but 2 r/s (mismatched lengths)
            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                messageHash,
                [sigResult.r, sigResult.r], // 2 r values
                [sigResult.s, sigResult.s], // 2 s values
                publicKeyX, // 1 x value
                publicKeyY, // 1 y value
                proof,
                1,
                data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSignatureLength");
        });

        it("Should return InvalidPubKey when provided key not in registered keys", async function () {
            // Use unregistered mnemonic to generate signature with different pubkey
            const UNREGISTERED_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
            const unregisteredPubKey = await getPublicKeyFromMnemonic(UNREGISTERED_MNEMONIC);

            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, 1, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(UNREGISTERED_MNEMONIC, preimage.slice(2));

            // Use the unregistered public key (not in account's stored keys)
            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                messageHash,
                [sigResult.r],
                [sigResult.s],
                [unregisteredPubKey.x], // Not registered in account
                [unregisteredPubKey.y],
                proof,
                1,
                data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidPubKey");
        });
    });

    // Helper function to encode txPayload for recoverTransaction
    function encodeTxPayload(sequence: bigint, dest: string, value: bigint, data: string): string {
        const selector = keccak256(toUtf8Bytes("recoverProposal(uint64,address,uint256,bytes)")).slice(0, 10);
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(["uint64", "address", "uint256", "bytes"], [sequence, dest, value, data]);
        return selector + encodedParams.slice(2);
    }
});
