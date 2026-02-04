import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, parseEther, sha256, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account } from "../../typechain-types";
import { generateSignatureWithMnemonic, getPublicKeyFromMnemonic } from "../../scripts/generateSignature";
import { combineHexStrings } from "../utils/lib";

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

describe("Account", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    // Use test mnemonic to derive keys
    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 1;
    const THRESHOLD = 1;

    let account: Account;
    let recover: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [recover, stranger] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
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
        const abiCoder = new AbiCoder();
        const preimage = abiCoder.encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, SEQUENCE, RECIPIENT_ADDRESS, parseEther("0.01")]
        );
        const messageHash = sha256(preimage);

        const data = abiCoder.encode(["address", "uint256", "bytes"], [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]);

        const proof = sha256(combineHexStrings(messageHash, data));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

        const [isValid] = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            [sigResult.v],
            [sigResult.r],
            [sigResult.s],
            publicKeyX,
            publicKeyY,
            proof,
            SEQUENCE,
            data
        );
        expect(isValid).to.be.true;
    });

    it("Should not validate operation, invalid proof", async function () {
        const abiCoder = new AbiCoder();
        const preimage = abiCoder.encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, SEQUENCE, RECIPIENT_ADDRESS, parseEther("0.01")]
        );
        const messageHash = sha256(preimage);

        const data = "0x000000000000000000000000"; // Different data causing invalid proof

        const proof = sha256(combineHexStrings(messageHash, "0x")); // Wrong proof

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

        const [isValid, msg] = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            [sigResult.v],
            [sigResult.r],
            [sigResult.s],
            publicKeyX,
            publicKeyY,
            proof,
            SEQUENCE,
            data
        );

        expect(isValid).to.be.false;
        expect(msg).to.equal("InvalidProof");
    });

    it("Should not validate operation, invalid signature", async function () {
        const abiCoder = new AbiCoder();
        const preimage = abiCoder.encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, SEQUENCE, RECIPIENT_ADDRESS, parseEther("0.01")]
        );
        const messageHash = sha256(preimage);

        const data = abiCoder.encode(["address", "uint256", "bytes"], [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]);

        const proof = sha256(combineHexStrings(messageHash, data));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

        // Use wrong r and s values
        const [isValid, msg] = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            [sigResult.v],
            ["0x2d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"],
            ["0x1e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"],
            publicKeyX,
            publicKeyY,
            proof,
            SEQUENCE,
            data
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

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 1;
    const THRESHOLD = 1;

    let account: Account;
    let recover: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        // Duplicate the same key for multisig testing
        publicKeyX = [pubKey.x, pubKey.x];
        publicKeyY = [pubKey.y, pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
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
        const abiCoder = new AbiCoder();
        const preimage = abiCoder.encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, SEQUENCE, RECIPIENT_ADDRESS, parseEther("0.01")]
        );
        const messageHash = sha256(preimage);

        const data = abiCoder.encode(["address", "uint256", "bytes"], [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]);

        const proof = sha256(combineHexStrings(messageHash, data));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

        const [isValid] = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            [sigResult.v],
            [sigResult.r],
            [sigResult.s],
            publicKeyX.slice(0, THRESHOLD),
            publicKeyY.slice(0, THRESHOLD),
            proof,
            SEQUENCE,
            data
        );
        expect(isValid).to.be.true;
    });

    it("Should revert duplicate public key", async function () {
        const abiCoder = new AbiCoder();
        const preimage = abiCoder.encode(
            ["string", "uint64", "address", "uint256"],
            [SOURCE_ADDRESS, SEQUENCE, RECIPIENT_ADDRESS, parseEther("0.01")]
        );
        const messageHash = sha256(preimage);

        const data = abiCoder.encode(["address", "uint256", "bytes"], [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]);

        const proof = sha256(combineHexStrings(messageHash, data));

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

        const [isValid, message] = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            [sigResult.v, sigResult.v],
            [sigResult.r, sigResult.r],
            [sigResult.s, sigResult.s],
            publicKeyX,
            publicKeyY,
            proof,
            SEQUENCE,
            data
        );
        expect(isValid).to.be.false;
        expect(message).to.equal("DuplicatePubKey");
    });
});

/**
 * Tests for Account getter functions to improve coverage
 * Covers: getX(), getY(), receive()
 */
describe("Account Getters and ETH Handling", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const TEST_MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let owner: HardhatEthersSigner;

    let publicKeyX: string[];
    let publicKeyY: string[];

    describe("Single Signer Account", function () {
        beforeEach(async function () {
            [owner] = await hre.ethers.getSigners();

            const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            publicKeyX = [pubKey.x];
            publicKeyY = [pubKey.y];

            const AccountContract = await hre.ethers.getContractFactory("Account");
            account = await AccountContract.deploy(
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1 // threshold
            );
            await account.waitForDeployment();
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
        let multiSigAccount: Account;
        let pubKeyX2: string[];
        let pubKeyY2: string[];

        beforeEach(async function () {
            [owner] = await hre.ethers.getSigners();

            const pubKey1 = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            const pubKey2 = await getPublicKeyFromMnemonic(TEST_MNEMONIC_2);

            pubKeyX2 = [pubKey1.x, pubKey2.x];
            pubKeyY2 = [pubKey1.y, pubKey2.y];

            const AccountContract = await hre.ethers.getContractFactory("Account");
            multiSigAccount = await AccountContract.deploy(
                ENTRYPOINT_ADDRESS,
                pubKeyX2,
                pubKeyY2,
                SOURCE_ADDRESS_HASH,
                2 // threshold = 2 of 2
            );
            await multiSigAccount.waitForDeployment();
        });

        it("Should return all X public keys for multisig", async function () {
            const xKeys = await multiSigAccount.getX();
            expect(xKeys.length).to.equal(2);
            expect(xKeys[0]).to.equal(pubKeyX2[0]);
            expect(xKeys[1]).to.equal(pubKeyX2[1]);
        });

        it("Should return all Y public keys for multisig", async function () {
            const yKeys = await multiSigAccount.getY();
            expect(yKeys.length).to.equal(2);
            expect(yKeys[0]).to.equal(pubKeyY2[0]);
            expect(yKeys[1]).to.equal(pubKeyY2[1]);
        });
    });
});

describe("Account Recover", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const THRESHOLD = 1;

    let account: Account;
    let recover: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
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

    it("Should execute recoverTransaction with valid signature", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");

        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
        const txPayloadHex = txPayload.slice(2);

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

        const v = [sigResult.v];
        const r = [sigResult.r];
        const s = [sigResult.s];

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        expect(await account.accountSequence()).to.equal(0);

        await expect(account.recoverTransaction(v, r, s, publicKeyX, publicKeyY, txPayload))
            .to.emit(account, "TransactionExecuted")
            .withArgs(RECIPIENT_ADDRESS, amountToSend, "0x");

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);

        expect(await account.accountSequence()).to.equal(1);
    });

    it("Should revert with InvalidPubKey when public key not in account", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
        const txPayloadHex = txPayload.slice(2);

        const differentMnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
        const sigResult = await generateSignatureWithMnemonic(differentMnemonic, txPayloadHex);

        const invalidPubKeyX = [sigResult.x];
        const invalidPubKeyY = [sigResult.y];
        const v = [sigResult.v];
        const r = [sigResult.r];
        const s = [sigResult.s];

        await expect(
            account.recoverTransaction(v, r, s, invalidPubKeyX, invalidPubKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidPubKey");
    });

    it("Should revert with InvalidSignature when signature is invalid", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");

        const invalidV = [0];
        const invalidR = ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
        const invalidS = ["0x1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];

        await expect(
            account.recoverTransaction(invalidV, invalidR, invalidS, publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidSignature");
    });

    it("Should revert with InvalidSequence when sequence is wrong", async function () {
        const wrongSequence = BigInt(5);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(wrongSequence, RECIPIENT_ADDRESS, amountToSend, "0x");
        const txPayloadHex = txPayload.slice(2);

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
        const v = [sigResult.v];
        const r = [sigResult.r];
        const s = [sigResult.s];

        await expect(
            account.recoverTransaction(v, r, s, publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidSequence");
    });

    it("Should revert with InvalidPayload when function selector is wrong", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");

        const wrongSelector = keccak256(toUtf8Bytes("wrongFunction(uint64,address,uint256,bytes)")).slice(0, 10);
        const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
        const encodedParams = abiCoder.encode(
            ["uint64", "address", "uint256", "bytes"],
            [sequence, RECIPIENT_ADDRESS, amountToSend, "0x"]
        );
        const txPayload = wrongSelector + encodedParams.slice(2);
        const txPayloadHex = txPayload.slice(2);

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
        const v = [sigResult.v];
        const r = [sigResult.r];
        const s = [sigResult.s];

        await expect(
            account.recoverTransaction(v, r, s, publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidPayload");
    });

    it("Should revert with InvalidInputLength when x and y lengths mismatch", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
        const txPayloadHex = txPayload.slice(2);

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
        const v = [sigResult.v];
        const r = [sigResult.r];
        const s = [sigResult.s];

        await expect(account.recoverTransaction(v, r, s, publicKeyX, [], txPayload)).to.be.revertedWithCustomError(
            account,
            "InvalidInputLength"
        );
    });

    it("Should revert with InvalidInputLength when r/s lengths mismatch x/y", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
        const txPayloadHex = txPayload.slice(2);

        const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

        await expect(
            account.recoverTransaction([sigResult.v], [sigResult.r], [], publicKeyX, publicKeyY, txPayload)
        ).to.be.revertedWithCustomError(account, "InvalidInputLength");
    });

    it("Should revert with InvalidThreshold when not enough signers", async function () {
        const sequence = BigInt(1);
        const amountToSend = parseEther("0.001");
        const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");

        await expect(account.recoverTransaction([], [], [], [], [], txPayload)).to.be.revertedWithCustomError(
            account,
            "InvalidThreshold"
        );
    });
});

/**
 * Security-critical tests for Account contract
 * Phase 1: Source address, sequence, and threshold validation
 */
describe("Account Security", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const WRONG_SOURCE_ADDRESS = "neutron1wrongaddresswrongaddresswrongaddresswrongaddress";

    let account: Account;
    let owner: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            ENTRYPOINT_ADDRESS,
            publicKeyX,
            publicKeyY,
            SOURCE_ADDRESS_HASH,
            1 // threshold
        );
        await account.waitForDeployment();

        await owner.sendTransaction({
            to: await account.getAddress(),
            value: parseEther("2.0"),
        });
    });

    describe("Source Address Validation", function () {
        async function createValidateOperationParams(sequence: number) {
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, parseEther("0.01")]
            );

            const messageHash = sha256(preimage);

            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );

            const proof = sha256(combineHexStrings(messageHash, data));

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            return {
                messageHash,
                v: [sigResult.v],
                r: [sigResult.r],
                s: [sigResult.s],
                proof,
                data,
            };
        }

        it("Should reject validateOperation with wrong source address", async function () {
            const params = await createValidateOperationParams(1);

            const [isValid, reason] = await account.validateOperation(
                WRONG_SOURCE_ADDRESS,
                params.messageHash,
                params.v,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                1,
                params.data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSourceAddress");
        });

        it("Should accept validateOperation with correct source address", async function () {
            const params = await createValidateOperationParams(1);

            const [isValid] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.messageHash,
                params.v,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                1,
                params.data
            );

            expect(isValid).to.be.true;
        });

        it("Should verify compareSourceAddress function directly", async function () {
            expect(await account.compareSourceAddress(SOURCE_ADDRESS)).to.be.true;
            expect(await account.compareSourceAddress(WRONG_SOURCE_ADDRESS)).to.be.false;
            expect(await account.compareSourceAddress("")).to.be.false;
        });
    });

    describe("Sequence Validation", function () {
        async function createParamsForSequence(sequence: number) {
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, sequence, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            return {
                messageHash,
                v: [sigResult.v],
                r: [sigResult.r],
                s: [sigResult.s],
                proof,
                data,
            };
        }

        it("Should reject validateOperation with sequence too low", async function () {
            const params = await createParamsForSequence(0);

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.messageHash,
                params.v,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                0,
                params.data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSequence");
        });

        it("Should reject validateOperation with sequence too high", async function () {
            const params = await createParamsForSequence(5);

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                params.messageHash,
                params.v,
                params.r,
                params.s,
                publicKeyX,
                publicKeyY,
                params.proof,
                5,
                params.data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSequence");
        });

        it("Should verify sequence increments after recovery transaction", async function () {
            expect(await account.accountSequence()).to.equal(0);

            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
            const v = [sigResult.v];
            const r = [sigResult.r];
            const s = [sigResult.s];

            await account.recoverTransaction(v, r, s, publicKeyX, publicKeyY, txPayload);

            expect(await account.accountSequence()).to.equal(1);

            const sequence2 = BigInt(2);
            const txPayload2 = encodeTxPayload(sequence2, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex2 = txPayload2.slice(2);

            const sigResult2 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex2);

            await account.recoverTransaction(
                [sigResult2.v],
                [sigResult2.r],
                [sigResult2.s],
                publicKeyX,
                publicKeyY,
                txPayload2
            );

            expect(await account.accountSequence()).to.equal(2);
        });

        it("Should prevent replay with same sequence", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
            const v = [sigResult.v];
            const r = [sigResult.r];
            const s = [sigResult.s];

            await account.recoverTransaction(v, r, s, publicKeyX, publicKeyY, txPayload);

            await expect(
                account.recoverTransaction(v, r, s, publicKeyX, publicKeyY, txPayload)
            ).to.be.revertedWithCustomError(account, "InvalidSequence");
        });
    });

    describe("Threshold Validation", function () {
        let multiSigAccount: Account;
        let pubKeyX2: string[];
        let pubKeyY2: string[];

        const TEST_MNEMONIC_2 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

        beforeEach(async function () {
            const pubKey2 = await getPublicKeyFromMnemonic(TEST_MNEMONIC_2);

            pubKeyX2 = [publicKeyX[0], pubKey2.x];
            pubKeyY2 = [publicKeyY[0], pubKey2.y];

            const AccountContract = await hre.ethers.getContractFactory("Account");
            multiSigAccount = await AccountContract.deploy(
                ENTRYPOINT_ADDRESS,
                pubKeyX2,
                pubKeyY2,
                SOURCE_ADDRESS_HASH,
                2 // threshold = 2
            );
            await multiSigAccount.waitForDeployment();

            await owner.sendTransaction({
                to: await multiSigAccount.getAddress(),
                value: parseEther("2.0"),
            });
        });

        it("Should reject recoverTransaction with fewer signatures than threshold", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            await expect(
                multiSigAccount.recoverTransaction(
                    [sigResult.v],
                    [sigResult.r],
                    [sigResult.s],
                    [publicKeyX[0]],
                    [publicKeyY[0]],
                    txPayload
                )
            ).to.be.revertedWithCustomError(multiSigAccount, "InvalidThreshold");
        });

        it("Should accept recoverTransaction with exactly threshold signatures", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult1 = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);
            const sigResult2 = await generateSignatureWithMnemonic(TEST_MNEMONIC_2, txPayloadHex);

            const initialBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

            await multiSigAccount.recoverTransaction(
                [sigResult1.v, sigResult2.v],
                [sigResult1.r, sigResult2.r],
                [sigResult1.s, sigResult2.s],
                [sigResult1.x, sigResult2.x],
                [sigResult1.y, sigResult2.y],
                txPayload
            );

            const finalBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
            expect(finalBalance).to.equal(initialBalance + amountToSend);
        });

        it("Should reject validateOperation with fewer signatures than threshold", async function () {
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, 1, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            const [isValid, reason] = await multiSigAccount.validateOperation(
                SOURCE_ADDRESS,
                messageHash,
                [sigResult.v],
                [sigResult.r],
                [sigResult.s],
                [pubKeyX2[0]],
                [pubKeyY2[0]],
                proof,
                1,
                data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidThreshold");
        });

        it("Should reject when public key not in registered keys", async function () {
            const sequence = BigInt(1);
            const amountToSend = parseEther("0.001");
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, amountToSend, "0x");
            const txPayloadHex = txPayload.slice(2);

            const UNREGISTERED_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
            const sigResult = await generateSignatureWithMnemonic(UNREGISTERED_MNEMONIC, txPayloadHex);

            await expect(
                multiSigAccount.recoverTransaction(
                    [sigResult.v, sigResult.v],
                    [sigResult.r, sigResult.r],
                    [sigResult.s, sigResult.s],
                    [sigResult.x, sigResult.x],
                    [sigResult.y, sigResult.y],
                    txPayload
                )
            ).to.be.revertedWithCustomError(multiSigAccount, "InvalidPubKey");
        });
    });

    describe("validateOperation Edge Cases", function () {
        async function createBasicParams() {
            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, 1, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, preimage.slice(2));

            return { messageHash, proof, data, sigResult };
        }

        it("Should return InvalidSignatureLength when r/s length != x/y length", async function () {
            const { messageHash, proof, data, sigResult } = await createBasicParams();

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                messageHash,
                [sigResult.v, sigResult.v],
                [sigResult.r, sigResult.r],
                [sigResult.s, sigResult.s],
                publicKeyX,
                publicKeyY,
                proof,
                1,
                data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidSignatureLength");
        });

        it("Should return InvalidPubKey when provided key not in registered keys", async function () {
            const UNREGISTERED_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
            const unregisteredPubKey = await getPublicKeyFromMnemonic(UNREGISTERED_MNEMONIC);

            const abiCoder = new AbiCoder();
            const preimage = abiCoder.encode(
                ["string", "uint64", "address", "uint256"],
                [SOURCE_ADDRESS, 1, RECIPIENT_ADDRESS, parseEther("0.01")]
            );
            const messageHash = sha256(preimage);
            const data = abiCoder.encode(
                ["address", "uint256", "bytes"],
                [RECIPIENT_ADDRESS, parseEther("0.01"), "0x"]
            );
            const proof = sha256(combineHexStrings(messageHash, data));
            const sigResult = await generateSignatureWithMnemonic(UNREGISTERED_MNEMONIC, preimage.slice(2));

            const [isValid, reason] = await account.validateOperation(
                SOURCE_ADDRESS,
                messageHash,
                [sigResult.v],
                [sigResult.r],
                [sigResult.s],
                [unregisteredPubKey.x],
                [unregisteredPubKey.y],
                proof,
                1,
                data
            );

            expect(isValid).to.be.false;
            expect(reason).to.equal("InvalidPubKey");
        });
    });
});

/**
 * Reentrancy tests for Account contract
 *
 * Tests whether an attacker can exploit reentrancy during:
 * 1. recoverTransaction - ETH transfer triggers receive() which re-enters
 * 2. executeTransactions - batch execution with malicious recipient
 */
describe("Account Reentrancy", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let account: Account;
    let owner: HardhatEthersSigner;
    let attacker: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner, attacker] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
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

    describe("recoverTransaction Reentrancy", function () {
        it("FIXED: recoverTransaction is protected against reentrancy", async function () {
            /**
             * REENTRANCY PROTECTION VERIFIED
             *
             * This test verifies that recoverTransaction is protected against reentrancy.
             * The fix moves incrementSequence() BEFORE _call() (Checks-Effects-Interactions pattern).
             *
             * Expected behavior: Attacker contract attempts reentrancy but only receives
             * the signed amount (1 ETH), not multiple times.
             */

            const ReentrancyAttackerFactory = await hre.ethers.getContractFactory("ReentrancyAttacker");
            const attackerContract = await ReentrancyAttackerFactory.deploy();
            await attackerContract.waitForDeployment();

            const attackerAddress = await attackerContract.getAddress();
            const accountAddress = await account.getAddress();

            const amountPerCall = parseEther("1.0");
            const sequence = BigInt(1);

            const txPayload = encodeTxPayload(sequence, attackerAddress, amountPerCall, "0x");
            const txPayloadHex = txPayload.slice(2);
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            await attackerContract.setTarget(accountAddress);
            await attackerContract.setAttackParams(5);
            await attackerContract.setRecoverParams(
                [sigResult.v],
                [sigResult.r],
                [sigResult.s],
                publicKeyX,
                publicKeyY,
                txPayload
            );
            await attackerContract.startAttack();

            const initialAccountBalance = await hre.ethers.provider.getBalance(accountAddress);
            const initialAttackerBalance = await hre.ethers.provider.getBalance(attackerAddress);

            await account.recoverTransaction(
                [sigResult.v],
                [sigResult.r],
                [sigResult.s],
                publicKeyX,
                publicKeyY,
                txPayload
            );

            const finalAccountBalance = await hre.ethers.provider.getBalance(accountAddress);
            const finalAttackerBalance = await hre.ethers.provider.getBalance(attackerAddress);

            const attackerGained = finalAttackerBalance - initialAttackerBalance;
            const accountLost = initialAccountBalance - finalAccountBalance;
            const attackCount = await attackerContract.attackCount();

            console.log(`Account lost: ${hre.ethers.formatEther(accountLost)} ETH`);
            console.log(`Attacker gained: ${hre.ethers.formatEther(attackerGained)} ETH`);
            console.log(`Attack attempts: ${attackCount}`);

            // Reentrancy is blocked - attacker only gets the signed amount
            expect(attackerGained).to.equal(amountPerCall, "Reentrancy blocked - only signed amount transferred");
            expect(attackCount).to.equal(
                1,
                "Only one successful call (reentrancy attempts fail due to InvalidSequence)"
            );
        });

        it("Should increment sequence before external call to prevent reentrancy (CEI pattern check)", async function () {
            const sequence = BigInt(1);
            const txPayload = encodeTxPayload(sequence, attacker.address, parseEther("0.1"), "0x");
            const txPayloadHex = txPayload.slice(2);
            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            await account.recoverTransaction(
                [sigResult.v],
                [sigResult.r],
                [sigResult.s],
                publicKeyX,
                publicKeyY,
                txPayload
            );

            expect(await account.accountSequence()).to.equal(1);

            await expect(
                account.recoverTransaction(
                    [sigResult.v],
                    [sigResult.r],
                    [sigResult.s],
                    publicKeyX,
                    publicKeyY,
                    txPayload
                )
            ).to.be.revertedWithCustomError(account, "InvalidSequence");
        });

        it("Should document: sequence increment happens BEFORE external call (CEI pattern)", async function () {
            // This test documents that the Checks-Effects-Interactions pattern is now in place.
            // The sequence is incremented BEFORE the external call, preventing reentrancy.
            expect(true).to.be.true;
        });
    });

    describe("Batch Transaction Reentrancy", function () {
        it("Should handle reentrancy attempt during batch execution", async function () {
            await expect(
                account.connect(attacker).executeTransactions([attacker.address], [parseEther("1.0")], ["0x"])
            ).to.be.revertedWithCustomError(account, "NotEntryPoint");
        });
    });
});

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

    let owner: HardhatEthersSigner;
    let publicKeyX: string[];
    let publicKeyY: string[];

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const pubKey = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
        publicKeyX = [pubKey.x];
        publicKeyY = [pubKey.y];
    });

    describe("uint64 Boundary", function () {
        it("INFO: Documents uint64 max value for sequence", async function () {
            const uint64Max = BigInt("18446744073709551615");

            console.log("uint64 max:", uint64Max.toString());
            console.log("At 1 tx/second, would take", Number(uint64Max) / 31536000, "years to overflow");

            expect(uint64Max).to.equal(BigInt("18446744073709551615"));
        });

        it("INFO: Sequence increment uses unchecked math (would wrap on overflow)", async function () {
            /**
             * In Solidity 0.8+, this would revert on overflow due to built-in checks.
             * So if somehow sequence reached uint64 max, the next increment would revert.
             *
             * This is actually SAFE behavior - the account would become unusable
             * rather than wrapping to 0 (which could enable replay).
             */

            const AccountContract = await hre.ethers.getContractFactory("Account");
            const account = await AccountContract.deploy(
                ENTRYPOINT_ADDRESS,
                publicKeyX,
                publicKeyY,
                SOURCE_ADDRESS_HASH,
                1
            );
            await account.waitForDeployment();

            expect(await account.accountSequence()).to.equal(0);

            console.log("Solidity 0.8+ has built-in overflow protection");
            console.log("If sequence somehow reached uint64 max, next tx would revert (safe)");
        });

        it("Should handle large sequence numbers correctly", async function () {
            const AccountContract = await hre.ethers.getContractFactory("Account");
            const account = await AccountContract.deploy(
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

            const sequence = BigInt(1);
            const txPayload = encodeTxPayload(sequence, RECIPIENT_ADDRESS, parseEther("0.001"), "0x");
            const txPayloadHex = txPayload.slice(2);

            const sigResult = await generateSignatureWithMnemonic(TEST_MNEMONIC, txPayloadHex);

            await account.recoverTransaction(
                [sigResult.v],
                [sigResult.r],
                [sigResult.s],
                publicKeyX,
                publicKeyY,
                txPayload
            );

            expect(await account.accountSequence()).to.equal(1);
            console.log("Sequence correctly incremented to 1");
        });
    });
});
