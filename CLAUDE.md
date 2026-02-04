# CLAUDE.md

Project context for Claude Code AI assistance.

## Project Overview

**sourdough-solidity-contracts** is a multi-signature smart account system for EVM chains, part of the Sourdough cross-chain authentication protocol.

### Architecture

```
Source Chain --> MPC Relayer --> MPCGateway --> EntryPoint --> Account
                                                    |
                                              AccountFactory
```

Optional privacy flow:

```
Account --> RoutingRailgun --> Railgun Protocol
```

### Key Contracts

| Contract                | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `MPCGateway`            | Validates MPC signatures, prevents replay, forwards to EntryPoint |
| `MPCVerifier`           | Stores MPC public key, validates signatures                       |
| `EntryPoint`            | Routes payloads to Accounts, manages executors                    |
| `AccountFactory`        | Creates Account instances via CREATE2                             |
| `Account`               | User's smart account with multisig, holds funds                   |
| `Secp256k1Verifier`     | EIP-7212 compatible signature verification (used by MPCVerifier)  |
| `RoutingRailgun`        | Intermediary for Railgun privacy transactions                     |
| `RoutingRailgunFactory` | Deploys RoutingRailgun instances                                  |

## Build & Test

```bash
# Install dependencies
npm ci

# Compile contracts
npm run compile

# Run tests
npm run test

# Format code
npm run format:fix
```

## Project Structure

```
contracts/
├── smart-account/
│   ├── account/          # Account.sol
│   ├── interfaces/       # IAccount, IEntryPoint, IAccountFactory
│   ├── util/             # SignatureVerifier, Secp256k1Verifier
│   ├── EntryPoint.sol
│   └── AccountFactory.sol
├── mpc-gateway/
│   ├── interfaces/       # IMPCGateway, IMPCVerifier
│   ├── MPCGateway.sol
│   └── MPCVerifier.sol
├── routing-railgun/
│   ├── interfaces/       # IRoutingRailgun, IRoutingRailgunFactory
│   ├── RoutingRailgun.sol
│   └── RoutingRailgunFactory.sol
├── testing-contracts/    # Mock ERC20 for testing
└── utils/                # Test utilities

test/                     # Hardhat tests
scripts/                  # Deployment scripts
```

## Code Conventions

- **Solidity version**: 0.8.21
- **Framework**: Hardhat with TypeScript
- **Error handling**: Prefer custom errors over require strings
- **Interfaces**: Every contract has a corresponding interface
- **NatSpec**: Document all public/external functions

## Security Considerations

See `docs/THREAT_MODEL.md` for full security model.

Key points:

- Two authorization paths: Normal (via MPC) and Recovery (direct)
- Replay protection via sequence numbers and txHash tracking
- Accounts are immutable after creation
- Recovery path provides censorship resistance

## Known Issues

See `docs/TODO.md` for tracked issues including:

- Missing admin functionality on some contracts (upgradeability TBD)
- Grants system not yet implemented
- chain_id validation (related to cross-chain security model)

## Debugging

- **View functions**: `Account.validateOperation` returns `(bool, string)` for off-chain debugging via `eth_call`
- **Debug events**: `DebugReason`, `DebugTxHash`, `DebugError` provide on-chain visibility for failures
- **Custom errors**: All state-changing functions use custom errors for gas-efficient reverts

## Testing Notes

- Tests are in `/test/` directory
- Mock contracts in `/contracts/testing-contracts/`
- Use `npm run test` to run full suite
- Coverage target: 90%+

## Related Repositories

- [sourdough](https://github.com/s16rv/sourdough) - Main Sourdough protocol
- [sd-ica](https://github.com/s16rv/sd-ica) - CosmWasm version for Neutron
