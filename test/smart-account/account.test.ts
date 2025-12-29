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
    const SEQUENCE = 1;
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
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const proof = "0x557072bab6f803255768af1241504525bf58ade4438b23fd0f52909fa748e1f9";
        const data =
            "0x000000000000000000000000aa25aa7a19f9c426e07dee59b12f944f4d9f1dd3000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";

        const [isValid] = await account.validateOperation(
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
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const proof = "0x557072bab6f803255768af1241504525bf58ade4438b23fd0f52909fa748e1f9";
        const data = "0x000000000000000000000000";

        const [isValid, msg] = await account.validateOperation(
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
        expect(msg).to.equal("InvalidProof");
    });

    it("Should not validate operation, invalid signature", async function () {
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = ["0x2d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd"];
        const s = ["0x8e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c"];
        const proof = "0x557072bab6f803255768af1241504525bf58ade4438b23fd0f52909fa748e1f9";
        const data =
            "0x000000000000000000000000aa25aa7a19f9c426e07dee59b12f944f4d9f1dd3000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";

        const [isValid, msg] = await account.validateOperation(
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
    const SEQUENCE = 1;
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
        const messageHash = "0x87a9afdf384bb934b0b7b383cab20a2f472d0e64bd0603f2072066be6796faf0";
        const r = [
            "0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd",
            "0x1d59ffe13a4c317e0346d6791f29ada0ff012451649e1c5670348d04a65c8afd",
        ];
        const s = [
            "0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c",
            "0x7e6c637f57928d095dcc052a22da0c09b4c87614e91e21ff428840e93b90b13c",
        ];
        const proof = "0x557072bab6f803255768af1241504525bf58ade4438b23fd0f52909fa748e1f9";
        const data =
            "0x000000000000000000000000aa25aa7a19f9c426e07dee59b12f944f4d9f1dd3000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";
        const [isValid] = await account.validateOperation(
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
