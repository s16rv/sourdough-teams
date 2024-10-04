import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { sha256, encodeBytes32String, AbiCoder, parseEther } from "ethers";

import { Account, EntryPoint } from "../../typechain-types";

const TX_BYTES_A_1 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAESBBDAmgwaB2FscGhhLTE=";
const TX_BYTES_A_2 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAISBBDAmgwaB2FscGhhLTE=";
const SIGNATURE_A_1 = "GHUe6rGUxcUuzLnjYJ8qE+qYoHkTjcKdr2c5Ea4mCJlzrMvDi6sZZCNO4K6taTiaeYmMgL+MNXBjMinM9fJKHg==";
const SIGNATURE_A_2 = "0A5QeQgokPkkOxxYgdw+shCF+3nwr1eq4fxhax+kQ+J3TycL0JpeF4CuSDyvnUHwGMQk4ecx/15cl9CzJtUbgw==";

const EXPECTED_SIGNER = "0x07557D755E777B85d878D34861cd52126524a155";

describe("EntryPoint", function () {
    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const MockGatewayContract = await hre.ethers.getContractFactory("MockGateway");
        const mockGateway = await MockGatewayContract.deploy();
        const mockGatewayAddress = await mockGateway.getAddress();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy();
        const accountFactoryAddress = await accountFactory.getAddress();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(mockGatewayAddress, accountFactoryAddress);

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";
        const sourceAddress = recover.address;

        const message = Buffer.from(TX_BYTES_A_1, "base64");
        const signature = Buffer.from(SIGNATURE_A_1, "base64");

        const r = "0x" + signature.subarray(0, 32).toString("hex");
        const s = "0x" + signature.subarray(32, 64).toString("hex");

        const messageHash = sha256(message);

        const payload = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "bytes32"],
            [1, recover.address, messageHash, r, s]
        );

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, sourceAddress, payload);
        const signerAccounts = await accountFactory.getAccounts(EXPECTED_SIGNER);
        expect(signerAccounts).to.length(1);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(signerAccounts[0]) as Account;

        await recover.sendTransaction({
            to: signerAccounts[0],
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
});
