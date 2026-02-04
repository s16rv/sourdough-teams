import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, parseEther, sha256 } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, AccountFactory, EntryPoint, MPCGateway, MPCVerifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import {
    combineHexStrings,
    encodeNewTxPayload,
    computeTxPayloadHash,
    createSignBytes,
    encodeNewPayload,
} from "../utils/lib";

/**
 * Full integration tests: MPCGateway -> EntryPoint -> Account
 * Tests the complete flow of cross-chain transaction execution
 */
describe("Integration: Full Flow", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_CHAIN = "sourdough-1";
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const DESTINATION_CHAIN = "ethereum";
    const CHAIN_ID = 31337n; // Hardhat default chain ID for txPayload

    let mpcGateway: MPCGateway;
    let mpcVerifier: MPCVerifier;
    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let account: Account;

    let owner: HardhatEthersSigner;
    let mpcOwner: HardhatEthersSigner;
    let relayer: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    // MPC key pair for signing
    const MPC_MNEMONIC = "test test test test test test test test test test test junk";
    let mpcPublicKeyX: string;
    let mpcPublicKeyY: string;

    /**
     * Helper function to create a new format payload for Category 2 transactions
     */
    async function createNewFormatPayload(
        accountAddress: string,
        sequence: bigint,
        calls: { to: string; value: bigint; data: string }[],
        signerMnemonic: string,
        signerPubKeyX: string,
        signerPubKeyY: string
    ): Promise<string> {
        // 1. Encode txPayload with chainId, accountAddress, sequence, calls
        const txPayload = encodeNewTxPayload(CHAIN_ID, accountAddress, sequence, calls);

        // 2. Compute hash of txPayload
        const txPayloadHash = computeTxPayloadHash(txPayload);

        // 3. Create signBytes with embedded hash
        const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

        // 4. Sign sha256(signBytes) with user's key
        // Note: generateSignatureWithMnemonic computes sha256 internally, so we pass the raw signBytes content
        const signBytesBuffer = Buffer.from(signBytes.slice(2), "hex");
        const userSig = await generateSignatureWithMnemonic(signerMnemonic, signBytesBuffer.toString("hex"));

        // 5. Encode the full payload
        const fullPayload = encodeNewPayload(
            signBytes,
            hashOffset,
            [{ v: userSig.v, r: userSig.r, s: userSig.s, x: signerPubKeyX, y: signerPubKeyY }],
            txPayload
        );

        return fullPayload;
    }

    beforeEach(async function () {
        [owner, mpcOwner, relayer] = await hre.ethers.getSigners();

        // Get user public key
        const userPubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [userPubKey.x];
        publicKeyY = [userPubKey.y];

        // Get MPC public key
        const mpcPubKey = await getPublicKeyFromMnemonic(MPC_MNEMONIC);
        mpcPublicKeyX = mpcPubKey.x;
        mpcPublicKeyY = mpcPubKey.y;

        // Deploy MPCVerifier with MPC public key
        const MPCVerifierContract = await hre.ethers.getContractFactory("MPCVerifier");
        mpcVerifier = await MPCVerifierContract.deploy(mpcOwner.address, mpcPublicKeyX, mpcPublicKeyY);
        await mpcVerifier.waitForDeployment();

        // Deploy AccountFactory
        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();

        // Deploy EntryPoint
        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(accountFactory.target, owner.address);
        await entryPoint.waitForDeployment();

        // Deploy MPCGateway
        const MPCGatewayContract = await hre.ethers.getContractFactory("MPCGateway");
        mpcGateway = await MPCGatewayContract.deploy(mpcVerifier.target);
        await mpcGateway.waitForDeployment();

        // Set MPCGateway as executor on EntryPoint
        await entryPoint.setExecutor(mpcGateway.target, true);

        // Create account via EntryPoint (simulating account creation)
        const createAccountPayload = new AbiCoder().encode(
            ["uint8", "uint64", "uint64", "bytes32", "bytes32"],
            [1, 1, 1, publicKeyX[0], publicKeyY[0]] // category=1, totalSigners=1, threshold=1
        );

        // Need to set owner as executor temporarily to create account
        await entryPoint.setExecutor(owner.address, true);
        await entryPoint.executePayload(SOURCE_CHAIN, SOURCE_ADDRESS, createAccountPayload);

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

    describe("MPCGateway -> EntryPoint -> Account Flow", function () {
        it("Should execute full flow: MPC validates, EntryPoint routes, Account executes", async function () {
            const amountToSend = parseEther("1.0");
            const accountAddress = await account.getAddress();
            const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            const accountSequence = await account.accountSequence();

            // 1. Create the new format payload for EntryPoint
            const fullPayload = await createNewFormatPayload(
                accountAddress,
                accountSequence + 1n,
                [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
                TEST_MNEMONIC,
                publicKeyX[0],
                publicKeyY[0]
            );

            // 2. Compute txHash preimage for MPC signature
            const txHashPreimage = new AbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [SOURCE_CHAIN, SOURCE_ADDRESS, DESTINATION_CHAIN, entryPoint.target, fullPayload]
            );

            // 3. Sign txHash preimage with MPC key
            const mpcSig = await generateSignatureWithMnemonic(MPC_MNEMONIC, txHashPreimage.slice(2));

            // 4. Execute via MPCGateway
            const tx = await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    mpcSig.v,
                    mpcSig.r,
                    mpcSig.s,
                    SOURCE_CHAIN,
                    SOURCE_ADDRESS,
                    DESTINATION_CHAIN,
                    entryPoint.target,
                    fullPayload
                );

            // 5. Verify the transaction succeeded
            await expect(tx)
                .to.emit(mpcGateway, "ContractCallApproved")
                .and.to.emit(mpcGateway, "ContractCallExecuted")
                .and.to.emit(entryPoint, "TransactionHandled");

            // 6. Verify funds transferred
            const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);

            // 7. Verify sequence incremented
            expect(await account.accountSequence()).to.equal(accountSequence + 1n);
        });

        it("Should reject when MPC signature is invalid", async function () {
            const amountToSend = parseEther("1.0");
            const accountAddress = await account.getAddress();
            const accountSequence = await account.accountSequence();

            const fullPayload = await createNewFormatPayload(
                accountAddress,
                accountSequence + 1n,
                [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
                TEST_MNEMONIC,
                publicKeyX[0],
                publicKeyY[0]
            );

            // Use WRONG MPC key to sign
            const WRONG_MPC_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
            const txHashPreimage = new AbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [SOURCE_CHAIN, SOURCE_ADDRESS, DESTINATION_CHAIN, entryPoint.target, fullPayload]
            );
            const wrongMpcSig = await generateSignatureWithMnemonic(WRONG_MPC_MNEMONIC, txHashPreimage.slice(2));

            // Should return false (not revert) due to invalid MPC signature
            const result = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    wrongMpcSig.v,
                    wrongMpcSig.r,
                    wrongMpcSig.s,
                    SOURCE_CHAIN,
                    SOURCE_ADDRESS,
                    DESTINATION_CHAIN,
                    entryPoint.target,
                    fullPayload
                );

            expect(result).to.be.false;
        });

        it("Should reject replay of same transaction", async function () {
            const amountToSend = parseEther("1.0");
            const accountAddress = await account.getAddress();
            const accountSequence = await account.accountSequence();

            const fullPayload = await createNewFormatPayload(
                accountAddress,
                accountSequence + 1n,
                [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
                TEST_MNEMONIC,
                publicKeyX[0],
                publicKeyY[0]
            );

            const txHashPreimage = new AbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [SOURCE_CHAIN, SOURCE_ADDRESS, DESTINATION_CHAIN, entryPoint.target, fullPayload]
            );
            const mpcSig = await generateSignatureWithMnemonic(MPC_MNEMONIC, txHashPreimage.slice(2));

            // First execution should succeed
            await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    mpcSig.v,
                    mpcSig.r,
                    mpcSig.s,
                    SOURCE_CHAIN,
                    SOURCE_ADDRESS,
                    DESTINATION_CHAIN,
                    entryPoint.target,
                    fullPayload
                );

            // Second execution with same parameters should fail (replay protection at MPCGateway level)
            const result = await mpcGateway
                .connect(relayer)
                .executeContractCall.staticCall(
                    mpcSig.v,
                    mpcSig.r,
                    mpcSig.s,
                    SOURCE_CHAIN,
                    SOURCE_ADDRESS,
                    DESTINATION_CHAIN,
                    entryPoint.target,
                    fullPayload
                );

            expect(result).to.be.false;
        });

        it("Should execute multiple sequential transactions", async function () {
            const amountToSend = parseEther("0.5");
            const accountAddress = await account.getAddress();
            const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            // Execute 3 sequential transactions
            for (let i = 0; i < 3; i++) {
                const accountSequence = await account.accountSequence();

                const fullPayload = await createNewFormatPayload(
                    accountAddress,
                    accountSequence + 1n,
                    [{ to: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }],
                    TEST_MNEMONIC,
                    publicKeyX[0],
                    publicKeyY[0]
                );

                const txHashPreimage = new AbiCoder().encode(
                    ["string", "string", "string", "address", "bytes"],
                    [SOURCE_CHAIN, SOURCE_ADDRESS, DESTINATION_CHAIN, entryPoint.target, fullPayload]
                );
                const mpcSig = await generateSignatureWithMnemonic(MPC_MNEMONIC, txHashPreimage.slice(2));

                await mpcGateway
                    .connect(relayer)
                    .executeContractCall(
                        mpcSig.v,
                        mpcSig.r,
                        mpcSig.s,
                        SOURCE_CHAIN,
                        SOURCE_ADDRESS,
                        DESTINATION_CHAIN,
                        entryPoint.target,
                        fullPayload
                    );

                // Verify sequence incremented
                expect(await account.accountSequence()).to.equal(BigInt(i + 1));
            }

            // Verify total funds transferred
            const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend * 3n);
        });
    });

    describe("Recovery Path (Bypass MPC)", function () {
        it("Should allow recovery transaction when MPC is unavailable", async function () {
            const amountToSend = parseEther("1.0");
            const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            const accountSequence = await account.accountSequence();

            // Encode recovery payload
            const abiCoder = new AbiCoder();
            const txPayload = abiCoder.encode(
                ["uint256", "uint64", "address", "uint256", "bytes"],
                [CHAIN_ID, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend, "0x"]
            );

            // Sign with user key directly (no MPC involved)
            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            // Execute recovery transaction directly on Account
            await account.recoverTransaction(
                [userSig.v],
                [userSig.r],
                [userSig.s],
                [publicKeyX[0]],
                [publicKeyY[0]],
                txPayload
            );

            // Verify funds transferred
            const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);

            // Verify sequence incremented
            expect(await account.accountSequence()).to.equal(accountSequence + 1n);
        });
    });
});
