import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encodeBytes32String, AbiCoder, parseEther, sha256, toUtf8Bytes, keccak256 } from "ethers";

import { Account, EntryPoint } from "../../typechain-types";

const RECIPIENT_ADDRESS = "0xaa25Aa7a19f9c426E07dee59b12f944f4d9f1DD3";

const PUBLIC_KEY_X = "0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0";
const PUBLIC_KEY_Y = "0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";

const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

describe("ExecuteIcauthz", function () {
    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;

    beforeEach(async function () {
        [recover] = await hre.ethers.getSigners();

        const MockGatewayContract = await hre.ethers.getContractFactory("MockGateway");
        const mockGateway = await MockGatewayContract.deploy();

        const Secp256k1VerifierContract = await hre.ethers.getContractFactory("Secp256k1Verifier");
        const verifier = await Secp256k1VerifierContract.deploy();
        await verifier.waitForDeployment();

        const AccountFactoryContract = await hre.ethers.getContractFactory("AccountFactory");
        const accountFactory = await AccountFactoryContract.deploy(verifier.target);
        await accountFactory.waitForDeployment();

        const EntryPointContract = await hre.ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPointContract.deploy(mockGateway.target, accountFactory.target);
        await entryPoint.waitForDeployment();

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const messageHash = "0x87ed53f4eef3fd7cb1497e8671057c2859417487c0ee8b037ebd1be45075c001";
        const r = "0xc07088b681723e98dbc11648ffa5646f80cfaff291120e90ffd75337093f4227";
        const s = "0x6ffd64cf200433e89b12036119d2777c92b1903cf8579b70e873d03fa1844aa1";

        const payload = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
            [1, recover.address, messageHash, r, s, PUBLIC_KEY_X, PUBLIC_KEY_Y]
        );

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(PUBLIC_KEY_X, PUBLIC_KEY_Y, SOURCE_ADDRESS_HASH);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });
    });

    it("should execute icauthz from account contract with authorization", async function () {
        const latestBlock = await hre.ethers.provider.getBlock("latest");
        let expTimestamp = 1704758400;
        if (latestBlock) {
            expTimestamp = latestBlock.timestamp + 3600;
        }

        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = "0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61";
        const s = "0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b";

        const amountToSend = parseEther("1.0");
        const accountAddress = await account.getAddress();

        // Execute transaction from the Account contract
        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const txPayload = new AbiCoder().encode(
            ["address", "uint256", "bytes"],
            [RECIPIENT_ADDRESS, amountToSend, "0x"]
        );

        const proof = sha256(combineHexStrings(messageHash, txPayload));

        let payloadDataType = ["uint8", "address", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "uint16"];
        let payloadDataValue = [
            3,
            accountAddress,
            messageHash,
            r,
            s,
            proof,
            expTimestamp,
            32 + 32 + 32 + 32 + 32 + 32 + (32 + 32 + 32 + 32 + 32 + 32) + (32 + 32 + 32 + 32 + 32 + 32),
        ];

        const addressEqualAuthType = ["uint16", "uint8", "uint8", "uint16", "uint16", "address"];
        const addressEqualAuthValue = [32 + 32 + 32 + 32 + 32, 2, 1, 0, 20, RECIPIENT_ADDRESS];

        const balanceLTEAuthType = ["uint16", "uint8", "uint8", "uint16", "uint16", "uint256"];
        const balanceLTEAuthValue = [32 + 32 + 32 + 32 + 32, 1, 2, 20, 20 + 32, 5];

        const balanceSumDailyAuthType = ["uint16", "uint8", "uint8", "uint16", "uint16", "uint256"];
        const balanceSumDailyAuthValue = [32 + 32 + 32 + 32 + 32, 1, 4, 20, 20 + 32, 20];

        const p = new AbiCoder().encode(
            [...payloadDataType, ...addressEqualAuthType, ...balanceLTEAuthType, ...balanceSumDailyAuthType],
            [...payloadDataValue, ...addressEqualAuthValue, ...balanceLTEAuthValue, ...balanceSumDailyAuthValue]
        );

        const payload = combineHexStrings(p, txPayload);

        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);

        // trigger execute after create
        const initialRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);

        const q = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "bytes32", "bytes32"],
            [4, accountAddress, messageHash, r, s, proof]
        );
        const qPayload = combineHexStrings(q, txPayload);

        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, qPayload);

        const finalRecipientBalance = await hre.ethers.provider.getBalance(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});

function combineHexStrings(hexString1: string, hexString2: string): string {
    const buffer1 = Buffer.from(hexString1.slice(2), "hex");
    const buffer2 = Buffer.from(hexString2.slice(2), "hex");

    const combinedBuffer = Buffer.concat([buffer1, buffer2]);

    const combinedHex = combinedBuffer.toString("hex");

    return "0x" + combinedHex;
}
