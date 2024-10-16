import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encodeBytes32String, AbiCoder, parseEther } from "ethers";

import { Account__factory, AccountFactory, EntryPoint, MockGateway } from "../../typechain-types";

const EXPECTED_SIGNER = "0x07557D755E777B85d878D34861cd52126524a155";
const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

const PUBLIC_KEY_X = "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0";
const PUBLIC_KEY_Y = "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

describe("EntryPoint", function () {
    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let mockGateway: MockGateway;
    let accountFactory: AccountFactory;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const MockGatewayContract = await hre.ethers.getContractFactory("MockGateway");
        mockGateway = await MockGatewayContract.deploy();
        await mockGateway.waitForDeployment();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy(verifier.target);
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(mockGateway.target, accountFactory.target);
        await entryPoint.waitForDeployment();
    });

    it("Test create account", async function () {
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";
        const recoverAddress = "0xee17D0A243361997245A0EBA740e26020952f249";

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";
        const sourceAddress = recoverAddress;

        const payload = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
            [1, recoverAddress, messageHash, r, s, PUBLIC_KEY_X, PUBLIC_KEY_Y]
        );

        console.log({ payload });

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, sourceAddress, payload);
        const accounts = await accountFactory["getAccounts(bytes32,bytes32)"](PUBLIC_KEY_X, PUBLIC_KEY_Y);
        expect(accounts).to.length(1);

        const account = Account__factory.connect(accounts[0], recover);
        console.log("account", await account.getAddress());
        expect(await account.recover()).to.equal(recoverAddress);
    });

    it("Test send account tx", async function () {
        const messageHash = "0xdc8c11d51d653ac6baef8e1ae1bbddda8910d0d0abd0e0edeef0a67bef590e0a";
        const r = "0x2100b47091a86403304ac0f71a57c185b41c7de0262c21800e04c3bb0e9d655e";
        const s = "0x5161a2c18d41771776c43eb261ede3ce0d9981e13bcea1ddc2622ae20eeabab9";
        const recoverAddress = "0xee17D0A243361997245A0EBA740e26020952f249";

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";
        const sourceAddress = recoverAddress;

        const payloadCreateAccount = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
            [1, recoverAddress, messageHash, r, s, PUBLIC_KEY_X, PUBLIC_KEY_Y]
        );

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, sourceAddress, payloadCreateAccount);
        const accounts = await accountFactory["getAccounts(bytes32,bytes32)"](PUBLIC_KEY_X, PUBLIC_KEY_Y);
        expect(accounts).to.length(1);

        const account = Account__factory.connect(accounts[0], recover);
        const accountAddress = await account.getAddress();
        console.log("account", accountAddress);
        expect(await account.recover()).to.equal(recoverAddress);

        await recover.sendTransaction({
            to: accounts[0],
            value: parseEther("2.0"),
        });

        const amountToSend = parseEther("0.01");
        const payloadAccountTx = new AbiCoder().encode(
            ["address", "uint256", "bytes"],
            [RECIPIENT_ADDRESS, amountToSend, "0x"]
        );
        console.log({ payloadAccountTx });

        const payloadHandleTx = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "bytes32"],
            [2, accountAddress, messageHash, r, s]
        );
        const payloadSendTx = ethers.concat([payloadHandleTx, payloadAccountTx]);
        console.log({ payloadSendTx });
        const payloadSendTx2 =
            "0x0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000" +
            accountAddress.replace("0x", "") +
            messageHash.replace("0x", "") +
            r.replace("0x", "") +
            s.replace("0x", "") +
            "000000000000000000000000aa25aa7a19f9c426e07dee59b12f944f4d9f1dd3000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000";

        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        await entryPoint.execute(commandId, sourceChain, sourceAddress, payloadSendTx2);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});
