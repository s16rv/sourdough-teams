import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encodeBytes32String, AbiCoder, parseEther, sha256, toUtf8Bytes, keccak256 } from "ethers";

import { Account, EntryPoint } from "../../typechain-types";
import { combineHexStrings } from "../utils/lib";

describe("EntryPointMultisig 2 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 2;
    const PUBLIC_KEY_X = [
        "0x136ea3f63279bc540c8fed8f11f08427d55736aaf2ce2859fd2348282035c17f",
        "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
    ];
    const PUBLIC_KEY_Y = [
        "0x6578e8e0a5f7bd39687d1d46205bb25afeef52bc261249e7637cb65f55e817c4",
        "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
    ];
    const THRESHOLD = 2;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const MockGatewayContract = await hre.ethers.getContractFactory("MockGateway");
        const mockGateway = await MockGatewayContract.deploy();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(mockGateway.target, accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "address", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                1,
                recover.address,
                totalSigners,
                THRESHOLD,
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
                PUBLIC_KEY_X[1],
                PUBLIC_KEY_Y[1],
            ]
        );

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(PUBLIC_KEY_X, PUBLIC_KEY_Y, SOURCE_ADDRESS_HASH, THRESHOLD);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));
    });

    it("should have recover", async function () {
        expect(await account.recover()).to.equal(recover.address);
    });

    it("should execute transactions from Account contract", async function () {
        const messageHash = "0xc5d5353eb37e8606d9ee377aa5fe19efcb9a11ff6551e0a4c642f9e4a2a2b94b";
        const r = [
            "0xf71104d22f55094dbf973f65c6cff43d18d2aadc87a8de2234635ff0128a75aa",
            "0x543c159b6a4179f7b6b486554ba3bfcd11a9268f76fe7a052c5c31888c630399",
        ];
        const s = [
            "0x2775621757741923cb8921e42b09c393f486439e54860c0852a02fa036c5efeb",
            "0x4094056e2994f0e5b52f2776b01ab91bcc7b2827791a29eb39a1aa93e5e723c7",
        ];
        const numberSigners = 2;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        // Execute transaction from the Account contract
        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const txPayloadAddress = new AbiCoder().encode(["address", "uint256"], [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = combineHexStrings(txPayloadAddress, "0x");

        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const p = new AbiCoder().encode(
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
                "bytes32",
                "bytes32",
                "bytes32",
                "bytes32",
            ],
            [
                2,
                accountAddress,
                messageHash,
                proof,
                0,
                numberSigners,
                r[0],
                s[0],
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
                r[1],
                s[1],
                PUBLIC_KEY_X[1],
                PUBLIC_KEY_Y[1],
            ]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});

describe("EntryPointMultisig 1 of 2", function () {
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const totalSigners = 2;
    const PUBLIC_KEY_X = [
        "0x136ea3f63279bc540c8fed8f11f08427d55736aaf2ce2859fd2348282035c17f",
        "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
    ];
    const PUBLIC_KEY_Y = [
        "0x6578e8e0a5f7bd39687d1d46205bb25afeef52bc261249e7637cb65f55e817c4",
        "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
    ];
    const THRESHOLD = 1;

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const MockGatewayContract = await hre.ethers.getContractFactory("MockGateway");
        const mockGateway = await MockGatewayContract.deploy();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(mockGateway.target, accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "address", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [
                1,
                recover.address,
                totalSigners,
                THRESHOLD,
                PUBLIC_KEY_X[0],
                PUBLIC_KEY_Y[0],
                PUBLIC_KEY_X[1],
                PUBLIC_KEY_Y[1],
            ]
        );

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(PUBLIC_KEY_X, PUBLIC_KEY_Y, SOURCE_ADDRESS_HASH, THRESHOLD);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));
    });

    it("should have recover", async function () {
        expect(await account.recover()).to.equal(recover.address);
    });

    it("should execute transactions from Account contract", async function () {
        const messageHash = "0xc5d5353eb37e8606d9ee377aa5fe19efcb9a11ff6551e0a4c642f9e4a2a2b94b";
        const r = [
            "0xf71104d22f55094dbf973f65c6cff43d18d2aadc87a8de2234635ff0128a75aa",
            "0x543c159b6a4179f7b6b486554ba3bfcd11a9268f76fe7a052c5c31888c630399",
        ];
        const s = [
            "0x2775621757741923cb8921e42b09c393f486439e54860c0852a02fa036c5efeb",
            "0x4094056e2994f0e5b52f2776b01ab91bcc7b2827791a29eb39a1aa93e5e723c7",
        ];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        // Execute transaction from the Account contract
        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const txPayloadAddress = new AbiCoder().encode(["address", "uint256"], [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = combineHexStrings(txPayloadAddress, "0x");

        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [2, accountAddress, messageHash, proof, 0, numberSigners, r[0], s[0], PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0]]
        );
        const payload = combineHexStrings(p, txPayload);
        console.log("payload", payload);

        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });

    it("should execute transactions from Account contract", async function () {
        const messageHash = "0xc5d5353eb37e8606d9ee377aa5fe19efcb9a11ff6551e0a4c642f9e4a2a2b94b";
        const r = [
            "0xf71104d22f55094dbf973f65c6cff43d18d2aadc87a8de2234635ff0128a75aa",
            "0x543c159b6a4179f7b6b486554ba3bfcd11a9268f76fe7a052c5c31888c630399",
        ];
        const s = [
            "0x2775621757741923cb8921e42b09c393f486439e54860c0852a02fa036c5efeb",
            "0x4094056e2994f0e5b52f2776b01ab91bcc7b2827791a29eb39a1aa93e5e723c7",
        ];
        const numberSigners = 1;

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        // Execute transaction from the Account contract
        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const txPayloadAddress = new AbiCoder().encode(["address", "uint256"], [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = combineHexStrings(txPayloadAddress, "0x");

        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [2, accountAddress, messageHash, proof, 0, numberSigners, r[1], s[1], PUBLIC_KEY_X[1], PUBLIC_KEY_Y[1]]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});
