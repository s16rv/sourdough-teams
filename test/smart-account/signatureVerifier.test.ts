import hre from "hardhat";
import { expect } from "chai";
import { sha256 } from "ethers";
import { SignatureVerifier } from "../../typechain-types";

const TX_BYTES_A_1 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAESBBDAmgwaB2FscGhhLTE=";
const TX_BYTES_A_2 =
    "CoECCv4BCiUvaW50ZXJjaGFpbmF1dGguaWNhdXRoLnYxLk1zZ1N1Ym1pdFR4EtQBCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSCWNoYW5uZWwtMBqQAQocL2Nvc21vcy5iYW5rLnYxYmV0YTEuTXNnU2VuZBJwCi1jb3Ntb3MxenlwcWE3NmplN3B4c2R3a2ZhaDZtdTlhNTgzc2p1NnhxdDNtdjYSLWNvc21vczFtZ3A3cW52dW1obGNxNmU0ejJxMDVyMjlkY2hjeXVnMHozenhlZxoQCgV1YmV0YRIHMjAwMDAwMCCAoPHCsTQSWApQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohApC+f+iGx0i+gOmLNA0UGNC/54ZWde5ZfZ2FBSZSAIXwEgQKAggBGAISBBDAmgwaB2FscGhhLTE=";
const SIGNATURE_A_1 = "GHUe6rGUxcUuzLnjYJ8qE+qYoHkTjcKdr2c5Ea4mCJlzrMvDi6sZZCNO4K6taTiaeYmMgL+MNXBjMinM9fJKHg==";
const SIGNATURE_A_2 = "0A5QeQgokPkkOxxYgdw+shCF+3nwr1eq4fxhax+kQ+J3TycL0JpeF4CuSDyvnUHwGMQk4ecx/15cl9CzJtUbgw==";

const EXPECTED_SIGNER = "0x07557D755E777B85d878D34861cd52126524a155";
const SIGNATURE_V = 27;

describe("SignatureVerifier", function () {
    let signatureVerifier: SignatureVerifier;
    beforeEach(async function () {
        const SignatureVerifierContract = await hre.ethers.getContractFactory("SignatureVerifier");
        signatureVerifier = await SignatureVerifierContract.deploy();
        await signatureVerifier.waitForDeployment();
    });

    it("Should recover signer", async function () {
        const message = Buffer.from(TX_BYTES_A_1, "base64");
        const signature = Buffer.from(SIGNATURE_A_1, "base64");

        const r = "0x" + signature.subarray(0, 32).toString("hex");
        const s = "0x" + signature.subarray(32, 64).toString("hex");

        const messageHash = sha256(message);
        const signer = await signatureVerifier.recoverSigner(messageHash, r, s, SIGNATURE_V);
        expect(signer).to.equal(EXPECTED_SIGNER);
    });

    it("Should verify signature A", async function () {
        const message = Buffer.from(TX_BYTES_A_1, "base64");
        const signature = Buffer.from(SIGNATURE_A_1, "base64");

        const r = "0x" + signature.subarray(0, 32).toString("hex");
        const s = "0x" + signature.subarray(32, 64).toString("hex");

        const messageHash = sha256(message);
        const isValid = await signatureVerifier.verifySignature(messageHash, r, s, SIGNATURE_V, EXPECTED_SIGNER);
        expect(isValid).to.be.true;
    });

    it("Should verify signature B", async function () {
        const message = Buffer.from(TX_BYTES_A_2, "base64");
        const signature = Buffer.from(SIGNATURE_A_2, "base64");

        const r = "0x" + signature.subarray(0, 32).toString("hex");
        const s = "0x" + signature.subarray(32, 64).toString("hex");

        const messageHash = sha256(message);
        const isValid = await signatureVerifier.verifySignature(messageHash, r, s, SIGNATURE_V, EXPECTED_SIGNER);
        expect(isValid).to.be.true;
    });

    it("Should not verify signature", async function () {
        const message = Buffer.from(TX_BYTES_A_1, "base64");
        const signature = Buffer.from(SIGNATURE_A_2, "base64");

        const r = "0x" + signature.subarray(0, 32).toString("hex");
        const s = "0x" + signature.subarray(32, 64).toString("hex");

        const messageHash = sha256(message);
        const isValid = await signatureVerifier.verifySignature(messageHash, r, s, SIGNATURE_V, EXPECTED_SIGNER);
        expect(isValid).to.be.false;
    });
});
