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

| Contract                | Type       | Purpose                                                           |
| ----------------------- | ---------- | ----------------------------------------------------------------- |
| `MPCGateway`            | UUPS Proxy | Validates MPC signatures, prevents replay, forwards to EntryPoint |
| `MPCVerifier`           | Immutable  | Stores MPC signer address, validates via ecrecover                |
| `EntryPoint`            | UUPS Proxy | Dumb router - parses payloads and forwards to Account             |
| `AccountFactory`        | UUPS Proxy | Creates Account instances via CREATE2                             |
| `Account`               | Immutable  | **Trust anchor** - validates everything, executes atomically      |
| `RoutingRailgun`        | Immutable  | Intermediary for Railgun privacy transactions                     |
| `RoutingRailgunFactory` | Immutable  | Deploys RoutingRailgun instances                                  |

### Trust Anchor Architecture

Account is the **trust anchor** - all validation and execution happens atomically:

- `validateAndExecute()`: Validates chainId, accountAddress, signatures, sequence, hash commitment, then executes
- `recoverTransaction()`: Direct path that also validates chainId (censorship resistant)
- EntryPoint is just a parser/router - even if compromised, can't steal funds

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
│   ├── util/             # SignatureVerifier
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

- **Solidity version**: 0.8.24
- **Framework**: Hardhat with TypeScript
- **Proxy pattern**: UUPS (OpenZeppelin contracts-upgradeable) for infrastructure contracts
- **Storage pattern**: ERC-7201 namespaced storage for upgrade safety
- **Error handling**: Prefer custom errors over require strings
- **Interfaces**: Every contract has a corresponding interface
- **NatSpec**: Document all public/external functions

## Security Considerations

See `docs/THREAT_MODEL.md` for full security model.

Key points:

- **Account is trust anchor** - validates everything atomically (no TOCTOU)
- Two authorization paths: Normal (via MPC) and Recovery (direct)
- Both paths validate `evmChainId == block.chainid` (cross-chain replay protection)
- Replay protection via sequence numbers and txHash tracking
- Accounts are immutable after creation
- Recovery path provides censorship resistance
- CEI pattern prevents reentrancy (sequence incremented before external calls)
- Inter-contract access control: `onlyMPCGateway` on EntryPoint, `onlyEntryPoint` on AccountFactory
- Infrastructure contracts (proxies) can be upgraded, but Account validates all signatures

## Known Issues

See `docs/TODO.md` for tracked issues including:

- Grants system not yet implemented
- RoutingRailgunFactory admin functionality (update default Railgun address)

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
