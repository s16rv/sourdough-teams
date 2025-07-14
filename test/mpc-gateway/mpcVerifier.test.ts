import hre from "hardhat";
import { expect } from "chai";
import { MPCVerifier, Secp256k1Verifier } from "../../typechain-types";
import { ethers } from "hardhat";

describe("MPCVerifier", function () {
    let mpcVerifier: MPCVerifier;
    let secp256k1Verifier: Secp256k1Verifier;
    let owner: any;
    let nonOwner: any;

    // Test values for MPC public key
    const publicKeyX = "0xc9e0bc01d127e2d245dc261a5aba5db8e0c9d12343405c2c865e8f82dcf0f6cb";
    const publicKeyY = "0x93819edf5fe5aad653c150d4ec70b4c0e0c3921e2f08aee3b3855ee402d5feb0";

    // Test values for updated MPC public key
    const newPublicKeyX = "0xef6c6462995f147e3909e50ecc1ad9b202a787737aabc660e0252851406afa8b";
    const newPublicKeyY = "0x87195b498efd817adc092da3d171f81d8f9f97293d52701f3b87fdd6e8056066";

    // Test values for signature validation
    const payloadHash = "0x17a0b0a71185ed7511bf55ef568d7c069dcbc886f993c01e07ff26aaf808a76e";
    const signatureR = "0x9272896f66ef96f4516bbea12ee7e04673060df8dc07b2b79b261ed611ac8b08";
    const signatureS = "0x7143dfd748a847b8961a4a57902c4f3198e80d94b165a63625ae8b227fdb649e";

    beforeEach(async function () {
        [owner, nonOwner] = await ethers.getSigners();

        // Deploy Secp256k1Verifier
        const Secp256k1VerifierFactory = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierFactory.deploy();
        await secp256k1Verifier.waitForDeployment();

        // Deploy MPCVerifier with initial values
        const MPCVerifierFactory = await hre.ethers.getContractFactory("MPCVerifier");
        mpcVerifier = await MPCVerifierFactory.deploy(owner.address, secp256k1Verifier.target, publicKeyX, publicKeyY);
        await mpcVerifier.waitForDeployment();
    });

    describe("Initialization", function () {
        it("Should initialize with correct owner and verifier address", async function () {
            // We can't directly check private variables, but we can test the behavior
            // that depends on them being set correctly

            // Test that owner can update public key (which requires owner to be set correctly)
            await expect(mpcVerifier.connect(owner).updateMPCPublicKey(newPublicKeyX, newPublicKeyY)).to.not.be
                .reverted;

            // Test that non-owner cannot update public key
            await expect(
                mpcVerifier.connect(nonOwner).updateMPCPublicKey(newPublicKeyX, newPublicKeyY)
            ).to.be.revertedWith("Only owner can update public key");
        });
    });

    describe("Signature Validation", function () {
        it("Should validate a correct signature", async function () {
            // Create a valid signature and test validation
            // For this test, we're using pre-generated test values that should validate correctly
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, signatureR, signatureS);
            expect(isValid).to.equal(true);
        });

        it("Should reject an invalid signature", async function () {
            // Modify the signature to make it invalid
            const invalidSignatureR = "0x1111111111111111111111111111111111111111111111111111111111111111";
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, invalidSignatureR, signatureS);
            expect(isValid).to.equal(false);
        });

        it("Should validate with updated public key", async function () {
            // Update the public key
            await mpcVerifier.connect(owner).updateMPCPublicKey(newPublicKeyX, newPublicKeyY);

            // Create a new test case with the updated public key
            const newPayloadHash = "0xaaa79707bf4ee8e0b83f454d5e972a9139e660d6c2e1281d0cf67707bd65cabb";
            const newSignatureR = "0xcd94692db3f28c630763a188efa64c28bb22d21f6923b570cd283b87e6359fb0";
            const newSignatureS = "0x51be668ef81f594bef69556f7bc14784368a45dd057b60d26c88ebb5f2b796e3";

            const isValid = await mpcVerifier.validateMPCSignature(newPayloadHash, newSignatureR, newSignatureS);
            expect(isValid).to.equal(true);
        });
    });

    describe("Public Key Update", function () {
        it("Should allow owner to update public key", async function () {
            await expect(mpcVerifier.connect(owner).updateMPCPublicKey(newPublicKeyX, newPublicKeyY)).to.not.be
                .reverted;

            // Create a new test case with the updated public key
            const newPayloadHash = "0xaaa79707bf4ee8e0b83f454d5e972a9139e660d6c2e1281d0cf67707bd65cabb";
            const newSignatureR = "0xcd94692db3f28c630763a188efa64c28bb22d21f6923b570cd283b87e6359fb0";
            const newSignatureS = "0x51be668ef81f594bef69556f7bc14784368a45dd057b60d26c88ebb5f2b796e3";

            const isValid = await mpcVerifier.validateMPCSignature(newPayloadHash, newSignatureR, newSignatureS);
            expect(isValid).to.equal(true);
        });

        it("Should prevent non-owner from updating public key", async function () {
            await expect(
                mpcVerifier.connect(nonOwner).updateMPCPublicKey(newPublicKeyX, newPublicKeyY)
            ).to.be.revertedWith("Only owner can update public key");
        });
    });
});
