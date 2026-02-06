// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockRailgun {
    uint256 public totalReceived;
    uint256 public lastAmount;
    bytes32[] public lastCommitments;
    bytes[] public lastEncryptedNotes;
    address public lastToken;
    bool public shouldFail;

    event Shield(address indexed from, uint256 amount);
    event ShieldERC20(address indexed token, uint256 amount);

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function shield(bytes32[] calldata commitments, bytes[] calldata encryptedNotes) external payable {
        require(!shouldFail, "MockRailgun: forced failure");
        totalReceived += msg.value;
        lastAmount = msg.value;
        lastCommitments = commitments;
        lastEncryptedNotes = encryptedNotes;
        emit Shield(msg.sender, msg.value);
    }

    function shieldERC20(address token, uint256 amount, bytes32[] calldata commitments, bytes[] calldata encryptedNotes) external {
        require(!shouldFail, "MockRailgun: forced failure");
        lastToken = token;
        lastAmount = amount;
        lastCommitments = commitments;
        lastEncryptedNotes = encryptedNotes;
        emit ShieldERC20(token, amount);
    }

    // Fallback to accept arbitrary calls (for executeRailgunCall testing)
    fallback() external payable {
        require(!shouldFail, "MockRailgun: forced failure");
    }

    receive() external payable {
        require(!shouldFail, "MockRailgun: forced failure");
    }
}
