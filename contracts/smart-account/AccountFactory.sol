// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./interfaces/IAccountFactory.sol";
import "./util/SignatureVerifier.sol";
import "./account/Account.sol";

import "hardhat/console.sol";

contract AccountFactory is IAccountFactory, SignatureVerifier {
    mapping(address => address[]) public signerAccounts;

    uint8 private constant SIGNATURE_V = 27;

    function createAccount(
        address recover, 
        address entryPoint,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s
    ) external returns (address) {
        address signer = recoverSigner(messageHash, r, s, SIGNATURE_V);
        uint256 salt = uint256(keccak256(abi.encodePacked(signer, signerAccounts[signer].length)));
        address accountAddress = _deployAccount(recover, signer, entryPoint, salt);

        signerAccounts[signer].push(accountAddress);

        emit AccountCreated(signer, accountAddress);
        return accountAddress;
    }

    function _deployAccount(address recover, address signer, address entryPoint, uint256 salt) internal returns (address) {
        // Define the bytecode of the account contract
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(recover, signer, entryPoint)
        );
        
        // Use CREATE2 to deploy the contract at a predictable address
        address accountAddress;
        assembly {
            accountAddress := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }

        if (accountAddress == address(0)) revert FailedDeployAccount();

        return accountAddress;
    }

    // Helper function to compute the address where the contract will be deployed
    function computeAddress(address recover, address signer, address entryPoint, uint256 salt) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(recover, signer, entryPoint)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }

    // Function to get the list of accounts created by a user
    function getAccounts(address signer) external view returns (address[] memory) {
        return signerAccounts[signer];
    }
}
