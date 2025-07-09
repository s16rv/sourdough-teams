---
title: Gateway
stage: Draft
category: Contract
kind: instantiation
author: S16 Research Ventures <team@s16.ventures>
created: 2025-07-09
modified: 2025-07-09
requires:
version compatibility:
---

## Synopsis

This standard document specifies the packet data structure, state machine handling logic, and encoding details for implementation of Gateway contracts.

## Motivation

Gateway is a crucial component for facilitating cross-chain communication within the Interchain Auth protocol. It acts as an intermediary, enabling secure and verifiable message passing between different blockchain networks. The Gateway ensures that transactions originating from one chain can be accurately and securely processed on another, maintaining data integrity and trust across disparate environments.

This protocol establishes a unified communication mechanism that operates seamlessly across various blockchain networks. With Gateway, applications on one chain can securely interact with contracts and functionalities on other chains, ensuring that cross-chain interactions are both secure and verifiable. This approach minimizes reliance on trust-based intermediaries, enabling users to engage with decentralized applications and assets distributed across multiple blockchains, fostering interoperability and scalability within the broader blockchain ecosystem.

## Definitions

- `Gateway`: A smart contract that facilitates secure and verifiable message passing between different blockchain networks.
- `GMP Module`: The module that build GMP messages with the user's signatures.

## Desired Properties

- `Permissionless`: No changes are required to integrate. Each distinct network needs to stand on its own, and no internal changes need to be required to any such network to connect it.
- `Modular`: The Gateway specifies the messages semantics for receiving messages and Verifier specifies the validation rules that are applied to provide safety. Verifier contract logic may be upgraded or improved without requiring any interface changes, as the applications only need to speak to the Gateway.

## Technical Specification

### General Design

A chain that integrates GMP Module can send messages to other chains through the Gateway. The Gateway ensures the integrity and authenticity of these messages before processing them on the destination chain.

This specification details the workflow for executing cross-chain transactions through the Gateway. Users initiate the process by submitting GMP messages on the Sending Chain, which are then sent to the MPC service for signing. The MPC service validates the user's signature and signs the payload hash. Once signed, the MPC service submits the signed payload to the Gateway for approval and execution. Upon receipt, the Gateway Contract processes the request by verifying the MPC signature before executing the transaction. This process ensures secure and verifiable cross-chain interactions, leveraging cryptographic proof to maintain the integrity of the transaction.

```mermaid
sequenceDiagram
    participant User
    participant CosmosSDK as Cosmos SDK Chain
    participant MPC as MPC Service
    participant Relayer
    participant GatewayDest as Destination Gateway
    participant SmartAccount as Smart Account
    participant DestContract as Destination Contract

    User->>CosmosSDK: Submit Intent (destinationChain, contractAddress, msg)
    CosmosSDK->>CosmosSDK: Validate Intent
    CosmosSDK->>CosmosSDK: Create payload (msg, userSignature, pubkey, payloadHash)
    CosmosSDK->>MPC: Send payload and userSignature
    MPC->>MPC: Validate userSignature, Sign payloadHash
    MPC->>MPC: Store MPC-signed payloadHash
    MPC->>Relayer: Emit ContractCall(sourceAddress, destinationChain, contractAddress, payloadHash, payload, transactionId)
    Relayer->>GatewayDest: approveContractCall(params, transactionId)
    GatewayDest->>GatewayDest: Verify MPC Signature, Store Approval
    GatewayDest->>GatewayDest: Emit ContractCallApproved(transactionId, sourceChain, sourceAddress, contractAddress, payloadHash)
    GatewayDest->>GatewayDest: executeContractCall(transactionId, sourceChain, sourceAddress, contractAddress, payload, payloadHash)
    GatewayDest->>GatewayDest: Validate Approval
    GatewayDest->>SmartAccount: Forward payload to execute
    SmartAccount->>SmartAccount: Verify User Signature
    SmartAccount->>DestContract: Execute payload
    DestContract->>SmartAccount: Return Result
    SmartAccount->>User: Notify Execution (via UI or callback)
```

### Data Structures

Gateway Contract is a smart contract that receives and processes cross-chain messages.

```typescript
interface Gateway {
    private approvedCalls: Map<string, boolean> = new Map(); // mapping of tx hash to approval status
    private executedCalls: Map<string, boolean> = new Map(); // mapping of tx hash to execution status
    private verifiers: Map<string, string> = new Map(); // mapping of method to verifier address
    private entryPointAddress: string; // smart account entrypoint contract address
    private ownerAddress: string; // Owner address of the Gateway contract
    private mpcPublicKey: string; // MPC public key encoded
}
```

### Sub-protocols

#### Gateway Contract

`Gateway Contract` is a smart contract that acts as the communication channel for cross-chain messages. It receives transaction payloads from the sending chain, which include the execution payload, MPC signature, user's signature, and other message semantics. The Gateway validates these inputs through a Verifier contract and forwards valid payloads to the Smart Account contract for execution.

```typescript
interface ContractCallParams {
    transactionId: string;
    sourceChain: string;
    sourceAddress: string;
    destinationChain: string;
    contractAddress: string;
    payload: string; // Hex string
    mpcSignature: string; // Hex string
    verifierType: string;
}

interface ContractCallApprovedEvent {
    transactionId: string;
    sourceChain: string;
    sourceAddress: string;
    contractAddress: string;
    payloadHash: string;
}

interface ContractCallExecutedEvent {
    transactionId: string;
    sourceChain: string;
    sourceAddress: string;
    contractAddress: string;
    payloadHash: string;
}

class GatewayContract {
    private approvedCalls: Map<string, boolean> = new Map();
    private executedCalls: Map<string, boolean> = new Map();
    private verifiers: Map<string, string> = new Map();
    private entryPointAddress: string;
    private ownerAddress: string;
    private mpcPublicKey: string;

    constructor(ownerAddress: string, entryPointAddress: string, mpcPublicKey: string, verifiers: Map<string, string>) {
        this.ownerAddress = ownerAddress;
        this.entryPointAddress = entryPointAddress;
        this.mpcPublicKey = mpcPublicKey;
        this.verifiers = verifiers;
    }

    // Approve a cross-chain contract call
    async approveContractCall(params: ContractCallParams, transactionId: string): Promise<bool> {
        const { sourceChain, sourceAddress, contractAddress, payloadHash, mpcSignature, verifierType } = params;

        // Call Verifier to validate MPC signature and transaction ID
        const verifierAddress = this.verifiers.get(verifierType);
        if (!verifierAddress) {
            throw new Error("Verifier not found");
        }
        const verifier = new Verifier(verifierAddress);
        const isValidSignature = await verifier.validateMPCSignature(payloadHash, mpcSignature);
        if (!isValidSignature) {
            return false;
        }

        // Generate key for approval
        const key = this.generateKey(transactionId, sourceChain, sourceAddress, contractAddress, payloadHash);

        // Verify transaction ID is unique
        if (this.approvedCalls.get(key)) {
            throw new Error("Transaction ID already used");
        }

        // Mark transaction as approved
        this.approvedCalls.set(key, true);

        // Emit ContractCallApproved event (simulated)
        this.emitEvent<ContractCallApprovedEvent>("ContractCallApproved", {
            transactionId,
            sourceChain,
            sourceAddress,
            contractAddress,
            payloadHash,
        });

        return true;
    }

    // Execute a contract call (called by relayer)
    async executeContractCall(
        transactionId: string,
        sourceChain: string,
        sourceAddress: string,
        contractAddress: string,
        payload: string, // Hex string
        payloadHash: string // Hex string
    ): Promise<void> {
        // Generate key for approval
        const key = this.generateKey(transactionId, sourceChain, sourceAddress, contractAddress, payloadHash);

        const isApproved = await this.approveContractCall(params, transactionId);
        if (!isApproved) {
            throw new Error("Transaction not approved");
        }

        // Verify transaction is approved and not executed
        if (!this.approvedCalls.get(key)) {
            throw new Error("Transaction not approved");
        }
        if (this.executedCalls.get(key)) {
            throw new Error("Transaction already executed");
        }

        // Verify payload hash
        const computedHash = keccak256(payload);
        if (computedHash !== payloadHash) {
            throw new Error("Invalid payload hash");
        }

        // Mark transaction as executed
        this.executedCalls.set(key, true);
        this.approvedCalls.set(key, false); // Clear approval

        // Forward payload to smart account
        const success = await this.callSmartAccount(payload);
        if (!success) {
            throw new Error("Smart account execution failed");
        }

        // Emit ContractCallExecuted event
        this.emitEvent<ContractCallExecutedEvent>("ContractCallExecuted", {
            transactionId,
            sourceChain,
            sourceAddress,
            contractAddress,
            payloadHash,
        });
    }

    // Update Verifier address (for upgradability)
    async updateVerifier(type: string, address: string): Promise<void> {
        if (!this.isOwner()) {
            throw new Error("Only owner can update verifier");
        }
        this.verifiers.set(type, address);
    }

    // Helper: Generate key for approval/executed mapping
    private generateKey(
        transactionId: string,
        sourceChain: string,
        sourceAddress: string,
        contractAddress: string,
        payloadHash: string
    ): string {
        return keccak256(
            JSON.stringify({
                transactionId,
                sourceChain,
                sourceAddress,
                contractAddress,
                payloadHash,
            })
        );
    }

    // Helper: Simulate calling smart account
    private async callSmartAccount(payload: string): Promise<boolean> {
        // Pseudo-code: Call smart account's executePayload function
        // In a real implementation, use ethers.js or similar to call contract
        try {
            await callContract(this.smartAccountAddress, "executePayload", [payload]);
            return true;
        } catch {
            return false;
        }
    }

    // Helper: Simulate event emission
    private emitEvent<T>(eventName: string, data: T): void {
        console.log(`Event ${eventName}:`, data); // Placeholder for event emission
    }

    private isOwner(): boolean {
        return this.ownerAddress === this.sender;
    }
}
```

### Verifier Contract

Verifier contract is responsible for validating the MPC signature and transaction ID. It ensures that the signature is valid and the transaction ID is unique.

```typescript
class Verifier {
    private usedTransactionIds: Map<string, boolean> = new Map();
    private mpcPublicKey: string; // Hex string

    constructor(mpcPublicKey: string) {
        this.mpcPublicKey = mpcPublicKey;
    }

    // Validate MPC signature
    async validateMPCSignature(payloadHash: string, mpcSignature: string): Promise<boolean> {
        // Verify threshold signature (e.g., BLS or Schnorr)
        const signer = await this.recoverSigner(payloadHash, mpcSignature);
        return this.verifyThresholdSignature(signer, this.mpcPublicKey);
    }

    // Check transaction ID uniqueness
    async isTransactionUnique(transactionId: string): Promise<boolean> {
        if (this.usedTransactionIds.get(transactionId)) {
            return false;
        }
        this.usedTransactionIds.set(transactionId, true);
        return true;
    }

    // Update MPC public key (for upgradability)
    async updateMPCPublicKey(newPublicKey: string): Promise<void> {
        if (!this.isOwner()) {
            throw new Error("Only owner can update public key");
        }
        this.mpcPublicKey = newPublicKey;
    }

    // Helper: Verify threshold signature (pseudo-code)
    private async verifyThresholdSignature(signer: string, publicKey: string): Promise<boolean> {
        // Implement TSS verification (e.g., BLS or Schnorr)
        // Placeholder: assumes signature verification logic
        return true;
    }

    // Helper: Recover signer from signature (pseudo-code)
    private async recoverSigner(hash: string, signature: string): Promise<string> {
        // Implement signature recovery for TSS
        // Placeholder: returns signer address
        return "0x0"; // Replace with actual recovery logic
    }

    // Helper: Check if caller is owner (placeholder)
    private isOwner(): boolean {
        return true; // Implement actual owner check
    }
}
```

## Example Implementations

- GMP Module [Go Implementation](https://github.com/s16rv/sourdough/tree/main/x/gmp)
- Gateway [Solidity Implementation](https://github.com/s16rv/sourdough-solidity-contracts/tree/main/contracts/gateway) (Placeholder - assuming a gateway contract exists or will exist)

## History

July 9, 2025 - Draft written

## Copyright

All content herein is licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
