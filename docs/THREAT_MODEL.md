# Threat Model

This document describes the security model for the Sourdough EVM Smart Account system.

## Overview

sourdough-solidity-contracts is a multi-signature smart account system for EVM chains. Users control funds via threshold signatures verified against secp256k1 public keys configured at account creation. Transactions originate from a source chain and are relayed via MPC to EVM destination chains.

### System Components

| Component                   | Type              | Description                                |
| --------------------------- | ----------------- | ------------------------------------------ |
| **Source chain**            | Blockchain        | Where transactions originate (Sourdough)   |
| **MPC Relayer**             | Off-chain service | Relays signed transactions to EVM chains   |
| **Smart Account contracts** | Solidity on EVM   | Smart account system (this codebase)       |
| **Railgun**                 | External protocol | Optional privacy layer for token transfers |

```
Source Chain --> MPC Relayer --> EVM Chain (this repo)
                                     |
                                     +--> Railgun (optional privacy)
```

## Assets

| Asset                  | Value  | Description                                     |
| ---------------------- | ------ | ----------------------------------------------- |
| User funds in accounts | High   | ETH and tokens held by smart accounts           |
| Account control        | High   | Public keys and threshold determining ownership |
| RoutingRailgun funds   | High   | Tokens staged for Railgun shielding             |
| Executor permissions   | Medium | Addresses authorized to relay payloads          |
| MPC public key         | Medium | Key used to validate MPC signatures             |
| System availability    | Medium | Ability to process transactions                 |

## Authorization Model

### Signature Authority

```
+-------------------------------------------------------------+
|                    SIGNATURE AUTHORITY                       |
+-------------------------------------------------------------+
|                                                             |
|   Original Multisig Owners                                  |
|   +-- threshold of N signers (immutable)                    |
|   +-- can use normal path or recovery path                  |
|   +-- public keys (x, y) stored at account creation         |
|                                                             |
|   NOTE: Grants/delegation system planned but not yet        |
|   implemented in EVM version.                               |
+-------------------------------------------------------------+
```

### Authorization Paths

```
+-------------------------------------------------------------+
|                    AUTHORIZATION PATHS                       |
+-------------------------------------------------------------+
|                                                             |
|  Path 1: Normal (via Source Chain + MPC)                    |
|  +------------+   +-------------+   +------------+          |
|  |Source Chain| > | MPCGateway  | > | EntryPoint |          |
|  +------------+   +-------------+   +------------+          |
|                                            |                |
|                                            v                |
|                                      +---------+            |
|                                      | Account |            |
|                                      +---------+            |
|  - Requires valid MPC signature on txHash                   |
|  - Account verifies owner signatures + sequence             |
|  - Goes through operator infrastructure                     |
|                                                             |
|  Path 2: Recovery (direct, censorship resistant)            |
|  +---------------------+   +---------+                      |
|  | recoverTransaction  | > | Account |                      |
|  +---------------------+   +---------+                      |
|  - Anyone can call with valid signatures                    |
|  - Requires threshold owner signatures                      |
|  - Bypasses MPC infrastructure entirely                     |
|  - Escape hatch for censorship/liveness issues              |
|                                                             |
|  Both paths verify signatures. Security is equivalent.      |
+-------------------------------------------------------------+
```

## Replay Protection

| Mechanism               | Protects Against     | Location       |
| ----------------------- | -------------------- | -------------- |
| `accountSequence`       | Transaction replay   | Account.sol    |
| `executedCalls[txHash]` | MPC payload replay   | MPCGateway.sol |
| `addrHash`              | Wrong source address | Account.sol    |
| `proof`                 | Payload tampering    | Account.sol    |

### Sequence Behavior

- `accountSequence`: Must equal `current + 1` for each transaction
- Incremented after successful execution (both normal and recovery paths)
- Sequence is per-account, not global

## Attackers

| Attacker                                | Capabilities                  | Goal                | Mitigated By                            |
| --------------------------------------- | ----------------------------- | ------------------- | --------------------------------------- |
| **External (non-key holder)**           | Call any public function      | Steal funds         | Signature verification                  |
| **Compromised signer (1 of N)**         | One valid signature           | Partial access      | Threshold requirement                   |
| **Colluding signers (below threshold)** | N-1 signatures                | Reach threshold     | Threshold math                          |
| **Compromised MPC**                     | Valid MPC signatures          | Unauthorized txs    | Account still verifies owner signatures |
| **Malicious executor**                  | Submit payloads to EntryPoint | Unauthorized txs    | Owner signatures required               |
| **Rogue operator**                      | Control operator multisig     | Censor transactions | Recovery path bypasses                  |
| **RoutingRailgun attacker**             | Call routing functions        | Steal staged funds  | onlyController modifier                 |

## Attack Scenarios

| Scenario                                       | Can They Steal Funds? | Why                                  |
| ---------------------------------------------- | --------------------- | ------------------------------------ |
| Attacker calls recoverTransaction with garbage | No                    | Signature verification fails         |
| Attacker replays old transaction               | No                    | Sequence check fails                 |
| Attacker replays payload to different account  | No                    | addrHash check fails                 |
| Attacker modifies payload after signing        | No                    | Proof verification fails             |
| MPC compromised, forges payload                | No                    | Account verifies owner signatures    |
| Operator goes rogue, censors all txs           | No                    | Owners use recoverTransaction        |
| Executor submits invalid payload               | No                    | Owner signatures still required      |
| Attacker calls RoutingRailgun functions        | No                    | onlyController modifier reverts      |
| Threshold signers collude                      | **Yes**               | By design - they control the account |

## Severity Classification

| Outcome                                    | Severity     | Acceptable?              |
| ------------------------------------------ | ------------ | ------------------------ |
| User funds stolen without valid signatures | Catastrophic | Never                    |
| Silent token transfer failure              | Critical     | Never (needs SafeERC20)  |
| Reentrancy drain                           | Critical     | Never (needs mitigation) |
| Transactions delayed (liveness)            | Degraded     | Temporarily OK           |
| MPC infrastructure down                    | Degraded     | Recovery path exists     |
| Single account bricked (bad config)        | Contained    | User error, contained    |
| Threshold signers collude                  | By design    | User's responsibility    |

## Trust Assumptions

| Entity                  | Trusted For                                                      | NOT Trusted For                       |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| **EVM chain**           | Executing contracts correctly                                    | -                                     |
| **Secp256k1Verifier**   | Correct signature verification                                   | -                                     |
| **Operator (multisig)** | Maintaining infrastructure, setting executors, rotating MPC keys | Accessing user funds                  |
| **MPC system**          | Relaying valid payloads                                          | - (account verifies anyway)           |
| **Source chain**        | Transaction origination, signature collection                    | - (censorship -> recovery path)       |
| **Account signers**     | Acting in user's interest                                        | - (threshold protects)                |
| **Railgun protocol**    | Correct shielding/unshielding                                    | -                                     |
| **ERC20 tokens**        | Standard-compliant behavior                                      | Non-standard tokens may fail silently |

## Invariants

These properties must **always** hold:

1. **Funds require signatures**: Funds can only move with threshold valid owner signatures
2. **Sequence monotonic**: accountSequence never decreases
3. **No replay**: A transaction cannot be replayed (same sequence rejected, same txHash rejected)
4. **Source binding**: addrHash mismatch always rejected
5. **Proof binding**: Payload tampering detected via proof verification
6. **Signer immutability**: Public keys and threshold are immutable after creation
7. **Censorship resistance**: Recovery path always available to original owners
8. **Controller exclusivity**: Only controller can operate RoutingRailgun

## External Dependencies

| Dependency                         | Risk                         | Impact if Compromised                 |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| OpenZeppelin contracts             | Bug in standard library      | Contract malfunction                  |
| Secp256k1Verifier (FreshCryptoLib) | Signature verification bug   | Catastrophic                          |
| EVM chain                          | Chain halt, reorg            | Liveness lost, potential double-spend |
| Railgun protocol                   | Protocol bug                 | RoutingRailgun funds at risk          |
| ERC20 tokens                       | Non-standard implementations | Silent transfer failures              |

## Administrative Model

| Contract              | Admin        | Can Do                                | Should Be Able To Do                |
| --------------------- | ------------ | ------------------------------------- | ----------------------------------- |
| MPCVerifier           | ownerAddress | Update MPC public key                 | -                                   |
| MPCGateway            | None         | -                                     | Update verifier address (TODO)      |
| EntryPoint            | ownerAddress | Set/remove executors                  | -                                   |
| AccountFactory        | None         | -                                     | Update entry point, verifier (TODO) |
| Account instances     | None         | -                                     | Immutable by design                 |
| RoutingRailgun        | controller   | Approve tokens, execute calls, refund | -                                   |
| RoutingRailgunFactory | None         | -                                     | Update Railgun address (TODO)       |

### Operator

The **operator** is expected to be a multisig that controls administrative functions across the system. The operator:

- **Can** set executors on EntryPoint
- **Can** rotate MPC public keys on MPCVerifier
- **Cannot** access user funds (no signature authority)
- **Cannot** modify user accounts (accounts are immutable)
- **Can** affect liveness by removing executors (but recovery path exists)

### Admin Limitations

- Adding a malicious executor doesn't compromise funds (signatures still protect)
- Rotating MPC key requires careful coordination with off-chain MPC system
- Account code is locked at creation (upgrade by creating new account)

## Known Issues & Accepted Risks

| Issue                            | Status           | Rationale                                     |
| -------------------------------- | ---------------- | --------------------------------------------- |
| No SafeERC20 usage               | **Needs fix**    | Silent failures with non-standard tokens      |
| No reentrancy guards             | **Needs review** | External calls with value in Account.\_call() |
| Debug events in production       | **Needs fix**    | Should be removed or gated                    |
| O(n\*m) pubkey validation        | Accepted         | N and M are small in practice                 |
| No grants/delegation             | **Planned**      | Simpler model for now, to be added            |
| AccountFactory publicly callable | **Needs fix**    | Should be EntryPoint-only                     |

## Revision History

| Date       | Author  | Changes              |
| ---------- | ------- | -------------------- |
| 2026-01-30 | Initial | Created threat model |
