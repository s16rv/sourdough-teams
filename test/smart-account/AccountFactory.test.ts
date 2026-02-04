import hre, { upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, toUtf8Bytes, ethers } from "ethers";

import { AccountFactory, EntryPoint } from "../../typechain-types";
import { DEFAULT_SALT } from "../utils/lib";

const PUBLIC_KEY_X = ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"];
const PUBLIC_KEY_Y = ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"];

const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));
const SOURCE_ADDRESS2 = "neutron1klzktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";

const THRESHOLD = 1;

describe("AccountFactory", function () {
    let accountFactory: AccountFactory;
    let entryPoint: EntryPoint;
    let owner: HardhatEthersSigner;
    let nonOwner: HardhatEthersSigner;

    // Helper to get impersonated signer with funded balance
    async function getEntryPointSigner(): Promise<HardhatEthersSigner> {
        const entryPointAddress = await entryPoint.getAddress();
        // Fund the impersonated address using hardhat_setBalance (no receive() function needed)
        await hre.network.provider.send("hardhat_setBalance", [
            entryPointAddress,
            "0xDE0B6B3A7640000", // 1 ETH in hex
        ]);
        return await hre.ethers.getImpersonatedSigner(entryPointAddress);
    }

    beforeEach(async function () {
        [owner, nonOwner] = await hre.ethers.getSigners();

        // Deploy AccountFactory proxy
        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = (await upgrades.deployProxy(AccountFactoryContract, [hre.ethers.ZeroAddress, owner.address], {
            kind: "uups",
        })) as unknown as AccountFactory;
        await accountFactory.waitForDeployment();

        // Deploy EntryPoint proxy
        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = (await upgrades.deployProxy(
            EntryPointContract,
            [accountFactory.target, owner.address, hre.ethers.ZeroAddress],
            { kind: "uups" }
        )) as unknown as EntryPoint;
        await entryPoint.waitForDeployment();

        // Wire up contracts
        await accountFactory.setEntryPoint(entryPoint.target);
    });

    describe("Initialization", function () {
        it("Should initialize with correct entryPoint", async function () {
            // Test that we can get accounts (which means entryPoint is set correctly)
            const accounts = await accountFactory.getAccounts(SOURCE_ADDRESS);
            expect(accounts).to.be.an("array");
        });
    });

    describe("Address Computation", function () {
        it("Should compute address consistent", async function () {
            const accountAddr1 = await accountFactory.computeAddress(
                entryPoint.target,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD,
                DEFAULT_SALT
            );
            const accountAddr2 = await accountFactory.computeAddress(
                entryPoint.target,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD,
                DEFAULT_SALT
            );

            expect(accountAddr1).to.equal(accountAddr2);
        });

        it("Should compute different addresses for different salts", async function () {
            const salt1 = DEFAULT_SALT;
            const salt2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("different-salt"));

            const accountAddr1 = await accountFactory.computeAddress(
                entryPoint.target,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD,
                salt1
            );
            const accountAddr2 = await accountFactory.computeAddress(
                entryPoint.target,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD,
                salt2
            );

            expect(accountAddr1).to.not.equal(accountAddr2);
        });

        it("Should compute same address before and after creation", async function () {
            const preComputedAddr = await accountFactory.computeAddress(
                entryPoint.target,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                1,
                DEFAULT_SALT
            );

            // Create account via entryPoint (using impersonation)
            const entryPointSigner = await getEntryPointSigner();

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS, DEFAULT_SALT);

            const actualAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

            expect(preComputedAddr).to.equal(actualAddr);
        });
    });

    describe("Account Creation", function () {
        it("Should create account via entryPoint", async function () {
            const entryPointSigner = await getEntryPointSigner();

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS, DEFAULT_SALT);

            const addressComputed = await accountFactory.computeAddress(
                entryPoint.target,
                PUBLIC_KEY_X,
                PUBLIC_KEY_Y,
                SOURCE_ADDRESS_HASH,
                THRESHOLD,
                DEFAULT_SALT
            );
            const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);

            expect(addressComputed).to.equal(accountAddr);
        });

        it("Should create two different accounts for same sourceAddress with different salts", async function () {
            const entryPointSigner = await getEntryPointSigner();

            const salt1 = DEFAULT_SALT;
            const salt2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("salt-2"));

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS, salt1);

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS, salt2);

            const accounts = await accountFactory.getAccounts(SOURCE_ADDRESS);
            expect(accounts.length).to.equal(2);
            expect(accounts[0]).to.not.equal(accounts[1]);
        });

        it("Should create two different accounts for different sourceAddresses", async function () {
            const entryPointSigner = await getEntryPointSigner();

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS, DEFAULT_SALT);

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS2, DEFAULT_SALT);

            const accountAddr1 = await accountFactory.getAccount(SOURCE_ADDRESS);
            const accountAddr2 = await accountFactory.getAccount(SOURCE_ADDRESS2);

            expect(accountAddr1).to.not.equal(accountAddr2);
        });
    });

    describe("Access Control", function () {
        it("Should reject createAccount from non-entryPoint", async function () {
            await expect(
                accountFactory
                    .connect(owner)
                    .createAccount(
                        entryPoint.target,
                        PUBLIC_KEY_X,
                        PUBLIC_KEY_Y,
                        THRESHOLD,
                        SOURCE_ADDRESS,
                        DEFAULT_SALT
                    )
            ).to.be.revertedWithCustomError(accountFactory, "NotEntryPoint");
        });

        it("Should allow entryPoint to create account", async function () {
            const entryPointSigner = await getEntryPointSigner();

            await expect(
                accountFactory
                    .connect(entryPointSigner)
                    .createAccount(
                        entryPoint.target,
                        PUBLIC_KEY_X,
                        PUBLIC_KEY_Y,
                        THRESHOLD,
                        SOURCE_ADDRESS,
                        DEFAULT_SALT
                    )
            ).to.not.be.reverted;
        });
    });

    describe("Duplicate Account Prevention", function () {
        it("Should revert when creating account with same source address and salt twice", async function () {
            const entryPointSigner = await getEntryPointSigner();

            // First creation should succeed
            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS, DEFAULT_SALT);

            const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
            expect(accountAddr).to.not.equal(hre.ethers.ZeroAddress);

            // Second creation with same source address and salt should fail
            await expect(
                accountFactory
                    .connect(entryPointSigner)
                    .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS, DEFAULT_SALT)
            ).to.be.revertedWithCustomError(accountFactory, "AccountAlreadyExists");
        });

        it("Should allow creating accounts with same source address but different salts", async function () {
            const entryPointSigner = await getEntryPointSigner();

            const salt1 = DEFAULT_SALT;
            const salt2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("different-salt"));

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS, salt1);

            // Different salt should succeed
            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, 1, SOURCE_ADDRESS, salt2);

            const accounts = await accountFactory.getAccounts(SOURCE_ADDRESS);
            expect(accounts.length).to.equal(2);
            expect(accounts[0]).to.not.equal(hre.ethers.ZeroAddress);
            expect(accounts[1]).to.not.equal(hre.ethers.ZeroAddress);
        });
    });

    describe("Threshold Validation", function () {
        it("Should revert when threshold is zero", async function () {
            const entryPointSigner = await getEntryPointSigner();

            await expect(
                accountFactory.connect(entryPointSigner).createAccount(
                    entryPoint.target,
                    PUBLIC_KEY_X,
                    PUBLIC_KEY_Y,
                    0, // invalid threshold
                    SOURCE_ADDRESS,
                    DEFAULT_SALT
                )
            ).to.be.revertedWithCustomError(accountFactory, "InvalidThreshold");
        });

        it("Should revert when threshold exceeds number of signers", async function () {
            const entryPointSigner = await getEntryPointSigner();

            // Only 1 public key provided, but threshold is 2
            await expect(
                accountFactory.connect(entryPointSigner).createAccount(
                    entryPoint.target,
                    PUBLIC_KEY_X,
                    PUBLIC_KEY_Y,
                    2, // threshold > number of keys
                    SOURCE_ADDRESS,
                    DEFAULT_SALT
                )
            ).to.be.revertedWithCustomError(accountFactory, "InvalidThreshold");
        });

        it("Should accept threshold equal to number of signers", async function () {
            const entryPointSigner = await getEntryPointSigner();

            const MULTI_KEY_X = [
                "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
                "0x80be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0",
            ];
            const MULTI_KEY_Y = [
                "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
                "0x77b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338",
            ];

            // 2 keys, threshold 2 should work
            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, MULTI_KEY_X, MULTI_KEY_Y, 2, SOURCE_ADDRESS, DEFAULT_SALT);

            const accountAddr = await accountFactory.getAccount(SOURCE_ADDRESS);
            expect(accountAddr).to.not.equal(hre.ethers.ZeroAddress);
        });
    });

    describe("Non-existent Account Query", function () {
        it("Should return zero address for non-existent account via getAccount", async function () {
            const nonExistentAccount = await accountFactory.getAccount("non_existent_source_address");
            expect(nonExistentAccount).to.equal(hre.ethers.ZeroAddress);
        });

        it("Should return empty array for non-existent account via getAccounts", async function () {
            const accounts = await accountFactory.getAccounts("non_existent_source_address");
            expect(accounts).to.be.an("array");
            expect(accounts.length).to.equal(0);
        });
    });

    describe("getAccounts function", function () {
        it("Should return all accounts for a sourceAddress", async function () {
            const entryPointSigner = await getEntryPointSigner();

            const salt1 = DEFAULT_SALT;
            const salt2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("salt-2"));
            const salt3 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("salt-3"));

            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS, salt1);
            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS, salt2);
            await accountFactory
                .connect(entryPointSigner)
                .createAccount(entryPoint.target, PUBLIC_KEY_X, PUBLIC_KEY_Y, THRESHOLD, SOURCE_ADDRESS, salt3);

            const accounts = await accountFactory.getAccounts(SOURCE_ADDRESS);
            expect(accounts.length).to.equal(3);

            // All addresses should be unique and non-zero
            const uniqueAddresses = new Set(accounts.map((a) => a.toLowerCase()));
            expect(uniqueAddresses.size).to.equal(3);
            for (const addr of accounts) {
                expect(addr).to.not.equal(hre.ethers.ZeroAddress);
            }
        });
    });

    describe("Upgradeability", function () {
        it("Should allow owner to upgrade", async function () {
            const AccountFactoryV2Factory = await hre.ethers.getContractFactory("AccountFactory");
            await expect(upgrades.upgradeProxy(accountFactory.target, AccountFactoryV2Factory)).to.not.be.reverted;
        });

        it("Should reject non-owner upgrade", async function () {
            const AccountFactoryV2Factory = await hre.ethers.getContractFactory("AccountFactory", nonOwner);
            await expect(upgrades.upgradeProxy(accountFactory.target, AccountFactoryV2Factory)).to.be.reverted;
        });
    });

    describe("setEntryPoint", function () {
        it("Should allow owner to update entryPoint", async function () {
            const newEntryPoint = "0x1234567890123456789012345678901234567890";
            await expect(accountFactory.connect(owner).setEntryPoint(newEntryPoint)).to.not.be.reverted;
        });

        it("Should reject non-owner updating entryPoint", async function () {
            const newEntryPoint = "0x1234567890123456789012345678901234567890";
            await expect(accountFactory.connect(nonOwner).setEntryPoint(newEntryPoint)).to.be.revertedWithCustomError(
                accountFactory,
                "OwnableUnauthorizedAccount"
            );
        });
    });
});
