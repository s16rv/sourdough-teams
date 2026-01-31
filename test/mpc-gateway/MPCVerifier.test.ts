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
    const publicKeyX = "0xf8beefb970589c6e2a7105c161b51661463ea39bf5360222d42e5a3eb5033e19";
    const publicKeyY = "0x9e90e07eb23e01251a5493be008c70758e5275c56a6d79ed2223d8aeb38a431f";

    // Test values for updated MPC public key
    const newPublicKeyX = "0xef6c6462995f147e3909e50ecc1ad9b202a787737aabc660e0252851406afa8b";
    const newPublicKeyY = "0x87195b498efd817adc092da3d171f81d8f9f97293d52701f3b87fdd6e8056066";

    // Test values for signature validation
    const payloadHash = "0xc27f816427f4f248c53e3662439f4e80d62775bff2f219747e0cd696e4ede1d1";
    const signatureR = "0xd9d9d77db6e734f1d2a1428bfd92b0f2969e5eb03759843e0330b413964eb177";
    const signatureS = "0x4deaa3be2edb551dbb07102b0a88b510170154df6a1f5ed58101abe99440dda5";

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
