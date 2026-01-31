import hre from "hardhat";
import { expect } from "chai";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { Account, Secp256k1Verifier } from "../../typechain-types";
import { getPublicKeyFromMnemonic } from "../../scripts/generateSignature";

/**
 * Tests for Account getter functions to improve coverage
 * Covers: getX(), getY(), getVerifier(), receive()
 */
describe("Account Getters and ETH Handling", function () {
    const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

    const TEST_MNEMONIC =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
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
        let multiSigAccount: Account;
        let pubKeyX2: string[];
        let pubKeyY2: string[];

        beforeEach(async function () {
            [owner] = await hre.ethers.getSigners();

            const pubKey1 = await getPublicKeyFromMnemonic(TEST_MNEMONIC);
            const pubKey2 = await getPublicKeyFromMnemonic(TEST_MNEMONIC_2);

            pubKeyX2 = [pubKey1.x, pubKey2.x];
            pubKeyY2 = [pubKey1.y, pubKey2.y];

            const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
            verifier = await Secp256k1VerifierContract.deploy();
            await verifier.waitForDeployment();

            const AccountContract = await hre.ethers.getContractFactory("Account");
            multiSigAccount = await AccountContract.deploy(
                verifier.target,
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
