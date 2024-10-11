import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encodeBytes32String, AbiCoder } from "ethers";

import { Account__factory, AccountFactory, EntryPoint, MockGateway } from "../../typechain-types";

const EXPECTED_SIGNER = "0x07557D755E777B85d878D34861cd52126524a155";
const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

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
        const mockGatewayAddress = await mockGateway.getAddress();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        accountFactory = await AccountFactoryContract.deploy();
        await accountFactory.waitForDeployment();
        const accountFactoryAddress = await accountFactory.getAddress();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(mockGatewayAddress, accountFactoryAddress);
        await entryPoint.waitForDeployment();
    });

    it("Test create account", async function () {
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";
        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const recoverAddress = "0xee17D0A243361997245A0EBA740e26020952f249";

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";
        const sourceAddress = recoverAddress;

        const payload = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "bytes32"],
            [1, recoverAddress, messageHash, r, s]
        );

        console.log({ payload });

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, sourceAddress, payload);
        const signerAccounts = await accountFactory.getAccounts(EXPECTED_SIGNER);
        expect(signerAccounts).to.length(1);

        const account = Account__factory.connect(signerAccounts[0], recover);
        expect(await account.getSigner()).to.equal(EXPECTED_SIGNER);
    });
});
