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
- `GMP Module`: The module that builds GMP (General Message Passing) messages with the user's signatures.
- `MPC`: Multi-Party Computation, a cryptographic service that validates and signs cross-chain messages.
- `Relayer`: An entity responsible for transmitting approved messages between chains.
- `Smart Account`: A contract that receives and executes the cross-chain payload on the destination chain.
- `Verifier`: A contract responsible for validating MPC signatures and transaction authenticity.

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
    Relayer->>GatewayDest: executeContractCall(params, transactionId)
    GatewayDest->>GatewayDest: Verify MPC Signature, Store Approval
    GatewayDest->>GatewayDest: Emit ContractCallApproved(transactionId, sourceChain, sourceAddress, contractAddress, payloadHash)
    GatewayDest->>GatewayDest: execute(transactionId, sourceChain, sourceAddress, contractAddress, payload, payloadHash)
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
    private executedCalls: Map<string, boolean>; // mapping of transaction key to execution status
    private verifierAddress: string; // verifier contract address
    private ownerAddress: string; // Owner address of the Gateway contract
}
```

### Sub-protocols

#### Gateway Contract

`Gateway Contract` is a smart contract that acts as the communication channel for cross-chain messages. It receives transaction payloads from the sending chain, which include the execution payload, MPC signature, user's signature, and other message semantics. The Gateway validates these inputs through a Verifier contract and forwards valid payloads to the Smart Account contract for execution.

```typescript
interface ContractCallParams {
    sourceChain: string; // Identifier of the chain where the transaction originated
    sourceAddress: string; // Address of the sender on the source chain
    destinationChain: string; // Identifier of the target chain
    destinationAddress: string; // Address of the contract to call on the destination chain
    payload: string; // Encoded call data to be executed (Hex string)
}

interface ContractCallApprovedEvent {
    sourceChain: string;
    sourceAddress: string;
    destinationAddress: string;
    payloadHash: string;
}

interface ContractCallExecutedEvent {
    sourceChain: string;
    sourceAddress: string;
    destinationAddress: string;
    payloadHash: string;
}

class GatewayContract {
    private executedCalls: Map<string, boolean> = new Map();
    private verifierAddress: string;

    constructor(verifierAddress: string) {
        this.verifierAddress = verifierAddress;
    }

    // Approve a cross-chain contract call
    async approveContractCall(txHash: bytes, r: bytes, s: bytes, params: ContractCallParams): Promise<boolean> {
        const { sourceChain, sourceAddress, destinationAddress, payloadHash } = params;

        // Call Verifier to validate MPC signature
        const verifier = new Verifier(this.verifierAddress);
        const isValidSignature = await verifier.validateMPCSignature(payloadHash, mpcSignature);
        if (!isValidSignature) {
            return false;
        }

        // Emit ContractCallApproved event
        this.emitEvent<ContractCallApprovedEvent>("ContractCallApproved", {
            sourceChain,
            sourceAddress,
            destinationAddress,
            payloadHash,
        });

        return true;
    }

    // Execute a contract call (called by relayer)
    async executeContractCall(txHash: bytes, r: bytes, s: bytes, params: ContractCallParams): Promise<void> {
        const { sourceChain, sourceAddress, destinationAddress, payload } = params;

        // Generate unique key for this transaction
        const key = this.generateTxHash(params);

        // Check if already executed to prevent replay attacks
        if (this.executedCalls.get(key)) {
            throw new Error("Transaction already executed");
        }

        // Ensure transaction is approved
        const isApproved = await this.approveContractCall(params);
        if (!isApproved) {
            throw new Error("Transaction not approved");
        }

        // Mark transaction as executed to prevent replay
        this.executedCalls.set(key, true);

        // Forward payload to smart account for execution
        const success = await this.callSmartAccount(destinationAddress, payload);
        if (!success) {
            throw new Error("Smart account execution failed");
        }

        // Emit ContractCallExecuted event for tracking
        this.emitEvent<ContractCallExecutedEvent>("ContractCallExecuted", {
            sourceChain,
            sourceAddress,
            destinationAddress,
            payloadHash,
        });
    }

    // Helper: Generate unique key for approval/executed mapping
    private generateTxHash(params: ContractCallParams): string {
        const { sourceChain, sourceAddress, destinationChain, destinationAddress, payload } = params;

        // Create a unique key using essential transaction parameters
        // Note: We exclude mpcSignature to allow different signatures for the same transaction
        return keccak256(
            JSON.stringify({
                sourceChain,
                sourceAddress,
                destinationChain,
                destinationAddress,
                payloadh,
            })
        );
    }

    // Helper: Call smart account to execute the payload
    private async callSmartAccount(destinationAddress: string, payload: string): Promise<boolean> {
        // Pseudo-code: Call smart account's executePayload function
        // In a real implementation, use ethers.js or similar to call contract
        try {
            // Call the EntryPoint contract which will route to the appropriate smart account
            await callContract(this.entryPointAddress, "executePayload", [destinationAddress, payload]);
            return true;
        } catch (error) {
            console.error("Smart account execution failed:", error);
            return false;
        }
    }

    // Helper: Simulate event emission
    private emitEvent<T>(eventName: string, data: T): void {
        console.log(`Event ${eventName}:`, data); // Placeholder for event emission
    }
}
```

### Verifier Contract

Verifier contract is responsible for validating the MPC signature and transaction ID. It ensures that the signature is valid and the transaction ID is unique.

```typescript
class Verifier {
    private mpcPublicKey: string; // Hex string
    private ownerAddress: string;

    constructor(mpcPublicKey: string, ownerAddress: string) {
        this.mpcPublicKey = mpcPublicKey;
        this.ownerAddress = ownerAddress;
    }

    // Validate MPC signature
    async validateMPCSignature(payloadHash: string, mpcSignature: string): Promise<boolean> {
        // Verify threshold signature (e.g., BLS or Schnorr)
        return this.verifySecp256k1Signature(payloadHash, mpcSignature, this.mpcPublicKey);
    }

    // Helper: Check if caller is owner (placeholder)
    private isOwner(): boolean {
        return this.ownerAddress === this.sender;
    }
}
```

## Example Implementations

- GMP Module [Go Implementation](https://github.com/s16rv/sourdough/tree/main/x/gmp)
- MPC Gateway [Solidity Implementation](https://github.com/s16rv/sourdough-solidity-contracts/tree/main/contracts/mpc-gateway)

## History

July 9, 2025 - Draft written

## Copyright

All content herein is licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
