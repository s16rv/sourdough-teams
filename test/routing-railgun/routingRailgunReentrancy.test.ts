import hre from "hardhat";
import { expect } from "chai";
import { parseEther } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { RoutingRailgun, RoutingRailgunFactory } from "../../typechain-types";

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
