import hre from "hardhat";
import { expect } from "chai";

/**
 * Edge case tests for SignatureVerifier library
 * Covers: staticcall failure path (line 29)
 */
describe("SignatureVerifier Edge Cases", function () {
    describe("Verifier Failure Handling", function () {
        it("Should return false when verifier staticcall fails (reverts)", async function () {
            // Deploy SignatureVerifierWrapper (exposes the library function)
            const SignatureVerifierWrapperFactory = await hre.ethers.getContractFactory("SignatureVerifierWrapper");
            const testVerifier = await SignatureVerifierWrapperFactory.deploy();
            await testVerifier.waitForDeployment();

            // Deploy a verifier that always reverts
            const RevertingVerifierFactory = await hre.ethers.getContractFactory("RevertingVerifier");
            const revertingVerifier = await RevertingVerifierFactory.deploy();
            await revertingVerifier.waitForDeployment();

            // Call with reverting verifier - should return false (not revert)
            const result = await testVerifier.testVerify(
                await revertingVerifier.getAddress(),
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234"
            );

            // The call should not revert, but return false
            expect(result).to.be.false;
        });

        it("Should return false when verifier returns invalid data", async function () {
            // Deploy a mock verifier that returns invalid data
            const BadVerifierFactory = await hre.ethers.getContractFactory("BadVerifier");
            const badVerifier = await BadVerifierFactory.deploy();
            await badVerifier.waitForDeployment();

            const SignatureVerifierWrapperFactory = await hre.ethers.getContractFactory("SignatureVerifierWrapper");
            const testVerifier = await SignatureVerifierWrapperFactory.deploy();
            await testVerifier.waitForDeployment();

            // Set bad verifier to return 0 (invalid signature)
            await badVerifier.setReturnValue(0);

            const result = await testVerifier.testVerify(
                await badVerifier.getAddress(),
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234"
            );

            expect(result).to.be.false;
        });

        it("Should return true when verifier returns 1", async function () {
            const BadVerifierFactory = await hre.ethers.getContractFactory("BadVerifier");
            const badVerifier = await BadVerifierFactory.deploy();
            await badVerifier.waitForDeployment();

            const SignatureVerifierWrapperFactory = await hre.ethers.getContractFactory("SignatureVerifierWrapper");
            const testVerifier = await SignatureVerifierWrapperFactory.deploy();
            await testVerifier.waitForDeployment();

            // Set bad verifier to return 1 (valid signature)
            await badVerifier.setReturnValue(1);

            const result = await testVerifier.testVerify(
                await badVerifier.getAddress(),
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x1234567890123456789012345678901234567890123456789012345678901234"
            );

            expect(result).to.be.true;
        });
    });
});
