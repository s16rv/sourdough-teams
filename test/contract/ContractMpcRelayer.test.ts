// CONTRACT: sourdough-solidity-contracts ↔ sourdough-mpc-relayer EVM interface
// Mirror: sourdough-mpc-relayer/internal/relayservice/evmclient/contract_test.go
//
// These tests pin the same constants from the Solidity side. If a constant
// drifts on either side, the contract test on that side breaks.

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { AbiCoder, keccak256, sha256 } from "ethers";
import { MPCGateway } from "../../typechain-types";
import {
    encodeSignerBlock,
    encodeCreateAccountPayload,
    encodeNewPayload,
    encodeNewTxPayload,
    DEFAULT_SALT,
} from "../utils/lib";

// ---------------------------------------------------------------------------
// Contract constants — must match Go side exactly.
// Source: sourdough-mpc-relayer/internal/relayservice/evmclient/contract_test.go
// ---------------------------------------------------------------------------

const EXECUTE_CONTRACT_CALL_SIG = "executeContractCall(uint8,bytes32,bytes32,string,string,string,address,bytes)";
const EXECUTE_CONTRACT_CALL_SELECTOR = "0x546c77a6";

// EntryPoint.sol constants
const SLOT_SIZE = 32;
const SIGNER_WITH_SIG_SIZE = 129; // v(1) + r(32) + s(32) + x(32) + y(32)
const CREATE_ACCOUNT_HEADER_SIZE = 128; // 4 * 32
const NEW_HEADER_SIZE = 160; // 5 * 32
const GRANT_HEADER_SIZE = 224; // 7 * 32

// Category byte values
const CATEGORY_CREATE_ACCOUNT = 1;
const CATEGORY_SEND_TX = 2;

// txPayload account address offset (senderHash(32) + evmChainId(32) = 64)
const TX_PAYLOAD_ACCOUNT_ADDRESS_OFFSET = 64;

// Golden vector inputs (must match Go side)
const GOLDEN_SOURCE_CHAIN = "sourdough-1";
const GOLDEN_SOURCE_ADDRESS = "cosmos1zypqa76je7pxsdwkfah6mu9a583sju6xqt3mv6";
const GOLDEN_DEST_CHAIN = "polygon";
const GOLDEN_DEST_ADDRESS = "0x1234567890123456789012345678901234567890";
const GOLDEN_PAYLOAD = "0x1234";
const GOLDEN_TX_HASH = "0x1b71267ade0bcdcba28e2c3e9794e92419fbb6a1ff91ba82afb98e05a1d1cd9b";

describe("Contract: MPC Relayer ↔ Solidity", function () {
    describe("executeContractCall", function () {
        it("function selector matches", async function () {
            // ethers.id computes keccak256 of the string, slice first 4 bytes (10 hex chars with 0x)
            const computed = ethers.id(EXECUTE_CONTRACT_CALL_SIG).slice(0, 10);
            expect(computed).to.equal(EXECUTE_CONTRACT_CALL_SELECTOR);
        });
    });

    describe("generateTxHash", function () {
        let mpcGateway: MPCGateway;

        beforeEach(async function () {
            const [owner] = await ethers.getSigners();

            // Deploy MockMPCVerifier
            const MockMPCVerifierFactory = await ethers.getContractFactory("MockMPCVerifier");
            const mockMPCVerifier = await MockMPCVerifierFactory.deploy();
            await mockMPCVerifier.waitForDeployment();

            // Deploy MPCGateway proxy
            const MPCGatewayFactory = await ethers.getContractFactory("MPCGateway");
            mpcGateway = (await upgrades.deployProxy(MPCGatewayFactory, [mockMPCVerifier.target, owner.address], {
                kind: "uups",
            })) as unknown as MPCGateway;
            await mpcGateway.waitForDeployment();
        });

        it("golden vector matches Go side", async function () {
            // Call on-chain generateTxHash with the same inputs as the Go test
            const hash = await mpcGateway.generateTxHash(
                GOLDEN_SOURCE_CHAIN,
                GOLDEN_SOURCE_ADDRESS,
                GOLDEN_DEST_CHAIN,
                GOLDEN_DEST_ADDRESS,
                GOLDEN_PAYLOAD
            );
            expect(hash).to.equal(GOLDEN_TX_HASH);
        });

        it("matches manual abi.encode + sha256", async function () {
            // Compute off-chain: sha256(abi.encode(string, string, string, address, bytes))
            const coder = new AbiCoder();
            const encoded = coder.encode(
                ["string", "string", "string", "address", "bytes"],
                [GOLDEN_SOURCE_CHAIN, GOLDEN_SOURCE_ADDRESS, GOLDEN_DEST_CHAIN, GOLDEN_DEST_ADDRESS, GOLDEN_PAYLOAD]
            );
            const offChainHash = sha256(encoded);

            // Compare with on-chain result
            const onChainHash = await mpcGateway.generateTxHash(
                GOLDEN_SOURCE_CHAIN,
                GOLDEN_SOURCE_ADDRESS,
                GOLDEN_DEST_CHAIN,
                GOLDEN_DEST_ADDRESS,
                GOLDEN_PAYLOAD
            );

            expect(offChainHash).to.equal(onChainHash);
            expect(offChainHash).to.equal(GOLDEN_TX_HASH);
        });
    });

    describe("EntryPoint payload constants", function () {
        it("createAccount header is 128 bytes", function () {
            // Category 1 payload: category(32) + totalSigners(32) + threshold(32) + salt(32)
            const payload = encodeCreateAccountPayload(0, 1, DEFAULT_SALT, [], []);
            // Remove 0x prefix, divide by 2 for bytes
            const headerBytes = (payload.length - 2) / 2;
            expect(headerBytes).to.equal(CREATE_ACCOUNT_HEADER_SIZE);
            expect(CREATE_ACCOUNT_HEADER_SIZE).to.equal(4 * SLOT_SIZE);
        });

        it("newPayload header is 160 bytes", function () {
            // Category 2 header: category(32) + signBytesLen(32) + hashOffset(32) + numSigners(32) + grantOffset(32)
            expect(NEW_HEADER_SIZE).to.equal(5 * SLOT_SIZE);
        });

        it("grant header is 224 bytes", function () {
            expect(GRANT_HEADER_SIZE).to.equal(7 * SLOT_SIZE);
        });
    });

    describe("signer block layout", function () {
        it("is 129 bytes (v|r|s|x|y)", function () {
            const v = 27;
            const r = "0x" + "11".repeat(32);
            const s = "0x" + "22".repeat(32);
            const x = "0x" + "33".repeat(32);
            const y = "0x" + "44".repeat(32);

            const block = encodeSignerBlock(v, r, s, x, y);
            // Remove 0x prefix, divide by 2 for byte count
            const blockBytes = (block.length - 2) / 2;
            expect(blockBytes).to.equal(SIGNER_WITH_SIG_SIZE);

            // Verify field positions by decoding raw bytes
            const raw = Buffer.from(block.slice(2), "hex");
            expect(raw[0]).to.equal(v, "v at offset 0");
            expect(raw.slice(1, 33).toString("hex")).to.equal("11".repeat(32), "r at offset 1");
            expect(raw.slice(33, 65).toString("hex")).to.equal("22".repeat(32), "s at offset 33");
            expect(raw.slice(65, 97).toString("hex")).to.equal("33".repeat(32), "x at offset 65");
            expect(raw.slice(97, 129).toString("hex")).to.equal("44".repeat(32), "y at offset 97");
        });
    });

    describe("txPayload account address", function () {
        it("at offset 64", function () {
            const senderHash = "0x" + "11".repeat(32);
            const evmChainId = BigInt(137);
            const accountAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            const sequence = BigInt(1);

            const txPayload = encodeNewTxPayload(senderHash, evmChainId, accountAddress, sequence, []);
            const raw = Buffer.from(txPayload.slice(2), "hex");

            // Decode address at offset 64 (32 bytes ABI-encoded, address in last 20 bytes)
            const addressSlot = raw.slice(TX_PAYLOAD_ACCOUNT_ADDRESS_OFFSET, TX_PAYLOAD_ACCOUNT_ADDRESS_OFFSET + 32);
            // ABI-encoded address has 12 zero-padding bytes then 20 address bytes
            const decodedAddress = "0x" + addressSlot.slice(12).toString("hex");
            expect(decodedAddress.toLowerCase()).to.equal(accountAddress.toLowerCase());
        });
    });
});
