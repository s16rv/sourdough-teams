# Routing Railgun

RoutingRailgun is a minimal, controller-gated router that forwards encoded calls (e.g., Railgun `shield`/`shieldERC20`) and performs ETH/ERC20 refunds. The controller is authorized to call `executeRailgunCall` and `refund`. Encoded call data is produced off-chain, then forwarded by the router to the Railgun contract to shield funds to the user’s zk address.

**Factory**

- `createRoutingRailgun(address railgunAddress)`
    - Deploys a `RoutingRailgun` configured with `controller = msg.sender` and `railgunAddress`.
    - Emits `RoutingRailgunCreated(address contractAddress, address railgunAddress)`.

**RoutingRailgun**

- Constructor: `(address controller, address railgunAddress)`

    - `controller`: address authorized to call `executeRailgunCall` and `refund`.
    - `railgunAddress`: a railgun contract address reserved by the router; `executeRailgunCall` reverts for this address to guard misrouting (`InvalidRecipient`).

- Events

    - `FundsReceived(address indexed sender, uint256 amount)`
    - `RefundedETH(address indexed to, uint256 amount)`
    - `RefundedToken(address indexed token, address indexed to, uint256 amount)`
    - `CallSuccess(address indexed to, uint256 value, bytes data)`

- Errors

    - `NotController`
    - `InvalidETHRefundAmount`
    - `CallFailed`
    - `InvalidRecipient`

- Functions

    - `controller() → address`
    - `railgunAddress() → address`
    - `executeRailgunCall(address to, uint256 value, bytes data) external onlyController`
        - Non-payable. Forwards an encoded call to `to` and sends `value` wei from the router’s existing ETH balance. Reverts `InvalidRecipient` if `to == railgunAddress`. Emits `CallSuccess` on success.
    - `refund(address token, address to, uint256 amount) external onlyController`
        - ETH: requires `address(this).balance == amount`, transfers ETH to `to`, emits `RefundedETH(to, amount)`.
        - ERC20: transfers tokens currently held by the router to `to`, emits `RefundedToken(token, to, amount)`.
    - `receive() external payable`
        - Allows the router to receive ETH and emits `FundsReceived(sender, amount)`.

- Notes on Railgun interactions
    - To interact with a Railgun contract, encode its `shield`/`shieldERC20` call data off-chain and pass it to `executeRailgunCall`. Commitments and encrypted notes are produced off-chain by your Railgun SDK.

**Design Notes**

- Stateless flows: the router holds no internal accounting. Fund the router with ETH via a plain transfer before calling `executeRailgunCall` or `refund`. Tokens must be held by the router prior to `refund`.
- Access control: only `controller` can call mutation functions.
- Observability: events allow downstream systems to track receipts, refunds, and forwarded calls.

**Testing**

- Hardhat tests cover ETH forward-calls to a `MockRailgun`, and ETH/ERC20 refunds.
- `RoutingRailgunFactory.createRoutingRailgun(railgunAddress)` deploys a router controlled by the deployer.
