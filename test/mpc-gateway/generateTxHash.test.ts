import { expect } from "chai";
import { ethers } from "hardhat";
import { MPCGateway } from "../../typechain-types";
import hre from "hardhat";

describe("MPCGateway - generateTxHash", function () {
    let mpcGateway: MPCGateway;
    let mockMPCVerifier: any;

    beforeEach(async function () {
        // Deploy MockMPCVerifier (required for MPCGateway constructor)
        const MockMPCVerifierFactory = await hre.ethers.getContractFactory("MockMPCVerifier");
        mockMPCVerifier = await MockMPCVerifierFactory.deploy();
        await mockMPCVerifier.waitForDeployment();

        // Deploy MPCGateway
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = await MPCGatewayFactory.deploy(mockMPCVerifier.target);
        await mpcGateway.waitForDeployment();
    });

    describe("generateTxHash function", function () {
        it("Should generate consistent hash for same parameters", async function () {
            const sourceChain = "sourdough-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "polygon";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            const hash1 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            const hash2 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            expect(hash1).to.equal(hash2);
        });

        it("Should generate different hashes for different source chains", async function () {
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "polygon";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            const hash1 = await mpcGateway.generateTxHash(
                "sourdough-1",
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            const hash2 = await mpcGateway.generateTxHash(
                "sourdough-2",
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            expect(hash1).to.not.equal(hash2);
        });

        it("Should generate different hashes for different source addresses", async function () {
            const sourceChain = "sourdough-1";
            const destinationChain = "polygon";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            const hash1 = await mpcGateway.generateTxHash(
                sourceChain,
                "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6",
                destinationChain,
                destinationAddress,
                payload
            );

            const hash2 = await mpcGateway.generateTxHash(
                sourceChain,
                "cosmos1abcdefghijklmnopqrstuvwxyz123456789xyz",
                destinationChain,
                destinationAddress,
                payload
            );

            expect(hash1).to.not.equal(hash2);
        });

        it("Should generate different hashes for different destination chains", async function () {
            const sourceChain = "sourdough-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            const hash1 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                "polygon",
                destinationAddress,
                payload
            );

            const hash2 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                "ethereum",
                destinationAddress,
                payload
            );

            expect(hash1).to.not.equal(hash2);
        });

        it("Should generate different hashes for different destination addresses", async function () {
            const sourceChain = "sourdough-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "polygon";
            const payload = "0x1234abcd";

            const hash1 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                "0x1234567890123456789012345678901234567890",
                payload
            );

            const hash2 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
                payload
            );

            expect(hash1).to.not.equal(hash2);
        });

        it("Should generate different hashes for different payloads", async function () {
            const sourceChain = "sourdough-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "polygon";
            const destinationAddress = "0x1234567890123456789012345678901234567890";

            const hash1 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                "0x1234abcd"
            );

            const hash2 = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                "0xabcd1234"
            );

            expect(hash1).to.not.equal(hash2);
        });

        it("Should handle empty strings and empty payload", async function () {
            const hash = await mpcGateway.generateTxHash(
                "",
                "",
                "",
                "0x0000000000000000000000000000000000000000",
                "0x"
            );

            expect(hash).to.be.a("string");
            expect(hash).to.have.lengthOf(66); // 0x + 64 hex characters
        });

        it("Should handle very long strings", async function () {
            const longString = "a".repeat(1000);
            const longPayload = "0x" + "ab".repeat(500);

            const hash = await mpcGateway.generateTxHash(
                longString,
                longString,
                longString,
                "0x1234567890123456789012345678901234567890",
                longPayload
            );

            expect(hash).to.be.a("string");
            expect(hash).to.have.lengthOf(66); // 0x + 64 hex characters
        });

        it("Should match expected hash format (32 bytes)", async function () {
            const sourceChain = "sourdough-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "polygon";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            const hash = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            // Should be a valid bytes32 (0x + 64 hex characters)
            expect(hash).to.match(/^0x[a-fA-F0-9]{64}$/);
        });

        it("Should generate hash that matches manual calculation", async function () {
            const sourceChain = "sourdough-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "polygon";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            // Generate hash using contract
            const contractHash = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            // Generate hash manually using ethers
            const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [sourceChain, sourceAddress, destinationChain, destinationAddress, payload]
            );
            const manualHash = ethers.sha256(encodedParams);

            expect(contractHash).to.equal(manualHash);
        });

        it("Should handle special characters in strings", async function () {
            const sourceChain = "sourdough-1-测试";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6-特殊";
            const destinationChain = "polygon-🚀";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            const hash = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            expect(hash).to.be.a("string");
            expect(hash).to.have.lengthOf(66);
        });

        it("Should be deterministic across multiple calls", async function () {
            const sourceChain = "sourdough-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "polygon";
            const destinationAddress = "0x1234567890123456789012345678901234567890";
            const payload = "0x1234abcd";

            const hashes = [];
            for (let i = 0; i < 5; i++) {
                const hash = await mpcGateway.generateTxHash(
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    destinationAddress,
                    payload
                );
                hashes.push(hash);
            }

            // All hashes should be identical
            for (let i = 1; i < hashes.length; i++) {
                expect(hashes[i]).to.equal(hashes[0]);
            }
        });
    });

    describe("test generateTxHash function", function () {
        it("test generateTxHash function", async function () {
            const sourceChain = "alpha-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "ethereum-sepolia";
            const destinationAddress = "0xf56d63B2778Cad34bf38cab2E0B91230936B7a72";
            const payload =
                "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

            const hash = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            expect(hash).to.equal("0xc27f816427f4f248c53e3662439f4e80d62775bff2f219747e0cd696e4ede1d1");
        });

        it("test execute contract call", async function () {
            const signatureR = "0xd9d9d77db6e734f1d2a1428bfd92b0f2969e5eb03759843e0330b413964eb177";
            const signatureS = "0x4deaa3be2edb551dbb07102b0a88b510170154df6a1f5ed58101abe99440dda5";
            const sourceChain = "alpha-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "ethereum-sepolia";
            const destinationAddress = "0xf56d63B2778Cad34bf38cab2E0B91230936B7a72";
            const payload =
                "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

            await mpcGateway.executeContractCall(
                signatureR,
                signatureS,
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );
        });

        it("test generateTxHash function", async function () {
            const sourceChain = "alpha-1";
            const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
            const destinationChain = "ethereum-sepolia";
            const destinationAddress = "0xf56d63B2778Cad34bf38cab2E0B91230936B7a72";
            const payload =
                "0x00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

            const hash = await mpcGateway.generateTxHash(
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payload
            );

            expect(hash).to.equal("0x775a77e732b9e03f7977af56cdede61f6fcd6ac0d1b3579398aa4793217f47c5");
        });
    });
});
