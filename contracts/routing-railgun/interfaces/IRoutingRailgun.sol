// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRoutingRailgun {
    /**
     * @dev Emitted when funds are received by the contract.
     * @param sender The address sending the funds.
     * @param amount The amount of funds received.
     */
    event FundsReceived(address indexed sender, uint256 amount);

    /**
     * @dev Emitted when ETH is refunded.
     * @param to The address receiving the refund.
     * @param amount The amount of ETH refunded.
     */
    event RefundedETH(address indexed to, uint256 amount);

    /**
     * @dev Emitted when ERC20 tokens are refunded.
     * @param token The address of the token being refunded.
     * @param to The address receiving the refund.
     * @param amount The amount of tokens refunded.
     */
    event RefundedToken(address indexed token, address indexed to, uint256 amount);

    /**
     * @dev Emitted when a Railgun call is successfully executed.
     * @param to The address called (should be the Railgun contract).
     * @param value The amount of ETH sent with the call.
     * @param data The calldata sent with the call.
     */
    event CallSuccess(address indexed to, uint256 value, bytes data);

    /**
     * @dev Emitted when a token approval is successful.
     * @param token The address of the token approved.
     * @param to The address of the spender.
     * @param amount The amount approved.
     */
    event TokenApproved(address indexed token, address indexed to, uint256 amount);

    /**
     * @dev Error thrown when the caller is not the controller.
     */
    error NotController();

    /**
     * @dev Error thrown when the contract has insufficient ETH balance for a refund.
     */
    error InsufficientETHBalance();

    /**
     * @dev Error thrown when an ETH transfer fails.
     */
    error ETHTransferFailed();

    /**
     * @dev Error thrown when a call to the Railgun contract fails.
     */
    error CallFailed();

    /**
     * @dev Error thrown when the recipient is invalid (not the Railgun address).
     */
    error InvalidRecipient();

    /**
     * @dev Error thrown when a token approval fails.
     */
    error ApprovalFailed();

    /**
     * @dev Error thrown when a token transfer fails.
     */
    error TransferFailed();

    /**
     * @dev Returns the address of the Railgun contract.
     * @return The address of the Railgun contract.
     */
    function railgunAddress() external view returns (address);

    /**
     * @dev Returns the address of the controller.
     * @return The address of the controller.
     */
    function controller() external view returns (address);

    /**
     * @dev Approves the Railgun contract to spend tokens.
     * @param token The address of the token to approve.
     * @param to The address of the spender.
     * @param amount The amount of tokens to approve.
     */
    function approveToken(address token, address to, uint256 amount) external;

    /**
     * @dev Executes a call to the Railgun contract.
     * @param to The address of the contract to call.
     * @param value The amount of Ether to send with the call.
     * @param data The calldata to send.
     */
    function executeRailgunCall(address to, uint256 value, bytes calldata data) external;

    /**
     * @dev Refunds tokens or Ether to a specified address.
     * @param token The address of the token to refund (address(0) for Ether).
     * @param to The address to receive the refund.
     * @param amount The amount to refund.
     */
    function refund(address token, address to, uint256 amount) external;
}
