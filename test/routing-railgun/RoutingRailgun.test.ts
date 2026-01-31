import hre from "hardhat";
import { expect } from "chai";
import { parseEther } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { RoutingRailgun, RoutingRailgunFactory } from "../../typechain-types";

function extractRoutingAddress(receipt: any, factory: any): string {
    if (!receipt) throw new Error("ReceiptNull");
    for (const log of receipt.logs) {
        try {
            const parsed = factory.interface.parseLog(log);
            if (parsed && parsed.name === "RoutingRailgunCreated") {
                return parsed.args.contractAddress as string;
            }
        } catch {}
    }
    throw new Error("EventNotFound");
}

describe("RoutingRailgun", function () {
    it("receives ETH and shields via controller", async function () {
        const [controller, user, recipient] = await hre.ethers.getSigners();

        const MockRailgunFactory = await hre.ethers.getContractFactory("MockRailgun");
        const mockRailgun = await MockRailgunFactory.deploy();
        await mockRailgun.waitForDeployment();

        const RoutingRailgunFactory = await hre.ethers.getContractFactory("RoutingRailgunFactory");
        const factory = await RoutingRailgunFactory.connect(controller).deploy();
        await factory.waitForDeployment();

        const rrAddr = await factory.connect(controller).createRoutingRailgun(await mockRailgun.getAddress());
        const createReceipt = await rrAddr.wait();
        const routingAddress = extractRoutingAddress(createReceipt, factory);

        const routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddress, user);

        await expect(user.sendTransaction({ to: routingAddress, value: hre.ethers.parseEther("1") })).to.not.be
            .reverted;

        const commitments = [hre.ethers.keccak256(hre.ethers.toUtf8Bytes("c1"))];
        const encryptedNotes = [hre.ethers.toUtf8Bytes("n1")];

        await expect(
            routing
                .connect(controller)
                .executeRailgunCall(
                    await mockRailgun.getAddress(),
                    hre.ethers.parseEther("1"),
                    mockRailgun.interface.encodeFunctionData("shield", [commitments, encryptedNotes])
                )
        ).to.not.be.reverted;

        // Fund router with ETH for refund
        await user.sendTransaction({ to: routingAddress, value: hre.ethers.parseEther("0.5") });

        await expect(
            routing.connect(controller).refund(hre.ethers.ZeroAddress, controller.address, hre.ethers.parseEther("0.5"))
        ).to.emit(routing, "RefundedETH");

        const lastAmount = await mockRailgun.lastAmount();
        expect(lastAmount).to.equal(hre.ethers.parseEther("1"));
    });

    it("refunds by controller", async function () {
        const [controller, user, recipient] = await hre.ethers.getSigners();

        const MockRailgunFactory = await hre.ethers.getContractFactory("MockRailgun");
        const mockRailgun = await MockRailgunFactory.deploy();
        await mockRailgun.waitForDeployment();

        const RoutingRailgunFactory = await hre.ethers.getContractFactory("RoutingRailgunFactory");
        const factory = await RoutingRailgunFactory.connect(controller).deploy();
        await factory.waitForDeployment();

        const rrAddr = await factory.connect(controller).createRoutingRailgun(recipient.address);
        const createReceipt2 = await rrAddr.wait();
        const routingAddress = extractRoutingAddress(createReceipt2, factory);

        const routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddress, user);

        await user.sendTransaction({ to: routingAddress, value: hre.ethers.parseEther("0.5") });

        // ownerAddress is controller, refund goes to ownerAddress
        const before = await hre.ethers.provider.getBalance(controller.address);
        const tx = await routing
            .connect(controller)
            .refund(hre.ethers.ZeroAddress, controller.address, hre.ethers.parseEther("0.5"));
        const refundReceipt = await tx.wait();
        const after = await hre.ethers.provider.getBalance(controller.address);
        const effectiveGasPrice = refundReceipt?.effectiveGasPrice ?? 0n;
        const gasPrice = tx.gasPrice ?? effectiveGasPrice;
        const gasUsed = refundReceipt?.gasUsed ?? 0n;
        const gasCost = gasUsed * gasPrice;
        expect(after - before + gasCost).to.equal(hre.ethers.parseEther("0.5"));
    });

    it("shields ERC20 and refunds ERC20", async function () {
        const [controller, user, recipient] = await hre.ethers.getSigners();

        const TokenFactory = await hre.ethers.getContractFactory("MyToken");
        const token = await TokenFactory.deploy("Test", "TST", 18);
        await token.waitForDeployment();

        const MockRailgunFactory = await hre.ethers.getContractFactory("MockRailgun");
        const mockRailgun = await MockRailgunFactory.deploy();
        await mockRailgun.waitForDeployment();

        const RoutingRailgunFactory = await hre.ethers.getContractFactory("RoutingRailgunFactory");
        const factory = await RoutingRailgunFactory.connect(controller).deploy();
        await factory.waitForDeployment();

        const rrAddrTx = await factory.connect(controller).createRoutingRailgun(await mockRailgun.getAddress());
        const createReceipt3 = await rrAddrTx.wait();
        const routingAddress = extractRoutingAddress(createReceipt3, factory);

        const routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddress, controller);

        await token.connect(controller).mint(user.address, hre.ethers.parseEther("10"));
        await token.connect(user).approve(routingAddress, hre.ethers.parseEther("2"));

        const commitments = [hre.ethers.keccak256(hre.ethers.toUtf8Bytes("c1"))];
        const encryptedNotes = [hre.ethers.toUtf8Bytes("n1")];

        await expect(
            routing
                .connect(controller)
                .approveToken(await token.getAddress(), await mockRailgun.getAddress(), hre.ethers.parseEther("2"))
        ).to.emit(routing, "TokenApproved");

        await expect(
            routing
                .connect(controller)
                .executeRailgunCall(
                    await mockRailgun.getAddress(),
                    0,
                    mockRailgun.interface.encodeFunctionData("shieldERC20", [
                        await token.getAddress(),
                        hre.ethers.parseEther("2"),
                        commitments,
                        encryptedNotes,
                    ])
                )
        ).to.not.be.reverted;

        const lastAmount = await mockRailgun.lastAmount();
        expect(lastAmount).to.equal(hre.ethers.parseEther("2"));

        await token.connect(user).transfer(routingAddress, hre.ethers.parseEther("1"));
        const beforeBal = await token.balanceOf(controller.address);
        await expect(
            routing.connect(controller).refund(await token.getAddress(), controller.address, hre.ethers.parseEther("1"))
        ).to.emit(routing, "RefundedToken");
        const afterBal = await token.balanceOf(controller.address);
        expect(afterBal - beforeBal).to.equal(hre.ethers.parseEther("1"));
    });
});

/**
 * Security and edge case tests for RoutingRailgun
 * Covers: access control, error paths, and branch coverage gaps
 */
describe("RoutingRailgun Security", function () {
    let routingRailgun: RoutingRailgun;
    let routingRailgunFactory: RoutingRailgunFactory;
    let mockRailgun: any;
    let mockToken: any;
    let controller: HardhatEthersSigner;
    let attacker: HardhatEthersSigner;
    let recipient: HardhatEthersSigner;

    beforeEach(async function () {
        [controller, attacker, recipient] = await hre.ethers.getSigners();

        // Deploy mock Railgun
        const MockRailgunFactory = await hre.ethers.getContractFactory("MockRailgun");
        mockRailgun = await MockRailgunFactory.deploy();
        await mockRailgun.waitForDeployment();

        // Deploy RoutingRailgunFactory
        const RoutingRailgunFactoryContract = await hre.ethers.getContractFactory("RoutingRailgunFactory");
        routingRailgunFactory = await RoutingRailgunFactoryContract.deploy();
        await routingRailgunFactory.waitForDeployment();

        // Create a RoutingRailgun instance (controller calls, so controller becomes the controller)
        const tx = await routingRailgunFactory.connect(controller).createRoutingRailgun(mockRailgun.target);
        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => {
            try {
                return routingRailgunFactory.interface.parseLog(log)?.name === "RoutingRailgunCreated";
            } catch {
                return false;
            }
        });
        const parsedEvent = routingRailgunFactory.interface.parseLog(event as any);
        const routingRailgunAddress = parsedEvent?.args.contractAddress;

        routingRailgun = await hre.ethers.getContractAt("RoutingRailgun", routingRailgunAddress);

        // Deploy mock token
        const MyTokenFactory = await hre.ethers.getContractFactory("MyToken");
        mockToken = await MyTokenFactory.deploy("Mock Token", "MTK", 18);
        await mockToken.waitForDeployment();

        // Fund the RoutingRailgun contract
        await controller.sendTransaction({
            to: routingRailgunAddress,
            value: parseEther("5.0"),
        });

        // Mint tokens to RoutingRailgun
        await mockToken.mint(routingRailgunAddress, parseEther("1000"));
    });

    describe("Access Control (onlyController)", function () {
        it("Should reject approveToken from non-controller", async function () {
            await expect(
                routingRailgun.connect(attacker).approveToken(mockToken.target, mockRailgun.target, parseEther("100"))
            ).to.be.revertedWithCustomError(routingRailgun, "NotController");
        });

        it("Should reject executeRailgunCall from non-controller", async function () {
            await expect(
                routingRailgun.connect(attacker).executeRailgunCall(mockRailgun.target, 0, "0x")
            ).to.be.revertedWithCustomError(routingRailgun, "NotController");
        });

        it("Should reject refund from non-controller", async function () {
            await expect(
                routingRailgun.connect(attacker).refund(hre.ethers.ZeroAddress, attacker.address, parseEther("1"))
            ).to.be.revertedWithCustomError(routingRailgun, "NotController");
        });

        it("Should allow controller to call approveToken", async function () {
            await expect(
                routingRailgun.connect(controller).approveToken(mockToken.target, mockRailgun.target, parseEther("100"))
            ).to.emit(routingRailgun, "TokenApproved");
        });

        it("Should allow controller to call executeRailgunCall", async function () {
            // MockRailgun has a fallback that accepts calls
            await expect(routingRailgun.connect(controller).executeRailgunCall(mockRailgun.target, 0, "0x")).to.emit(
                routingRailgun,
                "CallSuccess"
            );
        });

        it("Should allow controller to call refund (ETH)", async function () {
            await expect(
                routingRailgun.connect(controller).refund(hre.ethers.ZeroAddress, recipient.address, parseEther("1"))
            ).to.emit(routingRailgun, "RefundedETH");
        });

        it("Should allow controller to call refund (token)", async function () {
            await expect(
                routingRailgun.connect(controller).refund(mockToken.target, recipient.address, parseEther("100"))
            ).to.emit(routingRailgun, "RefundedToken");
        });
    });

    describe("Error Paths", function () {
        it("Should revert executeRailgunCall with InvalidRecipient if not railgunAddress", async function () {
            // Try to call a different address than railgunAddress
            await expect(
                routingRailgun.connect(controller).executeRailgunCall(attacker.address, 0, "0x")
            ).to.be.revertedWithCustomError(routingRailgun, "InvalidRecipient");
        });

        it("Should revert executeRailgunCall with CallFailed if call fails", async function () {
            // Configure MockRailgun to fail
            await mockRailgun.setShouldFail(true);

            await expect(
                routingRailgun.connect(controller).executeRailgunCall(mockRailgun.target, 0, "0x")
            ).to.be.revertedWithCustomError(routingRailgun, "CallFailed");
        });

        it("Should revert refund ETH with InsufficientETHBalance", async function () {
            // Try to refund more ETH than available
            const balance = await hre.ethers.provider.getBalance(await routingRailgun.getAddress());

            await expect(
                routingRailgun
                    .connect(controller)
                    .refund(hre.ethers.ZeroAddress, recipient.address, balance + parseEther("1"))
            ).to.be.revertedWithCustomError(routingRailgun, "InsufficientETHBalance");
        });

        it("Should revert refund token with TransferFailed if transfer fails", async function () {
            // Try to transfer more tokens than available
            const tokenBalance = await mockToken.balanceOf(await routingRailgun.getAddress());

            // This will fail because RoutingRailgun doesn't have enough tokens
            // Note: Standard ERC20 reverts, but the test checks the path
            await expect(
                routingRailgun
                    .connect(controller)
                    .refund(mockToken.target, recipient.address, tokenBalance + parseEther("1"))
            ).to.be.reverted; // ERC20 will revert before our custom error
        });
    });

    describe("ETH Handling", function () {
        it("Should receive ETH and emit FundsReceived", async function () {
            const amount = parseEther("1.0");

            await expect(
                attacker.sendTransaction({
                    to: await routingRailgun.getAddress(),
                    value: amount,
                })
            )
                .to.emit(routingRailgun, "FundsReceived")
                .withArgs(attacker.address, amount);
        });
    });

    describe("State Queries", function () {
        it("Should return correct controller", async function () {
            expect(await routingRailgun.controller()).to.equal(controller.address);
        });

        it("Should return correct railgunAddress", async function () {
            expect(await routingRailgun.railgunAddress()).to.equal(mockRailgun.target);
        });
    });
});

/**
 * Reentrancy tests for RoutingRailgun
 *
 * Analysis: RoutingRailgun has two potential reentrancy points:
 * 1. refund() - sends ETH via .call{value: amount}("")
 * 2. executeRailgunCall() - calls external contract via .call{value: value}(data)
 *
 * However, both functions have `onlyController` modifier, which should prevent
 * external attackers from re-entering since they are not the controller.
 *
 * These tests verify whether the access control provides sufficient protection.
 */
describe("RoutingRailgun Reentrancy", function () {
    let routingRailgun: RoutingRailgun;
    let routingRailgunFactory: RoutingRailgunFactory;
    let controller: HardhatEthersSigner;
    let attacker: HardhatEthersSigner;

    beforeEach(async function () {
        [controller, attacker] = await hre.ethers.getSigners();

        // Deploy RoutingRailgunFactory
        const RoutingRailgunFactoryContract = await hre.ethers.getContractFactory("RoutingRailgunFactory");
        routingRailgunFactory = await RoutingRailgunFactoryContract.deploy();
        await routingRailgunFactory.waitForDeployment();
    });

    describe("Refund Reentrancy", function () {
        it("PROTECTED: Reentrancy during refund fails due to onlyController", async function () {
            // Deploy a malicious Railgun that will be used as railgunAddress
            const MaliciousRailgunFactory = await hre.ethers.getContractFactory("RoutingRailgunReentrancyAttacker");
            const maliciousReceiver = await MaliciousRailgunFactory.deploy();
            await maliciousReceiver.waitForDeployment();

            // Controller creates RoutingRailgun with malicious contract as railgun address
            const tx = await routingRailgunFactory.connect(controller).createRoutingRailgun(maliciousReceiver.target);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return routingRailgunFactory.interface.parseLog(log)?.name === "RoutingRailgunCreated";
                } catch {
                    return false;
                }
            });
            const parsedEvent = routingRailgunFactory.interface.parseLog(event as any);
            const routingRailgunAddress = parsedEvent?.args.contractAddress;

            routingRailgun = await hre.ethers.getContractAt("RoutingRailgun", routingRailgunAddress);

            // Fund the RoutingRailgun with 5 ETH
            await controller.sendTransaction({
                to: routingRailgunAddress,
                value: parseEther("5.0"),
            });

            // Configure attacker to attempt reentrancy on refund
            await maliciousReceiver.setTarget(routingRailgunAddress);
            await maliciousReceiver.setAttackType(1); // 1 = attack refund

            const initialBalance = await hre.ethers.provider.getBalance(routingRailgunAddress);
            expect(initialBalance).to.equal(parseEther("5.0"));

            // Controller calls refund to send 1 ETH to malicious receiver
            // Malicious receiver will try to re-enter refund() in its receive()
            // But it should fail because malicious receiver is NOT the controller
            await routingRailgun
                .connect(controller)
                .refund(hre.ethers.ZeroAddress, maliciousReceiver.target, parseEther("1.0"));

            // Check: Only 1 ETH was sent, not drained
            const finalBalance = await hre.ethers.provider.getBalance(routingRailgunAddress);
            expect(finalBalance).to.equal(parseEther("4.0"));

            // Check: Attacker's reentrancy attempt failed
            const attackAttempts = await maliciousReceiver.attackCount();
            expect(attackAttempts).to.equal(1); // Only the initial receive, reentry failed

            console.log("Reentrancy attempt blocked by onlyController modifier");
        });

        it("PROTECTED: Malicious token cannot re-enter during token refund", async function () {
            // Deploy malicious ERC20 that tries to re-enter on transfer
            const MaliciousTokenFactory = await hre.ethers.getContractFactory("ReentrantToken");
            const maliciousToken = await MaliciousTokenFactory.deploy();
            await maliciousToken.waitForDeployment();

            // Create RoutingRailgun
            const tx = await routingRailgunFactory.connect(controller).createRoutingRailgun(controller.address);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return routingRailgunFactory.interface.parseLog(log)?.name === "RoutingRailgunCreated";
                } catch {
                    return false;
                }
            });
            const parsedEvent = routingRailgunFactory.interface.parseLog(event as any);
            const routingRailgunAddress = parsedEvent?.args.contractAddress;

            routingRailgun = await hre.ethers.getContractAt("RoutingRailgun", routingRailgunAddress);

            // Fund RoutingRailgun with malicious tokens
            await maliciousToken.mint(routingRailgunAddress, parseEther("100"));

            // Configure malicious token to attack this RoutingRailgun
            await maliciousToken.setTarget(routingRailgunAddress);

            const initialBalance = await maliciousToken.balanceOf(routingRailgunAddress);
            expect(initialBalance).to.equal(parseEther("100"));

            // Refund should work - malicious token's reentrancy attempt should fail
            await routingRailgun.connect(controller).refund(maliciousToken.target, attacker.address, parseEther("10"));

            // Only 10 tokens transferred, not drained
            const finalBalance = await maliciousToken.balanceOf(routingRailgunAddress);
            expect(finalBalance).to.equal(parseEther("90"));

            console.log("Token reentrancy blocked by onlyController modifier");
        });
    });

    describe("ExecuteRailgunCall Reentrancy", function () {
        it("PROTECTED: Malicious Railgun cannot re-enter during executeRailgunCall", async function () {
            // Deploy malicious Railgun that tries to re-enter
            const MaliciousRailgunFactory = await hre.ethers.getContractFactory("RoutingRailgunReentrancyAttacker");
            const maliciousRailgun = await MaliciousRailgunFactory.deploy();
            await maliciousRailgun.waitForDeployment();

            // Create RoutingRailgun with malicious Railgun as the railgunAddress
            const tx = await routingRailgunFactory.connect(controller).createRoutingRailgun(maliciousRailgun.target);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return routingRailgunFactory.interface.parseLog(log)?.name === "RoutingRailgunCreated";
                } catch {
                    return false;
                }
            });
            const parsedEvent = routingRailgunFactory.interface.parseLog(event as any);
            const routingRailgunAddress = parsedEvent?.args.contractAddress;

            routingRailgun = await hre.ethers.getContractAt("RoutingRailgun", routingRailgunAddress);

            // Fund RoutingRailgun
            await controller.sendTransaction({
                to: routingRailgunAddress,
                value: parseEther("5.0"),
            });

            // Configure malicious Railgun to attack
            await maliciousRailgun.setTarget(routingRailgunAddress);
            await maliciousRailgun.setAttackType(2); // 2 = attack executeRailgunCall

            const initialBalance = await hre.ethers.provider.getBalance(routingRailgunAddress);

            // Execute call to malicious Railgun with 1 ETH
            // Malicious Railgun will try to re-enter via executeRailgunCall
            await routingRailgun
                .connect(controller)
                .executeRailgunCall(maliciousRailgun.target, parseEther("1.0"), "0x");

            // Only 1 ETH was sent
            const finalBalance = await hre.ethers.provider.getBalance(routingRailgunAddress);
            expect(finalBalance).to.equal(parseEther("4.0"));

            console.log("ExecuteRailgunCall reentrancy blocked by onlyController modifier");
        });
    });

    describe("Edge Case: Controller is Malicious", function () {
        it("INFO: If controller itself is malicious, it could drain via multiple calls", async function () {
            /**
             * This is NOT a reentrancy vulnerability per se, but documents that
             * if the controller (Account) is compromised or malicious, it can
             * drain all funds by simply calling refund() multiple times.
             *
             * This is expected behavior - the controller is SUPPOSED to have
             * full control over the RoutingRailgun.
             */

            // Create RoutingRailgun with controller as railgun address (for simplicity)
            const tx = await routingRailgunFactory.connect(controller).createRoutingRailgun(controller.address);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return routingRailgunFactory.interface.parseLog(log)?.name === "RoutingRailgunCreated";
                } catch {
                    return false;
                }
            });
            const parsedEvent = routingRailgunFactory.interface.parseLog(event as any);
            const routingRailgunAddress = parsedEvent?.args.contractAddress;

            routingRailgun = await hre.ethers.getContractAt("RoutingRailgun", routingRailgunAddress);

            // Fund it
            await controller.sendTransaction({
                to: routingRailgunAddress,
                value: parseEther("5.0"),
            });

            // Controller can drain via multiple refund calls (expected behavior)
            await routingRailgun
                .connect(controller)
                .refund(hre.ethers.ZeroAddress, controller.address, parseEther("1.0"));
            await routingRailgun
                .connect(controller)
                .refund(hre.ethers.ZeroAddress, controller.address, parseEther("1.0"));
            await routingRailgun
                .connect(controller)
                .refund(hre.ethers.ZeroAddress, controller.address, parseEther("1.0"));

            const finalBalance = await hre.ethers.provider.getBalance(routingRailgunAddress);
            expect(finalBalance).to.equal(parseEther("2.0"));

            console.log("Controller has full authority (by design)");
        });
    });
});

/**
 * ERC20 Edge Case Tests for RoutingRailgun
 *
 * Tests behavior with non-standard ERC20 tokens:
 * - Tokens that return false instead of reverting
 * - Tokens that don't return a value (USDT-like)
 * - Fee-on-transfer tokens
 *
 * Note: RoutingRailgun does NOT use SafeERC20, which is a known issue in TODO.md
 */
describe("RoutingRailgun ERC20 Edge Cases", function () {
    let routingRailgun: RoutingRailgun;
    let routingRailgunFactory: RoutingRailgunFactory;
    let controller: HardhatEthersSigner;
    let recipient: HardhatEthersSigner;

    beforeEach(async function () {
        [controller, recipient] = await hre.ethers.getSigners();

        const RoutingRailgunFactoryContract = await hre.ethers.getContractFactory("RoutingRailgunFactory");
        routingRailgunFactory = await RoutingRailgunFactoryContract.deploy();
        await routingRailgunFactory.waitForDeployment();

        const tx = await routingRailgunFactory.connect(controller).createRoutingRailgun(controller.address);
        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => {
            try {
                return routingRailgunFactory.interface.parseLog(log)?.name === "RoutingRailgunCreated";
            } catch {
                return false;
            }
        });
        const parsedEvent = routingRailgunFactory.interface.parseLog(event as any);
        const routingRailgunAddress = parsedEvent?.args.contractAddress;

        routingRailgun = await hre.ethers.getContractAt("RoutingRailgun", routingRailgunAddress);
    });

    describe("Tokens That Return False", function () {
        it("VULNERABILITY: Token returning false on transfer is caught", async function () {
            // Deploy token that returns false instead of reverting
            const FalseReturningTokenFactory = await hre.ethers.getContractFactory("FalseReturningToken");
            const badToken = await FalseReturningTokenFactory.deploy();
            await badToken.waitForDeployment();

            // Mint tokens to RoutingRailgun
            await badToken.mint(await routingRailgun.getAddress(), parseEther("100"));

            // Configure token to return false on transfer
            await badToken.setShouldFail(true);

            // Refund should revert with TransferFailed
            await expect(
                routingRailgun.connect(controller).refund(badToken.target, recipient.address, parseEther("10"))
            ).to.be.revertedWithCustomError(routingRailgun, "TransferFailed");

            console.log("Token returning false correctly caught by TransferFailed check");
        });

        it("Should succeed when token returns true", async function () {
            const FalseReturningTokenFactory = await hre.ethers.getContractFactory("FalseReturningToken");
            const goodToken = await FalseReturningTokenFactory.deploy();
            await goodToken.waitForDeployment();

            await goodToken.mint(await routingRailgun.getAddress(), parseEther("100"));
            await goodToken.setShouldFail(false);

            await routingRailgun.connect(controller).refund(goodToken.target, recipient.address, parseEther("10"));

            expect(await goodToken.balanceOf(recipient.address)).to.equal(parseEther("10"));
        });
    });

    describe("Tokens That Don't Return Value (USDT-like)", function () {
        it("VULNERABILITY: No-return token causes revert (SafeERC20 needed)", async function () {
            // Deploy token that doesn't return a value
            const NoReturnTokenFactory = await hre.ethers.getContractFactory("NoReturnToken");
            const noReturnToken = await NoReturnTokenFactory.deploy();
            await noReturnToken.waitForDeployment();

            await noReturnToken.mint(await routingRailgun.getAddress(), parseEther("100"));

            // This will fail because Solidity expects a bool return but gets nothing
            // The EVM will revert when trying to decode the empty return
            await expect(
                routingRailgun.connect(controller).refund(noReturnToken.target, recipient.address, parseEther("10"))
            ).to.be.reverted;

            console.log("USDT-like token causes revert - SafeERC20 needed for compatibility");
        });
    });

    describe("Fee-on-Transfer Tokens", function () {
        it("INFO: Fee-on-transfer token results in less received than expected", async function () {
            // Deploy fee-on-transfer token (10% fee)
            const FeeTokenFactory = await hre.ethers.getContractFactory("FeeOnTransferToken");
            const feeToken = await FeeTokenFactory.deploy();
            await feeToken.waitForDeployment();

            await feeToken.mint(await routingRailgun.getAddress(), parseEther("100"));

            const recipientBalanceBefore = await feeToken.balanceOf(recipient.address);

            // Transfer 10 tokens, but recipient gets only 9 (10% fee)
            await routingRailgun.connect(controller).refund(feeToken.target, recipient.address, parseEther("10"));

            const recipientBalanceAfter = await feeToken.balanceOf(recipient.address);
            const received = recipientBalanceAfter - recipientBalanceBefore;

            // Recipient receives less than requested amount
            expect(received).to.equal(parseEther("9")); // 10 - 10% fee = 9

            console.log("Fee-on-transfer: Requested 10, received 9 (10% fee taken)");
        });
    });

    describe("Approval Edge Cases", function () {
        it("VULNERABILITY: Token returning false on approve is caught", async function () {
            const FalseReturningTokenFactory = await hre.ethers.getContractFactory("FalseReturningToken");
            const badToken = await FalseReturningTokenFactory.deploy();
            await badToken.waitForDeployment();

            await badToken.setApprovalShouldFail(true);

            await expect(
                routingRailgun.connect(controller).approveToken(badToken.target, recipient.address, parseEther("100"))
            ).to.be.revertedWithCustomError(routingRailgun, "ApprovalFailed");

            console.log("Token returning false on approve correctly caught");
        });
    });
});
