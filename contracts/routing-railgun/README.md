RoutingRailgun provides a simple routing layer to shield ETH and ERC20 into Railgun for a fixed recipient zk address. Funds are supplied at call time; there is no pooled balance. Refunds are restricted to the configured owner address.

**Factory**

- `createRoutingRailgun(address ownerAddress, string zkAddress, address railgunAddress)`
    - Deploys a `RoutingRailgun` configured with controller=`msg.sender`, `ownerAddress`, `zkAddress`, and `railgunAddress`.
    - Emits `RoutingRailgunCreated(address contractAddress, string zkAddress, address railgunAddress)`.

**RoutingRailgun**

- Constructor: `(address controller, address ownerAddress, string zkAddress, address railgunAddress)`

    - `controller`: address authorized to call `shieldTransfer`.
    - `ownerAddress`: address authorized to call `refund`; refunds always pay to this address.
    - `zkAddress`: target Railgun recipient zk address (used off-chain to build commitments and encrypted notes).
    - `railgunAddress`: Railgun contract address to interact with.

- Events

    - `FundsReceived(address indexed sender, uint256 amount)`
    - `Shielded(uint256 amount, bytes32[] commitments, bytes[] encryptedNotes)`
    - `ShieldedToken(address indexed token, uint256 amount, bytes32[] commitments, bytes[] encryptedNotes)`
    - `RefundedETH(address indexed to, uint256 amount)`
    - `RefundedToken(address indexed token, address indexed from, address indexed to, uint256 amount)`

- Errors

    - `NotController()`
    - `ParamsLengthMismatch()`
    - `InvalidETHAmount()`
    - `ETHNotAcceptedForERC20()`
    - `InvalidETHRefundAmount()`

- ETH and ERC20 Shielding

    - `shieldTransfer(address token, address from, uint256 amount, bytes32[] commitments, bytes[] encryptedNotes) external payable onlyController`
        - For ETH: set `token = address(0)`, require `msg.value == amount`, call `IRailgun.shield{value: amount}(commitments, encryptedNotes)`, emit `Shielded`.
        - For ERC20: require `msg.value == 0`, `IERC20(token).transferFrom(from, railgunAddress, amount)`, call `IRailgun.shieldERC20(token, amount, commitments, encryptedNotes)`, emit `ShieldedToken`.

- Refunds (owner-only)
    - `refund(address token, address from, uint256 amount) external payable`
        - Only callable by `ownerAddress`.
        - ETH: require `msg.value == amount`, transfer to `ownerAddress`, emit `RefundedETH(ownerAddress, amount)`.
        - ERC20: `IERC20(token).transferFrom(from, ownerAddress, amount)`, emit `RefundedToken(token, from, ownerAddress, amount)`.

**Design Notes**

- Stateless funding: no `pendingBalance`; the controller or user supplies ETH via `msg.value` or ERC20 via `transferFrom` at shield/refund time.
- Off-chain commitments: commitments and encrypted notes are computed off-chain (via Railgun SDK) using `zkAddress` and passed into `shieldTransfer`.
- Access control: `controller` gates shielding; `ownerAddress` gates refunding.
- Observability: events enable indexing and automation for the controller.

**Testing**

- Hardhat tests cover ETH and ERC20 shielding, and owner refunds.
- Event parsing uses ethers v6 `parseLog` for reliability.
