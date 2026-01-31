import hre from "hardhat";
import { expect } from "chai";
import { parseEther } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { RoutingRailgun, RoutingRailgunFactory } from "../../typechain-types";

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
