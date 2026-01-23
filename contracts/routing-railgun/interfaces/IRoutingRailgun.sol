// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IRoutingRailgun {
    event FundsReceived(address indexed sender, uint256 amount);
    event RefundedETH(address indexed to, uint256 amount);
    event RefundedToken(address indexed token, address indexed to, uint256 amount);
    event CallSuccess(address indexed to, uint256 value, bytes data);
    event TokenApproved(address indexed token, address indexed to, uint256 amount);

    error NotController();
    error InvalidETHRefundAmount();
    error CallFailed();
    error InvalidRecipient();
    error ApprovalFailed();
    error TransferFailed();

    function railgunAddress() external view returns (address);

    function controller() external view returns (address);

    function approveToken(address token, address to, uint256 amount) external;

    function executeRailgunCall(address to, uint256 value, bytes calldata data) external;

    function refund(address token, address to, uint256 amount) external;
}
