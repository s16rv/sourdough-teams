import hre from "hardhat";
import { expect } from "chai";
import { parseEther } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";

const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";
const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

const PUBLIC_KEY_X = "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0";
const PUBLIC_KEY_Y = "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

describe("Account", function () {
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
            SOURCE_ADDRESS,
            verifier.target,
            recover.address,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
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
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";

        const isValid = await account.validateOperation(SOURCE_ADDRESS, messageHash, r, s);
        expect(isValid).to.be.true;
    });

    it("Should not validate operation", async function () {
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c002";
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";

        const isValid = await account.validateOperation(SOURCE_ADDRESS, messageHash, r, s);
        expect(isValid).to.be.false;
    });

    it("Should execute transaction using recover account", async function () {
        const amountToSend = parseEther("0.001");
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        await expect(account.connect(recover).executeTransaction(RECIPIENT_ADDRESS, amountToSend, "0x"))
            .to.emit(account, "TransactionExecuted")
            .withArgs(RECIPIENT_ADDRESS, amountToSend, "0x");

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
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
