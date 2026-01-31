import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, parseEther, toUtf8Bytes, sha256 } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, AccountFactory, EntryPoint, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings, encodeMultiPayload } from "../utils/lib";

/**
 * Tests for EntryPoint error handling paths
 * Covers: TransactionFailed, TransactionError (catch blocks)
 */
describe("EntryPoint Error Paths", function () {
    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let secp256k1Verifier: Secp256k1Verifier;
    let account: Account;

    let owner: HardhatEthersSigner;
    let executor: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, executor] = await hre.ethers.getSigners();

        // Get public key from mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        // Deploy Secp256k1Verifier
        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierContract.deploy();
        await secp256k1Verifier.waitForDeployment();

        // Deploy AccountFactory
        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(secp256k1Verifier.target);
        await accountFactory.waitForDeployment();

        // Deploy EntryPoint
        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, owner.address);
        await entryPoint.waitForDeployment();

        // Set executor
        await entryPoint.setExecutor(executor.address, true);

        // Create account via EntryPoint
        const createAccountPayload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, 1, 1, publicKeyX[0], publicKeyY[0]]
        );

        await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, createAccountPayload);

        // Get the created account
        const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        // Fund the account
        await owner.sendTransaction({
            to: accountAddr,
            value: parseEther("10.0"),
        });
    });

    describe("Transaction Error Handling", function () {
        /**
         * Helper to create a valid signed transaction payload
         */
        async function createSignedPayload(
            sequence: bigint,
            destList: { dest: string; value: bigint; data: string }[]
        ) {
            const accountAddress = await account.getAddress();

            // Create txPayload
            const txPayload = encodeMultiPayload(destList);

            // Create messageHash preimage and hash
            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, destList[0].dest, destList[0].value]
            );
            const messageHash = sha256(messageHashPreimage);

            // Compute proof = sha256(messageHash || txPayload)
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            // Sign the preimage
            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Encode the EntryPoint payload (category 2 = transaction)
            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [
                    2, // category
                    accountAddress,
                    messageHash,
                    proof,
                    sequence,
                    1, // numberSigners
                    userSig.r,
                    userSig.s,
                    publicKeyX[0],
                    publicKeyY[0],
                ]
            );

            return combineHexStrings(entryPointPayload, txPayload);
        }

        it("Should revert with TransactionError when Account execution reverts with reason", async function () {
            // Create a transaction that will fail - send ETH to a contract that rejects it
            // Deploy a contract that rejects ETH
            const RejectETHFactory = await hre.ethers.getContractFactory("RejectETH");
            const rejectETH = await RejectETHFactory.deploy();
            await rejectETH.waitForDeployment();

            const sequence = (await account.accountSequence()) + 1n;
            const payload = await createSignedPayload(sequence, [
                { dest: await rejectETH.getAddress(), value: parseEther("1.0"), data: "0x" },
            ]);

            // This should trigger the catch Error block in EntryPoint
            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "TransactionError");
        });

        it("Should handle validation failure gracefully (emits DebugReason)", async function () {
            // Create a transaction with invalid sequence
            const wrongSequence = 999n;
            const payload = await createSignedPayload(wrongSequence, [
                { dest: owner.address, value: parseEther("0.1"), data: "0x" },
            ]);

            // This should NOT revert but emit DebugReason
            const tx = await entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload);
            const receipt = await tx.wait();

            // Check for DebugReason event
            const debugEvent = receipt?.logs.find((log: any) => {
                try {
                    const parsed = entryPoint.interface.parseLog(log);
                    return parsed?.name === "DebugReason";
                } catch {
                    return false;
                }
            });

            expect(debugEvent).to.not.be.undefined;
        });

        it("Should revert with PayloadTooShort when batch item is truncated (line 201)", async function () {
            // Create a payload that claims 2 items but only has data for 1
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;

            // Create a malformed txPayload: count=2 but only first item fully encoded
            const count = 2n;
            const dest1 = owner.address;
            const value1 = parseEther("0.01");
            const dataLen1 = 0n;

            // Encode only the first batch item, claim count=2
            // This will cause PayloadTooShort when parsing the second item (line 201)
            const truncatedTxPayload =
                "0x" +
                count.toString(16).padStart(64, "0") + // count = 2
                dest1.slice(2).toLowerCase().padStart(64, "0") + // dest1
                value1.toString(16).padStart(64, "0") + // value1
                dataLen1.toString(16).padStart(64, "0"); // dataLen1 = 0
            // Missing: data1, dest2, value2, dataLen2, data2

            // Create messageHash preimage
            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, dest1, value1]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, truncatedTxPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [
                    2, // category
                    accountAddress,
                    messageHash,
                    proof,
                    sequence,
                    1, // numberSigners
                    userSig.r,
                    userSig.s,
                    publicKeyX[0],
                    publicKeyY[0],
                ]
            );

            const fullPayload = combineHexStrings(entryPointPayload, truncatedTxPayload);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload)
            ).to.be.revertedWithCustomError(entryPoint, "PayloadTooShort");
        });

        it("Should revert with InvalidTargetAccount when target doesn't match factory (line 159)", async function () {
            const sequence = (await account.accountSequence()) + 1n;
            const dest = owner.address;
            const value = parseEther("0.01");

            // Create valid txPayload
            const txPayload = encodeMultiPayload([{ dest, value, data: "0x" }]);

            // Create messageHash preimage
            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, dest, value]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Use a WRONG target address (not the actual account)
            const wrongTarget = executor.address; // Just use any address that's not the account

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [
                    2, // category
                    wrongTarget, // WRONG target address
                    messageHash,
                    proof,
                    sequence,
                    1, // numberSigners
                    userSig.r,
                    userSig.s,
                    publicKeyX[0],
                    publicKeyY[0],
                ]
            );

            const fullPayload = combineHexStrings(entryPointPayload, txPayload);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload)
            ).to.be.revertedWithCustomError(entryPoint, "InvalidTargetAccount");
        });

        it("Should revert with PayloadTooShort when txPayload has no count (line 181)", async function () {
            const accountAddress = await account.getAddress();
            const sequence = (await account.accountSequence()) + 1n;
            const dest = owner.address;
            const value = parseEther("0.01");

            // Create an empty/too-short txPayload (less than 32 bytes)
            const shortTxPayload = "0x00"; // Only 1 byte, needs 32 for count

            // Create messageHash preimage
            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, dest, value]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, shortTxPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            const entryPointPayload = new AbiCoder().encode(
                [
                    "uint8",
                    "address",
                    "bytes32",
                    "bytes32",
                    "uint64",
                    "uint64",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                    "bytes32",
                ],
                [
                    2, // category
                    accountAddress,
                    messageHash,
                    proof,
                    sequence,
                    1, // numberSigners
                    userSig.r,
                    userSig.s,
                    publicKeyX[0],
                    publicKeyY[0],
                ]
            );

            const fullPayload = combineHexStrings(entryPointPayload, shortTxPayload);

            await expect(
                entryPoint.connect(executor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, fullPayload)
            ).to.be.revertedWithCustomError(entryPoint, "PayloadTooShort");
        });
    });

    describe("Executor Management", function () {
        it("Should allow owner to add executor", async function () {
            const [, , newExecutor] = await hre.ethers.getSigners();

            await entryPoint.connect(owner).setExecutor(newExecutor.address, true);

            expect(await entryPoint.isExecutor(newExecutor.address)).to.be.true;
        });

        it("Should allow owner to remove executor", async function () {
            await entryPoint.connect(owner).setExecutor(executor.address, false);

            expect(await entryPoint.isExecutor(executor.address)).to.be.false;
        });

        it("Should reject non-owner from setting executor", async function () {
            const [, , nonOwner, newExecutor] = await hre.ethers.getSigners();

            await expect(entryPoint.connect(nonOwner).setExecutor(newExecutor.address, true)).to.be.revertedWith(
                "Only owner can set executor"
            );
        });

        it("Should reject non-executor from executing payload", async function () {
            const [, , nonExecutor] = await hre.ethers.getSigners();

            const payload = new AbiCoder().encode(
                ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
                [1, 1, 1, publicKeyX[0], publicKeyY[0]]
            );

            await expect(
                entryPoint.connect(nonExecutor).executePayload(SOURCE_ADDRESS, SOURCE_ADDRESS, payload)
            ).to.be.revertedWithCustomError(entryPoint, "NotExecutor");
        });
    });
});

/**
 * Helper contract that rejects ETH transfers
 */
// Note: This contract needs to be added to testing-contracts/
