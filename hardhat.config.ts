import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
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
    gasReporter: {
        enabled: process.env.REPORT_GAS ? true : false,
        coinmarketcap: process.env.COINMARKETCAP_API_KEY,
        L1Etherscan: process.env.ETHERSCAN_API_KEY,
    },
};

export default config;
