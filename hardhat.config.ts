import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import dotenv from "dotenv";

dotenv.config();

// Only include accounts when env vars are set (avoids Hardhat config validation errors)
const evmAccounts = process.env.EVM_PRIVATE_KEY ? [process.env.EVM_PRIVATE_KEY] : [];
const mainnetAccounts = process.env.MAINNET_EVM_PRIVATE_KEY ? [process.env.MAINNET_EVM_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    networks: {
        "anvil-local": {
            url: process.env.ANVIL_RPC_URL || "http://localhost:18545",
            accounts: ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"], // Anvil account 0
        },
        sepolia: {
            url: "https://ethereum-sepolia-rpc.publicnode.com",
            accounts: evmAccounts,
            gasMultiplier: 1.2,
        },
        polygon: {
            url: "https://rpc-amoy.polygon.technology",
            accounts: evmAccounts,
            gasMultiplier: 1.2,
        },
        base: {
            url: "https://base-sepolia-rpc.publicnode.com",
            accounts: evmAccounts,
            gasMultiplier: 1.2,
        },
        ethereum_mainnet: {
            url: "https://ethereum-rpc.publicnode.com",
            accounts: mainnetAccounts,
            gasMultiplier: 1.2,
        },
        base_mainnet: {
            url: "https://base-rpc.publicnode.com",
            accounts: mainnetAccounts,
            gasMultiplier: 1.2,
        },
        polygon_mainnet: {
            url: "https://polygon-bor-rpc.publicnode.com",
            accounts: mainnetAccounts,
            gasMultiplier: 1.2,
        },
        arbitrum_mainnet: {
            url: "https://arbitrum-one-rpc.publicnode.com",
            accounts: mainnetAccounts,
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
