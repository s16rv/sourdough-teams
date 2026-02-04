import { AbiCoder, keccak256, ethers } from "ethers";

export function combineHexStrings(hexString1: string, hexString2: string): string {
    const buffer1 = Buffer.from(hexString1.slice(2), "hex");
    const buffer2 = Buffer.from(hexString2.slice(2), "hex");

    const combinedBuffer = Buffer.concat([buffer1, buffer2]);

    const combinedHex = combinedBuffer.toString("hex");

    return "0x" + combinedHex;
}

/**
 * Encodes signer data in the new 129-byte format: v(1) + r(32) + s(32) + x(32) + y(32)
 */
export function encodeSignerBlock(v: number, r: string, s: string, x: string, y: string): string {
    // v is a single byte (0-3)
    const vHex = v.toString(16).padStart(2, "0");
    // r, s, x, y are each 32 bytes (without 0x prefix, 64 hex chars)
    const rHex = r.slice(2);
    const sHex = s.slice(2);
    const xHex = x.slice(2);
    const yHex = y.slice(2);
    return "0x" + vHex + rHex + sHex + xHex + yHex;
}

export function encodeMultiPayload(items: { dest: string; value: bigint; data: string }[]): string {
    const coder = new AbiCoder();
    const count = coder.encode(["uint64"], [BigInt(items.length)]);
    let payload = count;
    for (const it of items) {
        const dataLen = BigInt((it.data.length - 2) / 2);
        const fixed = coder.encode(["address", "uint256", "uint256"], [it.dest, it.value, dataLen]);
        payload = combineHexStrings(payload, fixed);
        payload = combineHexStrings(payload, it.data);
    }
    return payload;
}

/**
 * Encode the new txPayload structure.
 * @param evmChainId The EVM chain ID (e.g., 1 for Ethereum, 137 for Polygon)
 * @param accountAddress The destination smart account address
 * @param sequence The replay protection nonce
 * @param calls Array of calls to execute
 * @returns The ABI-encoded txPayload
 */
export function encodeNewTxPayload(
    evmChainId: bigint,
    accountAddress: string,
    sequence: bigint,
    calls: { to: string; value: bigint; data: string }[]
): string {
    const coder = new AbiCoder();

    // Encode the header: evmChainId (uint256), accountAddress (address), sequence (uint64), count (uint64)
    const header = coder.encode(
        ["uint256", "address", "uint64", "uint64"],
        [evmChainId, accountAddress, sequence, BigInt(calls.length)]
    );

    // Encode calls: each call is to(32) + value(32) + dataLen(32) + data(variable)
    let callsPayload = "0x";
    for (const call of calls) {
        const dataLen = BigInt((call.data.length - 2) / 2);
        const callHeader = coder.encode(["address", "uint256", "uint256"], [call.to, call.value, dataLen]);
        callsPayload = combineHexStrings(callsPayload === "0x" ? "0x" : callsPayload, callHeader);
        if (call.data !== "0x" && call.data.length > 2) {
            callsPayload = combineHexStrings(callsPayload, call.data);
        }
    }

    if (callsPayload === "0x") {
        return header;
    }
    return combineHexStrings(header, callsPayload);
}

/**
 * Compute the keccak256 hash of a txPayload.
 * @param txPayload The encoded txPayload
 * @returns The keccak256 hash as a hex string
 */
export function computeTxPayloadHash(txPayload: string): string {
    return keccak256(txPayload);
}

/**
 * Create signBytes with embedded hash at a specific offset.
 * This creates an AMINO_JSON-like structure with the hash embedded.
 * @param txPayloadHash The keccak256 hash of txPayload
 * @param prefix Optional prefix before the hash (default: some JSON-like structure)
 * @param suffix Optional suffix after the hash (default: closing brace)
 * @returns Object containing signBytes and the offset to the hash
 */
export function createSignBytes(
    txPayloadHash: string,
    prefix: string = '{"tx_hash":"',
    suffix: string = '"}'
): { signBytes: string; hashOffset: number } {
    // Convert prefix to bytes and calculate offset
    const prefixBytes = Buffer.from(prefix, "utf8");
    const hashOffset = prefixBytes.length;

    // The hash should include "0x" prefix in the signBytes
    const fullString = prefix + txPayloadHash + suffix;
    const signBytes = "0x" + Buffer.from(fullString, "utf8").toString("hex");

    return { signBytes, hashOffset };
}

/**
 * Encode the recovery transaction payload.
 * Format: (uint256 evmChainId, uint64 sequence, address dest, uint256 value, bytes data)
 * @param evmChainId The EVM chain ID
 * @param sequence The sequence number
 * @param dest The destination address
 * @param value The ETH value to send
 * @param data The call data
 * @returns The ABI-encoded recovery payload
 */
export function encodeRecoverPayload(
    evmChainId: bigint,
    sequence: bigint,
    dest: string,
    value: bigint,
    data: string
): string {
    const coder = new AbiCoder();
    return coder.encode(
        ["uint256", "uint64", "address", "uint256", "bytes"],
        [evmChainId, sequence, dest, value, data]
    );
}

/**
 * Encode the new payload format for Category 2 transactions.
 * @param signBytes The signed message bytes (hex encoded)
 * @param txPayloadHashOffset Offset to the hash in signBytes
 * @param signatures Array of signatures with public keys (includes v for ecrecover)
 * @param txPayload The encoded txPayload
 * @returns The full encoded payload
 */
export function encodeNewPayload(
    signBytes: string,
    txPayloadHashOffset: number,
    signatures: { v: number; r: string; s: string; x: string; y: string }[],
    txPayload: string
): string {
    const coder = new AbiCoder();

    // Get signBytes as raw bytes (remove 0x prefix)
    const signBytesBuffer = Buffer.from(signBytes.slice(2), "hex");
    const signBytesLength = signBytesBuffer.length;

    // Encode header: category(uint8), signBytesLength(uint256), txPayloadHashOffset(uint256), numberSigners(uint64)
    const header = coder.encode(
        ["uint8", "uint256", "uint256", "uint64"],
        [2, signBytesLength, txPayloadHashOffset, BigInt(signatures.length)]
    );

    // Add signBytes (raw, not ABI encoded)
    let payload = combineHexStrings(header, signBytes);

    // Add signatures using encodeSignerBlock: v(1) + r(32) + s(32) + x(32) + y(32) for each signer
    for (const sig of signatures) {
        const signerBlock = encodeSignerBlock(sig.v, sig.r, sig.s, sig.x, sig.y);
        payload = combineHexStrings(payload, signerBlock);
    }

    // Add txPayload (raw, not ABI encoded)
    payload = combineHexStrings(payload, txPayload);

    return payload;
}

/**
 * Encode a Category 1 (createAccount) payload with salt parameter
 * New format: category(8) + totalSigners(64) + threshold(64) + salt(256) + pubkeys...
 */
export function encodeCreateAccountPayload(
    totalSigners: number,
    threshold: number,
    salt: string,
    publicKeysX: string[],
    publicKeysY: string[]
): string {
    const coder = new AbiCoder();

    // Header: category(uint8) + totalSigners(uint64) + threshold(uint64) + salt(bytes32)
    let payload = coder.encode(["uint8", "uint64", "uint64", "bytes32"], [1, totalSigners, threshold, salt]);

    // Add public keys
    for (let i = 0; i < totalSigners; i++) {
        const pubKey = coder.encode(["bytes32", "bytes32"], [publicKeysX[i], publicKeysY[i]]);
        payload = combineHexStrings(payload, pubKey);
    }

    return payload;
}

/**
 * Default salt value for backward compatibility in tests
 */
export const DEFAULT_SALT = ethers.ZeroHash;
