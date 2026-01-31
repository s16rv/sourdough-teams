import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, toUtf8Bytes } from "ethers";

import { AccountFactory, Secp256k1Verifier } from "../../typechain-types";

const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

const PUBLIC_KEY_X = ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"];
const PUBLIC_KEY_Y = ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"];

const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
const SOURCE_ADDRESS2 = "neutron1klzktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

const THRESHOLD = 1;

describe("AccountFactory", function () {
    let accountFactory: AccountFactory;
    let verifier: Secp256k1Verifier;
    let owner: HardhatEthersSigner;

    beforeEach(async function () {
        [owner] = await hre.ethers.getSigners();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(verifier.target);
        await accountFactory.waitForDeployment();
    });

    describe("Address Computation", function () {
        it("Should compute address consistent", async function () {
            const accountAddr1 = await accountFactory.computeAddress(
                ENTRYPOINT_ADDRESS,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD
            );
            const accountAddr2 = await accountFactory.computeAddress(
                ENTRYPOINT_ADDRESS,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD
            );

            expect(accountAddr1).to.equal(accountAddr2);
        });

        it("Should compute same address before and after creation", async function () {
            const preComputedAddr = await accountFactory.computeAddress(
                ENTRYPOINT_ADDRESS,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                1
            );

            await accountFactory.createAccount(ENTRYPOINT_ADDRESS, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS);

            const actualAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

            expect(preComputedAddr).to.equal(actualAddr);
        });
    });

    describe("Account Creation", function () {
        it("Should create account", async function () {
            await accountFactory.createAccount(
                ENTRYPOINT_ADDRESS,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                THRESHOLD,
                SOURCE_ADDRESS
            );

            const addressComputed = await accountFactory.computeAddress(
                ENTRYPOINT_ADDRESS,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD
            );
            const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

            expect(addressComputed).to.equal(accountAddr);
        });

        it("Should create two different accounts", async function () {
            await accountFactory.createAccount(
                ENTRYPOINT_ADDRESS,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                THRESHOLD,
                SOURCE_ADDRESS
            );

            await accountFactory.createAccount(
                ENTRYPOINT_ADDRESS,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                THRESHOLD,
                SOURCE_ADDRESS2
            );

            const accountAddr1 = await accountFactory.getAccount(SOURCE_ADDRESS);
            const accountAddr2 = await accountFactory.getAccount(SOURCE_ADDRESS2);

            expect(accountAddr1).to.not.equal(accountAddr2);
        });
    });

    describe("Duplicate Account Prevention", function () {
        it("Should revert when creating account with same source address twice", async function () {
            // First creation should succeed
            await accountFactory.createAccount(ENTRYPOINT_ADDRESS, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS);

            const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
            expect(accountAddr).to.not.equal(hre.ethers.ZeroAddress);

            // Second creation with same source address should fail
            await expect(
                accountFactory.createAccount(ENTRYPOINT_ADDRESS, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS)
            ).to.be.revertedWithCustomError(accountFactory, "AccountAlreadyExists");
        });

        it("Should allow creating accounts with different source addresses", async function () {
            const SOURCE_ADDRESS_2 = "neutron1differentaddressdifferentaddressdifferent";

            await accountFactory.createAccount(ENTRYPOINT_ADDRESS, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS);

            // Different source address should succeed
            await accountFactory.createAccount(ENTRYPOINT_ADDRESS, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS_2);

            const account1 = await accountFactory.getAccount(SOURCE_ADDRESS);
            const account2 = await accountFactory.getAccount(SOURCE_ADDRESS_2);

            expect(account1).to.not.equal(account2);
            expect(account1).to.not.equal(hre.ethers.ZeroAddress);
            expect(account2).to.not.equal(hre.ethers.ZeroAddress);
        });
    });

    describe("Threshold Validation", function () {
        it("Should revert when threshold is zero", async function () {
            await expect(
                accountFactory.createAccount(
                    ENTRYPOINT_ADDRESS,
                    PUBLIC_KEY_X,
                    PUBLIC_KEY_Y,
                    0, // invalid threshold
                    SOURCE_ADDRESS
                )
            ).to.be.revertedWithCustomError(accountFactory, "InvalidThreshold");
        });

        it("Should revert when threshold exceeds number of signers", async function () {
            // Only 1 public key provided, but threshold is 2
            await expect(
                accountFactory.createAccount(
                    ENTRYPOINT_ADDRESS,
                    PUBLIC_KEY_X,
                    PUBLIC_KEY_Y,
                    2, // threshold > number of keys
                    SOURCE_ADDRESS
                )
            ).to.be.revertedWithCustomError(accountFactory, "InvalidThreshold");
        });

        it("Should accept threshold equal to number of signers", async function () {
            const MULTI_KEY_X = [
                "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
                "0x80be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
            ];
            const MULTI_KEY_Y = [
                "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
                "0x77b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
            ];

            // 2 keys, threshold 2 should work
            await accountFactory.createAccount(ENTRYPOINT_ADDRESS, MULTI_KEY_X, MULTI_KEY_Y, 2, SOURCE_ADDRESS);

            const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
            expect(accountAddr).to.not.equal(hre.ethers.ZeroAddress);
        });
    });

    describe("Non-existent Account Query", function () {
        it("Should return zero address for non-existent account", async function () {
            const nonExistentAccount = await accountFactory.getAccount("non_existent_source_address");
            expect(nonExistentAccount).to.equal(hre.ethers.ZeroAddress);
        });
    });
});
