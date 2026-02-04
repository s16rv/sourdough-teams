# TODO

Tracking missing functionality, security fixes, and improvements for audit readiness.

## Missing Functionality

- [ ] **Grants system** - Delegation/grants not implemented (planned feature from CosmWasm version)
- [ ] **RoutingRailgunFactory admin** - Operator should be able to update default Railgun address
- [x] **Proxy upgradeability for EntryPoint, AccountFactory, and MPCGateway** - DONE: Using OpenZeppelin UUPS proxy pattern. EntryPoint, AccountFactory, and MPCGateway are all upgradeable proxies. Accounts store EntryPoint proxy address (stable). MPCVerifier stays immutable (key rotation via `updateMPCSigner()` sufficient). Account contracts immutable by design (user's trust anchor).
- [ ] **MPC-relayer parameter usage** - Relayer sends 5 params (sourceChain, sourceAddress, destinationChain, destinationAddress, payload) for cross-chain consistency (Solana/Cosmos/EVM):
    - `sourceChain`, `sourceAddress`: Kept for metadata/events/logging, NOT used for security validation
    - `destinationAddress`: EntryPoint proxy address (stable, single target for all payloads)
    - `accountAddress`: Inside signed txPayload, validated by Account (`accountAddress == address(this)`)
- [x] **Inter-contract access control** - DONE: Implemented as follows:
    ```
    Relayer → MPCGateway → EntryPoint (proxy) → AccountFactory (proxy)
                  │                                    │
                  ▼                                    ▼
             MPCVerifier                            Account
    ```
    - [x] MPCVerifier: Public `validateMPCSignature()` (view function, no security benefit from restricting)
    - [x] EntryPoint: `onlyMPCGateway` on `executePayload()`, removed executor whitelist, added `setMPCGateway()` for owner
    - [x] AccountFactory: `onlyEntryPoint` on `createAccount()`, added `setEntryPoint()` for owner
    - Account: `onlyEntryPoint` on `validateAndExecute()`, `recoverTransaction()` stays public (censorship-resistant)
- [x] **Multiple accounts per sourceAddress** - DONE: AccountFactory now supports multiple accounts per source address via `salt` parameter. `createAccount(entryPoint, x, y, threshold, sourceAddress, salt)`. CREATE2 uses `keccak256(addrHash, salt)`. `getAccounts(sourceAddress)` returns array of all accounts. `getAccount(sourceAddress)` returns first (backward compat). `addrHash` kept in Account for off-chain querying.

## Security Fixes

- [x] **SafeERC20** - FIXED: Using SafeERC20 `safeTransfer` and `forceApprove` in RoutingRailgun.sol. USDT-like tokens now work correctly.
- [x] **Reentrancy in recoverTransaction** - FIXED: Moved `incrementSequence()` BEFORE `_call()` in both `recoverTransaction` and `validateAndExecute` (Checks-Effects-Interactions pattern).
- [x] **ReentrancyGuard for RoutingRailgun** - FIXED: Added OpenZeppelin's `ReentrancyGuard` with `nonReentrant` modifier on `refund()` and `executeRailgunCall()`.
- [x] **Debug events** - KEPT: DebugReason, DebugTxHash, DebugError events retained for debugging. Zero-cost when not triggered, valuable for diagnosing failures.
- [x] **Recovery path chain binding** - FIXED: `recoverTransaction` now validates `evmChainId == block.chainid`. Payload format: `(uint256 evmChainId, uint64 sequence, address dest, uint256 value, bytes data)`. Prevents cross-chain replay if same account exists on multiple chains via CREATE2.
- [x] **Owner signature doesn't bind to data** - FIXED: New payload format includes hash commitment in signBytes. Owner signs `sha256(signBytes)` which contains `keccak256(txPayload)`. Account verifies `keccak256(txPayload) == extractedHash` before execution.
- [x] **chain_id validation (numeric)** - FIXED: txPayload now uses `uint256 evmChainId`. Account validates against `block.chainid` for gas-efficient on-chain validation. Both normal and recovery paths validate chain_id.
- [x] **TOCTOU: Atomic validate-and-execute** - FIXED: Merged `validateOperation()` + `executeTransactions()` into single atomic `validateAndExecute()`. Account validates signatures, chainId, accountAddress, sequence, hash commitment, then executes calls - all in one function. No way to split validation from execution.
- [x] **EntryPoint as dumb router** - FIXED: EntryPoint is now a thin parser/router only:
    1. Parses payload to extract target `accountAddress`
    2. Forwards raw components to Account's `validateAndExecute()`
    3. Account handles ALL validation and execution atomically
    - Benefits: EntryPoint upgradeable without security implications, Account is self-protecting, simpler trust model
- [x] **Account validates evmChainId** - FIXED: Account validates `evmChainId == block.chainid` in `validateAndExecute()`. Part of "Account as trust anchor" model.
- [x] **Account validates accountAddress** - FIXED: Account validates `accountAddress == address(this)` from txPayload. User signs exact target address. Old `executeTransactions()` function removed entirely to prevent misuse.

## Gas Optimizations

- [x] **Use ecrecover in Account** - DONE: Account.sol now uses native `ecrecover` precompile (~3,000 gas) instead of Secp256k1Verifier (~50,000-80,000 gas per signer). Signatures now include `v` recovery parameter. AccountFactory no longer requires a verifier.
- [x] **Use ecrecover in MPCVerifier** - DONE: MPCVerifier now uses native `ecrecover` instead of Secp256k1Verifier. Stores `mpcSignerAddress` (derived from public key) instead of x/y coordinates. Includes EIP-2 malleability check (`s <= SECP256K1_N_DIV_2`). MPC signature includes `v` recovery parameter. Saves ~47-77k gas per validation.

## Code Quality

- [x] **Consistent error handling** - FIXED: Standardized on custom errors. Replaced string reverts with `ZeroAddress` and `OnlyOwner` custom errors in MPCGateway, MPCVerifier, AccountFactory, and EntryPoint.
- [x] **Magic numbers** - FIXED: Extracted hardcoded offsets to named constants (SLOT_SIZE, PUBKEY_SIZE, SIGNER_WITH_SIG_SIZE, CREATE_ACCOUNT_HEADER_SIZE, EXECUTE_TX_HEADER_SIZE, TX_ITEM_HEADER_SIZE) in EntryPoint.sol.
- [x] **Dual error patterns** - KEPT INTENTIONALLY: `Account.validateOperation` returns `(bool, string)` for off-chain debugging via `eth_call` (zero gas cost). State-changing functions use custom errors. Debug events (DebugReason, DebugTxHash, DebugError) provide on-chain visibility.
- [x] **Clean up scripts/** - FIXED: Removed one-off debugging script (`getFunctionSelector.ts`). Removed hardcoded scripts (`query.ts`, `querySequence.ts`). Kept: `deploy.ts`, `deployRoutingRailgun.ts`, `deployTestUSDC.ts`, `generateSignature.ts`

## Testing

- [x] **Unit tests** - 177 tests, 87%+ coverage for production contracts
- [x] **Security tests** - Access control, reentrancy, error paths covered
- [x] **Integration tests** - Full flow from MPCGateway to Account execution
- [x] **Batch limits** - MAX_BATCH_SIZE (20) enforcement verified
- [x] **ERC20 edge cases** - Non-standard tokens, fee-on-transfer tested
- [x] **Sequence overflow** - uint64 boundary safe (Solidity 0.8+ reverts on overflow)
- [x] **Invariant tests** - 14 tests covering sequence monotonicity, no replay, funds protection, signer authority, threshold enforcement
- [x] **TOCTOU prevention tests** - Atomic validateAndExecute tested, old executeTransactions removed
- [x] **UUPS proxy tests** - Owner can upgrade, non-owner cannot, state preserved across upgrades
- [x] **Access control tests** - onlyMPCGateway, onlyEntryPoint modifiers tested
- [ ] **Fork tests** - Test RoutingRailgun against real Railgun on mainnet fork

### Test Coverage Summary (as of 2026-02-04)

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
- [x] **Use ecrecover instead of custom Secp256k1Verifier** - DONE: Both Account.sol and MPCVerifier.sol now use native `ecrecover` precompile. See Gas Optimizations section above.
- [x] **Owner signature doesn't bind to data** - FIXED: New payload format with hash commitment in signBytes. See Security Fixes section above.
- [x] **Multiple accounts per source address** - DONE: Support multiple accounts via `salt` parameter. `accountAddress` validation in txPayload provides security (not sourceAddress). See Missing Functionality section.
- [ ] **RoutingRailgun + Railgun integration flow** - Clarify with team:
    - Who controls funds after they're shielded into Railgun? (spending keys)
    - What's the intended use case? (shield → unshield to different address?)
    - Who initiates unshield operations?
    - If MPC is compromised, could attacker shield funds with their own spending key?
    - Does Account call Railgun directly for unshield, or via RoutingRailgun?
    - Who sends funds TO RoutingRailgun? (Account transfers own funds, or external parties?)
