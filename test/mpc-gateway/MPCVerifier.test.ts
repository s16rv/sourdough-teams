import hre from "hardhat";
import { expect } from "chai";
import { MPCVerifier } from "../../typechain-types";
import { ethers } from "hardhat";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

describe("MPCVerifier", function () {
    let mpcVerifier: MPCVerifier;
    let owner: any;
    let nonOwner: any;

    // Test mnemonic for generating signatures
    const TEST_MNEMONIC = "test test test test test test test test test test test junk";

    // Helper to derive Ethereum address from public key
    function publicKeyToAddress(pubKeyX: string, pubKeyY: string): string {
        const pubKeyBytes = hre.ethers.concat([pubKeyX, pubKeyY]);
        const hash = hre.ethers.keccak256(pubKeyBytes);
        return "0x" + hash.slice(-40);
    }

    // Test values for signature validation
    const payloadHash = "0xc27f816427f4f248c53e3662439f4e80d62775bff2f219747e0cd696e4ede1d1";
    const signatureR = "0xd9d9d77db6e734f1d2a1428bfd92b0f2969e5eb03759843e0330b413964eb177";
    const signatureS = "0x4deaa3be2edb551dbb07102b0a88b510170154df6a1f5ed58101abe99440dda5";
    const signatureV = 27;

    beforeEach(async function () {
        [owner, nonOwner] = await ethers.getSigners();

        // Deploy MPCVerifier with initial values
        const MPCVerifierFactory = await hre.ethers.getContractFactory("MPCVerifier");
        mpcVerifier = await MPCVerifierFactory.deploy(owner.address, publicKeyX, publicKeyY);
        await mpcVerifier.waitForDeployment();
    });

    describe("Initialization", function () {
        it("Should initialize with correct owner and signer address", async function () {
            // Verify mpcSignerAddress is set correctly (case-insensitive comparison)
            expect((await mpcVerifier.mpcSignerAddress()).toLowerCase()).to.equal(mpcSignerAddress.toLowerCase());

            // Test that owner can update signer (which requires owner to be set correctly)
            const newAddress = "0x1234567890123456789012345678901234567890";
            await expect(mpcVerifier.connect(owner).updateMPCSigner(newAddress)).to.not.be.reverted;

            // Test that non-owner cannot update signer
            await expect(mpcVerifier.connect(nonOwner).updateMPCSigner(newAddress)).to.be.revertedWithCustomError(
                mpcVerifier,
                "OnlyOwner"
            );
        });
    });

    describe("Signature Validation", function () {
        it("Should validate a correct signature", async function () {
            // Create a valid signature and test validation
            // For this test, we're using pre-generated test values that should validate correctly
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, 0, signatureR, signatureS);
            expect(isValid).to.equal(true);
        });

        it("Should reject an invalid signature", async function () {
            // Modify the signature to make it invalid
            const invalidSignatureR = "0x1111111111111111111111111111111111111111111111111111111111111111";
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, 0, invalidSignatureR, signatureS);
            expect(isValid).to.equal(false);
        });

        it("Should reject signature from wrong signer", async function () {
            // Use a different mnemonic to sign
            const WRONG_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
            const rawMessage = "1234";
            const sig = await generateSignatureWithMnemonic(WRONG_MNEMONIC, rawMessage);
            const payloadHash = "0x" + sig.digestHex;
            const v = sig.v + 27;

            // Signature should fail because it's from a different key
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, v, sig.r, sig.s);
            expect(isValid).to.equal(false);
        });

            const isValid = await mpcVerifier.validateMPCSignature(newPayloadHash, 1, newSignatureR, newSignatureS);
            expect(isValid).to.equal(true);
        });
    });

    describe("Signer Update", function () {
        it("Should allow owner to update signer address", async function () {
            const newSignerAddress = "0x1234567890123456789012345678901234567890";
            const oldSignerAddress = await mpcVerifier.mpcSignerAddress();

            await expect(mpcVerifier.connect(owner).updateMPCSigner(newSignerAddress))
                .to.emit(mpcVerifier, "MPCSignerUpdated")
                .withArgs(oldSignerAddress, newSignerAddress);

            const isValid = await mpcVerifier.validateMPCSignature(newPayloadHash, 1, newSignatureR, newSignatureS);
            expect(isValid).to.equal(true);
        });

        it("Should return false for ecrecover returning zero address", async function () {
            // Invalid signature that would cause ecrecover to return address(0)
            const rawMessage = "1234";
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, rawMessage);
            const payloadHash = "0x" + sig.digestHex;
            const invalidV = 30; // Invalid v value
            const arbitraryS = "0x4deaa3be2edb551dbb07102b0a88b510170154df6a1f5ed58101abe99440dda5";

            // ecrecover with invalid v returns address(0), which won't match mpcSignerAddress
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, invalidV, sig.r, arbitraryS);
            expect(isValid).to.equal(false);
        });
    });
});
