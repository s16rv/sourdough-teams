import { expect } from "chai";
import hre from "hardhat";

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

        const zkAddress = "railgun-0zk-addr";
        const rrAddr = await factory
            .connect(controller)
            .createRoutingRailgun(controller.address, zkAddress, await mockRailgun.getAddress());
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
                .shieldTransfer(
                    hre.ethers.ZeroAddress,
                    controller.address,
                    hre.ethers.parseEther("1"),
                    commitments,
                    encryptedNotes,
                    { value: hre.ethers.parseEther("1") }
                )
        ).to.not.be.reverted;

        await expect(
            routing
                .connect(controller)
                .refund(hre.ethers.ZeroAddress, controller.address, hre.ethers.parseEther("0.5"), {
                    value: hre.ethers.parseEther("0.5"),
                })
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

        const zkAddress = "railgun-0zk-addr";
        const rrAddr = await factory
            .connect(controller)
            .createRoutingRailgun(controller.address, zkAddress, await mockRailgun.getAddress());
        const createReceipt2 = await rrAddr.wait();
        const routingAddress = extractRoutingAddress(createReceipt2, factory);

        const routing = await hre.ethers.getContractAt("RoutingRailgun", routingAddress, user);

        await user.sendTransaction({ to: routingAddress, value: hre.ethers.parseEther("0.5") });

        // ownerAddress is controller, refund goes to ownerAddress
        const before = await hre.ethers.provider.getBalance(controller.address);
        const tx = await routing
            .connect(controller)
            .refund(hre.ethers.ZeroAddress, controller.address, hre.ethers.parseEther("0.5"), {
                value: hre.ethers.parseEther("0.5"),
            });
        const refundReceipt = await tx.wait();
        const after = await hre.ethers.provider.getBalance(controller.address);
        const gasPrice = tx.gasPrice ?? refundReceipt.effectiveGasPrice ?? 0n;
        const gasCost = refundReceipt.gasUsed * gasPrice;
        expect(after - before + gasCost).to.equal(0n);
    });
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

    const rrAddrTx = await factory
        .connect(controller)
        .createRoutingRailgun(controller.address, "railgun-0zk-addr", await mockRailgun.getAddress());
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
            .shieldTransfer(
                await token.getAddress(),
                user.address,
                hre.ethers.parseEther("2"),
                commitments,
                encryptedNotes
            )
    ).to.not.be.reverted;

    const lastAmount = await mockRailgun.lastAmount();
    expect(lastAmount).to.equal(hre.ethers.parseEther("2"));

    await token.connect(user).approve(routingAddress, hre.ethers.parseEther("1"));
    const beforeBal = await token.balanceOf(controller.address);
    await expect(
        routing.connect(controller).refund(await token.getAddress(), user.address, hre.ethers.parseEther("1"))
    ).to.emit(routing, "RefundedToken");
    const afterBal = await token.balanceOf(controller.address);
    expect(afterBal - beforeBal).to.equal(hre.ethers.parseEther("1"));
});
