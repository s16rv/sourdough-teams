# Sourdough Solidity Contracts

The contracts in this repository are used in [Sourdough](https://github.com/s16rv/sourdough) to enable cross-chain transaction authentication for EVM chains.

## Smart Account Contract

The Smart Account contract contains the core logic for the Sourdough Smart Account. It includes the following contracts:

- `EntryPoint.sol`: The main contract as an entry point to trigger Smart Account transactions from Axelar Executable.
- `Account.sol`: A contract that implements the Smart Account logic.
- `AccountFactory.sol`: A factory contract for creating Smart Account instances.
- `SignatureVerifier.sol`: A contract that verifies signatures.

# Repository Structure

```
│
├── contracts/              <- Contains all contracts
│   ├── mock-contracts/     <- Contains mock contracts for testing
│   ├── smart-account/      <- Contains the Smart Account contracts
│   └── testing-contracts/  <- Contains contracts for various testing cases
│
├── scripts/                <- Contains scripts for deployment and testing
├── test/                   <- Contains test files for the contracts
└── README.md
```

# Testing

```shell
npm run test
```

# Builds

Install dependencies:

```shell
npm ci
```

Compile the contracts:

```shell
npm run compile
```

Deploy the contracts:

```shell
npx hardhat run scripts/deploy.ts --network sepolia
```
