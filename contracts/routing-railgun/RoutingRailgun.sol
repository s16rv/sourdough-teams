// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IRoutingRailgun.sol";

interface IRailgun {
    function shield(bytes32[] calldata commitments, bytes[] calldata encryptedNotes) external payable;
    function shieldERC20(address token, uint256 amount, bytes32[] calldata commitments, bytes[] calldata encryptedNotes) external;
}

contract RoutingRailgun is IRoutingRailgun {
    string private _zkAddress;
    address public railgunAddress;
    address public controller;
    address private _ownerAddress;

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    modifier onlyOwnerAddress() {
        if (msg.sender != _ownerAddress) revert NotOwnerAddress();
        _;
    }

    constructor(address controller_, address ownerAddress_, string memory zkAddress_, address railgunAddress_) {
        controller = controller_;
        _ownerAddress = ownerAddress_;
        _zkAddress = zkAddress_;
        railgunAddress = railgunAddress_;
    }

    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    function shieldTransfer(
        address token,
        address from,
        uint256 amount,
        bytes32[] calldata commitments,
        bytes[] calldata encryptedNotes
    ) external payable onlyController {
        if (commitments.length != encryptedNotes.length) revert ParamsLengthMismatch();
        if (token == address(0)) {
            if (msg.value != amount) revert InvalidETHAmount();
            IRailgun(railgunAddress).shield{value: amount}(commitments, encryptedNotes);
            emit Shielded(amount, commitments, encryptedNotes);
        } else {
            if (msg.value != 0) revert ETHNotAcceptedForERC20();
            IERC20(token).transferFrom(from, railgunAddress, amount);
            IRailgun(railgunAddress).shieldERC20(token, amount, commitments, encryptedNotes);
            emit ShieldedToken(token, amount, commitments, encryptedNotes);
        }
    }

    function refund(address token, address from, uint256 amount) external payable onlyOwnerAddress {
        if (token == address(0)) {
            if (msg.value != amount) revert InvalidETHRefundAmount();
            payable(_ownerAddress).transfer(amount);
            emit RefundedETH(_ownerAddress, amount);
        } else {
            IERC20(token).transferFrom(from, _ownerAddress, amount);
            emit RefundedToken(token, from, _ownerAddress, amount);
        }
    }
}
