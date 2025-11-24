import { AbiCoder } from "ethers";

export function combineHexStrings(hexString1: string, hexString2: string): string {
    const buffer1 = Buffer.from(hexString1.slice(2), "hex");
    const buffer2 = Buffer.from(hexString2.slice(2), "hex");

    const combinedBuffer = Buffer.concat([buffer1, buffer2]);

    const combinedHex = combinedBuffer.toString("hex");

    return "0x" + combinedHex;
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
