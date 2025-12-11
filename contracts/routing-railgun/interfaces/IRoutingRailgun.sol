// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IRoutingRailgun {
    event FundsReceived(address indexed sender, uint256 amount);
    event Shielded(uint256 amount, bytes32[] commitments, bytes[] encryptedNotes);
    event ShieldedToken(address indexed token, uint256 amount, bytes32[] commitments, bytes[] encryptedNotes);
    event RefundedETH(address indexed to, uint256 amount);
    event RefundedToken(address indexed token, address indexed from, address indexed to, uint256 amount);

    error NotController();
    error NotOwnerAddress();
    error ParamsLengthMismatch();
    error InvalidETHAmount();
    error ETHNotAcceptedForERC20();
    error InvalidETHRefundAmount();

    function railgunAddress() external view returns (address);
    function controller() external view returns (address);

    function shieldTransfer(
        address token,
        address from,
        uint256 amount,
        bytes32[] calldata commitments,
        bytes[] calldata encryptedNotes
    ) external payable;

    function refund(
        address token,
        address from,
        uint256 amount
    ) external payable;
}
