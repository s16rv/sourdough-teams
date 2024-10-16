import { ethers } from "hardhat";
import dotenv from "dotenv";
import { Account__factory } from "../typechain-types";

dotenv.config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);

    const accountAddress = "0xE6Aa781A8CA1588cE5AfAc1D50dD0a9494FeC4F1";

    const account = Account__factory.connect(accountAddress, deployer);

    const r = "0x2100b47091a86403304ac0f71a57c185b41c7de0262c21800e04c3bb0e9d655e";
    const s = "0x5161a2c18d41771776c43eb261ede3ce0d9981e13bcea1ddc2622ae20eeabab9";
    const messageHash = "0xdc8c11d51d653ac6baef8e1ae1bbddda8910d0d0abd0e0edeef0a67bef590e0a";

    const recover = await account.recover();
    console.log("recover", recover);

    const validateOperation = await account.validateOperation(messageHash, r, s);
    console.log("validateOperation", validateOperation);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
