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

    // it("Should recover signer 1", async function () {
    //     const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
    //     const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
    //     const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";

    //     const signer = await signatureVerifier.recoverSigner(messageHash, r, s, SIGNATURE_V);
    //     expect(signer).to.equal("");
    // });

    // it("Should recover signer 2", async function () {
    //     const messageHash = "0xdc8c11d51d653ac6baef8e1ae1bbddda8910d0d0abd0e0edeef0a67bef590e0a";
    //     const r = "0x2100b47091a86403304ac0f71a57c185b41c7de0262c21800e04c3bb0e9d655e";
    //     const s = "0x5161a2c18d41771776c43eb261ede3ce0d9981e13bcea1ddc2622ae20eeabab9";

    //     const signer = await signatureVerifier.recoverSigner(messageHash, r, s, SIGNATURE_V);
    //     expect(signer).to.equal("");
    // });

    // it("Should verify signature A", async function () {
    //     const r = "0x2100b47091a86403304ac0f71a57c185b41c7de0262c21800e04c3bb0e9d655e";
    //     const s = "0x5161a2c18d41771776c43eb261ede3ce0d9981e13bcea1ddc2622ae20eeabab9";

    //     const messageHash = "0xdc8c11d51d653ac6baef8e1ae1bbddda8910d0d0abd0e0edeef0a67bef590e0a";
    //     const signer = "0x07557D755E777B85d878D34861cd52126524a155"

    //     const recoveredSigner = await signatureVerifier.recoverSigner(messageHash, r, s, SIGNATURE_V);
    //     console.log("recoveredSignerA", recoveredSigner);

    //     const isValid = await signatureVerifier.verifySignature(messageHash, r, s, SIGNATURE_V, signer);
    //     expect(isValid).to.be.true;
    // });

    // it("Should verify signature A2", async function () {
    //     const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
    //     const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";

    //     const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
    //     const signer = "0x07557D755E777B85d878D34861cd52126524a155"

    //     const recoveredSigner = await signatureVerifier.recoverSigner(messageHash, r, s, SIGNATURE_V);
    //     console.log("recoveredSignerA2", recoveredSigner);

    //     const isValid = await signatureVerifier.verifySignature(messageHash, r, s, SIGNATURE_V, signer);
    //     expect(isValid).to.be.true;
    // });

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
