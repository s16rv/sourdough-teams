---
title: Smart Account
stage: Draft
category: Contract
kind: instantiation
author: S16 Research Ventures <team@s16.ventures>
created: 2025-05-08
modified: 2025-05-08
requires:
version compatibility:
---

## Synopsis

This standard document specifies the packet data structure, state machine handling logic, and encoding details for implementation of Smart Account contracts.

## Motivation

Smart Account is a version of the Interchain Auth protocol specifically designed for EVM chains. It utilizes a smart account bound to the user's public key on the sending chain and is based on cryptographic proof rather than trust. Smart Account allows an account on a Cosmos chain to invoke functionality on EVM-compatible blockchain contracts, provided the contract addresses are generated from the user's public key.

This protocol establishes a unified authentication mechanism that operates seamlessly across various EVM networks. With Smart Account, accounts on the Cosmos chain can securely access and utilize the functionalities of smart accounts on EVM chains, ensuring that cross-chain interactions are both secure and verifiable. This approach minimizes reliance on trust-based intermediaries, enabling users to engage with decentralized applications and assets distributed across multiple EVM blockchains, fostering interoperability and scalability within the broader blockchain ecosystem.

## Definitions

- `Smart Account`: A blockchain account that incorporates programmable logic and smart contract functionality, allowing users to automate transactions, manage assets, and interact with decentralized applications in a customizable manner.
- `Axelar GMP`: A decentralized protocol that facilitates secure and seamless communication and data transfer between different blockchain networks, enabling cross-chain interactions and interoperability.
- `GMP Module`: The module that build GMP messages and send them to Axelar through IBC Transfer.

## Desired Properties

- `Permissionless`: Smart Account can be created by any account on any EVM chain that integrates the Smart Account protocol without the need for third-party approval or permission.

## Technical Specification

### General Design

A chain that integrates GMP Module can create a smart account on EVM chains and control them like a normal account through Axelar GMP. The smart account is secured by verifying the signature of the user from the sending chain before processing the transaction on behalf of the user.

This specification details the workflow for executing Smart Account transactions across EVM chains via Axelar GMP. Users initiate the process by submitting GMP messages on the Sending Chain, which are then packaged into IBC transfer packets and sent to the Axelar Chain for confirmation and approval. The Axelar Relayer facilitates the communication between the Axelar Chain and the EVM Chain, ensuring that the necessary data is accurately transmitted. Upon receipt, the Smart Account Contracts on the EVM Chain process the request, verifying the user's signature through the Signature Verifier Contract before executing the transaction. This process ensures secure and verifiable cross-chain interactions, leveraging cryptographic proof to maintain the integrity of the transaction.

### Data Structures

Account Factory Contract is a smart contract that creates smart accounts on EVM chains. It stores the verifier address and the smart account addresses that have been created by the signer.

```typescript
interface AccountFactory {
    accounts: Record<bytes, string>;
    verifier: string;
}
```

Account Contract is a smart contract that validates the signature of the user and executes the transaction on behalf of the user.

```typescript
interface Account {
    recover: string; // The address with recovery rights for the account.
    verifier: string; // The address of the verifier.
    entryPoint: string; // The address of the entry point.
    x: string; // The x part of the public key.
    y: string; // The y part of the public key.
    addrHash: string; // The hash address on the source chain.
    accountSequence: number; // The sequence number of the account.
}
```

### Sub-protocols

#### Entrypoint Contract

`Entrypoint Contract` is a Axelar Executable contract that also acts as the entry point for smart accounts. It validates inputs and controls execution.

```solidity
interface IEntrypoint {
    /**
     * @notice Executes logic on the destination chain when a cross-chain message is received.
     * @param _sourceChain The chain where the transaction originated.
     * @param _sourceAddress The address on the source chain.
     * @param _payload The encoded GMP message from the source chain.
     */
    function _execute(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) internal;
    /**
     * @dev Creates a new account using the account factory.
     * @param recover The address with recovery rights for the new account.
     * @param messageHash The hash for signature verification.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param sourceAddress The address on the source chain.
     * @return accountAddress The address of the new account.
     */
    function _createAccount(
        address recover,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y,
        string calldata sourceAddress
    ) internal returns (address);
    /**
     * @dev Executes a transaction on the destination chain by validating the signature.
     * @param target The address to execute the transaction.
     * @param messageHash The hash for signature verification.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param proof The proof of the transaction.
     * @param sequence The transaction sequence number.
     * @param sourceAddress The address on the source chain.
     * @param txPayload The transaction payload.
     */
    function _handleTransaction(
        address target,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        uint256 sequence,
        string calldata sourceAddress,
        bytes calldata txPayload
    ) internal;
}
```

#### Account Factory Contract

`Account Factory Contract` is a smart contract called once during the setup of a new smart account contract. It is responsible for initializing the smart account contract and setting up the necessary state.

```solidity
interface IAccountFactory {
    /**
     * @dev Creates a new account contract using the specified parameters and deploys it with CREATE2.
     * @param recover The address with recovery rights.
     * @param entryPoint The address of the entry point contract.
     * @param messageHash The hash for verifying the signer's identity.
     * @param r The r part of the signature.
     * @param s The s part of the signature.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param sourceAddress The address on the source chain.
     * @return accountAddress The address of the new account contract.
     */
    function createAccount(
        address recover,
        address entryPoint,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y,
        string calldata sourceAddress
    ) external returns (address);
    /**
     * @dev Computes the address of an account contract to be deployed with CREATE2, without deploying it.
     * @param recover The address with recovery rights.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain.
     * @return The computed address for the contract.
     */
    function computeAddress(
        address recover,
        address entryPoint,
        bytes32 x,
        bytes32 y,
        bytes32 addrHash
    ) external view returns (address);

    /**
     * @dev Returns the list of accounts created by a specific signer.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain.
     * @return The account address created by the signer.
     */
    function getAccount(bytes32 x, bytes32 y, bytes32 addrHash) external view returns (address);
}
```

##### Signature Verifier Contract

`Signature Verifier Contract` is a smart contract that verifies the signature of the user on the caller chain using secp256k1 elliptic curve.

```solidity
interface ISignatureVerifier {
    /**
     * @dev Verifies a signature using the secp256k1 elliptic curve.
     * @param verifier The address of the verifier.
     * @param message_hash The hash of the message to verify.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @return bool True if the signature is valid, false otherwise.
     */
    function verifySignature(
        address verifier,
        bytes32 message_hash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y
    ) internal view returns (bool)
```

#### Account Contract

`Account Contract` is a smart contract owned by the user. It validates execution payloads using the user’s signature and the public key from the source chain before processing.

```solidity
interface IAccount {
    /**
     * @dev Validates an operation by verifying the provided signature.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param messageHash The hash of the message to be validated.
     * @param r Part of the signature (r).
     * @param s Part of the signature (s).
     * @param proof The proof of the transaction.
     * @param sequence The sequence number of the transaction.
     * @param data The data to pass to the destination contract.
     * @return bool indicating whether the signature is valid.
     */
    function validateOperation(
        string calldata sourceAddress,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 proof,
        uint256 sequence,
        bytes calldata data
    ) external view returns (bool);
    /**
     * @dev Executes a transaction to a specified destination address.
     * @param dest The destination address of the transaction.
     * @param value The amount of Ether to send.
     * @param data The data to pass to the destination.
     * @return bool indicating whether the transaction was successful.
     */
    function executeTransaction(address dest, uint256 value, bytes calldata data) external returns (bool);
}
```

#### Smart Account Sequence

The smart account sequence is an increasing number on the account contract that is used to ensure that the smart account transaction is processed in the correct order. The sequence is incremented by 1 for each valid transaction.

The sending chain must keep track of the sequence number for the account on the account contract. The sending chain will increment the sequence number for the account on the account contract after a successful smart account transaction.

## Example Implementations

- GMP Module [Go Implementation](https://github.com/s16rv/sourdough/tree/main/x/gmp)
- Smart Account [Solidity Implementation](https://github.com/s16rv/sourdough-solidity-contracts/tree/main/contracts/smart-account)

## History

May 8, 2025 - Draft written

## Copyright

All content herein is licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
