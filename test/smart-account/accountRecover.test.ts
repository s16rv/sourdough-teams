import hre from "hardhat";
import { expect } from "chai";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

describe("Account Recover", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    // Test mnemonic - use a known mnemonic for deterministic testing
    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const THRESHOLD = 1;

    let account: Account;
    let verifier: Secp256k1Verifier;
    let recover: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [recover, stranger] = await hre.ethers.getSigners();

        // Derive public key from test mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            recover.address,
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
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

    /**
     * Helper to encode the txPayload as a recoverProposal function call.
     * Format: selector (4 bytes) + abi.encode(sequence, dest, value, data)
     */
    function encodeTxPayload(sequence: bigint, dest: string, value: bigint, data: string): string {
        // Get the function selector for recoverProposal(uint64,address,uint256,bytes)
        const selector = keccak256(toUtf8Bytes("recoverProposal(uint64,address,uint256,bytes)")).slice(0, 10);

        // Encode the parameters
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(["uint64", "address", "uint256", "bytes"], [sequence, dest, value, data]);

        // Combine selector + encoded params
        return selector + encodedParams.slice(2); // Remove "0x" from encodedParams
    }

    it("Should execute recoverTransaction with valid signature", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");

        // Encode the txPayload as recoverProposal function call
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");

        // Remove "0x" prefix for the signing function (expects hex string without prefix)
        const txPayloadHex = txPayload.slice(2);

        // Generate signature using the test mnemonic
        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

        const r = [sigResult.r];
        const s = [sigResult.s];

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        expect(await account.accountSequence()).to.equal(0);

        // Execute the recover transaction
        await expect(account.recoverTransaction(r, s, publicKeyX, publicKeyY, txPayload))
            .to.emit(account, "TransactionExecuted")
            .withArgs(RECIPIENT_ADDRESS, amountToSend, "0x");

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);

        expect(await account.accountSequence()).to.equal(1);
    });

    it("Should revert with InvalidPubKey when public key not in account", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
        const txPayloadHex = txPayload.slice(2);

        // Use a different mnemonic to get a different public key
        const differentMnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
        const sigResult = await generateSignatureWithMnemonic(differentMnemonic, txPayloadHex);

        // These keys are NOT registered in the account
        const invalidPubKeyX = [sigResult.x];
        const invalidPubKeyY = [sigResult.y];
        const r = [sigResult.r];
        const s = [sigResult.s];

        await expect(
            account.recoverTransaction(r, s, invalidPubKeyX, invalidPubKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidPubKey");
    });

    it("Should revert with InvalidSignature when signature is invalid", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");

        // Use the correct public key but an invalid/wrong signature
        const invalidR = ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
        const invalidS = ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];

        await expect(
            account.recoverTransaction(invalidR, invalidS, publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidSignature");
    });

    it("Should revert with InvalidSequence when sequence is wrong", async function () {
        // Use wrong sequence (expecting 1, but providing 5)
        const wrongSequence = BigInt(5);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(wrongSequence, RECIPIENT_ADDRESS, amountToSend, "0x");
        const txPayloadHex = txPayload.slice(2);

        // Generate a valid signature for this payload
        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
        const r = [sigResult.r];
        const s = [sigResult.s];

        await expect(account.recoverTransaction(r, s, publicKeyX, publicKeyY, txPayload)).to.be.revertedWithCustomError(
            account,
            "InvalidSequence"
        );
    });

    it("Should revert with InvalidPayload when function selector is wrong", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");

        // Use a wrong function selector
        const wrongSelector = keccak256(toUtf8Bytes("wrongFunction(uint64,address,uint256,bytes)")).slice(0, 10);
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(
            ["uint64", "address", "uint256", "bytes"],
            [sequence, RECIPIENT_ADDRESS, amountToSend, "0x"]
        );
        const txPayload = wrongSelector + encodedParams.slice(2);
        const txPayloadHex = txPayload.slice(2);

        // Generate a valid signature for this payload
        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
        const r = [sigResult.r];
        const s = [sigResult.s];

        await expect(account.recoverTransaction(r, s, publicKeyX, publicKeyY, txPayload)).to.be.revertedWithCustomError(
            account,
            "InvalidPayload"
        );
    });
});
