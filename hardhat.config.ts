import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.21",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    networks: {
        sepolia: {
            url: "https://ethereum-sepolia-rpc.publicnode.com",
            accounts: [process.env.EVM_PRIVATE_KEY as string],
        },
    },
};

export default config;
