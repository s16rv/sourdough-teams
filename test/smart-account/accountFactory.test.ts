import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, ContractTransaction, ContractTransactionResponse, keccak256, sha256, toBigInt } from "ethers";

import { AccountFactory, Secp256k1Verifier } from "../../typechain-types";

const TX_BYTES_A_1 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAESBBDAmgwaB2FscGhhLTE=";
const TX_BYTES_A_2 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAISBBDAmgwaB2FscGhhLTE=";
const SIGNATURE_A_1 = "GHUe6rGUxcUuzLnjYJ8qE+qYoHkTjcKdr2c5Ea4mCJlzrMvDi6sZZCNO4K6taTiaeYmMgL+MNXBjMinM9fJKHg==";
const SIGNATURE_A_2 = "0A5QeQgokPkkOxxYgdw+shCF+3nwr1eq4fxhax+kQ+J3TycL0JpeF4CuSDyvnUHwGMQk4ecx/15cl9CzJtUbgw==";

const EXPECTED_SIGNER = "0x07557D755E777B85d878D34861cd52126524a155";
const ENTRYPOINT_ADDRESS = "0x3bd70e10d71c6e882e3c1809d26a310d793646eb";

const PUBLIC_KEY_X = "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0";
const PUBLIC_KEY_Y = "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

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
            0
        );
        const accountAddr2 = await accountFactory.computeAddress(
            recover.address,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            0
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
            PUBLIC_KEY_Y
        );

        const accounts = await accountFactory["getAccounts(bytes32,bytes32)"](PUBLIC_KEY_X, PUBLIC_KEY_Y);

        const salt = toBigInt(
            keccak256(new AbiCoder().encode(["bytes32", "bytes32", "uint256"], [PUBLIC_KEY_X, PUBLIC_KEY_Y, 0]))
        );
        const addressComputed = await accountFactory.computeAddress(
            recover.address,
            ENTRYPOINT_ADDRESS,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y,
            salt
        );

        expect(accounts).to.length(1);
        expect(addressComputed).to.equal(accounts[0]);
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
            PUBLIC_KEY_Y
        );

        await accountFactory.createAccount(
            recover.address,
            ENTRYPOINT_ADDRESS,
            messageHash,
            r,
            s,
            PUBLIC_KEY_X,
            PUBLIC_KEY_Y
        );

        const accounts = await accountFactory["getAccounts(bytes32,bytes32)"](PUBLIC_KEY_X, PUBLIC_KEY_Y);

        expect(accounts).to.length(2);
        expect(accounts[0]).to.not.equal(accounts[1]);
    });
});
