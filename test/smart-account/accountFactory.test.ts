import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransaction, ContractTransactionResponse, sha256 } from "ethers";

import { AccountFactory } from "../../typechain-types";

const TX_BYTES_A_1 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAESBBDAmgwaB2FscGhhLTE=";
const TX_BYTES_A_2 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAISBBDAmgwaB2FscGhhLTE=";
const SIGNATURE_A_1 = "GHUe6rGUxcUuzLnjYJ8qE+qYoHkTjcKdr2c5Ea4mCJlzrMvDi6sZZCNO4K6taTiaeYmMgL+MNXBjMinM9fJKHg==";
const SIGNATURE_A_2 = "0A5QeQgokPkkOxxYgdw+shCF+3nwr1eq4fxhax+kQ+J3TycL0JpeF4CuSDyvnUHwGMQk4ecx/15cl9CzJtUbgw==";

const EXPECTED_SIGNER = "0x07557D755E777B85d878D34861cd52126524a155";
const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

describe("AccountFactory", function () {
    let accountFactory: AccountFactory;
    let recover: HardhatEthersSigner;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy();
    });

    it("Should compute address consistent", async function () {
        const accountAddr1 = await accountFactory.computeAddress(
            recover.address,
            EXPECTED_SIGNER,
            ENTRYPOINT_ADDRESS,
            0
        );
        const accountAddr2 = await accountFactory.computeAddress(
            recover.address,
            EXPECTED_SIGNER,
            ENTRYPOINT_ADDRESS,
            0
        );

        expect(accountAddr1).to.equal(accountAddr2);
    });

    it("Should create account", async function () {
        const message = Buffer.from(TX_BYTES_A_1, "base64");
        const signature = Buffer.from(SIGNATURE_A_1, "base64");

        const r = "0x" + signature.subarray(0, 32).toString("hex");
        const s = "0x" + signature.subarray(32, 64).toString("hex");

        const messageHash = sha256(message);
        await accountFactory.createAccount(recover.address, ENTRYPOINT_ADDRESS, messageHash, r, s);

        const signerAccounts = await accountFactory.getAccounts(EXPECTED_SIGNER);

        expect(signerAccounts).to.length(1);
    });

    it("Should create two different accounts", async function () {
        const message = Buffer.from(TX_BYTES_A_1, "base64");
        const signature = Buffer.from(SIGNATURE_A_1, "base64");

        const r = "0x" + signature.subarray(0, 32).toString("hex");
        const s = "0x" + signature.subarray(32, 64).toString("hex");

        const messageHash = sha256(message);
        await accountFactory.createAccount(recover.address, ENTRYPOINT_ADDRESS, messageHash, r, s);
        await accountFactory.createAccount(recover.address, ENTRYPOINT_ADDRESS, messageHash, r, s);

        const signerAccounts = await accountFactory.getAccounts(EXPECTED_SIGNER);

        expect(signerAccounts).to.length(2);
        expect(signerAccounts[0]).to.not.equal(signerAccounts[1]);
    });
});
