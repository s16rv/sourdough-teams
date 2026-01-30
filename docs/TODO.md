# TODO

Tracking missing functionality, security fixes, and improvements for audit readiness.

## Missing Functionality

- [ ] **Grants system** - Delegation/grants not implemented (planned feature from CosmWasm version)
- [ ] **AccountFactory access control** - Should only accept calls from EntryPoint
- [ ] **MPCGateway admin** - Operator should be able to update verifier address
- [ ] **AccountFactory admin** - Operator should be able to update entry point and verifier addresses
- [ ] **RoutingRailgunFactory admin** - Operator should be able to update default Railgun address

## Security Fixes

- [ ] **SafeERC20** - Use safeTransfer/safeApprove in RoutingRailgun.sol (lines 26, 45)
- [ ] **Reentrancy guards** - Review and add guards to Account._call() and RoutingRailgun external calls
- [ ] **Remove debug events** - Remove or gate DebugReason, DebugTxHash, DebugError events before production
- [ ] **Recovery path chain binding** - `recoverTransaction` has no chain_id validation. Add `chainId` to `recoverProposal` payload and validate against `block.chainid` to prevent cross-chain replay if same account exists on multiple chains via CREATE2
- [ ] **Owner signature doesn't bind to data** - In normal path, owner signs `messageHash` but not `data`. The `proof = sha256(messageHash || data)` binds them, but `proof` itself isn't signed. Payload integrity relies entirely on MPC signature. If MPC is compromised, attacker could substitute `data` and compute valid `proof`. Consider: should `messageHash` on source chain include commitment to `data`? Or is MPC trust acceptable?

## Code Quality

- [ ] **Consistent error handling** - Standardize on custom errors (remove string reverts like EntryPoint.sol:53)
- [ ] **Magic numbers** - Extract hardcoded offsets in EntryPoint payload parsing to named constants
- [ ] **Dual error patterns** - Account.validateOperation returns (bool, string) while rest uses custom errors

## Testing

- [ ] **Unit tests** - Expand coverage for edge cases
- [ ] **Integration tests** - Full flow from MPCGateway to Account execution
- [ ] **Invariant tests** - Property-based testing for replay protection, sequence monotonicity
- [ ] **Fork tests** - Test RoutingRailgun against real Railgun on mainnet fork

## Documentation

- [x] **THREAT_MODEL.md** - Security model documentation
- [x] **TODO.md** - This file
- [x] **README.md** - Updated project documentation
- [x] **CLAUDE.md** - Project context for AI assistance
- [ ] **ARCHITECTURE.md** - Detailed technical architecture
- [ ] **SECURITY.md** - Security contact and known issues for auditors

## Questions to Resolve

- [ ] Confirm grants system requirements with team
- [ ] Define RoutingRailgun controller expectations (always Account? can be EOA?)
- [ ] Decide if MPCGateway and MPCVerifier should be merged (simplicity vs modularity)
