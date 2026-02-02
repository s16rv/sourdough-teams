// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IRoutingRailgun.sol";

contract RoutingRailgun is IRoutingRailgun, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public railgunAddress;
    address public controller;

    /**
     * @dev Modifier to restrict access to the controller.
     */
    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    /**
     * @dev Initializes the contract with the controller and Railgun address.
     * @param controller_ The address of the controller.
     * @param railgunAddress_ The address of the Railgun contract.
     */
    constructor(address controller_, address railgunAddress_) {
        controller = controller_;
        railgunAddress = railgunAddress_;
    }

    /**
     * @dev Allows the contract to receive Ether.
     */
    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    /**
     * @dev Approves the Railgun contract to spend tokens.
     * @param token The address of the token to approve.
     * @param to The address of the spender (usually the Railgun contract).
     * @param amount The amount of tokens to approve.
     */
    function approveToken(address token, address to, uint256 amount) external onlyController {
        IERC20(token).forceApprove(to, amount);
        emit TokenApproved(token, to, amount);
    }

    /**
     * @dev Executes a call to the Railgun contract.
     * @param to The address of the contract to call (must be the Railgun address).
     * @param value The amount of Ether to send with the call.
     * @param data The calldata to send.
     */
    function executeRailgunCall(address to, uint256 value, bytes calldata data) external onlyController nonReentrant {
        if (to != railgunAddress) revert InvalidRecipient();
        (bool success, ) = to.call{value: value}(data);
        if (!success) {
            revert CallFailed();
        }
        emit CallSuccess(to, value, data);
    }

    /**
     * @dev Refunds tokens or Ether to a specified address.
     * @param token The address of the token to refund (address(0) for Ether).
     * @param to The address to receive the refund.
     * @param amount The amount to refund.
     */
    function refund(address token, address to, uint256 amount) external onlyController nonReentrant {
        if (token == address(0)) {
            if (address(this).balance < amount) revert InsufficientETHBalance();
            (bool success, ) = payable(to).call{value: amount}("");
            if (!success) revert ETHTransferFailed();
            emit RefundedETH(to, amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
            emit RefundedToken(token, to, amount);
        }
    }
}
