import { AbiCoder } from "ethers";

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
