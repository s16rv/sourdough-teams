import hre from "hardhat";
import { expect } from "chai";
import { AbiCoder, keccak256, sha256, parseEther, Wallet, SigningKey } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployAccountFactoryAndEntryPoint } from "../utils/deployHelpers";
import { combineHexStrings } from "../utils/lib";
import { RoutingRailgun, EntryPoint, AccountFactory } from "../../typechain-types";

const HARDHAT_CHAIN_ID = 31337n;

/**
 * Encode a RoutingRailgun operations payload.
 * Header: chainId(32) + accountAddress(32) + sequence(32) + count(32)
 * Body: count * [target(32) + value(32) + dataLen(32) + data(padded to 32)]
 */
function encodeOpsPayload(
    chainId: bigint,
    accountAddress: string,
    sequence: bigint,
    calls: { target: string; value: bigint; data: string }[]
): string {
    const coder = new AbiCoder();
    const header = coder.encode(
        ["uint256", "address", "uint256", "uint256"],
        [chainId, accountAddress, sequence, BigInt(calls.length)]
    );

    let payload = header;
    for (const call of calls) {
        const dataBytes = call.data === "0x" ? "0x" : call.data;
        const dataLen = dataBytes === "0x" ? 0n : BigInt((dataBytes.length - 2) / 2);
        const callHeader = coder.encode(["address", "uint256", "uint256"], [call.target, call.value, dataLen]);
        payload = combineHexStrings(payload, callHeader);
        if (dataLen > 0n) {
            // Pad data to 32-byte boundary
            const rawData = dataBytes.slice(2);
            const paddedLen = Math.ceil(rawData.length / 64) * 64;
            const paddedData = rawData.padEnd(paddedLen, "0");
            payload = combineHexStrings(payload, "0x" + paddedData);
        }
    }

    return payload;
}

/**
 * Sign a payload using the RoutingRailgun signature scheme:
 * sha256('{"tx_hash":"0x' + hex(keccak256(payload)) + '"}')
 */
function signRoutingPayload(payload: string, privateKey: string): string {
    const payloadHash = keccak256(payload);
    // Remove 0x prefix for the hex representation in JSON
    const hexHash = payloadHash.slice(2);
    const jsonMessage = `{"tx_hash":"0x${hexHash}"}`;
    const messageHash = sha256(Buffer.from(jsonMessage, "utf8"));

    const signingKey = new SigningKey(privateKey);
    const sig = signingKey.sign(messageHash);

    // Pack as r(32) + s(32) + v(1)
    const r = sig.r.slice(2);
    const s = sig.s.slice(2);
    const v = (sig.v - 27).toString(16).padStart(2, "0");
    return "0x" + r + s + v;
}

/**
 * Encode a Category 3 payload for creating a RoutingRailgun account.
 * Payload: category(32) + routingKeyAddress(32) + railgunAddress(32) + salt(32)
 */
function encodeCategory3Payload(routingKeyAddress: string, railgunAddress: string, salt: string): string {
    const coder = new AbiCoder();
    return coder.encode(["uint8", "address", "address", "bytes32"], [3, routingKeyAddress, railgunAddress, salt]);
}

/**
 * Encode a Category 4 payload for executing on a RoutingRailgun account.
 * Payload: category(32) + target(32) + signatureLen(32) + signature(signatureLen) + opsPayload(remaining)
 */
function encodeCategory4Payload(target: string, signature: string, opsPayload: string): string {
    const coder = new AbiCoder();
    const sigBytes = Buffer.from(signature.slice(2), "hex");
    const header = coder.encode(["uint8", "address", "uint256"], [4, target, sigBytes.length]);
    let payload = combineHexStrings(header, signature);
    payload = combineHexStrings(payload, opsPayload);
    return payload;
}

describe("RoutingRailgun", function () {
    let entryPoint: EntryPoint;
    let accountFactory: AccountFactory;
    let owner: HardhatEthersSigner;
    let mpcGateway: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let routingKeyWallet: Wallet;
    let mockRailgun: any;
    let mockToken: any;

    beforeEach(async function () {
        [owner, mpcGateway, user] = await hre.ethers.getSigners();

        // Deploy infrastructure
        const deployed = await deployAccountFactoryAndEntryPoint(owner.address, mpcGateway.address);
        entryPoint = deployed.entryPoint;
        accountFactory = deployed.accountFactory;

        // Create a routing key wallet (EOA that will sign operations)
        routingKeyWallet = Wallet.createRandom();

        // Deploy MockRailgun
        const MockRailgunFactory = await hre.ethers.getContractFactory("MockRailgun");
        mockRailgun = await MockRailgunFactory.deploy();
        await mockRailgun.waitForDeployment();

        // Deploy MockToken
        const MyTokenFactory = await hre.ethers.getContractFactory("MyToken");
        mockToken = await MyTokenFactory.deploy("Test Token", "TST", 18);
        await mockToken.waitForDeployment();
    });

    describe("Category 3: Account Creation", function () {
        it("should create a RoutingRailgun account via EntryPoint", async function () {
            const salt = hre.ethers.id("test-salt-1");
            const payload = encodeCategory3Payload(routingKeyWallet.address, await mockRailgun.getAddress(), salt);

            const tx = await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", payload);
            const receipt = await tx.wait();

            // Check RoutingAccountCreated event
            const routingEvent = receipt?.logs.find((log: any) => {
                try {
                    const parsed = entryPoint.interface.parseLog(log);
                    return parsed?.name === "RoutingAccountCreated";
                } catch {
                    return false;
                }
            });
            expect(routingEvent).to.not.be.undefined;

            const parsed = entryPoint.interface.parseLog(routingEvent as any);
            const routingAddr = parsed?.args.routingAccountAddress;
            expect(routingAddr).to.not.equal(hre.ethers.ZeroAddress);

            // Verify the deployed contract has correct immutables
            const routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddr);
            expect(await routing.routingKeyAddress()).to.equal(routingKeyWallet.address);
            expect(await routing.railgunAddress()).to.equal(await mockRailgun.getAddress());
            expect(await routing.entryPoint()).to.equal(await entryPoint.getAddress());
            expect(await routing.nonce()).to.equal(0);
        });

        it("should create deterministic addresses via CREATE2", async function () {
            const salt = hre.ethers.id("deterministic-salt");

            // Create first account
            const payload1 = encodeCategory3Payload(routingKeyWallet.address, await mockRailgun.getAddress(), salt);

            const tx1 = await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", payload1);
            const receipt1 = await tx1.wait();
            const event1 = receipt1?.logs.find((log: any) => {
                try {
                    return entryPoint.interface.parseLog(log)?.name === "RoutingAccountCreated";
                } catch {
                    return false;
                }
            });
            const addr1 = entryPoint.interface.parseLog(event1 as any)?.args.routingAccountAddress;

            // Second creation with same params should revert (AccountAlreadyExists)
            await expect(entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", payload1)).to.be
                .reverted;

            // Different salt should produce different address
            const salt2 = hre.ethers.id("different-salt");
            const payload2 = encodeCategory3Payload(routingKeyWallet.address, await mockRailgun.getAddress(), salt2);
            const tx2 = await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", payload2);
            const receipt2 = await tx2.wait();
            const event2 = receipt2?.logs.find((log: any) => {
                try {
                    return entryPoint.interface.parseLog(log)?.name === "RoutingAccountCreated";
                } catch {
                    return false;
                }
            });
            const addr2 = entryPoint.interface.parseLog(event2 as any)?.args.routingAccountAddress;

            expect(addr1).to.not.equal(addr2);
        });
    });

    describe("Category 4: Operation Execution", function () {
        let routingAddr: string;
        let routing: RoutingRailgun;

        beforeEach(async function () {
            // Create a routing account first
            const salt = hre.ethers.id("ops-test-salt");
            const payload = encodeCategory3Payload(routingKeyWallet.address, await mockRailgun.getAddress(), salt);
            const tx = await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", payload);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return entryPoint.interface.parseLog(log)?.name === "RoutingAccountCreated";
                } catch {
                    return false;
                }
            });
            routingAddr = entryPoint.interface.parseLog(event as any)?.args.routingAccountAddress;
            routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddr);

            // Fund the routing account with ETH and tokens
            await owner.sendTransaction({ to: routingAddr, value: parseEther("5") });
            await mockToken.mint(routingAddr, parseEther("1000"));
        });

        it("should execute a single ETH call via handleOps", async function () {
            const railgunAddr = await mockRailgun.getAddress();
            const commitments = [hre.ethers.keccak256(hre.ethers.toUtf8Bytes("c1"))];
            const encryptedNotes = [hre.ethers.toUtf8Bytes("n1")];
            const shieldData = mockRailgun.interface.encodeFunctionData("shield", [commitments, encryptedNotes]);

            const opsPayload = encodeOpsPayload(HARDHAT_CHAIN_ID, routingAddr, 0n, [
                { target: railgunAddr, value: parseEther("1"), data: shieldData },
            ]);

            const signature = signRoutingPayload(opsPayload, routingKeyWallet.privateKey);
            const cat4Payload = encodeCategory4Payload(routingAddr, signature, opsPayload);

            await expect(entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload)).to.emit(
                entryPoint,
                "TransactionHandled"
            );

            // Verify the shield was called
            const lastAmount = await mockRailgun.lastAmount();
            expect(lastAmount).to.equal(parseEther("1"));

            // Verify nonce incremented
            expect(await routing.nonce()).to.equal(1);
        });

        it("should execute approve + shield ERC20 multicall", async function () {
            const railgunAddr = await mockRailgun.getAddress();
            const tokenAddr = await mockToken.getAddress();
            const amount = parseEther("100");

            // Build approve calldata
            const approveData = mockToken.interface.encodeFunctionData("approve", [railgunAddr, amount]);

            // Build shield ERC20 calldata
            const commitments = [hre.ethers.keccak256(hre.ethers.toUtf8Bytes("c1"))];
            const encryptedNotes = [hre.ethers.toUtf8Bytes("n1")];
            const shieldData = mockRailgun.interface.encodeFunctionData("shieldERC20", [
                tokenAddr,
                amount,
                commitments,
                encryptedNotes,
            ]);

            const opsPayload = encodeOpsPayload(HARDHAT_CHAIN_ID, routingAddr, 0n, [
                { target: tokenAddr, value: 0n, data: approveData },
                { target: railgunAddr, value: 0n, data: shieldData },
            ]);

            const signature = signRoutingPayload(opsPayload, routingKeyWallet.privateKey);
            const cat4Payload = encodeCategory4Payload(routingAddr, signature, opsPayload);

            await expect(entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload)).to.emit(
                entryPoint,
                "TransactionHandled"
            );

            // Verify the shieldERC20 was called
            expect(await mockRailgun.lastAmount()).to.equal(amount);
            expect(await mockRailgun.lastToken()).to.equal(tokenAddr);

            // Verify nonce incremented
            expect(await routing.nonce()).to.equal(1);
        });

        it("should reject invalid signature", async function () {
            const opsPayload = encodeOpsPayload(HARDHAT_CHAIN_ID, routingAddr, 0n, []);

            // Sign with a different key
            const wrongWallet = Wallet.createRandom();
            const signature = signRoutingPayload(opsPayload, wrongWallet.privateKey);
            const cat4Payload = encodeCategory4Payload(routingAddr, signature, opsPayload);

            await expect(entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload)).to.be
                .reverted;
        });

        it("should reject replay (wrong nonce)", async function () {
            // Execute first operation (nonce 0)
            const opsPayload1 = encodeOpsPayload(HARDHAT_CHAIN_ID, routingAddr, 0n, []);
            const sig1 = signRoutingPayload(opsPayload1, routingKeyWallet.privateKey);
            const cat4Payload1 = encodeCategory4Payload(routingAddr, sig1, opsPayload1);
            await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload1);

            // Try to replay the same nonce (0) - should fail
            await expect(entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload1)).to.be
                .reverted;
        });

        it("should reject wrong chain ID", async function () {
            const wrongChainId = 999n;
            const opsPayload = encodeOpsPayload(wrongChainId, routingAddr, 0n, []);
            const signature = signRoutingPayload(opsPayload, routingKeyWallet.privateKey);
            const cat4Payload = encodeCategory4Payload(routingAddr, signature, opsPayload);

            await expect(entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload)).to.be
                .reverted;
        });

        it("should reject wrong account address", async function () {
            const wrongAddr = user.address;
            const opsPayload = encodeOpsPayload(HARDHAT_CHAIN_ID, wrongAddr, 0n, []);
            const signature = signRoutingPayload(opsPayload, routingKeyWallet.privateKey);
            const cat4Payload = encodeCategory4Payload(routingAddr, signature, opsPayload);

            await expect(entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload)).to.be
                .reverted;
        });

        it("should increment nonce sequentially", async function () {
            for (let i = 0; i < 3; i++) {
                const opsPayload = encodeOpsPayload(HARDHAT_CHAIN_ID, routingAddr, BigInt(i), []);
                const sig = signRoutingPayload(opsPayload, routingKeyWallet.privateKey);
                const cat4Payload = encodeCategory4Payload(routingAddr, sig, opsPayload);
                await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", cat4Payload);
            }
            expect(await routing.nonce()).to.equal(3);
        });
    });

    describe("Access Control", function () {
        let routingAddr: string;

        beforeEach(async function () {
            const salt = hre.ethers.id("access-test");
            const payload = encodeCategory3Payload(routingKeyWallet.address, await mockRailgun.getAddress(), salt);
            const tx = await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", payload);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return entryPoint.interface.parseLog(log)?.name === "RoutingAccountCreated";
                } catch {
                    return false;
                }
            });
            routingAddr = entryPoint.interface.parseLog(event as any)?.args.routingAccountAddress;
        });

        it("should reject handleOps from non-EntryPoint", async function () {
            const routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddr);
            await expect(routing.connect(user).handleOps("0x", "0x")).to.be.revertedWithCustomError(
                routing,
                "NotEntryPoint"
            );
        });

        it("should reject executePayload from non-MPCGateway", async function () {
            const payload = encodeCategory3Payload(routingKeyWallet.address, user.address, hre.ethers.ZeroHash);
            await expect(
                entryPoint.connect(user).executePayload("cosmos", "cosmos1abc", payload)
            ).to.be.revertedWithCustomError(entryPoint, "NotMPCGateway");
        });
    });

    describe("ETH Handling", function () {
        it("should receive ETH and emit FundsReceived", async function () {
            const salt = hre.ethers.id("eth-test");
            const payload = encodeCategory3Payload(routingKeyWallet.address, await mockRailgun.getAddress(), salt);
            const tx = await entryPoint.connect(mpcGateway).executePayload("cosmos", "cosmos1abc", payload);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return entryPoint.interface.parseLog(log)?.name === "RoutingAccountCreated";
                } catch {
                    return false;
                }
            });
            const routingAddr = entryPoint.interface.parseLog(event as any)?.args.routingAccountAddress;
            const routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddr);

            await expect(user.sendTransaction({ to: routingAddr, value: parseEther("1") }))
                .to.emit(routing, "FundsReceived")
                .withArgs(user.address, parseEther("1"));
        });
    });
});
