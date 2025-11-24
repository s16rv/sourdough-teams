import hre from "hardhat";
import { expect } from "chai";
import { EntryPoint, IMPCGateway, MPCGateway } from "../../typechain-types";
import { ethers } from "hardhat";

describe("MPCGatewayEntrypoint", function () {
    let mpcGateway: MPCGateway;
    let mockMPCVerifier: any;
    let entryPoint: EntryPoint;
    let owner: any;
    let nonOwner: any;
    let relayer: any;

    // Test values for signature validation
    const signatureR = "0x9272896f66ef96f4516bbea12ee7e04673060df8dc07b2b79b261ed611ac8b08";
    const signatureS = "0x7143dfd748a847b8961a4a57902c4f3198e80d94b165a63625ae8b227fdb649e";

    // Test values for contract call parameters
    const sourceChain = "sourdough-1";
    const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
    const destinationChain = "ethereum-sepolia";
    const payload =
        "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

    beforeEach(async function () {
        [owner, nonOwner, relayer] = await ethers.getSigners();

        // Deploy MockMPCVerifier
        const MockMPCVerifierFactory = await hre.ethers.getContractFactory("MockMPCVerifier");
        mockMPCVerifier = await MockMPCVerifierFactory.deploy();
        await mockMPCVerifier.waitForDeployment();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, owner.address);
        await entryPoint.waitForDeployment();

        // Deploy MPCGateway with MockMPCVerifier
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = await MPCGatewayFactory.deploy(mockMPCVerifier.target);
        await mpcGateway.waitForDeployment();

        await entryPoint.setExecutor(mpcGateway.target, true);
    });

    describe("Initialization", function () {
        it("Should initialize with correct verifier address", async function () {
            // Set MockMPCVerifier to fail validation
            await mockMPCVerifier.setShouldValidate(false);

            // This should return false because the signature validation fails
            const result1 = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    payload
                );
            expect(result1).to.be.false;

            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Now the call should return true
            const result2 = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    payload
                );
            expect(result2).to.be.true;
        });
    });

    describe("ErrorHandling", function () {
        it("emits DebugError('CallFailed') when EntryPoint reverts NotExecutor", async function () {
            await mockMPCVerifier.setShouldValidate(true);
            await entryPoint.setExecutor(mpcGateway.target, false);

            const tx = await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    "0x"
                );
            const receipt = await tx.wait();

            const events = await mpcGateway.queryFilter(
                mpcGateway.filters.DebugError(),
                receipt!.blockNumber,
                receipt!.blockNumber
            );
            const msgs = events.map((e) => e.args![0] as string);
            const hasCallFailed = msgs.some((m) => m === "CallFailed");
            expect(hasCallFailed).to.equal(true);
            const hasUnknownError = msgs.some((m) => m === "UnknownError");
            expect(hasUnknownError).to.equal(true);
        });

        it("emits DebugError('CallFailed') when EntryPoint reverts on invalid payload", async function () {
            await mockMPCVerifier.setShouldValidate(true);
            await entryPoint.setExecutor(mpcGateway.target, true);

            const tx = await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    "0x"
                );
            const receipt = await tx.wait();

            const events = await mpcGateway.queryFilter(
                mpcGateway.filters.DebugError(),
                receipt!.blockNumber,
                receipt!.blockNumber
            );
            const msgs = events.map((e) => e.args![0] as string);
            const hasCallFailed = msgs.some((m) => m === "CallFailed");
            expect(hasCallFailed).to.equal(true);
            const hasUnknownError = msgs.some((m) => m === "UnknownError");
            expect(hasUnknownError).to.equal(true);
        });
    });
});
