# Sourdough Solidity Contracts

Multi-signature smart account system for EVM chains, enabling cross-chain transaction authentication via the [Sourdough](https://github.com/s16rv/sourdough) protocol.

## Overview

Users control smart accounts via threshold signatures verified against secp256k1 public keys. Transactions originate from a source chain, are validated by the MPC network, and executed on EVM destination chains.

```
Source Chain --> MPC Relayer --> MPCGateway --> EntryPoint --> Account
```

### Key Features

- **Threshold Multisig**: Configurable M-of-N signature requirements
- **Cross-chain Authentication**: Transactions signed on source chain, executed on EVM
- **Censorship Resistance**: Direct recovery path bypasses infrastructure
- **Privacy Integration**: Optional Railgun routing for private transactions
- **Immutable Accounts**: Account behavior locked at creation

## Contracts

### Smart Account System

| Contract | Description |
|----------|-------------|
| `EntryPoint` | Routes cross-chain payloads to user accounts |
| `Account` | User's smart account with multisig verification |
| `AccountFactory` | Creates Account instances via CREATE2 |
| `Secp256k1Verifier` | EIP-7212 compatible signature verification |

### MPC Gateway

| Contract | Description |
|----------|-------------|
| `MPCGateway` | Validates MPC signatures, prevents replay attacks |
| `MPCVerifier` | Stores MPC public key, verifies signatures |

### Railgun Integration

| Contract | Description |
|----------|-------------|
| `RoutingRailgun` | Intermediary for Railgun privacy transactions |
| `RoutingRailgunFactory` | Deploys user-specific routing contracts |

## Repository Structure

```
contracts/
├── smart-account/        # Core smart account system
│   ├── account/          # Account implementation
│   ├── interfaces/       # Contract interfaces
│   └── util/             # Signature verification utilities
├── mpc-gateway/          # MPC signature validation
├── routing-railgun/      # Railgun privacy integration
├── testing-contracts/    # Mock contracts for testing
└── utils/                # General utilities

test/                     # Test suites
scripts/                  # Deployment scripts
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm ci
```

### Compile

```bash
npm run compile
```

### Test

```bash
npm run test
```

### Deploy

```bash
npx hardhat run scripts/deploy.ts --network <network>
```

Supported networks: `sepolia`, `polygon-amoy`, `base-sepolia`, `mainnet`, `base`, `polygon`, `arbitrum`

## Security

See [THREAT_MODEL.md](./THREAT_MODEL.md) for the complete security model.

### Authorization Paths

1. **Normal Path**: Source Chain -> MPC Relayer -> MPCGateway -> EntryPoint -> Account
2. **Recovery Path**: Direct call to `Account.recoverTransaction()` with threshold signatures

Both paths require valid owner signatures. The recovery path provides censorship resistance if infrastructure is unavailable.

### Key Security Properties

- Funds require threshold valid signatures to move
- Replay attacks prevented via sequence numbers and txHash tracking
- Account signers and threshold are immutable after creation
- Recovery path always available to original owners

## Documentation

- [THREAT_MODEL.md](./docs/THREAT_MODEL.md) - Security model and threat analysis
- [TODO.md](./docs/TODO.md) - Tracked issues and planned improvements
- [CLAUDE.md](./CLAUDE.md) - Project context for AI assistance

## License

MIT
