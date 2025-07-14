import hre from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encodeBytes32String, AbiCoder, parseEther, sha256, toUtf8Bytes, keccak256 } from "ethers";

import { Account, EntryPoint, MyToken } from "../../typechain-types";
import { combineHexStrings } from "../utils/lib";

const RECIPIENT_ADDRESS = "0x390dc2368bfde7e7a370af46c0b834b718d570c1";

const PUBLIC_KEY_X = ["0x90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f0"];
const PUBLIC_KEY_Y = ["0x87b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338"];

const THRESHOLD = 1;
const totalSigners = 1;

const SOURCE_ADDRESS = "neutron1chcktqempjfddymtslsagpwtp6nkw9qrvnt98tctp7dp0wuppjpsghqecn";
const SOURCE_ADDRESS_HASH = keccak256(toUtf8Bytes(SOURCE_ADDRESS));

describe("ExecuteContractCallERC20", function () {
    let entryPoint: EntryPoint;
    let recover: HardhatEthersSigner;
    let account: Account;
    let myToken: MyToken;

    this.beforeAll(async function () {
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
        entryPoint = await EntryPointContract.deploy(mockGateway.target, accountFactory.target, recover.address);
        await entryPoint.waitForDeployment();

        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const payload = new AbiCoder().encode(
            ["uint8", "address", "uint64", "uint64", "bytes32", "bytes32"],
            [1, recover.address, totalSigners, THRESHOLD, PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0]]
        );

        await mockGateway.setCallValid(true);
        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);
        const accountAddr = await accountFactory.getAccount(PUBLIC_KEY_X, PUBLIC_KEY_Y, SOURCE_ADDRESS_HASH, THRESHOLD);

        const AccountContract = await hre.ethers.getContractFactory("Account");
        account = AccountContract.attach(accountAddr) as Account;

        await recover.sendTransaction({
            to: accountAddr,
            value: parseEther("2.0"),
        });

        const MyTokenContract = await hre.ethers.getContractFactory("MyToken");
        myToken = await MyTokenContract.deploy("MyToken", "MTK", 18);
        await myToken.waitForDeployment();

        await myToken.transfer(accountAddr, parseEther("3.0"));
    });

    it("should have funds", async function () {
        const accountAddress = await account.getAddress();
        const balance = await hre.ethers.provider.getBalance(accountAddress);
        expect(balance).to.equal(parseEther("2.0"));

        const myTokenBalance = await myToken.balanceOf(accountAddress);
        expect(myTokenBalance).to.equal(parseEther("3.0"));
    });

    it("should execute erc20 transfer from Account contract", async function () {
        const messageHash = "0xcc61a33a7a9ace63fa4c5e74f9db3080c7ef68dd53e75dfb311bc28381830c2f";
        const r = ["0x87df5d0e314c3fe01b3dc136b3afe1659e02316f8d189f0b68983b7f90cd9b61"];
        const s = ["0x7d2212755fb0db4f8e9a3343d264942d14c5e75471245b0419f29ce10355b08b"];
        const numberSigners = 1;

        const initialRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        const amountToSend = parseEther("0.001");
        const accountAddress = await account.getAddress();

        // Execute transaction from the Account contract
        const commandId = encodeBytes32String("commandId");
        const sourceChain = "sourceChain";

        const txPayloadAddress = new AbiCoder().encode(["address", "uint256"], [myToken.target, 0]);
        const txPayloadTransfer = myToken.interface.encodeFunctionData("transfer", [RECIPIENT_ADDRESS, amountToSend]);
        const txPayload = combineHexStrings(txPayloadAddress, txPayloadTransfer);

        const proof = sha256(combineHexStrings(messageHash, txPayload));

        const p = new AbiCoder().encode(
            ["uint8", "address", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"],
            [2, accountAddress, messageHash, proof, 0, numberSigners, r[0], s[0], PUBLIC_KEY_X[0], PUBLIC_KEY_Y[0]]
        );
        const payload = combineHexStrings(p, txPayload);

        await entryPoint.execute(commandId, sourceChain, SOURCE_ADDRESS, payload);

        const finalRecipientBalance = await myToken.balanceOf(RECIPIENT_ADDRESS);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
    });
});
