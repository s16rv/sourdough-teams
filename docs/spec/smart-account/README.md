---
title: Smart Account
stage: Draft
category: Contract
kind: instantiation
author: S16 Research Ventures <team@s16.ventures>
created: 2025-05-08
modified: 2026-02-03
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
- `Secp256k1Verifier`: A contract implementing EIP-7212 compatible secp256k1 signature verification.
- `addrHash`: A keccak256 hash of the source chain address, used to bind the account to a specific source identity.
- `signBytes`: The AMINO_JSON message signed by account owners on the source chain. Contains an embedded hash commitment to the txPayload.
- `txPayload`: The ABI-encoded transaction payload containing chainId, accountAddress, sequence, and calls to execute.
- `txPayloadHashOffset`: The byte offset within signBytes where the keccak256(txPayload) hash is embedded (pointing to the "0x" prefix).

## Desired Properties

- `Permissionless`: Smart Account can be created by any account on any EVM chain that integrates the Smart Account protocol without the need for third-party approval.
- `Threshold Security`: Requires M-of-N valid signatures to authorize transactions.
- `Censorship Resistance`: Recovery path allows direct transaction execution bypassing infrastructure.
- `Immutability`: Account signers and threshold cannot be changed after creation.
- `Hash Commitment`: Owner signatures cryptographically bind to the exact transaction payload via hash commitment in signBytes.

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

#### Payload Format (Category 2 - Transaction Execution)

```
┌─────────────────────────┬────────────┐
│ category (uint8)        │ 32 bytes   │
├─────────────────────────┼────────────┤
│ signBytesLength (uint256)│ 32 bytes  │
├─────────────────────────┼────────────┤
│ txPayloadHashOffset     │ 32 bytes   │
├─────────────────────────┼────────────┤
│ numberSigners (uint64)  │ 32 bytes   │
├─────────────────────────┼────────────┤
│ signBytes (bytes)       │ variable   │  ← AMINO_JSON message with embedded hash
├─────────────────────────┼────────────┤
│ signatures              │ 128 × N    │  ← (r, s, x, y) for each signer
├─────────────────────────┼────────────┤
│ txPayload (bytes)       │ variable   │  ← ABI-encoded transaction data
└─────────────────────────┴────────────┘
```

#### txPayload Structure

```
ABI-encoded: (string chainId, address accountAddress, uint64 sequence, uint64 count)
followed by packed calls:
┌─────────────────────────┬────────────┐
│ dest (address)          │ 32 bytes   │
├─────────────────────────┼────────────┤
│ value (uint256)         │ 32 bytes   │
├─────────────────────────┼────────────┤
│ dataLen (uint256)       │ 32 bytes   │
├─────────────────────────┼────────────┤
│ data (bytes)            │ dataLen    │
└─────────────────────────┴────────────┘
(repeated for each call)
```

#### Account Contract

```solidity
interface IAccount {
    // Errors
    error InvalidSignature();
    error InvalidThreshold();
    error InvalidPubKey();
    error NotEntryPoint();
    error InvalidSourceAddress();
    error InvalidAuthorization();
    error InvalidSequence();
    error InvalidInputLength();
    error InvalidPubKeyLength();
    error InvalidSignatureLength();
    error DuplicatePubKey();
    error NotExecutable();
    error InvalidPayload();
    error InvalidHashOffset();
    error InvalidHexPrefix();
    error InvalidHexCharacter();
    error InvalidHashCommitment();

    // Events
    event AccountInitialized(address indexed verifier);
    event TransactionExecuted(address indexed dest, uint256 value, bytes data);

    // State (in implementation)
    // address private immutable verifier;
    // EntryPoint private immutable entryPoint;
    // bytes32[] private xPubKeys;        // X coordinates of owner public keys
    // bytes32[] private yPubKeys;        // Y coordinates of owner public keys
    // bytes32 private immutable addrHash; // Hash of source chain address
    // uint64 private threshold;           // Required number of signatures
    // uint64 public accountSequence;      // Replay protection counter

    function validateOperation(
        string calldata sourceAddress,
        bytes calldata signBytes,
        uint256 txPayloadHashOffset,
        bytes32[] memory r,
        bytes32[] memory s,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 sequence,
        bytes calldata txPayload
    ) external view returns (bool, string memory);

    function executeTransactions(
        address[] calldata destList,
        uint256[] calldata valueList,
        bytes[] calldata dataList
    ) external returns (bool);

    function recoverTransaction(
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
    error InvalidChainId();
    error ZeroAddress();
    error OnlyOwner();

    // Events
    event AccountCreated(address indexed accountAddress);
    event TransactionHandled(address indexed target, uint256 indexed sequence);
    event SignatureValidated(bytes32 indexed signBytesHash, bytes32[] indexed r, bytes32[] indexed s);
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
1. Decode header: (signBytesLength, txPayloadHashOffset, numberSigners)
2. Extract signBytes, signatures (r[], s[], x[], y[]), and txPayload
3. Decode txPayload header: (chainId, accountAddress, sequence)
4. Validate chainId matches expected chain ID
5. Validate accountAddress matches account for sourceAddress
6. Call Account.validateOperation(sourceAddress, signBytes, txPayloadHashOffset, r, s, x, y, sequence, txPayload)
7. If valid, decode calls from txPayload
8. Call Account.executeTransactions(destList, valueList, dataList)
9. Emit TransactionHandled event
```

#### validateOperation

Validates a transaction request in the normal path:

```
1. Compare hash(sourceAddress) against stored addrHash (source binding)
2. Check sequence == accountSequence + 1 (replay protection)
3. Extract hash from signBytes at txPayloadHashOffset
4. Verify keccak256(txPayload) == extractedHash (hash commitment)
5. Validate signature array lengths match
6. Check number of signatures >= threshold
7. Check for duplicate public keys
8. Check provided public keys are subset of stored xPubKeys/yPubKeys
9. For each signature: verify against sha256(signBytes) using Secp256k1Verifier
10. Return (true, "") if all checks pass
```

The hash extraction process:

1. Read 66 characters starting at txPayloadHashOffset (expects "0x" + 64 hex chars)
2. Verify "0x" prefix exists
3. Parse hex string to bytes32
4. Compare against keccak256(txPayload)

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
8. Increment accountSequence (before external call - CEI pattern)
9. Execute _call(dest, value, data)
```

The `recoverProposal` function signature defines the expected payload format:

```solidity
function recoverProposal(uint64 sequence, address dest, uint256 value, bytes calldata data) external;
```

This function always reverts and exists only as a template for constructing `txPayload`.

### Validation Requirements

Every transaction should validate:

| Requirement    | Normal Path                                       | Recovery Path                     |
| -------------- | ------------------------------------------------- | --------------------------------- |
| chain_id       | Validated in EntryPoint against EXPECTED_CHAIN_ID | **NOT VALIDATED** (TODO)          |
| target_address | Validated in EntryPoint against account lookup    | Implicit (calling the contract)   |
| source_address | `compareSourceAddress()`                          | Not applicable (pubkey auth)      |
| sequence       | `sequence == accountSequence + 1`                 | `sequence == accountSequence + 1` |
| hash_commit    | `keccak256(txPayload) == extractedHash`           | Not applicable (direct signing)   |
| auth           | Owner signs sha256(signBytes), MPC signs payload  | Owner signs sha256(txPayload)     |

### Security Considerations

#### Signature Verification

- Uses secp256k1 ECDSA via `Secp256k1Verifier` (EIP-7212 compatible)
- Verifies threshold number of valid signatures from registered public keys
- Checks for duplicate public keys to prevent signature reuse
- Normal path: signatures verified against `sha256(signBytes)`
- Recovery path: signatures verified against `sha256(txPayload)`

#### Replay Protection

- `accountSequence` increments after each successful transaction
- Sequence must be exactly `accountSequence + 1` (no gaps, no reuse)
- Sequence is incremented BEFORE external calls (Checks-Effects-Interactions pattern)

#### Source Binding

- `addrHash` is set at account creation from `keccak256(sourceAddress)`
- All transactions must originate from the bound source address

#### Hash Commitment (Normal Path)

- Owner signs `sha256(signBytes)` on the source chain
- `signBytes` contains an embedded `keccak256(txPayload)` hash at a known offset
- Account extracts and verifies this hash commitment before execution
- This cryptographically binds the owner's signature to the exact transaction payload
- Prevents any party (including compromised MPC) from substituting transaction data

#### Chain ID Validation

- EntryPoint validates `chainId` in txPayload against `EXPECTED_CHAIN_ID`
- Currently uses string comparison (e.g., "ethereum-1")
- TODO: Migrate to numeric `block.chainid` for stronger validation

### Known Limitations

- Recovery path does not validate `chain_id` (cross-chain replay risk if same account on multiple chains)
- Chain ID validation uses string comparison instead of numeric `block.chainid`
- Debug events (DebugReason) are retained for production debugging (zero gas cost when not triggered)

## Example Implementations

- GMP Module [Go Implementation](https://github.com/s16rv/sourdough/tree/main/x/gmp)
- Smart Account [Solidity Implementation](https://github.com/s16rv/sourdough-solidity-contracts/tree/main/contracts/smart-account)

## History

- May 8, 2025 - Draft written
- January 30, 2026 - Updated to reflect current implementation (multisig model, batch transactions, recovery path, removed recover address field)
- February 3, 2026 - Updated payload format with hash commitment (signBytes + txPayloadHashOffset), chainId validation

## Copyright

All content herein is licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
