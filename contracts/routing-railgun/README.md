RoutingRailgun provides a minimal controller-gated router to perform Railgun execute call for example shield token. The contract also provides refunding mechanism with controller role to designated recipient. Funds are supplied at through send to contract address.

**Factory**

- `createRoutingRailgun(address railgunAddress)`
    - Deploys a `RoutingRailgun` configured with `controller = msg.sender` and `railgunAddress`.
    - Emits `RoutingRailgunCreated(address contractAddress, address railgunAddress)`.

**RoutingRailgun**

- Constructor: `(address controller, address railgunAddress)`

    - `controller`: address authorized to call `executeRailgunCall` and `refund`.
    - `railgunAddress`: an address reserved by the router; `executeRailgunCall` reverts for this address to guard misrouting (`InvalidRecipient`).

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
    - `executeRailgunCall(address to, uint256 value, bytes data) external payable onlyController`
        - Forwards a call with optional ETH. Reverts `InvalidRecipient` if `to == railgunAddress`. Emits `CallSuccess` on success.
    - `refund(address token, address to, uint256 amount) external payable onlyController`
        - ETH: require `msg.value == amount`, transfers ETH to `to`, emits `RefundedETH(to, amount)`.
        - ERC20: transfers tokens held by the router to `to`, emits `RefundedToken(token, to, amount)`.

- Notes on Railgun interactions
    - To interact with a Railgun contract, encode its `shield`/`shieldERC20` call data off-chain and pass it to `executeRailgunCall`. Commitments and encrypted notes are produced off-chain by your Railgun SDK.

**Design Notes**

- Stateless flows: the router holds no internal accounting. ETH is provided via `msg.value`, tokens must be held by the router prior to `refund`.
- Access control: only `controller` can call mutation functions.
- Observability: events allow downstream systems to track receipts, refunds, and forwarded calls.

**Testing**

- Hardhat tests cover ETH forward-calls to a `MockRailgun`, and ETH/ERC20 refunds.
- `RoutingRailgunFactory.createRoutingRailgun(railgunAddress)` deploys a router controlled by the deployer.
