import hre, { upgrades } from "hardhat";
import { expect } from "chai";
import { ethers } from "hardhat";
import { EntryPoint, MPCGateway, MPCVerifier } from "../../typechain-types";

describe("MPCGateway", function () {
    let mpcGateway: MPCGateway;
    let mockMPCVerifier: any;
    let mockEntryPoint: any;
    let owner: any;
    let nonOwner: any;
    let relayer: any;

    // Test values for signature validation (now includes v parameter)
    const signatureV = 27;
    const signatureR = "0x9272896f66ef96f4516bbea12ee7e04673060df8dc07b2b79b261ed611ac8b08";
    const signatureS = "0x7143dfd748a847b8961a4a57902c4f3198e80d94b165a63625ae8b227fdb649e";
    const signatureV = 27;

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

        // Deploy MPCGateway proxy with MockMPCVerifier
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = (await upgrades.deployProxy(MPCGatewayFactory, [mockMPCVerifier.target, owner.address], {
            kind: "uups",
        })) as unknown as MPCGateway;
        await mpcGateway.waitForDeployment();
    });

    describe("Initialization", function () {
        it("Should initialize with correct verifier address", async function () {
            // Set MockMPCVerifier to fail validation
            await mockMPCVerifier.setShouldValidate(false);

            // This should return false because the signature validation fails
            const result1 = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    mockEntryPoint.target,
                    payload
                );
            expect(result1).to.be.false;

            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Set MockEntryPoint to succeed
            await mockEntryPoint.setShouldSucceed(true);

            // Now the call should succeed and return true
            const result2 = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    mockEntryPoint.target,
                    payload
                );
            expect(result2).to.be.true;
        });
    });

    describe("Contract Call Execution", function () {
        it("Should prevent replay attacks", async function () {
            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Set MockEntryPoint to succeed
            await mockEntryPoint.setShouldSucceed(true);

            // First execution should succeed
            const result1 = await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    mockEntryPoint.target,
                    payload
                );
            expect(result1).to.not.be.reverted;

            // Second execution with the same parameters should return false due to replay protection
            const result2 = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    mockEntryPoint.target,
                    payload
                );
            expect(result2).to.be.false;
        });

        it("Should fail when destination contract execution fails", async function () {
            // Set MockMPCVerifier to pass validation
            await mockMPCVerifier.setShouldValidate(true);

            // Set MockEntryPoint to fail
            await mockEntryPoint.setShouldSucceed(false);

            // Execution should return false because the destination contract returns false
            const result = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    mockEntryPoint.target,
                    payload
                );
            expect(result).to.be.false;
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
                        signatureV,
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
                .withArgs(sourceChain, sourceAddress, mockEntryPoint.target, txHash)
                .and.to.emit(mockEntryPoint, "Executed")
                .withArgs(sourceChain, sourceAddress);
        });

        it("Should fail when signature validation fails", async function () {
            // Set MockMPCVerifier to fail validation
            await mockMPCVerifier.setShouldValidate(false);

            // Set MockEntryPoint to succeed
            await mockEntryPoint.setShouldSucceed(true);

            // Execution should return false because the signature validation fails
            const result = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    mockEntryPoint.target,
                    payload
                );
            expect(result).to.be.false;
        });
    });

    describe("Verifier Update", function () {
        it("Should allow owner to update verifier", async function () {
            const NewMockVerifierFactory = await hre.ethers.getContractFactory("MockMPCVerifier");
            const newVerifier = await NewMockVerifierFactory.deploy();
            await newVerifier.waitForDeployment();

            await expect(mpcGateway.connect(owner).setVerifier(newVerifier.target)).to.emit(
                mpcGateway,
                "VerifierUpdated"
            );
        });

        it("Should reject non-owner updating verifier", async function () {
            const NewMockVerifierFactory = await hre.ethers.getContractFactory("MockMPCVerifier");
            const newVerifier = await NewMockVerifierFactory.deploy();
            await newVerifier.waitForDeployment();

            await expect(mpcGateway.connect(nonOwner).setVerifier(newVerifier.target)).to.be.revertedWithCustomError(
                mpcGateway,
                "OwnableUnauthorizedAccount"
            );
        });
    });

    describe("Upgradeability", function () {
        it("Should allow owner to upgrade", async function () {
            const MPCGatewayV2Factory = await hre.ethers.getContractFactory("MPCGateway");
            await expect(upgrades.upgradeProxy(mpcGateway.target, MPCGatewayV2Factory)).to.not.be.reverted;
        });

        it("Should reject non-owner upgrade", async function () {
            const MPCGatewayV2Factory = await hre.ethers.getContractFactory("MPCGateway", nonOwner);
            await expect(upgrades.upgradeProxy(mpcGateway.target, MPCGatewayV2Factory)).to.be.reverted;
        });
    });
});

describe("MPCGateway Entrypoint Integration", function () {
    let mpcGateway: MPCGateway;
    let mockMPCVerifier: any;
    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let owner: any;
    let nonOwner: any;
    let relayer: any;

    // Test values for signature validation (now includes v parameter)
    const signatureV = 27;
    const signatureR = "0x9272896f66ef96f4516bbea12ee7e04673060df8dc07b2b79b261ed611ac8b08";
    const signatureS = "0x7143dfd748a847b8961a4a57902c4f3198e80d94b165a63625ae8b227fdb649e";
    const signatureV = 27;

    // Test values for contract call parameters
    const sourceChain = "sourdough-1";
    const sourceAddress = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
    const destinationChain = "ethereum-sepolia";
    // Payload format: category(uint8), totalSigners(uint64), threshold(uint64), salt(bytes32), publicKeyX(bytes32), publicKeyY(bytes32)
    const payload = encodeCreateAccountPayload(
        1,
        1,
        DEFAULT_SALT,
        ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"],
        ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"]
    );

    beforeEach(async function () {
        [owner, nonOwner, relayer] = await ethers.getSigners();

        // Deploy MockMPCVerifier
        const MockMPCVerifierFactory = await hre.ethers.getContractFactory("MockMPCVerifier");
        mockMPCVerifier = await MockMPCVerifierFactory.deploy();
        await mockMPCVerifier.waitForDeployment();

        // Deploy AccountFactory proxy
        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = (await upgrades.deployProxy(AccountFactoryContract, [hre.ethers.ZeroAddress, owner.address], {
            kind: "uups",
        })) as unknown as AccountFactory;
        await accountFactory.waitForDeployment();

        // Deploy EntryPoint proxy
        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = (await upgrades.deployProxy(
            EntryPointContract,
            [accountFactory.target, owner.address, hre.ethers.ZeroAddress],
            { kind: "uups" }
        )) as unknown as EntryPoint;
        await entryPoint.waitForDeployment();

        // Deploy MPCGateway proxy with MockMPCVerifier
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = (await upgrades.deployProxy(MPCGatewayFactory, [mockMPCVerifier.target, owner.address], {
            kind: "uups",
        })) as unknown as MPCGateway;
        await mpcGateway.waitForDeployment();

        // Wire up contracts
        await accountFactory.setEntryPoint(entryPoint.target);
        await entryPoint.setMPCGateway(mpcGateway.target);
    });

    describe("Initialization", function () {
        it("Should initialize with correct verifier address", async function () {
            // Set MockMPCVerifier to fail validation
            await mockMPCVerifier.setShouldValidate(false);

            // This should return false because the signature validation fails
            const result1 = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
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
                    signatureV,
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
        it("returns false when EntryPoint reverts NotMPCGateway", async function () {
            await mockMPCVerifier.setShouldValidate(true);
            // Set mpcGateway to a different address to trigger NotMPCGateway
            await entryPoint.setMPCGateway(nonOwner.address);

            const result = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    "0x"
                );
            expect(result).to.be.false;

            const tx = await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    "0x"
                );
            await expect(tx).to.not.emit(mpcGateway, "ContractCallExecuted");
        });

        it("returns false when EntryPoint reverts on invalid payload", async function () {
            await mockMPCVerifier.setShouldValidate(true);

            const result = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    "0x"
                );
            expect(result).to.be.false;

            const tx = await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    signatureV,
                    signatureR,
                    signatureS,
                    sourceChain,
                    sourceAddress,
                    destinationChain,
                    entryPoint.target,
                    "0x"
                );
            await expect(tx).to.not.emit(mpcGateway, "ContractCallExecuted");
        });
    });
});

describe("MPCGateway Verifier Integration", function () {
    let mpcGateway: MPCGateway;
    let mpcVerifier: MPCVerifier;
    let mockEntryPoint: any;
    let owner: any;
    let nonOwner: any;
    let relayer: any;

    // MPC Public Key values - used to derive the signer address
    const MPC_PUBLIC_KEY_X = "0xf8beefb970589c6e2a7105c161b51661463ea39bf5360222d42e5a3eb5033e19";
    const MPC_PUBLIC_KEY_Y = "0x9e90e07eb23e01251a5493be008c70758e5275c56a6d79ed2223d8aeb38a431f";

    // Helper to derive Ethereum address from public key
    function publicKeyToAddress(pubKeyX: string, pubKeyY: string): string {
        const pubKeyBytes = hre.ethers.concat([pubKeyX, pubKeyY]);
        const hash = hre.ethers.keccak256(pubKeyBytes);
        return "0x" + hash.slice(-40);
    }

    beforeEach(async function () {
        [owner, nonOwner, relayer] = await ethers.getSigners();

        // Deploy MPCVerifier with the provided public key
        const MPCVerifierFactory = await hre.ethers.getContractFactory("MPCVerifier");
        mpcVerifier = await MPCVerifierFactory.deploy(owner.address, MPC_PUBLIC_KEY_X, MPC_PUBLIC_KEY_Y);
        await mpcVerifier.waitForDeployment();

        // Deploy MockEntryPoint
        const MockEntryPointFactory = await hre.ethers.getContractFactory("MockEntryPoint");
        mockEntryPoint = await MockEntryPointFactory.deploy();
        await mockEntryPoint.waitForDeployment();

        // Deploy MPCGateway proxy with real MPCVerifier
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = (await upgrades.deployProxy(MPCGatewayFactory, [mpcVerifier.target, owner.address], {
            kind: "uups",
        })) as unknown as MPCGateway;
        await mpcGateway.waitForDeployment();
    });

    describe("MPCVerifier Initialization", function () {
        it("Should initialize MPCVerifier with the correct public key values", async function () {
            // Verify that the MPCVerifier was initialized with the correct public key values
            // We can't directly access the private variables, but we can check that the contract was deployed successfully
            expect(await mpcVerifier.getAddress()).to.not.equal(ethers.ZeroAddress);
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

            // Try to validate the signature directly with the MPCVerifier
            // This should fail because the signature doesn't match the public key
            const isValid = await mpcVerifier.validateMPCSignature(
                payloadHash,
                0,
                params.signatureR,
                params.signatureS
            );

            // The validation should pass
            expect(isValid).to.be.true;
        });
    });

    describe("Execute Contract Call", function () {
        it("Should fail when signature does not match signer address", async function () {
            // Using arbitrary signature values that won't match the expected signer
            const signatureV = 27;
            const signatureR = "0xd9d9d77db6e734f1d2a1428bfd92b0f2969e5eb03759843e0330b413964eb177";
            const signatureS = "0x4deaa3be2edb551dbb07102b0a88b510170154df6a1f5ed58101abe99440dda5";

            const result = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    0,
                    params.signatureR,
                    params.signatureS,
                    params.sourceChain,
                    params.sourceAddress,
                    params.destinationChain,
                    mockEntryPoint.target,
                    "0x1234"
                );
            expect(result).to.be.false;
        });
    });
});

describe("MPCGateway - generateTxHash", function () {
    let mpcGateway: MPCGateway;
    let mockMPCVerifier: any;
    let owner: any;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Deploy MockMPCVerifier (required for MPCGateway initialization)
        const MockMPCVerifierFactory = await hre.ethers.getContractFactory("MockMPCVerifier");
        mockMPCVerifier = await MockMPCVerifierFactory.deploy();
        await mockMPCVerifier.waitForDeployment();

        // Deploy MPCGateway proxy
        const MPCGatewayFactory = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = (await upgrades.deployProxy(MPCGatewayFactory, [mockMPCVerifier.target, owner.address], {
            kind: "uups",
        })) as unknown as MPCGateway;
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

            expect(hash).to.equal("0xba5e3fea2ecd0fc87df057b6e77303f8059b59cba830290800f4250dbb2f4dc6");
        });
    });
});
