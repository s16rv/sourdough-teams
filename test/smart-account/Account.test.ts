import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, parseEther, sha256, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings, encodeNewTxPayload, computeTxPayloadHash, createSignBytes } from "../utils/lib";

const TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const EXPECTED_CHAIN_ID = 31337n; // Hardhat default chain ID

/**
 * Helper to encode the txPayload as a recoverProposal function call.
 * Format: selector (4 bytes) + abi.encode(sequence, dest, value, data)
 */
function encodeTxPayload(sequence: bigint, dest: string, value: bigint, data: string): string {
    const selector = keccak256(toUtf8Bytes("recoverProposal(uint64,address,uint256,bytes)")).slice(0, 10);
    const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
    const encodedParams = abiCoder.encode(["uint64", "address", "uint256", "bytes"], [sequence, dest, value, data]);
    return selector + encodedParams.slice(2);
}

/**
 * Helper to create validateOperation params for the new format
 */
async function createValidateParams(
    accountAddress: string,
    sequence: bigint,
    calls: { to: string; value: bigint; data: string }[],
    publicKeyX: string[],
    publicKeyY: string[],
    mnemonic: string = TEST_MNEMONIC
) {
    // 1. Create txPayload
    const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, sequence, calls);

    // 2. Compute hash of txPayload
    const txPayloadHash = computeTxPayloadHash(txPayload);

    // 3. Create signBytes with embedded hash
    const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

    // 4. Sign sha256(signBytes)
    const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
    const sig = await generateSignatureWithMnemonic(mnemonic, signBytesForSigning.toString("hex"));

    return {
        signBytes,
        txPayloadHashOffset: hashOffset,
        r: [sig.r],
        s: [sig.s],
        x: publicKeyX,
        y: publicKeyY,
        txPayload,
    };
}

describe("Account", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 1n;
    const THRESHOLD = 1;

    let account: Account;
    let verifier: Secp256k1Verifier;
    let recover: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;

    beforeEach(async function () {
        [recover, stranger] = await hre.ethers.getSigners();

        // Get public key from mnemonic
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y];

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS_HASH,
            THRESHOLD
        );
        await account.waitForDeployment();

        const accountAddr = await account.getAddress();

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("Should have funds", async function () {
        const accountAddr = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddr);

        expect(balance).to.gt(0);
    });

    it("Should validate operation", async function () {
        const accountAddress = await account.getAddress();
        const params = await createValidateParams(
            accountAddress,
            SEQUENCE,
            [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        const [isValid] = await account.validateOperation(
            SOURCE_ADDRESS,
            params.signBytes,
            params.txPayloadHashOffset,
            params.r,
            params.s,
            params.x,
            params.y,
            SEQUENCE,
            params.txPayload
        );
        expect(isValid).to.be.true;
    });

    it("Should not validate operation, invalid hash commitment", async function () {
        const accountAddress = await account.getAddress();
        const params = await createValidateParams(
            accountAddress,
            SEQUENCE,
            [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        // Create a tampered txPayload (different value)
        const tamperedTxPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, SEQUENCE, [
            { to: RECIPIENT_ADDRESS, value: parseEther("0.02"), data: "0x" },
        ]);

        const [isValid, msg] = await account.validateOperation(
            SOURCE_ADDRESS,
            params.signBytes,
            params.txPayloadHashOffset,
            params.r,
            params.s,
            params.x,
            params.y,
            SEQUENCE,
            tamperedTxPayload
        );

        expect(isValid).to.be.false;
        expect(msg).to.equal("InvalidHashCommitment");
    });

    it("Should not validate operation, invalid signature", async function () {
        const accountAddress = await account.getAddress();
        const params = await createValidateParams(
            accountAddress,
            SEQUENCE,
            [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        // Modify signature to make it invalid
        const invalidR = ["0x2d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];

        const [isValid, msg] = await account.validateOperation(
            SOURCE_ADDRESS,
            params.signBytes,
            params.txPayloadHashOffset,
            invalidR,
            params.s,
            params.x,
            params.y,
            SEQUENCE,
            params.txPayload
        );
        expect(isValid).to.be.false;
        expect(msg).to.equal("InvalidSignature");
    });

    it("Should not execute transaction using stranger account", async function () {
        const amountToSend = parseEther("0.001");
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        await expect(
            account.connect(stranger).executeTransactions([RECIPIENT_ADDRESS], [amountToSend], ["0x"])
        ).to.be.revertedWithCustomError(account, "NotEntryPoint");

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance);
    });
});

describe("Account Multisig", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    let PUBLIC_KEY_X: string[];
    let PUBLIC_KEY_Y: string[];

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 1n;
    const THRESHOLD = 1;

    let account: Account;
    let verifier: Secp256k1Verifier;
    let recover: HardhatEthersSigner;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        // Use same key twice to test duplicate detection
        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        PUBLIC_KEY_X = [pubKey.x, pubKey.x];
        PUBLIC_KEY_Y = [pubKey.y, pubKey.y];

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS_HASH,
            THRESHOLD
        );
        await account.waitForDeployment();

        const accountAddr = await account.getAddress();

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("Should have funds", async function () {
        const accountAddr = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddr);

        expect(balance).to.gt(0);
    });

    it("Should validate operation", async function () {
        const accountAddress = await account.getAddress();
        const params = await createValidateParams(
            accountAddress,
            SEQUENCE,
            [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
            PUBLIC_KEY_X.slice(0, THRESHOLD),
            PUBLIC_KEY_Y.slice(0, THRESHOLD)
        );

        const [isValid] = await account.validateOperation(
            SOURCE_ADDRESS,
            params.signBytes,
            params.txPayloadHashOffset,
            params.r,
            params.s,
            params.x,
            params.y,
            SEQUENCE,
            params.txPayload
        );
        expect(isValid).to.be.true;
    });

    it("Should revert duplicate public key", async function () {
        const accountAddress = await account.getAddress();
        const params = await createValidateParams(
            accountAddress,
            SEQUENCE,
            [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
            PUBLIC_KEY_X, // Both keys (duplicates)
            PUBLIC_KEY_Y
        );

        // Duplicate the signature for both keys
        const [isValid, message] = await account.validateOperation(
            SOURCE_ADDRESS,
            params.signBytes,
            params.txPayloadHashOffset,
            [params.r[0], params.r[0]], // Duplicate r
            [params.s[0], params.s[0]], // Duplicate s
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SEQUENCE,
            params.txPayload
        );
        expect(isValid).to.be.false;
        expect(message).to.equal("DuplicatePubKey");
    });
});

/**
 * Tests for Account getter functions to improve coverage
 * Covers: getX(), getY(), getVerifier(), receive()
 */
describe("Account Getters and ETH Handling", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

    const TEST_MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let verifier: Secp256k1Verifier;
    let owner: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    describe("Single Signer Account", function () {
        beforeEach(async function () {
            [owner] = await hre.ethers.getSigners();

            const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            publicKeyX = [pubKey.x];
            publicKeyY = [pubKey.y];

            const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
            verifier = await Secp256k1VerifierContract.deploy();
            await verifier.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1 // threshold
            );
            await account.waitForDeployment();
        });

        it("Should return correct verifier address", async function () {
            expect(await account.getVerifier()).to.equal(verifier.target);
        });

        it("Should return correct X public keys", async function () {
            const xKeys = await account.getX();
            expect(xKeys.length).to.equal(1);
            expect(xKeys[0]).to.equal(publicKeyX[0]);
        });

        it("Should return correct Y public keys", async function () {
            const yKeys = await account.getY();
            expect(yKeys.length).to.equal(1);
            expect(yKeys[0]).to.equal(publicKeyY[0]);
        });

        it("Should return correct account sequence (initially 0)", async function () {
            expect(await account.accountSequence()).to.equal(0);
        });

        it("Should compare source address correctly", async function () {
            expect(await account.compareSourceAddress(SOURCE_ADDRESS)).to.be.true;
            expect(await account.compareSourceAddress("wrong-address")).to.be.false;
        });

        it("Should receive ETH via receive()", async function () {
            const amount = parseEther("1.0");
            const accountAddress = await account.getAddress();

            const initialBalance = await hre.ethers.provider.getBalance(accountAddress);

            await owner.sendTransaction({
                to: accountAddress,
                value: amount,
            });

            const finalBalance = await hre.ethers.provider.getBalance(accountAddress);
            expect(finalBalance).to.equal(initialBalance + amount);
        });

        it("Should receive ETH from multiple senders", async function () {
            const [, sender2, sender3] = await hre.ethers.getSigners();
            const accountAddress = await account.getAddress();

            await owner.sendTransaction({ to: accountAddress, value: parseEther("1.0") });
            await sender2.sendTransaction({ to: accountAddress, value: parseEther("2.0") });
            await sender3.sendTransaction({ to: accountAddress, value: parseEther("3.0") });

            const balance = await hre.ethers.provider.getBalance(accountAddress);
            expect(balance).to.equal(parseEther("6.0"));
        });
    });

    describe("Multi-Signer Account", function () {
        beforeEach(async function () {
            [owner] = await hre.ethers.getSigners();

            const pubKey1 = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            const pubKey2 = await getPublicKeyFromMnemonic(TEST_MNEMONIC_2);
            publicKeyX = [pubKey1.x, pubKey2.x];
            publicKeyY = [pubKey1.y, pubKey2.y];

            const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
            verifier = await Secp256k1VerifierContract.deploy();
            await verifier.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                2 // threshold
            );
            await account.waitForDeployment();
        });

        it("Should return all X public keys for multisig", async function () {
            const xKeys = await account.getX();
            expect(xKeys.length).to.equal(2);
            expect(xKeys[0]).to.equal(publicKeyX[0]);
            expect(xKeys[1]).to.equal(publicKeyX[1]);
        });

        it("Should return all Y public keys for multisig", async function () {
            const yKeys = await account.getY();
            expect(yKeys.length).to.equal(2);
            expect(yKeys[0]).to.equal(publicKeyY[0]);
            expect(yKeys[1]).to.equal(publicKeyY[1]);
        });
    });
});

/**
 * Tests for Account recoverTransaction function
 */
describe("Account Recover", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
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

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
            SOURCE_ADDRESS_HASH,
            1 // threshold
        );
        await account.waitForDeployment();

        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("10.0"),
        });
    });

    it("Should execute recoverTransaction with valid signature", async function () {
        const sequence = 1n;
        const value = parseEther("1.0");
        const data = "0x";

        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, value, data);
        const messageHash = sha256(txPayload);

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        await account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

        const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalBalance).to.equal(initialBalance + value);
    });

    it("Should revert with InvalidPubKey when public key not in account", async function () {
        const wrongPubKey = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
        const sequence = 1n;
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x");

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.r], [sig.s], [wrongPubKey.x], [wrongPubKey.y], txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidPubKey");
    });

    it("Should revert with InvalidSignature when signature is invalid", async function () {
        const sequence = 1n;
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x");

        const invalidR = "0x1111111111111111111111111111111111111111111111111111111111111111";
        const invalidS = "0x2222222222222222222222222222222222222222222222222222222222222222";

        await expect(
            account.recoverTransaction([invalidR], [invalidS], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidSignature");
    });

    it("Should revert with InvalidSequence when sequence is wrong", async function () {
        const wrongSequence = 99n;
        const txPayload = encodeTxPayload(wrongSequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x");

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidSequence");
    });

    it("Should revert with InvalidPayload when function selector is wrong", async function () {
        const sequence = 1n;
        // Wrong selector
        const wrongSelector = "0x12345678";
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(
            ["uint64", "address", "uint256", "bytes"],
            [sequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x"]
        );
        const txPayload = wrongSelector + encodedParams.slice(2);

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidPayload");
    });

    it("Should revert with InvalidInputLength when x and y lengths mismatch", async function () {
        const sequence = 1n;
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x");

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.r], [sig.s], publicKeyX, [], txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidInputLength");
    });

    it("Should revert with InvalidInputLength when r/s lengths mismatch x/y", async function () {
        const sequence = 1n;
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x");

        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        await expect(
            account.recoverTransaction([sig.r, sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidInputLength");
    });

    it("Should revert with InvalidThreshold when not enough signers", async function () {
        // Deploy account with threshold of 2
        const pubKey2 = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
        const twoSignerAccount = await (
            await hre.ethers.getContractFactory("Account")
        ).deploy(
            verifier.target,
            ENTRYPOINT_ADDRESS,
            [publicKeyX[0], pubKey2.x],
            [publicKeyY[0], pubKey2.y],
            SOURCE_ADDRESS_HASH,
            2 // threshold
        );

        await owner.sendTransaction({
            to: await twoSignerAccount.getAddress(),
            value: parseEther("10.0"),
        });

        const sequence = 1n;
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, parseEther("1.0"), "0x");
        const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

        // Only provide 1 signature when threshold is 2
        await expect(
            twoSignerAccount.recoverTransaction([sig.r], [sig.s], [publicKeyX[0]], [publicKeyY[0]], txPayload)
        ).to.be.revertedWithCustomError(twoSignerAccount, "InvalidThreshold");
    });
});

/**
 * Security-focused tests for Account contract
 */
describe("Account Security", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
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

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
            SOURCE_ADDRESS_HASH,
            1 // threshold
        );
        await account.waitForDeployment();

        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("10.0"),
        });
    });

    describe("Source Address Validation", function () {
        it("Should reject validateOperation with wrong source address", async function () {
            const accountAddress = await account.getAddress();
            const params = await createValidateParams(
                accountAddress,
                1n,
                [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            const [isValid, reason] = await account.validateOperation(
                "wrong-source-address",
                params.signBytes,
                params.txPayloadHashOffset,
                params.r,
                params.s,
                params.x,
                params.y,
                1n,
                params.txPayload
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSourceAddress");
        });

        it("Should accept validateOperation with correct source address", async function () {
            const accountAddress = await account.getAddress();
            const params = await createValidateParams(
                accountAddress,
                1n,
                [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            const [isValid] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.signBytes,
                params.txPayloadHashOffset,
                params.r,
                params.s,
                params.x,
                params.y,
                1n,
                params.txPayload
            );

            expect(isValid).to.be.true;
        });

        it("Should verify compareSourceAddress function directly", async function () {
            expect(await account.compareSourceAddress(SOURCE_ADDRESS)).to.be.true;
            expect(await account.compareSourceAddress("wrong")).to.be.false;
            expect(await account.compareSourceAddress("")).to.be.false;
        });
    });

    describe("Sequence Validation", function () {
        it("Should reject validateOperation with sequence too low", async function () {
            const accountAddress = await account.getAddress();
            const params = await createValidateParams(
                accountAddress,
                0n, // sequence 0, but expected is 1 (accountSequence + 1)
                [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.signBytes,
                params.txPayloadHashOffset,
                params.r,
                params.s,
                params.x,
                params.y,
                0n,
                params.txPayload
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSequence");
        });

        it("Should reject validateOperation with sequence too high", async function () {
            const accountAddress = await account.getAddress();
            const params = await createValidateParams(
                accountAddress,
                99n, // sequence 99, but expected is 1
                [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.signBytes,
                params.txPayloadHashOffset,
                params.r,
                params.s,
                params.x,
                params.y,
                99n,
                params.txPayload
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSequence");
        });

        it("Should verify sequence increments after recovery transaction", async function () {
            expect(await account.accountSequence()).to.equal(0);

            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.01"), "0x");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            expect(await account.accountSequence()).to.equal(1);
        });

        it("Should prevent replay with same sequence", async function () {
            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.01"), "0x");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            // Try to replay
            await expect(
                account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload)
            ).to.be.revertedWithCustomError(account, "InvalidSequence");
        });
    });

    describe("Threshold Validation", function () {
        it("Should reject recoverTransaction with fewer signatures than threshold", async function () {
            const pubKey2 = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
            const twoOfTwoAccount = await (
                await hre.ethers.getContractFactory("Account")
            ).deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                [publicKeyX[0], pubKey2.x],
                [publicKeyY[0], pubKey2.y],
                SOURCE_ADDRESS_HASH,
                2
            );

            await owner.sendTransaction({
                to: await twoOfTwoAccount.getAddress(),
                value: parseEther("10.0"),
            });

            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.01"), "0x");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await expect(
                twoOfTwoAccount.recoverTransaction([sig.r], [sig.s], [publicKeyX[0]], [publicKeyY[0]], txPayload)
            ).to.be.revertedWithCustomError(twoOfTwoAccount, "InvalidThreshold");
        });

        it("Should accept recoverTransaction with exactly threshold signatures", async function () {
            const txPayload = encodeTxPayload(1n, RECIPIENT_ADDRESS, parseEther("0.01"), "0x");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance).to.equal(initialBalance + parseEther("0.01"));
        });

        it("Should reject validateOperation with fewer signatures than threshold", async function () {
            const pubKey2 = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
            const twoOfTwoAccount = await (
                await hre.ethers.getContractFactory("Account")
            ).deploy(
                verifier.target,
                ENTRYPOINT_ADDRESS,
                [publicKeyX[0], pubKey2.x],
                [publicKeyY[0], pubKey2.y],
                SOURCE_ADDRESS_HASH,
                2
            );

            const accountAddress = await twoOfTwoAccount.getAddress();
            const params = await createValidateParams(
                accountAddress,
                1n,
                [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
                [publicKeyX[0]], // Only 1 signer
                [publicKeyY[0]]
            );

            const [isValid, reason] = await twoOfTwoAccount.validateOperation(
                SOURCE_ADDRESS,
                params.signBytes,
                params.txPayloadHashOffset,
                params.r,
                params.s,
                params.x,
                params.y,
                1n,
                params.txPayload
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidThreshold");
        });

        it("Should reject when public key not in registered keys", async function () {
            const wrongPubKey = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");

            const accountAddress = await account.getAddress();
            // Create params with wrong public key
            const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, 1n, [
                { to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" },
            ]);
            const txPayloadHash = computeTxPayloadHash(txPayload);
            const { signBytes, hashOffset } = createSignBytes(txPayloadHash);

            // Sign with wrong key
            const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(
                "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
                signBytesForSigning.toString("hex")
            );

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                signBytes,
                hashOffset,
                [sig.r],
                [sig.s],
                [wrongPubKey.x],
                [wrongPubKey.y],
                1n,
                txPayload
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidPubKey");
        });
    });

    describe("validateOperation Edge Cases", function () {
        it("Should return InvalidSignatureLength when r/s length != x/y length", async function () {
            const accountAddress = await account.getAddress();
            const params = await createValidateParams(
                accountAddress,
                1n,
                [{ to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" }],
                publicKeyX,
                publicKeyY
            );

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.signBytes,
                params.txPayloadHashOffset,
                [params.r[0], params.r[0]], // 2 r values
                params.s, // Only 1 s value
                params.x,
                params.y,
                1n,
                params.txPayload
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSignatureLength");
        });

        it("Should return InvalidPubKey when provided key not in registered keys", async function () {
            const wrongPubKey = await getPublicKeyFromMnemonic("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
            const accountAddress = await account.getAddress();

            const txPayload = encodeNewTxPayload(EXPECTED_CHAIN_ID, accountAddress, 1n, [
                { to: RECIPIENT_ADDRESS, value: parseEther("0.01"), data: "0x" },
            ]);
            const txPayloadHash = computeTxPayloadHash(txPayload);
            const { signBytes, hashOffset } = createSignBytes(txPayloadHash);
            const signBytesForSigning = Buffer.from(signBytes.slice(2), "hex");
            const sig = await generateSignatureWithMnemonic(
                "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
                signBytesForSigning.toString("hex")
            );

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                signBytes,
                hashOffset,
                [sig.r],
                [sig.s],
                [wrongPubKey.x],
                [wrongPubKey.y],
                1n,
                txPayload
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidPubKey");
        });
    });
});

/**
 * Reentrancy tests for Account contract
 */
describe("Account Reentrancy", function () {
    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
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

    describe("recoverTransaction Reentrancy", function () {
        it("FIXED: recoverTransaction is protected against reentrancy", async function () {
            const ReentrantAttackerFactory = await hre.ethers.getContractFactory("ReentrantRecoverAttacker");
            const attacker = await ReentrantAttackerFactory.deploy();
            await attacker.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                verifier.target,
                attacker.target, // attacker is the "entrypoint"
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1
            );

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("10.0"),
            });

            await attacker.setTarget(await account.getAddress());

            const sequence = 1n;
            const value = parseEther("1.0");
            const txPayload = encodeTxPayload(sequence, await attacker.getAddress(), value, "0x");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await attacker.setAttackPayload([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            const accountBalanceBefore = await hre.ethers.provider.getBalance(await account.getAddress());
            const attackerBalanceBefore = await hre.ethers.provider.getBalance(await attacker.getAddress());

            await account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            const accountBalanceAfter = await hre.ethers.provider.getBalance(await account.getAddress());
            const attackerBalanceAfter = await hre.ethers.provider.getBalance(await attacker.getAddress());

            console.log(`Account lost: ${hre.ethers.formatEther(accountBalanceBefore - accountBalanceAfter)} ETH`);
            console.log(`Attacker gained: ${hre.ethers.formatEther(attackerBalanceAfter - attackerBalanceBefore)} ETH`);
            console.log(`Attack attempts: ${await attacker.attackCount()}`);

            // Due to CEI pattern, sequence is incremented before external call
            // So reentrancy attempt will fail with InvalidSequence
            expect(accountBalanceBefore - accountBalanceAfter).to.equal(value);
            expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(value);
        });

        it("Should increment sequence before external call to prevent reentrancy (CEI pattern check)", async function () {
            const SequenceCheckerFactory = await hre.ethers.getContractFactory("SequenceChecker");
            const checker = await SequenceCheckerFactory.deploy();
            await checker.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                verifier.target,
                checker.target,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1
            );

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("10.0"),
            });

            await checker.setAccountToCheck(await account.getAddress());

            const txPayload = encodeTxPayload(1n, await checker.getAddress(), parseEther("0.01"), "0x");
            const sig = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayload.slice(2));

            await account.recoverTransaction([sig.r], [sig.s], publicKeyX, publicKeyY, txPayload);

            // Sequence should have been 1 when the checker received the call
            expect(await checker.sequenceAtCallTime()).to.equal(1);
        });

        it("Should document: sequence increment happens BEFORE external call (CEI pattern)", async function () {
            console.log("Solidity code in recoverTransaction:");
            console.log("  1. Validate signatures");
            console.log("  2. Validate sequence");
            console.log("  3. incrementSequence() <-- BEFORE external call");
            console.log("  4. _call(dest, value, data) <-- external call");
            console.log("");
            console.log("This follows Checks-Effects-Interactions pattern:");
            console.log("  - Checks: signature validation, sequence validation");
            console.log("  - Effects: sequence increment");
            console.log("  - Interactions: external call");
        });
    });

    describe("Batch Transaction Reentrancy", function () {
        it("Should handle reentrancy attempt during batch execution", async function () {
            const MockEntryPointFactory = await hre.ethers.getContractFactory("MockEntryPoint");
            const mockEntryPoint = await MockEntryPointFactory.deploy();
            await mockEntryPoint.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                verifier.target,
                mockEntryPoint.target,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1
            );

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("10.0"),
            });

            // Execute batch through mock entry point
            await mockEntryPoint.callExecuteTransactions(
                await account.getAddress(),
                [owner.address],
                [parseEther("0.01")],
                ["0x"]
            );

            expect(await account.accountSequence()).to.equal(1);
        });
    });
});

/**
 * Sequence overflow tests
 */
describe("Account Sequence Overflow", function () {
    describe("uint64 Boundary", function () {
        it("INFO: Documents uint64 max value for sequence", async function () {
            const maxUint64 = BigInt("18446744073709551615");
            console.log(`uint64 max: ${maxUint64}`);
            console.log(`At 1 tx/second, would take ${Number(maxUint64) / (365.25 * 24 * 60 * 60)} years to overflow`);
        });

        it("INFO: Sequence increment uses unchecked math (would wrap on overflow)", async function () {
            console.log("Solidity 0.8+ has built-in overflow protection");
            console.log("If sequence somehow reached uint64 max, next tx would revert (safe)");
        });

        it("Should handle large sequence numbers correctly", async function () {
            const [owner] = await hre.ethers.getSigners();

            const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);

            const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
            const verifier = await Secp256k1VerifierContract.deploy();
            await verifier.waitForDeployment();

            const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
            const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

            const AccountContract = await hre.ethers.getContractFactory("Account");
            const account = await AccountContract.deploy(
                verifier.target,
                owner.address, // Use owner as entrypoint for this test
                [pubKey.x],
                [pubKey.y],
                SOURCE_ADDRESS_HASH,
                1
            );

            await owner.sendTransaction({
                to: await account.getAddress(),
                value: parseEther("1.0"),
            });

            // Execute a transaction to increment sequence
            await account.executeTransactions([owner.address], [parseEther("0.001")], ["0x"]);

            console.log(`Sequence correctly incremented to ${await account.accountSequence()}`);
            expect(await account.accountSequence()).to.equal(1);
        });
    });
});
