// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IRoutingRailgun.sol";

contract RoutingRailgun is IRoutingRailgun {
    address public railgunAddress;
    address public controller;

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    constructor(address controller_, address railgunAddress_) {
        controller = controller_;
        railgunAddress = railgunAddress_;
    }

    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    function approveToken(address token, address to, uint256 amount) external onlyController {
        IERC20(token).approve(to, amount);
        emit TokenApproved(token, to, amount);
    }

    function executeRailgunCall(address to, uint256 value, bytes calldata data) external onlyController {
        if (to == railgunAddress) revert InvalidRecipient();
        (bool success, ) = to.call{value: value}(data);
        if (!success) {
            revert CallFailed();
        }
        emit CallSuccess(to, value, data);
    }

    function refund(address token, address to, uint256 amount) external onlyController {
        if (token == address(0)) {
            if (address(this).balance != amount) revert InvalidETHRefundAmount();
            payable(to).transfer(amount);
            emit RefundedETH(to, amount);
        } else {
            IERC20(token).transfer(to, amount);
            emit RefundedToken(token, to, amount);
        }
    }
}
