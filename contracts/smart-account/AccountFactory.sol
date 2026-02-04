// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./interfaces/IAccountFactory.sol";
import "./account/Account.sol";

contract AccountFactory is IAccountFactory {
    mapping(bytes32 => address) private account;

    constructor() {}

    /**
     * @dev Creates a new account contract using a signature for verification.
     *      The account is deployed using the CREATE2 opcode for address predictability.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param threshold The threshold of the account.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly created account contract.
     */
    function createAccount(
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 threshold,
        string calldata sourceAddress
    ) external returns (address) {
        bytes32 addrHash = keccak256(abi.encodePacked(sourceAddress));
        if (account[addrHash] != address(0)) {
            revert AccountAlreadyExists();
        }

        if (threshold == 0 || threshold > x.length) revert InvalidThreshold();

        address accAddr = _deployAccount(entryPoint, x, y, addrHash, threshold);

        // Store the new account
        storeAccount(addrHash, accAddr);

        return accAddr;
    }

    /**
     * @dev Deploys the account contract using the CREATE2 opcode for address predictability.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @return accountAddress The address of the newly deployed account contract.
     */
    function _deployAccount(
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint64 threshold
    ) internal returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(entryPoint, x, y, addrHash, threshold)
        );

        // Use CREATE2 with addrHash as salt - address depends only on addrHash
        address accountAddress;
        assembly {
            accountAddress := create2(0, add(bytecode, 0x20), mload(bytecode), addrHash)
        }

        if (accountAddress == address(0)) revert FailedDeployAccount();

        return accountAddress;
    }

    /**
     * @dev Computes the address of an account contract to be deployed using CREATE2, without actually deploying it.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @param threshold The threshold of the account.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint64 threshold
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(entryPoint, x, y, addrHash, threshold)
        );
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), addrHash, keccak256(bytecode)));
        return address(uint160(uint256(hash)));
    }

    /**
     * @dev Returns the list of accounts created by a particular signer.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return An account address created by the signer.
     */
    function getAccount(string calldata sourceAddress) external view returns (address) {
        bytes32 addrHash = keccak256(abi.encodePacked(sourceAddress));
        return account[addrHash];
    }

    /**
     * @dev Stores the account address for a given address hash.
     * @param addrHash The hash of the source address.
     * @param accAddr The address of the deployed account.
     */
    function storeAccount(bytes32 addrHash, address accAddr) internal {
        account[addrHash] = accAddr;
    }
}
