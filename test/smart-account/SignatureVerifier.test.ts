import hre from "hardhat";
import { expect } from "chai";
import { ethers } from "hardhat";

import { SignatureVerifierWrapper, BadVerifier, RevertingVerifier } from "../../typechain-types";

describe("SignatureVerifier", function () {
    let wrapper: SignatureVerifierWrapper;
    let badVerifier: BadVerifier;
    let revertingVerifier: RevertingVerifier;

    const dummyHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const dummyR = ethers.keccak256(ethers.toUtf8Bytes("r"));
    const dummyS = ethers.keccak256(ethers.toUtf8Bytes("s"));
    const dummyX = ethers.keccak256(ethers.toUtf8Bytes("x"));
    const dummyY = ethers.keccak256(ethers.toUtf8Bytes("y"));

    beforeEach(async function () {
        const WrapperFactory = await hre.ethers.getContractFactory("SignatureVerifierWrapper");
        wrapper = await WrapperFactory.deploy();
        await wrapper.waitForDeployment();

        const BadVerifierFactory = await hre.ethers.getContractFactory("BadVerifier");
        badVerifier = await BadVerifierFactory.deploy();
        await badVerifier.waitForDeployment();

        const RevertingVerifierFactory = await hre.ethers.getContractFactory("RevertingVerifier");
        revertingVerifier = await RevertingVerifierFactory.deploy();
        await revertingVerifier.waitForDeployment();
    });

    it("should return true when verifier returns 1", async function () {
        await badVerifier.setReturnValue(1);
        const result = await wrapper.testVerify(
            await badVerifier.getAddress(),
            dummyHash,
            dummyR,
            dummyS,
            dummyX,
            dummyY
        );
        expect(result).to.be.true;
    });

    it("should return false when verifier returns 0", async function () {
        await badVerifier.setReturnValue(0);
        const result = await wrapper.testVerify(
            await badVerifier.getAddress(),
            dummyHash,
            dummyR,
            dummyS,
            dummyX,
            dummyY
        );
        expect(result).to.be.false;
    });

    it("should return false when verifier returns non-1 value", async function () {
        await badVerifier.setReturnValue(42);
        const result = await wrapper.testVerify(
            await badVerifier.getAddress(),
            dummyHash,
            dummyR,
            dummyS,
            dummyX,
            dummyY
        );
        expect(result).to.be.false;
    });

    it("should return false when verifier reverts", async function () {
        const result = await wrapper.testVerify(
            await revertingVerifier.getAddress(),
            dummyHash,
            dummyR,
            dummyS,
            dummyX,
            dummyY
        );
        expect(result).to.be.false;
    });

    it("should handle verifier with return value of 2 (not 1) as false", async function () {
        await badVerifier.setReturnValue(2);
        const result = await wrapper.testVerify(
            await badVerifier.getAddress(),
            dummyHash,
            dummyR,
            dummyS,
            dummyX,
            dummyY
        );
        expect(result).to.be.false;
    });
});
