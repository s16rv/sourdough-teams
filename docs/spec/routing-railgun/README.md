---
title: Routing Railgun
stage: Draft
category: Contract
kind: instantiation
author: S16 Research Ventures <team@s16.ventures>
created: 2026-01-30
modified: 2026-01-30
requires:
version compatibility:
---

## Synopsis

This document specifies the data structures, state machine handling logic, and encoding details for implementation of the Routing Railgun contracts, which provide optional privacy integration with the Railgun protocol.

## Motivation

Routing Railgun enables Smart Account users to interact with the Railgun privacy protocol for shielding and unshielding tokens. By routing transactions through a dedicated intermediary contract, users can maintain separation between their public Smart Account and private Railgun transactions.

The design uses a factory pattern where each user (or Smart Account) deploys their own RoutingRailgun instance, ensuring isolated control over funds staged for privacy operations.

## Definitions

- `RoutingRailgun`: An intermediary contract that holds funds and executes calls to the Railgun protocol on behalf of a controller.
- `RoutingRailgunFactory`: A factory contract for deploying new RoutingRailgun instances.
- `Controller`: The address authorized to operate the RoutingRailgun contract (set at deployment).
- `Railgun Address`: The address of the Railgun protocol contract that handles shielding/unshielding.
- `Shielding`: The process of depositing tokens into Railgun's private pool.
- `Unshielding`: The process of withdrawing tokens from Railgun's private pool.

## Desired Properties

- `Isolation`: Each user has their own RoutingRailgun instance with exclusive control.
- `Controller Exclusivity`: Only the designated controller can operate the contract.
- `Railgun Restriction`: Calls can only be made to the configured Railgun address.
- `Refund Capability`: Controller can recover funds if operations fail.

## Technical Specification

### General Design

```
┌─────────┐     ┌─────────────────┐     ┌─────────┐
│ Account │ --> │ RoutingRailgun  │ --> │ Railgun │
└─────────┘     └─────────────────┘     └─────────┘
     │                   ^
     │                   │
     v                   │
┌─────────────────────────────┐
│ RoutingRailgunFactory       │
└─────────────────────────────┘
```

### User Flow

#### Shield ERC20 Tokens

```
1. Controller transfers tokens to RoutingRailgun
   └── ERC20.transfer(routingRailgunAddress, amount)

2. Controller approves Railgun to spend tokens
   └── routingRailgun.approveToken(tokenAddress, railgunAddress, amount)

3. Controller executes Railgun shield call
   └── routingRailgun.executeRailgunCall(railgunAddress, 0, shieldCalldata)
       └── Railgun pulls tokens and shields them into private pool
```

#### Shield ETH

```
1. Send ETH to RoutingRailgun
   └── routingRailgun.receive{value: amount}()
       └── Emits FundsReceived event

2. Controller executes Railgun shield call with value
   └── routingRailgun.executeRailgunCall(railgunAddress, amount, shieldCalldata)
```

#### Refund (Recovery)

```
For ETH:
   └── routingRailgun.refund(address(0), recipientAddress, amount)
       └── Requires amount == contract balance (full refund only)

For ERC20:
   └── routingRailgun.refund(tokenAddress, recipientAddress, amount)
```

### Data Structures

#### RoutingRailgun Contract

```solidity
interface IRoutingRailgun {
    // Events
    event FundsReceived(address indexed sender, uint256 amount);
    event RefundedETH(address indexed to, uint256 amount);
    event RefundedToken(address indexed token, address indexed to, uint256 amount);
    event CallSuccess(address indexed to, uint256 value, bytes data);
    event TokenApproved(address indexed token, address indexed to, uint256 amount);

    // Errors
    error NotController();
    error InvalidETHRefundAmount();
    error CallFailed();
    error InvalidRecipient();

    // State
    // address public railgunAddress;
    // address public controller;

    function railgunAddress() external view returns (address);
    function controller() external view returns (address);

    function approveToken(address token, address to, uint256 amount) external;
    function executeRailgunCall(address to, uint256 value, bytes calldata data) external;
    function refund(address token, address to, uint256 amount) external;

    receive() external payable;
}
```

#### RoutingRailgunFactory Contract

```solidity
interface IRoutingRailgunFactory {
    event RoutingRailgunCreated(address indexed routingRailgun, address indexed railgunAddress);

    function createRoutingRailgun(address railgunAddress) external returns (address);
}
```

### Sub-protocols

#### createRoutingRailgun

Deploys a new RoutingRailgun instance.

```
1. Deploy new RoutingRailgun(msg.sender, railgunAddress)
   - msg.sender becomes the controller
   - railgunAddress is the Railgun protocol address
2. Emit RoutingRailgunCreated event
3. Return deployed contract address
```

#### approveToken

Approves an ERC20 token for spending (controller only).

```
1. Check msg.sender == controller
2. Call IERC20(token).approve(to, amount)
3. Emit TokenApproved event
```

#### executeRailgunCall

Executes a call to the Railgun protocol (controller only).

```
1. Check msg.sender == controller
2. Check to == railgunAddress (security: only Railgun calls allowed)
3. Execute low-level call: to.call{value: value}(data)
4. If call fails, revert with CallFailed
5. Emit CallSuccess event
```

#### refund

Returns funds to a specified address (controller only).

```
For ETH (token == address(0)):
1. Check msg.sender == controller
2. Check address(this).balance == amount (must refund exact balance)
3. Transfer ETH via payable(to).transfer(amount)
4. Emit RefundedETH event

For ERC20:
1. Check msg.sender == controller
2. Call IERC20(token).transfer(to, amount)
3. Emit RefundedToken event
```

### Access Control

| Function | Access | Notes |
|----------|--------|-------|
| `receive()` | Anyone | Accept ETH deposits |
| `approveToken()` | Controller only | Set token allowances |
| `executeRailgunCall()` | Controller only | Must target railgunAddress |
| `refund()` | Controller only | Recovery mechanism |

### Security Considerations

#### Controller Exclusivity

- All state-changing operations require `msg.sender == controller`
- Controller is immutable (set at deployment)

#### Railgun Address Restriction

- `executeRailgunCall` validates `to == railgunAddress`
- Prevents controller from using the contract to call arbitrary addresses

#### ETH Refund Constraint

- ETH refunds require exact balance match: `address(this).balance == amount`
- This is a design choice that could be reconsidered (partial refunds not supported)

### Known Limitations

- **No SafeERC20**: Uses raw `IERC20.approve()` and `IERC20.transfer()` which may fail silently on non-standard tokens (e.g., USDT). Should use OpenZeppelin SafeERC20.
- **ETH Refund**: Must refund exact balance; partial refunds not supported.
- **Controller Immutability**: Cannot change controller after deployment.
- **No Factory Admin**: Cannot update default Railgun address after factory deployment.

## Example Implementations

- RoutingRailgun [Solidity Implementation](https://github.com/s16rv/sourdough-solidity-contracts/tree/main/contracts/routing-railgun)

## History

- January 30, 2026 - Initial draft

## Copyright

All content herein is licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
