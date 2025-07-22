import hre from "hardhat";
import { expect } from "chai";
import { MPCGateway } from "../../typechain-types";
import { ethers } from "hardhat";

describe("MPCGateway", function () {
    let mpcGateway: MPCGateway;
    let mockMPCVerifier: any;
    let mockEntryPoint: any;
    let owner: any;
    let nonOwner: any;
    let relayer: any;

    // Test values for signature validation
    const signatureR = "0x9272896f66ef96f4516bbea12ee7e04673060df8dc07b2b79b261ed611ac8b08";
    const signatureS = "0x7143dfd748a847b8961a4a57902c4f3198e80d94b165a63625ae8b227fdb649e";

    // Test values for contract call parameters
    const sourceChain = "sourdough-1";
    const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
    const destinationChain = "polygon";
    const payload = "0x1234";

    beforeEach(async function () {
        [owner, nonOwner, relayer] = await ethers.getSigners();

        // Deploy MockMPCVerifier
        const MockMPCVerifierFactory = await hre.ethers.getContractFactory("MockMPCVerifier");
        mockMPCVerifier = await MockMPCVerifierFactory.deploy();
        await mockMPCVerifier.waitForDeployment();

        // Deploy MockEntryPoint
        const MockEntryPointFactory = await hre.ethers.getContractFactory("MockEntryPoint");
        mockEntryPoint = await MockEntryPointFactory.deploy();
        await mockEntryPoint.waitForDeployment();

        // Deploy MPCGateway with MockMPCVerifier
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = await MPCGatewayFactory.deploy(mockMPCVerifier.target);
        await mpcGateway.waitForDeployment();
    });

    describe("Initialization", function () {
        it("Should initialize with correct verifier address", async function () {
            // We can't directly check private variables, but we can test the behavior
            // that depends on them being set correctly

            // Set MockMPCVerifier to fail validation
            await mockMPCVerifier.setShouldValidate(false);

            // This should fail because the signature validation fails
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        signatureR,
                        signatureS,
                        sourceChain,
                        sourceAddress,
                        destinationChain,
                        mockEntryPoint.target,
                        payload
                    )
            ).to.be.revertedWithCustomError(mpcGateway, "TransactionNotApproved");

            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Set MockEntryPoint to succeed
            await mockEntryPoint.setShouldSucceed(true);

            // Now the call should succeed
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        signatureR,
                        signatureS,
                        sourceChain,
                        sourceAddress,
                        destinationChain,
                        mockEntryPoint.target,
                        payload
                    )
            ).to.not.be.reverted;
        });
    });

    describe("Contract Call Execution", function () {
        it("Should prevent replay attacks", async function () {
            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Set MockEntryPoint to succeed
            await mockEntryPoint.setShouldSucceed(true);

            // First execution should succeed
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        signatureR,
                        signatureS,
                        sourceChain,
                        sourceAddress,
                        destinationChain,
                        mockEntryPoint.target,
                        payload
                    )
            )
                .to.emit(mockEntryPoint, "Executed")
                .withArgs(sourceChain, sourceAddress);

            // Second execution with the same parameters should fail due to replay protection
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        signatureR,
                        signatureS,
                        sourceChain,
                        sourceAddress,
                        destinationChain,
                        mockEntryPoint.target,
                        payload
                    )
            ).to.be.revertedWithCustomError(mpcGateway, "TransactionAlreadyExecuted");
        });

        it("Should fail when destination contract execution fails", async function () {
            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Set MockEntryPoint to fail
            await mockEntryPoint.setShouldSucceed(false);

            // Execution should fail because the destination contract returns false
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        signatureR,
                        signatureS,
                        sourceChain,
                        sourceAddress,
                        destinationChain,
                        mockEntryPoint.target,
                        payload
                    )
            ).to.be.revertedWithCustomError(mpcGateway, "TransactionFailed");
        });

        it("Should emit ContractCallApproved and ContractCallExecuted events", async function () {
            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Set MockEntryPoint to succeed
            await mockEntryPoint.setShouldSucceed(true);

            // Generate transaction hash using sha256 and abi.encode to match the contract implementation
            const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [sourceChain, sourceAddress, destinationChain, mockEntryPoint.target, payload]
            );
            const txHash = ethers.sha256(encodedParams);

            // Execution should emit both events
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        signatureR,
                        signatureS,
                        sourceChain,
                        sourceAddress,
                        destinationChain,
                        mockEntryPoint.target,
                        payload
                    )
            )
                .to.emit(mpcGateway, "ContractCallApproved")
                .withArgs(sourceChain, sourceAddress, mockEntryPoint.target, txHash)
                .and.to.emit(mpcGateway, "ContractCallExecuted")
                .withArgs(sourceChain, sourceAddress, mockEntryPoint.target, txHash);
        });

        it("Should fail when signature validation fails", async function () {
            // Set MockMPCVerifier to fail validation
            await mockMPCVerifier.setShouldValidate(false);

            // Set MockEntryPoint to succeed
            await mockEntryPoint.setShouldSucceed(true);

            // Execution should fail because the signature validation fails
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        signatureR,
                        signatureS,
                        sourceChain,
                        sourceAddress,
                        destinationChain,
                        mockEntryPoint.target,
                        payload
                    )
            ).to.be.revertedWithCustomError(mpcGateway, "TransactionNotApproved");
        });
    });
});
