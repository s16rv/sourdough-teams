// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract MockRailgun {
    uint256 public totalReceived;
    uint256 public lastAmount;
    bytes32[] public lastCommitments;
    bytes[] public lastEncryptedNotes;
    address public lastToken;

    event Shield(address indexed from, uint256 amount);
    event ShieldERC20(address indexed token, uint256 amount);

    function shield(bytes32[] calldata commitments, bytes[] calldata encryptedNotes) external payable {
        totalReceived += msg.value;
        lastAmount = msg.value;
        lastCommitments = commitments;
        lastEncryptedNotes = encryptedNotes;
        emit Shield(msg.sender, msg.value);
    }

    function shieldERC20(address token, uint256 amount, bytes32[] calldata commitments, bytes[] calldata encryptedNotes) external {
        lastToken = token;
        lastAmount = amount;
        lastCommitments = commitments;
        lastEncryptedNotes = encryptedNotes;
        emit ShieldERC20(token, amount);
    }
}
