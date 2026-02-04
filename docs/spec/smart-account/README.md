---
title: Smart Account
stage: Draft
category: Contract
kind: instantiation
author: S16 Research Ventures <team@s16.ventures>
created: 2025-05-08
modified: 2026-02-04
requires:
version compatibility:
---

## Synopsis

This document specifies the packet data structure, state machine handling logic, and encoding details for implementation of Smart Account contracts.

## Motivation

Smart Account is a version of the Interchain Auth protocol specifically designed for EVM chains. It utilizes a smart account bound to the user's public keys on the sending chain and is based on cryptographic proof rather than trust. Smart Account allows an account on a Cosmos chain to invoke functionality on EVM-compatible blockchain contracts, with authentication via threshold multi-signature verification.

This protocol establishes a unified authentication mechanism that operates seamlessly across various EVM networks. With Smart Account, accounts on the Cosmos chain can securely access and utilize the functionalities of smart accounts on EVM chains, ensuring that cross-chain interactions are both secure and verifiable.

## Definitions

- `Smart Account`: A blockchain account that supports threshold multi-signature verification, allowing M-of-N signers to authorize transactions.
- `EntryPoint`: The contract that receives cross-chain payloads and routes them to user Accounts.
- `AccountFactory`: A factory contract for deploying new Account instances via CREATE2.
- `Secp256k1Verifier`: A contract implementing EIP-7212 compatible secp256k1 signature verification (used by MPCVerifier; Account uses native ecrecover).
- `addrHash`: A keccak256 hash of the source chain address, used to bind the account to a specific source identity.
- `messageHash`: A hash computed on the source chain that gets signed by account owners.
- `proof`: A binding value `sha256(messageHash || data)` that links the signed message to the execution payload.

## Desired Properties

- `Permissionless`: Smart Account can be created by any account on any EVM chain that integrates the Smart Account protocol without the need for third-party approval.
- `Threshold Security`: Requires M-of-N valid signatures to authorize transactions.
- `Censorship Resistance`: Recovery path allows direct transaction execution bypassing infrastructure.
- `Immutability`: Account signers and threshold cannot be changed after creation.

## Technical Specification

### General Design

A chain that integrates GMP Module can create a smart account on EVM chains and control them through the MPC Gateway. The smart account is secured by verifying threshold signatures from the user's public keys before processing the transaction.

```
Normal Path:
┌──────────────┐     ┌─────────────┐     ┌────────────┐     ┌─────────┐
│ Source Chain │ --> │ MPC Gateway │ --> │ EntryPoint │ --> │ Account │
└──────────────┘     └─────────────┘     └────────────┘     └─────────┘

Recovery Path (censorship resistant):
┌─────────────────────┐     ┌─────────┐
│ recoverTransaction  │ --> │ Account │
└─────────────────────┘     └─────────┘
```

### Data Structures

#### Account Contract

```solidity
interface IAccount {
    // Errors
    error InvalidSignature();
    error InvalidThreshold();
    error InvalidPubKey();
    error NotEntryPoint();
    error InvalidSourceAddress();
    error InvalidProof();
    error InvalidAuthorization();
    error InvalidSequence();
    error InvalidInputLength();
    error NotExecutable();
    error InvalidPayload();

    // Events
    event AccountInitialized();
    event TransactionExecuted(address indexed dest, uint256 value, bytes data);

    // State (in implementation)
    // EntryPoint private immutable entryPoint;
    // bytes32[] private xPubKeys;        // X coordinates of owner public keys
    // bytes32[] private yPubKeys;        // Y coordinates of owner public keys
    // bytes32 private immutable addrHash; // Hash of source chain address
    // uint64 private threshold;           // Required number of signatures
    // uint64 public accountSequence;      // Replay protection counter

    function validateOperation(
        string calldata sourceAddress,
        bytes32 messageHash,
        uint8[] memory v,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 proof,
        uint64 sequence,
        bytes calldata data
    ) external view returns (bool, string memory);

    function executeTransactions(
        address[] calldata destList,
        uint256[] calldata valueList,
        bytes[] calldata dataList
    ) external returns (bool);

    function recoverTransaction(
        uint8[] memory v,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes calldata txPayload
    ) external returns (bool);

    receive() external payable;
}
```

#### AccountFactory Contract

```solidity
interface IAccountFactory {
    // Errors
    error InvalidThreshold();
    error InvalidSignature();
    error FailedDeployAccount();
    error InvalidAuthorization();
    error AccountAlreadyExists();

    function createAccount(
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 threshold,
        string calldata sourceAddress
    ) external returns (address);

    function computeAddress(
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint64 threshold
    ) external view returns (address);

    function getAccount(string calldata sourceAddress) external view returns (address);
}
```

#### EntryPoint Contract

```solidity
interface IEntryPoint {
    // Errors
    error PayloadTooShort();
    error UnsupportedCategory();
    error InvalidSignature();
    error TransactionFailed();
    error TransactionError(string reason);
    error InvalidAuthorization();
    error NotExecutor();
    error InvalidPayloadArray();
    error InvalidTargetAccount();

    // Events
    event AccountCreated(address indexed accountAddress);
    event TransactionHandled(address indexed target, uint256 indexed sequence);
    event SignatureValidated(bytes32 indexed messageHash, bytes32[] indexed r, bytes32[] indexed s);
    event Executed(string sourceChain, string sourceAddress);
    event DebugReason(string str);

    function executePayload(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) external returns (bool);

    function setExecutor(address _executor, bool _isExecutor) external;
}
```

### Sub-protocols

#### Account Creation (Category 1)

When EntryPoint receives a payload with `category == 1`:

```
1. Decode payload: (totalSigners, threshold, [x[], y[]])
2. Call AccountFactory.createAccount(entryPoint, x, y, threshold, sourceAddress)
3. Factory deploys Account via CREATE2 with deterministic address
4. Emit AccountCreated event
```

#### Transaction Execution (Category 2)

When EntryPoint receives a payload with `category == 2`:

```
1. Decode payload: (target, messageHash, proof, sequence, numberSigners, [v[], r[], s[], x[], y[]], txPayload)
2. Call Account.validateOperation(sourceAddress, messageHash, v, r, s, x, y, proof, sequence, txPayload)
3. If valid, decode txPayload into (destList[], valueList[], dataList[])
4. Call Account.executeTransactions(destList, valueList, dataList)
5. Emit TransactionHandled event
```

#### validateOperation

Validates a transaction request in the normal path:

```
1. Compare hash(sourceAddress) against stored addrHash (source binding)
2. Check sequence == accountSequence + 1 (replay protection)
3. Verify proof == sha256(messageHash || data) (payload binding)
4. Check provided public keys are subset of stored xPubKeys/yPubKeys
5. Check number of signatures >= threshold
6. Check for duplicate public keys
7. For each signature: verify against messageHash using native ecrecover (v + 27, r, s)
8. Return (true, "") if all checks pass
```

#### recoverTransaction

Censorship-resistant recovery path that bypasses MPC infrastructure:

```
1. Check array lengths match
2. Check number of signatures >= threshold
3. Compute messageHash = sha256(txPayload)
4. For each signature:
   a. Verify public key is in stored xPubKeys/yPubKeys
   b. Verify signature against messageHash
5. Validate txPayload starts with recoverProposal selector
6. Decode txPayload: (sequence, dest, value, data)
7. Check sequence == accountSequence + 1
8. Execute _call(dest, value, data)
9. Increment accountSequence
```

The `recoverProposal` function signature defines the expected payload format:

```solidity
function recoverProposal(uint64 sequence, address dest, uint256 value, bytes calldata data) external;
```

This function always reverts and exists only as a template for constructing `txPayload`.

### Validation Requirements

Every transaction should validate:

| Requirement    | Normal Path                                | Recovery Path                     |
| -------------- | ------------------------------------------ | --------------------------------- |
| chain_id       | In MPC txHash                              | **NOT VALIDATED** (TODO)          |
| target_address | In MPC txHash, routed by Gateway           | Implicit (calling the contract)   |
| source_address | `compareSourceAddress()`                   | Not applicable (pubkey auth)      |
| sequence       | `sequence == accountSequence + 1`          | `sequence == accountSequence + 1` |
| auth           | Owner signs messageHash, MPC signs payload | Owner signs txPayload directly    |

### Security Considerations

#### Signature Verification

- Uses native `ecrecover` precompile for secp256k1 ECDSA verification
- Signatures include recovery id `v` (0-3 from MPC, +27 for ecrecover)
- Verifies threshold number of valid signatures from registered public keys
- Checks for duplicate public keys to prevent signature reuse
- Includes signature malleability protection (EIP-2)

#### Replay Protection

- `accountSequence` increments after each successful transaction
- Sequence must be exactly `accountSequence + 1` (no gaps, no reuse)

#### Source Binding

- `addrHash` is set at account creation from `keccak256(sourceAddress)`
- All transactions must originate from the bound source address

#### Proof Binding

- `proof = sha256(messageHash || data)` binds the signed message to the execution payload
- Prevents substitution of execution data after signing

### Known Limitations

- Recovery path does not validate `chain_id` (cross-chain replay risk if same account on multiple chains)
- Owner signature doesn't directly bind to execution `data` in normal path (relies on MPC for payload integrity)
- Debug events should be removed for production

## Example Implementations

- GMP Module [Go Implementation](https://github.com/s16rv/sourdough/tree/main/x/gmp)
- Smart Account [Solidity Implementation](https://github.com/s16rv/sourdough-solidity-contracts/tree/main/contracts/smart-account)

## History

- May 8, 2025 - Draft written
- January 30, 2026 - Updated to reflect current implementation (multisig model, batch transactions, recovery path, removed recover address field)
- February 4, 2026 - Updated signature verification to use native ecrecover with v parameter instead of Secp256k1Verifier

## Copyright

All content herein is licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
