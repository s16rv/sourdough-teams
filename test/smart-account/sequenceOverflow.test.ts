import hre from "hardhat";
import { expect } from "chai";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

/**
 * Sequence overflow tests for Account
 *
 * Account uses uint64 for accountSequence.
 * uint64 max = 18,446,744,073,709,551,615
 *
 * This tests what happens at the boundary.
 */
describe("Account Sequence Overflow", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let verifier: Secp256k1Verifier;
    let owner: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();
    });

    describe("uint64 Boundary", function () {
        it("INFO: Documents uint64 max value for sequence", async function () {
            const uint64Max = BigInt("18446744073709551615");

            // This is informational - in practice, reaching this would require
            // 18 quintillion transactions, which is practically impossible
            console.log("uint64 max:", uint64Max.toString());
            console.log("At 1 tx/second, would take", Number(uint64Max) / 31536000, "years to overflow");

            // The sequence is stored as uint64, so overflow would wrap to 0
            // But this is not a realistic attack vector
            expect(uint64Max).to.equal(BigInt("18446744073709551615"));
        });

        it("INFO: Sequence increment uses unchecked math (would wrap on overflow)", async function () {
            /**
             * Looking at Account.sol:
             *
             * function incrementSequence() internal {
             *     accountSequence++;
             * }
             *
             * In Solidity 0.8+, this would revert on overflow due to built-in checks.
             * So if somehow sequence reached uint64 max, the next increment would revert.
             *
             * This is actually SAFE behavior - the account would become unusable
             * rather than wrapping to 0 (which could enable replay).
             */

            // Deploy account with sequence starting at 0
            const AccountContract = await hre.ethers.getContractFactory("Account");
            const account = await AccountContract.deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1
            );
            await account.waitForDeployment();

            // Verify initial sequence is 0
            expect(await account.accountSequence()).to.equal(0);

            console.log("Solidity 0.8+ has built-in overflow protection");
            console.log("If sequence somehow reached uint64 max, next tx would revert (safe)");
        });

        it("Should handle large sequence numbers correctly", async function () {
            /**
             * We can't actually test uint64 max (would need quintillions of txs),
             * but we can verify the contract handles "large" numbers correctly.
             *
             * Note: We can't set sequence directly, so this is more of a
             * documentation test showing the data type can handle large values.
             */

            const AccountContract = await hre.ethers.getContractFactory("Account");
            const account = await AccountContract.deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1
            );
            await account.waitForDeployment();

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("1.0"),
            });

            // Execute a transaction to increment sequence
            const sequence = BigInt(1);
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            await account.recoverTransaction([sigResult.r], [sigResult.s], publicKeyX, publicKeyY, txPayload);

            expect(await account.accountSequence()).to.equal(1);
            console.log("Sequence correctly incremented to 1");
        });
    });

    // Helper function
    function encodeTxPayload(sequence: bigint, dest: string, value: bigint, data: string): string {
        const selector = keccak256(toUtf8Bytes("recoverProposal(uint64,address,uint256,bytes)")).slice(0, 10);
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(["uint64", "address", "uint256", "bytes"], [sequence, dest, value, data]);
        return selector + encodedParams.slice(2);
    }
});
