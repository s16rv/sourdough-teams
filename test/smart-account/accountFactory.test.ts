import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, keccak256, toBigInt } from "ethers";

import { AccountFactory, Secp256k1Verifier } from "../../typechain-types";

const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

const PUBLIC_KEY_X = "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0";
const PUBLIC_KEY_Y = "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
const SOURCE_ADDRESS2 = "neutron1klzktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

describe("AccountFactory", function () {
    let accountFactory: AccountFactory;
    let verifier: Secp256k1Verifier;
    let recover: HardhatEthersSigner;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(verifier.target);
        await accountFactory.waitForDeployment();
    });

    it("Should compute address consistent", async function () {
        const accountAddr1 = await accountFactory.computeAddress(
            recover.address,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS
        );
        const accountAddr2 = await accountFactory.computeAddress(
            recover.address,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS
        );

        expect(accountAddr1).to.equal(accountAddr2);
    });

    it("Should create account", async function () {
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";

        await accountFactory.createAccount(
            recover.address,
            ENTRYPOINT_ADDRESS,
            messageHash,
            r,
            s,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS
        );

        const addressComputed = await accountFactory.computeAddress(
            recover.address,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS
        );
        const accountAddr = await accountFactory.getAccount(PUBLIC_KEY_X, PUBLIC_KEY_Y, SOURCE_ADDRESS);

        expect(addressComputed).to.equal(accountAddr);
    });

    it("Should create two different accounts", async function () {
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";

        await accountFactory.createAccount(
            recover.address,
            ENTRYPOINT_ADDRESS,
            messageHash,
            r,
            s,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS
        );

        await accountFactory.createAccount(
            recover.address,
            ENTRYPOINT_ADDRESS,
            messageHash,
            r,
            s,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            SOURCE_ADDRESS2
        );

        const accountAddr1 = await accountFactory.getAccount(PUBLIC_KEY_X, PUBLIC_KEY_Y, SOURCE_ADDRESS);
        const accountAddr2 = await accountFactory.getAccount(PUBLIC_KEY_X, PUBLIC_KEY_Y, SOURCE_ADDRESS2);

        expect(accountAddr1).to.not.equal(accountAddr2);
    });
});
