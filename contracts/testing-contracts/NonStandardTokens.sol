// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @title FalseReturningToken
 * @dev ERC20-like token that returns false instead of reverting on failure
 * Used to test if contracts properly check return values
 */
contract FalseReturningToken {
    string public name = "False Returning Token";
    string public symbol = "FRT";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool public shouldFail;
    bool public approvalShouldFail;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function setApprovalShouldFail(bool _shouldFail) external {
        approvalShouldFail = _shouldFail;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (shouldFail) {
            return false; // Returns false instead of reverting
        }
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (approvalShouldFail) {
            return false;
        }
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (shouldFail) {
            return false;
        }
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title NoReturnToken
 * @dev ERC20-like token that doesn't return a value (like old USDT)
 * Solidity expects bool return, so this causes issues without SafeERC20
 */
contract NoReturnToken {
    string public name = "No Return Token";
    string public symbol = "NRT";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    // Note: No return value - this breaks standard Solidity bool checks
    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        // No return statement!
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
        // No return statement!
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        // No return statement!
    }
}

/**
 * @title FeeOnTransferToken
 * @dev ERC20-like token that takes a 10% fee on transfers
 */
contract FeeOnTransferToken {
    string public name = "Fee Token";
    string public symbol = "FEE";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public feeCollector;
    uint256 public feePercent = 10; // 10%

    constructor() {
        feeCollector = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");

        uint256 fee = (amount * feePercent) / 100;
        uint256 amountAfterFee = amount - fee;

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amountAfterFee;
        balanceOf[feeCollector] += fee;

        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");

        uint256 fee = (amount * feePercent) / 100;
        uint256 amountAfterFee = amount - fee;

        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amountAfterFee;
        balanceOf[feeCollector] += fee;

        return true;
    }
}
