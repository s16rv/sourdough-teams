import "dotenv/config";
import { Bip39, EnglishMnemonic, Secp256k1, Slip10, Slip10Curve, sha256, stringToPath } from "@cosmjs/crypto";
import { fromHex, toBase64, toHex, toUtf8 } from "@cosmjs/encoding";

/**
 * Validate and return the mnemonic from environment variables.
 * Ensures `EVM_MNEMONIC` exists and is a valid BIP-39 English mnemonic.
 * @throws Error when missing or invalid.
 */
function loadMnemonic(): EnglishMnemonic {
    const mnemonicEnv = process.env.EVM_MNEMONIC;
    if (!mnemonicEnv || typeof mnemonicEnv !== "string") {
        throw new Error("Missing EVM_MNEMONIC in environment");
    }
    try {
        const mnemonic = new EnglishMnemonic(mnemonicEnv.trim());
        return mnemonic;
    } catch {
        throw new Error("Invalid EVM_MNEMONIC format");
    }
}

/**
 * Derive a secp256k1 private key using Cosmos SDK standard HD path.
 * Uses path m/44'/118'/0'/0/0, which is standard for Cosmos.
 * @param mnemonic EnglishMnemonic
 * @returns Private key bytes (32 bytes)
 */
async function derivePrivkey(mnemonic: EnglishMnemonic): Promise<Uint8Array> {
    const seed = await Bip39.mnemonicToSeed(mnemonic);
    const path = stringToPath("m/44'/118'/0'/0/0");
    const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, path);
    return privkey;
}

/**
 * Hash a message string using SHA-256 over UTF-8 bytes.
 * Returns 32-byte digest as Uint8Array.
 * @param message Input message
 */
function hashMessage(message: string): Uint8Array {
    const bytes = fromHex(message);
    const digest = sha256(bytes);
    return digest;
}
/**
 * Create a deterministic (RFC 6979) ECDSA signature with secp256k1 over a 32-byte hash.
 * Returns fixed-length 64-byte (r||s) signature per Cosmos standard.
 * @param privkey Private key bytes
 * @param digest 32-byte message digest
 */
async function signDigest(privkey: Uint8Array, digest: Uint8Array): Promise<Uint8Array> {
    const sig = await Secp256k1.createSignature(digest, privkey);
    const fixed = sig.toFixedLength();
    return fixed;
}

/**
 * Generate a signature for a given message using env-provided mnemonic.
 * Returns the original message, digest (hex), and signature (base64).
 * @param message Message to sign
 */
export async function generateSignature(
    message: string,
    signerAddress: string
): Promise<{
    message: string;
    digestHex: string;
    signatureBase64: string;
    signatureHex: string;
    stdSignature: {
        pub_key: {
            type: string;
            value: string;
        };
        signature: string;
    };
}> {
    if (!message || typeof message !== "string") {
        throw new Error("Message must be a non-empty string");
    }
    if (!signerAddress || typeof signerAddress !== "string") {
        throw new Error("Signer address must be a non-empty string");
    }
    const mnemonic = loadMnemonic();
    const privkey = await derivePrivkey(mnemonic);
    const keypair = await Secp256k1.makeKeypair(privkey);
    const compressedPubkey = Secp256k1.compressPubkey(keypair.pubkey);
    const digest = hashMessage(message);
    const signature = await signDigest(privkey, digest);
    return {
        message,
        digestHex: toHex(digest),
        signatureBase64: toBase64(signature),
        signatureHex: toHex(signature),
        stdSignature: {
            pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(compressedPubkey) },
            signature: toBase64(signature),
        },
    };
}

/**
 * Generate a signature using a specific mnemonic (for testing).
 * Returns signature components (r, s) and public key (x, y) in hex format.
 * @param mnemonic The mnemonic to use for signing
 * @param messageHex The message to sign (hex encoded bytes)
 */
export async function generateSignatureWithMnemonic(
    mnemonic: string,
    messageHex: string
): Promise<{
    r: string;
    s: string;
    x: string;
    y: string;
    signatureHex: string;
    digestHex: string;
}> {
    const englishMnemonic = new EnglishMnemonic(mnemonic.trim());
    const seed = await Bip39.mnemonicToSeed(englishMnemonic);
    const path = stringToPath("m/44'/118'/0'/0/0");
    const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, path);
    const keypair = await Secp256k1.makeKeypair(privkey);

    // Get uncompressed public key x and y (each 32 bytes)
    // Uncompressed pubkey is 65 bytes: 0x04 + x (32 bytes) + y (32 bytes)
    const x = keypair.pubkey.slice(1, 33);
    const y = keypair.pubkey.slice(33, 65);

    // Hash the message
    const messageBytes = fromHex(messageHex);
    const digest = sha256(messageBytes);

    // Sign the digest
    const sig = await Secp256k1.createSignature(digest, privkey);
    const fixed = sig.toFixedLength();

    // Split signature into r and s (each 32 bytes)
    const r = fixed.slice(0, 32);
    const s = fixed.slice(32, 64);

    return {
        r: "0x" + toHex(r),
        s: "0x" + toHex(s),
        x: "0x" + toHex(x),
        y: "0x" + toHex(y),
        signatureHex: toHex(fixed),
        digestHex: toHex(digest),
    };
}

/**
 * Get public key (x, y) from a mnemonic.
 * @param mnemonic The mnemonic to derive the key from
 */
export async function getPublicKeyFromMnemonic(mnemonic: string): Promise<{
    x: string;
    y: string;
}> {
    const englishMnemonic = new EnglishMnemonic(mnemonic.trim());
    const seed = await Bip39.mnemonicToSeed(englishMnemonic);
    const path = stringToPath("m/44'/118'/0'/0/0");
    const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, path);
    const keypair = await Secp256k1.makeKeypair(privkey);

    // Get uncompressed public key x and y (each 32 bytes)
    const x = keypair.pubkey.slice(1, 33);
    const y = keypair.pubkey.slice(33, 65);

    return {
        x: "0x" + toHex(x),
        y: "0x" + toHex(y),
    };
}

/**
 * CLI entry point.
 * Accepts message via `--message="..."` CLI arg or SIGN_MESSAGE env variable.
 * Accepts signer via `--signer="..."` CLI arg or SIGN_SIGNER_ADDRESS env variable.
 * Prints signing steps and outputs in a standardized format.
 */
async function main(): Promise<void> {
    try {
        const args = process.argv.slice(2);
        const msgArg = args.find((a) => a.startsWith("--message="));
        const signerArg = args.find((a) => a.startsWith("--signer="));

        // Support both CLI args and environment variables
        const message = msgArg ? msgArg.substring("--message=".length) : process.env.SIGN_MESSAGE || "";
        const signerAddress = signerArg
            ? signerArg.substring("--signer=".length)
            : process.env.SIGN_SIGNER_ADDRESS || "";

        if (!message || !signerAddress) {
            console.error("Usage:");
            console.error(
                '  Option 1 (CLI args): npm run gen-signature -- --message="Your message" --signer="cosmos1..."'
            );
            console.error(
                '  Option 2 (env vars): SIGN_MESSAGE="Your message" SIGN_SIGNER_ADDRESS="cosmos1..." npm run gen-signature'
            );
            process.exit(1);
            return;
        }

        console.log("Loading mnemonic from environment...");
        // Do not print mnemonic for security reasons.
        const result = await generateSignature(message, signerAddress);
        console.log("Message:", result.message);
        console.log("SHA-256 digest (hex):", result.digestHex);
        console.log("Signature (base64, 64-byte r||s):", result.signatureBase64);
        console.log("Signature (hex, 64-byte r||s):", result.signatureHex);
        console.log("Standardized Signature:", JSON.stringify(result.stdSignature, null, 2));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Signing failed:", msg);
        process.exit(1);
    }
}

// Only run main() if this file is executed directly (not imported as a module)
if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
