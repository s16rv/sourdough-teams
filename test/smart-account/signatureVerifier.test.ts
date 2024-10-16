import hre from "hardhat";
import { expect } from "chai";
import { Secp256k1Verifier, TestSignatureVerifier } from "../../typechain-types";

describe("SignatureVerifier", function () {
    let signatureVerifier: TestSignatureVerifier;
    let secp256k1Verifier: Secp256k1Verifier;
    beforeEach(async function () {
        const SignatureVerifierContract = await hre.ethers.getContractFactory("TestSignatureVerifier");
        signatureVerifier = await SignatureVerifierContract.deploy();
        await signatureVerifier.waitForDeployment();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        secp256k1Verifier = await Secp256k1VerifierContract.deploy();
        await secp256k1Verifier.waitForDeployment();
    });

    it("Should verify signature generated", async function () {
        const messageHash = "0x5be0e5a436f0f74e8d8d03226c9f80e0867ea154bd92b625be61c44af4446f81";
        const r = "47813516332939048313022689157393756320714025549748214737759089440759200959512";
        const s = "48216932430946532102858716200626761674335641911140123797326719953952439705118";
        const publicKeyX = "111272987569522078290076334045874804606030625060148511894995709500683347601557";
        const publicKeyY = "45048818382825064779020333109215036960227811631245957743486600890829837596807";

        const signer = await signatureVerifier.verifySignature(
            secp256k1Verifier.target,
            messageHash,
            r,
            s,
            publicKeyX,
            publicKeyY
        );
        expect(signer).to.equal(true);
    });

    it("Should verify signature create account", async function () {
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const r = "87042897357088065645477199565719144872546403457901707382049179078452586693159";
        const s = "50654434258846861753266062282223816470336491221477247311662450327121027156641";
        const publicKeyX = "65469633928985749959591771474311734501900562128245628096486266603901861004784";
        const publicKeyY = "61390756697072325541611873048698312641630289720527108356070407895056408568632";

        const signer = await signatureVerifier.verifySignature(
            secp256k1Verifier.target,
            messageHash,
            r,
            s,
            publicKeyX,
            publicKeyY
        );
        expect(signer).to.equal(true);
    });

    it("Should verify signature send account tx", async function () {
        const messageHash = "0xdc8c11d51d653ac6baef8e1ae1bbddda8910d0d0abd0e0edeef0a67bef590e0a";
        const r = "14927569352443794035841222939324575111511099215461009405650123620809524995422";
        const s = "36809848201581931516851669399679491017546623763976996420715521648580060953273";
        const publicKeyX = "65469633928985749959591771474311734501900562128245628096486266603901861004784";
        const publicKeyY = "61390756697072325541611873048698312641630289720527108356070407895056408568632";

        const signer = await signatureVerifier.verifySignature(
            secp256k1Verifier.target,
            messageHash,
            r,
            s,
            publicKeyX,
            publicKeyY
        );
        expect(signer).to.equal(true);
    });

    it("Should verify signature create account using hex", async function () {
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";
        const publicKeyX = "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0";
        const publicKeyY = "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

        const signer = await signatureVerifier.verifySignature(
            secp256k1Verifier.target,
            messageHash,
            r,
            s,
            publicKeyX,
            publicKeyY
        );
        expect(signer).to.equal(true);
    });

    it("Should verify signature send account tx using hex", async function () {
        const messageHash = "0xdc8c11d51d653ac6baef8e1ae1bbddda8910d0d0abd0e0edeef0a67bef590e0a";
        const r = "0x2100b47091a86403304ac0f71a57c185b41c7de0262c21800e04c3bb0e9d655e";
        const s = "0x5161a2c18d41771776c43eb261ede3ce0d9981e13bcea1ddc2622ae20eeabab9";
        const publicKeyX = "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0";
        const publicKeyY = "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

        const signer = await signatureVerifier.verifySignature(
            secp256k1Verifier.target,
            messageHash,
            r,
            s,
            publicKeyX,
            publicKeyY
        );
        expect(signer).to.equal(true);
    });
});
