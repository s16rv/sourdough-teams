# TODO

Tracking missing functionality, security fixes, and improvements for audit readiness.

## Missing Functionality

- [ ] **Grants system** - Delegation/grants not implemented (planned feature from CosmWasm version)
- [ ] **AccountFactory access control** - Should only accept calls from EntryPoint
- [ ] **MPCGateway admin** - Operator should be able to update verifier address
- [ ] **AccountFactory admin** - Operator should be able to update entry point and verifier addresses
- [ ] **RoutingRailgunFactory admin** - Operator should be able to update default Railgun address

## Security Fixes

- [x] **SafeERC20** - FIXED: Using SafeERC20 `safeTransfer` and `forceApprove` in RoutingRailgun.sol. USDT-like tokens now work correctly.
- [x] **Reentrancy in recoverTransaction** - FIXED: Moved `incrementSequence()` BEFORE `_call()` in both `recoverTransaction` and `executeTransactions` (Checks-Effects-Interactions pattern).
- [x] **ReentrancyGuard for RoutingRailgun** - FIXED: Added OpenZeppelin's `ReentrancyGuard` with `nonReentrant` modifier on `refund()` and `executeRailgunCall()`.
- [x] **Debug events** - KEPT: DebugReason, DebugTxHash, DebugError events retained for debugging. Zero-cost when not triggered, valuable for diagnosing failures.
- [ ] **Recovery path chain binding** - `recoverTransaction` has no chain_id validation. Add `chainId` to `recoverProposal` payload and validate against `block.chainid` to prevent cross-chain replay if same account exists on multiple chains via CREATE2
- [x] **Owner signature doesn't bind to data** - FIXED: New payload format includes hash commitment in signBytes. Owner signs `sha256(signBytes)` which contains `keccak256(txPayload)`. Account verifies `keccak256(txPayload) == extractedHash` before execution.
- [ ] **chain_id validation (numeric)** - Current implementation validates chainId as string (e.g., "ethereum-1"). Should migrate to use `block.chainid` (numeric) for stronger validation. String comparison is gas-inefficient and requires hardcoded constant. Recovery path also needs chain_id validation.

## Gas Optimizations

- [x] **Use ecrecover instead of custom Secp256k1Verifier** - DONE: Account.sol now uses native `ecrecover` precompile (~3,000 gas) instead of Secp256k1Verifier (~50,000-80,000 gas per signer). Signatures now include `v` recovery parameter. AccountFactory no longer requires a verifier. Note: MPCVerifier still uses Secp256k1Verifier for MPC signature validation.

## Code Quality

- [x] **Consistent error handling** - FIXED: Standardized on custom errors. Replaced string reverts with `ZeroAddress` and `OnlyOwner` custom errors in MPCGateway, MPCVerifier, AccountFactory, and EntryPoint.
- [x] **Magic numbers** - FIXED: Extracted hardcoded offsets to named constants (SLOT_SIZE, PUBKEY_SIZE, SIGNER_WITH_SIG_SIZE, CREATE_ACCOUNT_HEADER_SIZE, EXECUTE_TX_HEADER_SIZE, TX_ITEM_HEADER_SIZE) in EntryPoint.sol.
- [x] **Dual error patterns** - KEPT INTENTIONALLY: `Account.validateOperation` returns `(bool, string)` for off-chain debugging via `eth_call` (zero gas cost). State-changing functions use custom errors. Debug events (DebugReason, DebugTxHash, DebugError) provide on-chain visibility.
- [x] **Clean up scripts/** - FIXED: Removed one-off debugging script (`getFunctionSelector.ts`). Removed hardcoded scripts (`query.ts`, `querySequence.ts`). Kept: `deploy.ts`, `deployRoutingRailgun.ts`, `deployTestUSDC.ts`, `generateSignature.ts`

## Testing

- [x] **Unit tests** - 174 tests, 87%+ coverage for production contracts
- [x] **Security tests** - Access control, reentrancy, error paths covered
- [x] **Integration tests** - Full flow from MPCGateway to Account execution
- [x] **Batch limits** - MAX_BATCH_SIZE (20) enforcement verified
- [x] **ERC20 edge cases** - Non-standard tokens, fee-on-transfer tested
- [x] **Sequence overflow** - uint64 boundary safe (Solidity 0.8+ reverts on overflow)
- [x] **Invariant tests** - 14 tests covering sequence monotonicity, no replay, funds protection, signer authority, threshold enforcement
- [ ] **Fork tests** - Test RoutingRailgun against real Railgun on mainnet fork
- [ ] **Secp256k1Verifier edge cases** - Point-at-infinity and EC math edge cases (81% coverage)

### Test Coverage Summary (as of 2026-02-03)

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
| USDT-like tokens (no return) fail             | ✅ Fixed | SafeERC20 implemented    |
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

- [ ] Define RoutingRailgun controller expectations (always Account? can be EOA?)
- [ ] **Grants system** - Delegation/grants not implemented (planned feature from CosmWasm version). Confirm requirements with team.
- [x] **Use ecrecover instead of custom Secp256k1Verifier** - DONE: Account.sol now uses native `ecrecover` precompile. See Gas Optimizations section above.
- [x] **Owner signature doesn't bind to data** - FIXED: New payload format with hash commitment in signBytes. See Security Fixes section above.
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
