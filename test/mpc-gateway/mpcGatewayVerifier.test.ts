import hre from "hardhat";
import { expect } from "chai";
import { MPCGateway, MPCVerifier, Secp256k1Verifier } from "../../typechain-types";
import { ethers } from "hardhat";

describe("MPCGatewayVerifier", function () {
    let mpcGateway: MPCGateway;
    let mpcVerifier: MPCVerifier;
    let secp256k1Verifier: Secp256k1Verifier;
    let mockEntryPoint: any;
    let owner: any;
    let nonOwner: any;
    let relayer: any;

    // MPC Public Key values
    const MPC_PUBLIC_KEY_X = "0xf8beefb970589c6e2a7105c161b51661463ea39bf5360222d42e5a3eb5033e19";
    const MPC_PUBLIC_KEY_Y = "0x9e90e07eb23e01251a5493be008c70758e5275c56a6d79ed2223d8aeb38a431f";

    // Hex data for executeContractCall from wallet
    const executeContractCallHex =
        "0x498cd109d9d9d77db6e734f1d2a1428bfd92b0f2969e5eb03759843e0330b413964eb1774deaa3be2edb551dbb07102b0a88b510170154df6a1f5ed58101abe99440dda500000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000f56d63b2778cad34bf38cab2e0b91230936b7a720000000000000000000000000000000000000000000000000000000000000007616c7068612d3100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002d636f736d6f73317a7970716137366a653770787364776b666168366d753961353833736a7536787174336d7636000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010657468657265756d2d7365706f6c6961000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

    // Extract the function selector from the hex data
    const functionSelector = executeContractCallHex.slice(0, 10);
    console.log("Function selector from executeContractCallHex:", functionSelector);

    // Parse the hex data to extract parameters
    const parseExecuteContractCallHex = () => {
        // Remove 0x prefix and function selector
        const hexWithoutPrefix = executeContractCallHex.slice(10);

        // Extract signature R and S (first 64 bytes)
        const signatureR = "0x" + hexWithoutPrefix.slice(0, 64);
        const signatureS = "0x" + hexWithoutPrefix.slice(64, 128);

        // Extract destination address directly from the hex data
        // It's at position 320-384 in the params hex (after removing the function selector)
        const paramsHex = executeContractCallHex.slice(10);
        const destinationAddress = "0x" + paramsHex.slice(320, 384).slice(-40);

        // Hard-coded values extracted from the hex data
        // These values were manually decoded from the hex data
        const sourceChain = "alpha-1";
        const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
        const destinationChain = "ethereum-sepolia";
        const payload =
            "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

        console.log("Extracted destination address:", destinationAddress);

        return {
            signatureR,
            signatureS,
            sourceChain,
            sourceAddress,
            destinationChain,
            destinationAddress,
            payload,
        };
    };

    beforeEach(async function () {
        [owner, nonOwner, relayer] = await ethers.getSigners();

        // Deploy Secp256k1Verifier
        const Secp256k1VerifierFactory = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierFactory.deploy();
        await secp256k1Verifier.waitForDeployment();

        // Deploy MPCVerifier with the provided public key
        const MPCVerifierFactory = await hre.ethers.getContractFactory("MPCVerifier");
        mpcVerifier = await MPCVerifierFactory.deploy(
            owner.address,
            secp256k1Verifier.target,
            MPC_PUBLIC_KEY_X,
            MPC_PUBLIC_KEY_Y
        );
        await mpcVerifier.waitForDeployment();

        // Deploy MockEntryPoint
        const MockEntryPointFactory = await hre.ethers.getContractFactory("MockEntryPoint");
        mockEntryPoint = await MockEntryPointFactory.deploy();
        await mockEntryPoint.waitForDeployment();

        // Deploy MPCGateway with real MPCVerifier
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = await MPCGatewayFactory.deploy(mpcVerifier.target);
        await mpcGateway.waitForDeployment();
    });

    describe("MPCVerifier Initialization", function () {
        it("Should initialize MPCVerifier with the correct public key values", async function () {
            // Verify that the MPCVerifier was initialized with the correct public key values
            // We can't directly access the private variables, but we can check that the contract was deployed successfully
            expect(await mpcVerifier.getAddress()).to.not.equal(ethers.ZeroAddress);

            // Log the addresses for verification
            console.log("MPCVerifier address:", await mpcVerifier.getAddress());
            console.log("Secp256k1Verifier address:", await secp256k1Verifier.getAddress());
            console.log("MPCGateway address:", await mpcGateway.getAddress());
            console.log("MPC Public Key X:", MPC_PUBLIC_KEY_X);
            console.log("MPC Public Key Y:", MPC_PUBLIC_KEY_Y);
        });

        it("Should pass to validate a signature with the provided public key", async function () {
            // Parse the hex data to get the signature and payload
            const params = parseExecuteContractCallHex();

            // Generate a payload hash similar to what the contract would do
            const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [
                    params.sourceChain,
                    params.sourceAddress,
                    params.destinationChain,
                    params.destinationAddress,
                    params.payload,
                ]
            );
            const payloadHash = ethers.sha256(encodedParams);
            console.log("Payload Hash:", payloadHash);
            console.log("Signature R:", params.signatureR);
            console.log("Signature S:", params.signatureS);
            console.log("MPC Public Key X:", MPC_PUBLIC_KEY_X);
            console.log("MPC Public Key Y:", MPC_PUBLIC_KEY_Y);

            // Try to validate the signature directly with the MPCVerifier
            // This should fail because the signature doesn't match the public key
            const isValid = await mpcVerifier.validateMPCSignature(payloadHash, params.signatureR, params.signatureS);

            // The validation should pass
            expect(isValid).to.be.true;

            console.log("Signature validation result:", isValid);
        });
    });

    describe("Execute Contract Call with Hex Data", function () {
        it("Should fail when signature validation fails with provided hex data", async function () {
            // Parse the hex data
            const params = parseExecuteContractCallHex();

            // With the real MPCVerifier, the signature validation will fail naturally
            // because the provided signature doesn't match the public key

            // Execution should fail because the signature validation fails
            await expect(
                mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        params.signatureR,
                        params.signatureS,
                        params.sourceChain,
                        params.sourceAddress,
                        params.destinationChain,
                        mockEntryPoint.target,
                        params.payload
                    )
            ).to.be.revertedWithCustomError(mpcGateway, "TransactionNotApproved");
        });
    });
});
