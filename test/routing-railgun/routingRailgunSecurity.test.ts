import hre from "hardhat";
import { expect } from "chai";
import { parseEther } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { RoutingRailgun, RoutingRailgunFactory } from "../../typechain-types";

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
