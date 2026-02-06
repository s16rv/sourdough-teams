import hre from "hardhat";
import { expect } from "chai";
import { MPCVerifier } from "../../typechain-types";
import { ethers } from "hardhat";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

describe("MPCVerifier", function () {
    let mpcVerifier: MPCVerifier;
    let owner: any;
    let nonOwner: any;
    let publicKeyX: string;
    let publicKeyY: string;

    // Test mnemonic for generating signatures
    const TEST_MNEMONIC = "test test test test test test test test test test test junk";

    // Test values for signature validation
    // These will be populated in beforeEach
    let payloadHash: string;
    let signatureR: string;
    let signatureS: string;
    let signatureV: number;

    beforeEach(async function () {
        [owner, nonOwner] = await ethers.getSigners();

        // Get public key from mnemonic
        const keys = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = keys.x;
        publicKeyY = keys.y;

        // Deploy MPCVerifier with initial values
        const MPCVerifierFactory = await hre.ethers.getContractFactory("MPCVerifier");
        mpcVerifier = await MPCVerifierFactory.deploy(owner.address, publicKeyX, publicKeyY);
        await mpcVerifier.waitForDeployment();

        // Generate a valid signature for default test case
        const rawMessage = "1234";
        // generateSignatureWithMnemonic takes hex string message
        const messageHex = Buffer.from(rawMessage).toString("hex");
        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHex);

        payloadHash = "0x" + sig.digestHex;
        signatureR = sig.r;
        signatureS = sig.s;
        signatureV = sig.v;
    });

    describe("Initialization", function () {
        it("Should initialize with correct public key", async function () {
            expect(await mpcVerifier.publicKeyX()).to.equal(publicKeyX);
            expect(await mpcVerifier.publicKeyY()).to.equal(publicKeyY);
        });

        it("Should allow owner to update public key", async function () {
            // Generate new keys
            const newMnemonic =
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            const newKeys = await getPublicKeyFromMnemonic(newMnemonic);

            await expect(mpcVerifier.connect(owner).updateMPCPublicKey(newKeys.x, newKeys.y))
                .to.emit(mpcVerifier, "MPCPublicKeyUpdated")
                .withArgs(publicKeyX, publicKeyY, newKeys.x, newKeys.y);

            expect(await mpcVerifier.publicKeyX()).to.equal(newKeys.x);
            expect(await mpcVerifier.publicKeyY()).to.equal(newKeys.y);
        });

        it("Should prevent non-owner from updating public key", async function () {
            const newKeys = { x: ethers.ZeroHash, y: ethers.ZeroHash }; // Dummy
            await expect(
                mpcVerifier.connect(nonOwner).updateMPCPublicKey(newKeys.x, newKeys.y)
            ).to.be.revertedWithCustomError(mpcVerifier, "OnlyOwner");
        });
    });

    describe("Signature Validation", function () {
        it("Should validate a correct signature", async function () {
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, signatureV, signatureR, signatureS);
            expect(isValid).to.equal(true);
        });

        it("Should reject an invalid signature (wrong R)", async function () {
            const invalidSignatureR = "0x1111111111111111111111111111111111111111111111111111111111111111";
            const isValid = await mpcVerifier.validateMPCSignature(
                payloadHash,
                signatureV,
                invalidSignatureR,
                signatureS
            );
            expect(isValid).to.equal(false);
        });

        it("Should reject signature from wrong signer", async function () {
            // Use a different mnemonic to sign
            const WRONG_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
            const rawMessage = "1234";
            const messageHex = Buffer.from(rawMessage).toString("hex");
            const sig = await generateSignatureWithMnemonic(WRONG_MNEMONIC, messageHex);
            const wrongPayloadHash = "0x" + sig.digestHex;

            // Signature should fail because it's from a different key
            const isValid = await mpcVerifier.validateMPCSignature(wrongPayloadHash, sig.v, sig.r, sig.s);
            expect(isValid).to.equal(false);
        });

        it("Should validate signature after key update", async function () {
            // Update to new key
            const newMnemonic =
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            const newKeys = await getPublicKeyFromMnemonic(newMnemonic);
            await mpcVerifier.connect(owner).updateMPCPublicKey(newKeys.x, newKeys.y);

            // Sign with new key
            const rawMessage = "new message";
            const messageHex = Buffer.from(rawMessage).toString("hex");
            const sig = await generateSignatureWithMnemonic(newMnemonic, messageHex);
            const newPayloadHash = "0x" + sig.digestHex;

            const isValid = await mpcVerifier.validateMPCSignature(newPayloadHash, sig.v, sig.r, sig.s);
            expect(isValid).to.equal(true);

            // Old signature should fail
            const isOldValid = await mpcVerifier.validateMPCSignature(payloadHash, signatureV, signatureR, signatureS);
            expect(isOldValid).to.equal(false);
        });
    });
});
