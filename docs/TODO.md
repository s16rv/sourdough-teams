# TODO

Tracking missing functionality, security fixes, and improvements for audit readiness.

## Missing Functionality

- [ ] **Grants system** - Delegation/grants not implemented (planned feature from CosmWasm version)
- [ ] **AccountFactory access control** - Should only accept calls from EntryPoint
- [ ] **MPCGateway admin** - Operator should be able to update verifier address
- [ ] **AccountFactory admin** - Operator should be able to update entry point and verifier addresses
- [ ] **RoutingRailgunFactory admin** - Operator should be able to update default Railgun address

## Security Fixes

- [ ] **SafeERC20** - Use safeTransfer/safeApprove in RoutingRailgun.sol (lines 26, 45). **Confirmed by tests:** USDT-like tokens (no return value) cause reverts. Fee-on-transfer tokens work but recipient receives less than expected.
- [ ] **Reentrancy in recoverTransaction** - CRITICAL: `recoverTransaction` updates sequence AFTER external call, allowing same signed tx to execute multiple times via reentrancy. Fix: move `incrementSequence()` BEFORE `_call()` (Checks-Effects-Interactions pattern). Same issue exists in `executeTransactions` but is protected by `onlyEntryPoint` modifier.
- [ ] **ReentrancyGuard for RoutingRailgun** - Defense in depth: Add OpenZeppelin's `ReentrancyGuard` to `refund()` and `executeRailgunCall()`. Currently protected by `onlyController`, but reentrancy guard provides defense in depth if access control is ever modified or bypassed.
- [ ] **Remove debug events** - Remove or gate DebugReason, DebugTxHash, DebugError events before production
- [ ] **Recovery path chain binding** - `recoverTransaction` has no chain_id validation. Add `chainId` to `recoverProposal` payload and validate against `block.chainid` to prevent cross-chain replay if same account exists on multiple chains via CREATE2
- [ ] **Owner signature doesn't bind to data** - In normal path, owner signs `messageHash` but not `data`. The `proof = sha256(messageHash || data)` binds them, but `proof` itself isn't signed. Payload integrity relies entirely on MPC signature. If MPC is compromised, attacker could substitute `data` and compute valid `proof`. Consider: should `messageHash` on source chain include commitment to `data`? Or is MPC trust acceptable?
- [ ] **chain_id validation missing** - Neither normal path nor recovery path validates `block.chainid` at Account level. Normal path only has it in MPC txHash. Add explicit chain_id validation in Account contract for both paths.

## Gas Optimizations

- [ ] **Use ecrecover instead of custom Secp256k1Verifier** - Current signature verification costs ~50,000-80,000 gas per signer using pure Solidity EC math. Native `ecrecover` precompile costs ~3,000 gas (15-25x cheaper). Requires storing signer addresses instead of raw public key coordinates (x, y), and signatures must include `v` recovery parameter. For 3 signers: saves ~171,000 gas per transaction.

## Code Quality

- [ ] **Consistent error handling** - Standardize on custom errors (remove string reverts like EntryPoint.sol:53)
- [ ] **Magic numbers** - Extract hardcoded offsets in EntryPoint payload parsing to named constants
- [ ] **Dual error patterns** - Account.validateOperation returns (bool, string) while rest uses custom errors

## Testing

- [x] **Unit tests** - 184 tests, 87%+ coverage for production contracts
- [x] **Security tests** - Access control, reentrancy, error paths covered
- [x] **Integration tests** - Full flow from MPCGateway to Account execution
- [x] **Batch limits** - MAX_BATCH_SIZE (20) enforcement verified
- [x] **ERC20 edge cases** - Non-standard tokens, fee-on-transfer tested
- [x] **Sequence overflow** - uint64 boundary safe (Solidity 0.8+ reverts on overflow)
- [x] **Invariant tests** - 14 tests covering sequence monotonicity, no replay, funds protection, signer authority, threshold enforcement
- [ ] **Fork tests** - Test RoutingRailgun against real Railgun on mainnet fork
- [ ] **Secp256k1Verifier edge cases** - Point-at-infinity and EC math edge cases (81% coverage)

### Test Coverage Summary (as of 2026-01-31)

| Contract              | Lines  | Notes                         |
| --------------------- | ------ | ----------------------------- |
| MPCGateway            | 100%   | ✅                            |
| MPCVerifier           | 100%   | ✅                            |
| RoutingRailgun        | 100%   | ✅                            |
| RoutingRailgunFactory | 100%   | ✅                            |
| AccountFactory        | 100%   | ✅                            |
| SignatureVerifier     | 100%   | ✅                            |
| Account               | 97.67% | 2 lines unreachable by design |
| EntryPoint            | ~96%   | 1-2 lines unreachable         |
| Secp256k1Verifier     | 81.74% | EC edge cases remaining       |

### Test Findings

| Finding                                       | Severity | Status                   |
| --------------------------------------------- | -------- | ------------------------ |
| USDT-like tokens (no return) fail             | 🟠 High  | Needs SafeERC20          |
| Fee-on-transfer tokens work but less received | ℹ️ Info  | Document for users       |
| Sequence overflow reverts (safe)              | ✅ Safe  | Solidity 0.8+ protection |
| Batch limit (20) enforced correctly           | ✅ Safe  | Working as designed      |

## Documentation

- [x] **THREAT_MODEL.md** - Security model documentation
- [x] **TODO.md** - This file
- [x] **README.md** - Updated project documentation
- [x] **CLAUDE.md** - Project context for AI assistance
- [ ] **ARCHITECTURE.md** - Detailed technical architecture
- [ ] **SECURITY.md** - Security contact and known issues for auditors

### Spec Updates (docs/spec/)

- [x] **Gateway spec** - Updated to match current implementation
- [x] **Smart Account spec** - Updated to match current implementation (multisig, batch tx, recovery path)
- [x] **RoutingRailgun spec** - Created new spec document
- [x] **Add validation requirements** - Documented in Smart Account spec

## Questions to Resolve

- [ ] Confirm grants system requirements with team
- [ ] Define RoutingRailgun controller expectations (always Account? can be EOA?)
- [ ] Decide if MPCGateway and MPCVerifier should be merged (simplicity vs modularity)
- [ ] **Multiple accounts per source address** - Currently AccountFactory enforces 1 account per source address. sd-ica (CosmWasm version) allows multiple accounts per source address. Consider adding an `accountIndex` parameter to CREATE2 salt to allow users to create multiple accounts (e.g., for different purposes like trading vs savings). Tradeoffs:
    - Current: simpler lookup, prevents accidental duplicates
    - Multiple: more flexible, matches sd-ica behavior, requires index coordination across chains
- [ ] **RoutingRailgun + Railgun integration flow** - Clarify with team:
    - Who controls funds after they're shielded into Railgun? (spending keys)
    - What's the intended use case? (shield → unshield to different address?)
    - Who initiates unshield operations?
    - If MPC is compromised, could attacker shield funds with their own spending key?
    - Does Account call Railgun directly for unshield, or via RoutingRailgun?
    - Who sends funds TO RoutingRailgun? (Account transfers own funds, or external parties?)
