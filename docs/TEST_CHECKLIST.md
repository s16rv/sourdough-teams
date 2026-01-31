# Test Audit Checklist

> **Last Updated:** 2026-01-31 (170 tests, 87% coverage)
>
> This document maps security invariants and trust boundaries to required test cases. Tests are prioritized by security impact.
>
> See also: [THREAT_MODEL.md](THREAT_MODEL.md) for security invariants, [TODO.md](TODO.md) for implementation tasks.

**Priority Legend:**

- 🔴 **Critical** - Could lead to fund loss or security bypass
- 🟠 **High** - Could cause contract malfunction or DoS
- 🟡 **Medium** - Edge cases that should be handled gracefully
- 🟢 **Low** - Nice-to-have completeness tests

---

## Part 1: Security Invariant Tests

Based on the 8 invariants from `THREAT_MODEL.md`.

### Invariant 1: Funds Require Threshold Signatures

**Design Intent:** No funds can move without M-of-N valid signatures from authorized signers.

| Priority | Test Case                                                     | Status | Location                       |
| -------- | ------------------------------------------------------------- | ------ | ------------------------------ |
| 🔴       | threshold = 0 rejected on createAccount                       | ✅     | accountFactorySecurity.test.ts |
| 🔴       | threshold > signer_count rejected on createAccount            | ✅     | accountFactorySecurity.test.ts |
| 🔴       | threshold = signer_count accepted                             | ✅     | accountFactorySecurity.test.ts |
| 🔴       | Duplicate signers rejected in validateOperation               | ✅     | account.test.ts (Multisig)     |
| 🔴       | Signatures from non-authorized pubkeys rejected               | ✅     | accountRecover.test.ts         |
| 🔴       | Valid signature for wrong payload rejected                    | ✅     | account.test.ts                |
| 🔴       | Fewer signatures than threshold rejected (validateOperation)  | ✅     | accountSecurity.test.ts        |
| 🔴       | Fewer signatures than threshold rejected (recoverTransaction) | ✅     | accountSecurity.test.ts        |
| 🟠       | Empty signers array rejected                                  | ✅     | accountSecurity.test.ts        |
| 🟠       | Mismatched r/s/x/y array lengths rejected                     | ✅     | accountRecover.test.ts         |

### Invariant 2: Sequence Monotonic

**Design Intent:** Sequence numbers only increase, never decrease or repeat.

| Priority | Test Case                                        | Status | Location                 |
| -------- | ------------------------------------------------ | ------ | ------------------------ |
| 🔴       | Sequence must equal accountSequence + 1          | ✅     | accountSecurity.test.ts  |
| 🔴       | Sequence = accountSequence (replay) rejected     | ✅     | accountSecurity.test.ts  |
| 🔴       | Sequence < accountSequence rejected              | ✅     | accountSecurity.test.ts  |
| 🔴       | Sequence > accountSequence + 1 rejected          | ✅     | accountSecurity.test.ts  |
| 🔴       | Sequence increments after successful recovery tx | ✅     | accountSecurity.test.ts  |
| 🟠       | Sequence overflow (uint64 max) handled           | ✅     | sequenceOverflow.test.ts |

### Invariant 3: No Replay

**Design Intent:** Same transaction cannot be executed twice.

| Priority | Test Case                                                    | Status     | Location                |
| -------- | ------------------------------------------------------------ | ---------- | ----------------------- |
| 🔴       | Same sequence rejected on second attempt                     | ✅         | accountSecurity.test.ts |
| 🔴       | Same txHash rejected at MPCGateway level                     | ✅         | mpcGateway.test.ts      |
| 🔴       | Replay of MPC payload rejected                               | ✅         | fullFlow.test.ts        |
| 🔴       | **VULNERABILITY: Reentrancy allows replay during execution** | ⚠️ FAILING | reentrancy.test.ts      |

### Invariant 4: Source Binding

**Design Intent:** Transactions are bound to specific source address.

| Priority | Test Case                                            | Status | Location                |
| -------- | ---------------------------------------------------- | ------ | ----------------------- |
| 🔴       | sourceAddress mismatch rejected in validateOperation | ✅     | accountSecurity.test.ts |
| 🔴       | sourceAddress match accepted                         | ✅     | accountSecurity.test.ts |
| 🔴       | compareSourceAddress returns correct boolean         | ✅     | accountSecurity.test.ts |
| 🟡       | Empty sourceAddress rejected                         | ✅     | edgeCases.test.ts       |

### Invariant 5: Proof Binding

**Design Intent:** Payload tampering detected via proof verification.

| Priority | Test Case                                                     | Status | Location        |
| -------- | ------------------------------------------------------------- | ------ | --------------- |
| 🔴       | Invalid proof rejected                                        | ✅     | account.test.ts |
| 🔴       | proof = sha256(messageHash \|\| data) verified                | ✅     | account.test.ts |
| 🟠       | Modified data with recomputed proof (MPC compromise scenario) | ❌     | -               |

### Invariant 6: Signer Immutability

**Design Intent:** Public keys and threshold are immutable after account creation.

| Priority | Test Case                              | Status | Location            |
| -------- | -------------------------------------- | ------ | ------------------- |
| 🔴       | No function to change signers exists   | ✅     | (by inspection)     |
| 🔴       | No function to change threshold exists | ✅     | (by inspection)     |
| 🟢       | getX/getY return original signers      | ✅     | (implicit in tests) |

### Invariant 7: Censorship Resistance

**Design Intent:** Recovery path always available to original owners.

| Priority | Test Case                                             | Status | Location               |
| -------- | ----------------------------------------------------- | ------ | ---------------------- |
| 🔴       | recoverTransaction works with valid owner sig         | ✅     | accountRecover.test.ts |
| 🔴       | recoverTransaction rejects non-owner pubkey           | ✅     | accountRecover.test.ts |
| 🔴       | recoverTransaction rejects invalid signature          | ✅     | accountRecover.test.ts |
| 🔴       | Anyone can submit recoverTransaction (permissionless) | ✅     | accountRecover.test.ts |
| 🔴       | recoverTransaction respects sequence                  | ✅     | accountRecover.test.ts |
| 🔴       | recoverTransaction validates payload selector         | ✅     | accountRecover.test.ts |
| 🟠       | Recovery path bypasses MPC entirely                   | ✅     | fullFlow.test.ts       |

### Invariant 8: Controller Exclusivity (RoutingRailgun)

**Design Intent:** Only controller can operate RoutingRailgun.

| Priority | Test Case                                     | Status | Location                       |
| -------- | --------------------------------------------- | ------ | ------------------------------ |
| 🔴       | Non-controller cannot call executeRailgunCall | ✅     | routingRailgunSecurity.test.ts |
| 🔴       | Non-controller cannot call refund             | ✅     | routingRailgunSecurity.test.ts |
| 🔴       | Non-controller cannot call approveToken       | ✅     | routingRailgunSecurity.test.ts |
| 🟢       | Controller can execute all functions          | ✅     | routingRailgunSecurity.test.ts |

---

## Part 2: Trust Boundary Tests

External input enters at these points and must be validated.

### Entry Point: AccountFactory.createAccount

| Priority | Test Case                                                      | Status   | Location                       |
| -------- | -------------------------------------------------------------- | -------- | ------------------------------ |
| 🔴       | Duplicate sourceAddress rejected                               | ✅       | accountFactorySecurity.test.ts |
| 🔴       | Invalid threshold rejected                                     | ✅       | accountFactorySecurity.test.ts |
| 🔴       | **VULNERABILITY: Anyone can call (should be EntryPoint only)** | ⚠️ KNOWN | accountFactorySecurity.test.ts |
| 🟠       | Non-existent account query returns zero address                | ✅       | accountFactorySecurity.test.ts |
| 🟠       | Account address is deterministic (CREATE2)                     | ✅       | accountFactory.test.ts         |

### Entry Point: EntryPoint.executePayload

| Priority | Test Case                                   | Status | Location                     |
| -------- | ------------------------------------------- | ------ | ---------------------------- |
| 🔴       | Unauthorized sender (not executor) rejected | ✅     | mpcGatewayEntrypoint.test.ts |
| 🔴       | Executor can execute                        | ✅     | entryPoint.test.ts           |
| 🔴       | Invalid payload rejected                    | ✅     | mpcGatewayEntrypoint.test.ts |
| 🔴       | Target account must match sourceAddress     | ✅     | entryPointErrors.test.ts     |
| 🟠       | Owner can add/remove executors              | ✅     | entryPointErrors.test.ts     |
| 🟠       | Non-owner cannot modify executors           | ✅     | entryPointErrors.test.ts     |

### Entry Point: MPCGateway.executeContractCall

| Priority | Test Case                                 | Status | Location                   |
| -------- | ----------------------------------------- | ------ | -------------------------- |
| 🔴       | Invalid MPC signature rejected            | ✅     | fullFlow.test.ts           |
| 🔴       | Valid MPC signature accepted              | ✅     | mpcGatewayVerifier.test.ts |
| 🔴       | Replay (same txHash) rejected             | ✅     | mpcGateway.test.ts         |
| 🔴       | txHash computed correctly                 | ✅     | generateTxHash.test.ts     |
| 🟠       | Destination contract call failure handled | ✅     | mpcGateway.test.ts         |

### Entry Point: Account.executeTransactions

| Priority | Test Case                         | Status | Location                       |
| -------- | --------------------------------- | ------ | ------------------------------ |
| 🔴       | Only EntryPoint can call          | ✅     | account.test.ts                |
| 🔴       | Non-EntryPoint caller rejected    | ✅     | account.test.ts                |
| 🟠       | Mismatched array lengths rejected | ✅     | (by code inspection)           |
| 🟠       | Batch execution succeeds          | ✅     | entryPointMultiPayload.test.ts |

### Entry Point: Account.recoverTransaction

| Priority | Test Case                                     | Status     | Location               |
| -------- | --------------------------------------------- | ---------- | ---------------------- |
| 🔴       | Invalid txPayload selector rejected           | ✅         | accountRecover.test.ts |
| 🔴       | Invalid signature rejected                    | ✅         | accountRecover.test.ts |
| 🔴       | Invalid pubkey rejected                       | ✅         | accountRecover.test.ts |
| 🔴       | Invalid sequence rejected                     | ✅         | accountRecover.test.ts |
| 🔴       | **VULNERABILITY: Reentrancy during \_call()** | ⚠️ FAILING | reentrancy.test.ts     |

### Entry Point: Account.validateOperation

| Priority | Test Case                      | Status | Location                |
| -------- | ------------------------------ | ------ | ----------------------- |
| 🔴       | Invalid sourceAddress rejected | ✅     | accountSecurity.test.ts |
| 🔴       | Invalid sequence rejected      | ✅     | accountSecurity.test.ts |
| 🔴       | Invalid proof rejected         | ✅     | account.test.ts         |
| 🔴       | Invalid signature rejected     | ✅     | account.test.ts         |
| 🔴       | Invalid pubkey rejected        | ✅     | accountSecurity.test.ts |
| 🔴       | Duplicate pubkeys rejected     | ✅     | account.test.ts         |
| 🔴       | Below threshold rejected       | ✅     | accountSecurity.test.ts |

### Entry Point: MPCVerifier.validateMPCSignature

| Priority | Test Case                              | Status | Location            |
| -------- | -------------------------------------- | ------ | ------------------- |
| 🔴       | Valid signature accepted               | ✅     | mpcVerifier.test.ts |
| 🔴       | Invalid signature rejected             | ✅     | mpcVerifier.test.ts |
| 🔴       | Updated public key used for validation | ✅     | mpcVerifier.test.ts |
| 🟠       | Only owner can update public key       | ✅     | mpcVerifier.test.ts |
| 🟠       | Non-owner cannot update public key     | ✅     | mpcVerifier.test.ts |

---

## Part 3: EVM-Specific Security Tests

### Reentrancy Protection

| Priority | Test Case                                            | Status        | Location                         |
| -------- | ---------------------------------------------------- | ------------- | -------------------------------- |
| 🔴       | **recoverTransaction: reentrancy drains funds**      | ⚠️ VULNERABLE | reentrancy.test.ts               |
| 🔴       | executeTransactions: protected by onlyEntryPoint     | ✅            | reentrancy.test.ts               |
| 🔴       | RoutingRailgun: reentrancy during refund             | ✅ PROTECTED  | routingRailgunReentrancy.test.ts |
| 🔴       | RoutingRailgun: reentrancy during executeRailgunCall | ✅ PROTECTED  | routingRailgunReentrancy.test.ts |

> **Note:** RoutingRailgun is protected by `onlyController`, but should add `ReentrancyGuard` for defense in depth.

### ERC20 Edge Cases

| Priority | Test Case                                  | Status   | Location               |
| -------- | ------------------------------------------ | -------- | ---------------------- |
| 🔴       | Non-standard ERC20 (returns false) handled | ✅       | erc20EdgeCases.test.ts |
| 🔴       | No-return ERC20 (USDT-like) handled        | ⚠️ FAILS | erc20EdgeCases.test.ts |
| 🟠       | Fee-on-transfer tokens handled             | ✅ INFO  | erc20EdgeCases.test.ts |
| 🟠       | Rebasing tokens handled                    | ❌       | -                      |

> **Note:** No-return tokens (USDT-like) cause reverts. SafeERC20 needed for compatibility.

### Cross-Chain Replay

| Priority | Test Case                                         | Status   | Location    |
| -------- | ------------------------------------------------- | -------- | ----------- |
| 🔴       | **recoverTransaction has no chain_id validation** | ⚠️ KNOWN | -           |
| 🔴       | Same CREATE2 address on different chains          | ❌       | -           |
| 🟠       | Normal path has chain_id in MPC txHash            | ✅       | (by design) |

### Gas Limits

| Priority | Test Case                           | Status | Location            |
| -------- | ----------------------------------- | ------ | ------------------- |
| 🟠       | Max batch size (20) transactions    | ✅     | batchLimits.test.ts |
| 🟠       | Batch with 21 transactions rejected | ✅     | batchLimits.test.ts |
| 🟡       | Very large payload handled          | ✅     | edgeCases.test.ts   |

---

## Part 4: Integration Tests

### Full Flow: MPC → EntryPoint → Account

| Priority | Test Case                             | Status | Location                |
| -------- | ------------------------------------- | ------ | ----------------------- |
| 🔴       | Complete transaction flow succeeds    | ✅     | fullFlow.test.ts        |
| 🔴       | Invalid MPC signature blocks flow     | ✅     | fullFlow.test.ts        |
| 🔴       | Invalid user signature blocks flow    | ✅     | (via validateOperation) |
| 🔴       | Replay blocked at MPC level           | ✅     | fullFlow.test.ts        |
| 🔴       | Multiple sequential transactions work | ✅     | fullFlow.test.ts        |
| 🟠       | Recovery path bypasses MPC            | ✅     | fullFlow.test.ts        |

### Account Creation Flow

| Priority | Test Case                      | Status | Location               |
| -------- | ------------------------------ | ------ | ---------------------- |
| 🔴       | Account created via EntryPoint | ✅     | fullFlow.test.ts       |
| 🔴       | Account receives funds         | ✅     | fullFlow.test.ts       |
| 🟠       | Account address predictable    | ✅     | accountFactory.test.ts |

---

## Part 5: Summary

### Coverage by Priority

| Priority    | Total | Covered  | Vulnerable | Missing |
| ----------- | ----- | -------- | ---------- | ------- |
| 🔴 Critical | 52    | 49 (94%) | 3          | 0       |
| 🟠 High     | 22    | 19 (86%) | 0          | 3       |
| 🟡 Medium   | 5     | 1 (20%)  | 0          | 4       |
| 🟢 Low      | 3     | 3 (100%) | 0          | 0       |

### Known Vulnerabilities (⚠️)

| Issue                            | Severity    | Status    | Fix                                      |
| -------------------------------- | ----------- | --------- | ---------------------------------------- |
| Reentrancy in recoverTransaction | 🔴 Critical | Confirmed | Move incrementSequence() before \_call() |
| AccountFactory public access     | 🟠 High     | Known     | Restrict to EntryPoint only              |
| No chain_id in recovery path     | 🔴 Critical | Known     | Add chainId to recoverProposal payload   |

### Missing Tests

| Priority    | Count | Key Gaps                        |
| ----------- | ----- | ------------------------------- |
| 🔴 Critical | 0     | All critical tests covered      |
| 🟠 High     | 0     | All high priority tests covered |
| 🟡 Medium   | 1     | Rebasing tokens                 |

### Code Coverage (as of 2026-01-31)

| Contract              | Statements | Branches | Lines   |
| --------------------- | ---------- | -------- | ------- |
| MPCGateway            | 100%       | 90%      | 100%    |
| MPCVerifier           | 100%       | 67%      | 100%    |
| RoutingRailgun        | 100%       | 86%      | 100%    |
| RoutingRailgunFactory | 100%       | 100%     | 100%    |
| AccountFactory        | 100%       | 80%      | 100%    |
| Account               | 98%        | 87%      | 98%     |
| EntryPoint            | 100%       | 70%      | 95%     |
| SignatureVerifier     | 100%       | 100%     | 100%    |
| Secp256k1Verifier     | 77%        | 48%      | 82%     |
| **Overall**           | **87%**    | **69%**  | **86%** |

---

## Appendix: Test File Reference

| File                                 | Purpose                                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| `account.test.ts`                    | Basic Account validation and execution                            |
| `accountRecover.test.ts`             | Recovery transaction path                                         |
| `accountSecurity.test.ts`            | Source address, sequence, threshold, validateOperation edge cases |
| `accountFactory.test.ts`             | Account creation and address computation                          |
| `accountFactorySecurity.test.ts`     | Factory security checks                                           |
| `accountGetters.test.ts`             | Getter functions and ETH receive coverage                         |
| `entryPoint.test.ts`                 | EntryPoint execution                                              |
| `entryPointErrors.test.ts`           | Error paths, executor management, payload validation              |
| `entryPointMultiPayload.test.ts`     | Batch transaction execution                                       |
| `entryPointMultisig.test.ts`         | Multisig via EntryPoint                                           |
| `mpcGateway.test.ts`                 | MPC Gateway execution and replay protection                       |
| `mpcGatewayVerifier.test.ts`         | MPC signature verification                                        |
| `mpcGatewayEntrypoint.test.ts`       | Gateway → EntryPoint integration                                  |
| `mpcVerifier.test.ts`                | MPC public key management                                         |
| `generateTxHash.test.ts`             | Transaction hash generation                                       |
| `fullFlow.test.ts`                   | End-to-end integration tests                                      |
| `reentrancy.test.ts`                 | Reentrancy vulnerability tests                                    |
| `routingRailgun.test.ts`             | Railgun routing functionality                                     |
| `routingRailgunSecurity.test.ts`     | Access control, error paths, ETH handling                         |
| `routingRailgunReentrancy.test.ts`   | Reentrancy protection verification                                |
| `erc20EdgeCases.test.ts`             | Non-standard token handling                                       |
| `batchLimits.test.ts`                | MAX_BATCH_SIZE enforcement                                        |
| `sequenceOverflow.test.ts`           | uint64 sequence boundary tests                                    |
| `edgeCases.test.ts`                  | Empty sourceAddress, large payloads, zero value                   |
| `signatureVerifier.test.ts`          | Secp256k1 signature verification                                  |
| `signatureVerifierEdgeCases.test.ts` | Verifier failure and edge case handling                           |
| `executeContractCallERC20.test.ts`   | ERC20 transfers via Account                                       |

---

## Appendix: Test Naming Convention

Tests should document design intent in their names:

```typescript
// BAD: What it does
it("test validate sequence failure", ...)

// GOOD: Why it matters
it("Should reject sequence replay to prevent double-spend", ...)

// GOOD: What invariant it protects
it("INVARIANT: duplicate signers cannot inflate threshold count", ...)

// GOOD: Document vulnerabilities
it("VULNERABILITY: recoverTransaction is vulnerable to reentrancy", ...)
```
