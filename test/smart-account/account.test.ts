import hre from "hardhat";
import { expect } from "chai";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";

describe("Account", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const PUBLIC_KEY_X = ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"];
    const PUBLIC_KEY_Y = ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"];

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 0;
    const THRESHOLD = 1;

    let account: Account;
    let verifier: Secp256k1Verifier;
    let recover: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;

    beforeEach(async function () {
        [recover, stranger] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            recover.address,
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
        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = ["0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61"];
        const s = ["0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b"];
        const proof = "0x878ca931506cebeb0388fc31f82f2ed5daefa3b18576fe9536a46795cdb384a1";
        const data =
            "0x000000000000000000000000aa25aa7a19f9c426e07dee59b12f944f4d9f1dd3000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";

        const isValid = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            r,
            s,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            proof,
            SEQUENCE,
            data
        );
        expect(isValid).to.be.true;
    });

    it("Should not validate operation, invalid proof", async function () {
        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = ["0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61"];
        const s = ["0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b"];
        const proof = "0x878ca931506cebeb0388fc31f82f2ed5daefa3b18576fe9536a46795cdb384a1";
        const data = "0x000000000000000000000000";

        await expect(
            account.validateOperation(
                SOURCE_ADDRESS,
                messageHash,
                r,
                s,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                proof,
                SEQUENCE,
                data
            )
        ).to.be.revertedWithCustomError(account, "InvalidProof");
    });

    it("Should not validate operation, invalid signature", async function () {
        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = ["0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b62"];
        const s = ["0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b"];
        const proof = "0x878ca931506cebeb0388fc31f82f2ed5daefa3b18576fe9536a46795cdb384a1";
        const data =
            "0x000000000000000000000000aa25aa7a19f9c426e07dee59b12f944f4d9f1dd3000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";

        const isValid = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            r,
            s,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            proof,
            SEQUENCE,
            data
        );
        expect(isValid).to.be.false;
    });

    it("Should execute transaction using recover account", async function () {
        const amountToSend = parseEther("0.001");
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        expect(await account.accountSequence()).to.equal(0);

        await expect(account.connect(recover).executeTransaction(RECIPIENT_ADDRESS, amountToSend, "0x"))
            .to.emit(account, "TransactionExecuted")
            .withArgs(RECIPIENT_ADDRESS, amountToSend, "0x");

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);

        expect(await account.accountSequence()).to.equal(1);
    });

    it("Should not execute transaction using stranger account", async function () {
        const amountToSend = parseEther("0.001");
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        await expect(
            account.connect(stranger).executeTransaction(RECIPIENT_ADDRESS, amountToSend, "0x")
        ).to.be.revertedWithCustomError(account, "NotEntryPointOrRecover");

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance);
    });
});

describe("Account Multisig", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
    const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

    const PUBLIC_KEY_X = [
        "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
        "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
    ];
    const PUBLIC_KEY_Y = [
        "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
        "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
    ];

    const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
    const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
    const SEQUENCE = 0;
    const THRESHOLD = 1;

    let account: Account;
    let verifier: Secp256k1Verifier;
    let recover: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;

    beforeEach(async function () {
        [recover, stranger] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = await AccountContract.deploy(
            verifier.target,
            recover.address,
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
        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = [
            "0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61",
            "0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61",
        ];
        const s = [
            "0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b",
            "0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b",
        ];
        const proof = "0x878ca931506cebeb0388fc31f82f2ed5daefa3b18576fe9536a46795cdb384a1";
        const data =
            "0x000000000000000000000000aa25aa7a19f9c426e07dee59b12f944f4d9f1dd3000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";

        const isValid = await account.validateOperation(
            SOURCE_ADDRESS,
            messageHash,
            r,
            s,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            proof,
            SEQUENCE,
            data
        );
        expect(isValid).to.be.true;
    });
});
