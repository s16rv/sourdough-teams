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
            gasMultiplier: 1.2,
        },
        polygon: {
            url: "https://rpc-amoy.polygon.technology",
            accounts: [process.env.EVM_PRIVATE_KEY as string],
            gasMultiplier: 1.2,
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS ? true : false,
        coinmarketcap: process.env.COINMARKETCAP_API_KEY,
        gasPriceApi: process.env.ETHERSCAN_API_KEY,
    },
    etherscan: {
        apiKey: {
            sepolia: process.env.ETHERSCAN_API_KEY as string,
            polygonAmoy: process.env.ETHERSCAN_API_KEY as string,
        },
        customChains: [
            {
                network: "polygonAmoy",
                chainId: 80002, // Polygon Amoy chain ID
                urls: {
                    apiURL: "https://api-amoy.polygonscan.com/api",
                    browserURL: "https://amoy.polygonscan.com",
                },
            },
        ],
    },
    sourcify: {
        enabled: false, // Suppress Sourcify warning
    },
};

export default config;
