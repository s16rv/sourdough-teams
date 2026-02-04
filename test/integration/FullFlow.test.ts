import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, parseEther, sha256 } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, AccountFactory, EntryPoint, MPCGateway, MPCVerifier, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings, encodeMultiPayload, encodeSignerBlock } from "../utils/lib";

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

    let mpcGateway: MPCGateway;
    let mpcVerifier: MPCVerifier;
    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let secp256k1Verifier: Secp256k1Verifier;
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

        // Deploy Secp256k1Verifier (for both MPC and Account signature verification)
        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierContract.deploy();
        await secp256k1Verifier.waitForDeployment();

        // Deploy MPCVerifier with MPC public key
        const MPCVerifierContract = await hre.ethers.getContractFactory("MPCVerifier");
        mpcVerifier = await MPCVerifierContract.deploy(
            mpcOwner.address,
            secp256k1Verifier.target,
            mpcPublicKeyX,
            mpcPublicKeyY
        );
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

            // 1. Prepare the transaction payload for Account
            const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

            // 2. Create messageHash preimage and hash
            // generateSignatureWithMnemonic hashes its input, so we pass the preimage
            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
            );
            const messageHash = sha256(messageHashPreimage);

            // 3. Compute proof = sha256(messageHash || txPayload)
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            // 4. Sign the preimage with user's key (generateSignatureWithMnemonic will hash it to get messageHash)
            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // 5. Encode the EntryPoint header (category 2 = transaction)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, accountSequence + 1n, 1]
            );

            // 6. Encode signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            // 7. Combine: header + signerBlock + txPayload
            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

            // 8. Compute txHash preimage for MPC signature
            // generateSignatureWithMnemonic hashes its input, so we pass the preimage
            // txHash = sha256(abi.encode(sourceChain, sourceAddress, destChain, destAddress, payload))
            const txHashPreimage = new AbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [SOURCE_CHAIN, SOURCE_ADDRESS, DESTINATION_CHAIN, entryPoint.target, fullPayload]
            );

            // 9. Sign txHash preimage with MPC key (generateSignatureWithMnemonic will hash it to get txHash)
            const mpcSig = await generateSignatureWithMnemonic(MPC_MNEMONIC, txHashPreimage.slice(2));

            // 10. Execute via MPCGateway
            const tx = await mpcGateway
                .connect(relayer)
                .executeContractCall(
                    mpcSig.r,
                    mpcSig.s,
                    SOURCE_CHAIN,
                    SOURCE_ADDRESS,
                    DESTINATION_CHAIN,
                    entryPoint.target,
                    fullPayload
                );

            // 11. Verify the transaction succeeded
            await expect(tx)
                .to.emit(mpcGateway, "ContractCallApproved")
                .and.to.emit(mpcGateway, "ContractCallExecuted")
                .and.to.emit(entryPoint, "TransactionHandled");

            // 12. Verify funds transferred
            const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);

            // 13. Verify sequence incremented
            expect(await account.accountSequence()).to.equal(accountSequence + 1n);
        });

        it("Should reject when MPC signature is invalid", async function () {
            const amountToSend = parseEther("1.0");
            const accountAddress = await account.getAddress();
            const accountSequence = await account.accountSequence();

            const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, accountSequence + 1n, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

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

            const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

            const messageHashPreimage = new AbiCoder().encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend]
            );
            const messageHash = sha256(messageHashPreimage);
            const proof = sha256(combineHexStrings(messageHash, txPayload));

            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

            // Header part (ABI-encoded)
            const header = new AbiCoder().encode(
                ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                [2, accountAddress, messageHash, proof, accountSequence + 1n, 1]
            );

            // Signer block (129 bytes: v + r + s + x + y, tight-packed)
            const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

            const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

            const txHashPreimage = new AbiCoder().encode(
                ["string", "string", "string", "address", "bytes"],
                [SOURCE_CHAIN, SOURCE_ADDRESS, DESTINATION_CHAIN, entryPoint.target, fullPayload]
            );
            const mpcSig = await generateSignatureWithMnemonic(MPC_MNEMONIC, txHashPreimage.slice(2));

            // First execution should succeed
            await mpcGateway
                .connect(relayer)
                .executeContractCall(
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

                const txPayload = encodeMultiPayload([{ dest: RECIPIENT_ADDRESS, value: amountToSend, data: "0x" }]);

                const messageHashPreimage = new AbiCoder().encode(
                    ["string", "uint64", "address", "uint256", "uint256"],
                    [SOURCE_ADDRESS, accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend, i]
                );
                const messageHash = sha256(messageHashPreimage);
                const proof = sha256(combineHexStrings(messageHash, txPayload));

                const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, messageHashPreimage.slice(2));

                // Header part (ABI-encoded)
                const header = new AbiCoder().encode(
                    ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64"],
                    [2, accountAddress, messageHash, proof, accountSequence + 1n, 1]
                );

                // Signer block (129 bytes: v + r + s + x + y, tight-packed)
                const signerBlock = encodeSignerBlock(userSig.v, userSig.r, userSig.s, publicKeyX[0], publicKeyY[0]);

                const fullPayload = combineHexStrings(combineHexStrings(header, signerBlock), txPayload);

                const txHashPreimage = new AbiCoder().encode(
                    ["string", "string", "string", "address", "bytes"],
                    [SOURCE_CHAIN, SOURCE_ADDRESS, DESTINATION_CHAIN, entryPoint.target, fullPayload]
                );
                const mpcSig = await generateSignatureWithMnemonic(MPC_MNEMONIC, txHashPreimage.slice(2));

                await mpcGateway
                    .connect(relayer)
                    .executeContractCall(
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
            const selector = hre.ethers.id("recoverProposal(uint64,address,uint256,bytes)").slice(0, 10);
            const abiCoder = new AbiCoder();
            const encodedParams = abiCoder.encode(
                ["uint64", "address", "uint256", "bytes"],
                [accountSequence + 1n, RECIPIENT_ADDRESS, amountToSend, "0x"]
            );
            const txPayload = selector + encodedParams.slice(2);

            // Sign with user key directly (no MPC involved)
            const userSig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            // Execute recovery transaction directly on Account (with v parameter)
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
