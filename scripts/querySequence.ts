import { ethers } from "hardhat";
import dotenv from "dotenv";
import { Account__factory } from "../typechain-types";

dotenv.config();

async function main() {
    const [wallet] = await ethers.getSigners();
    console.log("Wallet Address:", wallet.address);

    const accountAddress = process.env.ACCOUNT_ADDRESS as string;

    const account = Account__factory.connect(accountAddress, wallet);

    console.log("Account address :", await account.getAddress());

    const sequence = await account.accountSequence();
    console.log("sequence", sequence);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
