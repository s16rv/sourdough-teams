// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./interfaces/IAccountFactory.sol";
import "./util/SignatureVerifier.sol";
import "./account/Account.sol";

contract AccountFactory is IAccountFactory {
    // Mapping of signers to their list of created accounts
    mapping(bytes32 => mapping(bytes32 => address[])) public accounts;
    address public immutable verifier;

    /**
     * @dev Constructor that initializes the contract with the secp256k1 verifier address.
     * @param _verifierAddr The address of the secp256k1 verifier contract.
     */
    constructor(address _verifierAddr) {
        verifier = _verifierAddr;
    }

    /**
     * @dev Creates a new account contract using a signature for verification.
     *      The account is deployed using the CREATE2 opcode for address predictability.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param messageHash The hash of the message to verify the signer's identity.
     * @param r The r part of the signature.
     * @param s The s part of the signature.
     * @return accountAddress The address of the newly created account contract.
     */
    function createAccount(
        address recover,
        address entryPoint,
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 x,
        bytes32 y
    ) external returns (address) {
        bool isValidSignature = SignatureVerifier.verifySignature(
            verifier,
            messageHash,
            uint256(r),
            uint256(s),
            uint256(x),
            uint256(y)
        );
        if (!isValidSignature) revert InvalidSignature();

        uint256 salt = uint256(keccak256(abi.encodePacked(x, y, accounts[x][y].length)));
        address accountAddress = _deployAccount(recover, entryPoint, x, y, salt);

        // Store the new account for the x and y
        accounts[x][y].push(accountAddress);

        emit AccountCreated(x, y, accountAddress);
        return accountAddress;
    }

    /**
     * @dev Deploys the account contract using the CREATE2 opcode for address predictability.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param salt The salt used for deterministic contract deployment with CREATE2.
     * @return accountAddress The address of the newly deployed account contract.
     */
    function _deployAccount(
        address recover,
        address entryPoint,
        bytes32 x,
        bytes32 y,
        uint256 salt
    ) internal returns (address) {
        // Encode the creation bytecode of the Account contract
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(verifier, recover, entryPoint, x, y)
        );

        // Use CREATE2 to deploy the contract with the provided salt
        address accountAddress;
        assembly {
            accountAddress := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }

        if (accountAddress == address(0)) revert FailedDeployAccount();

        return accountAddress;
    }

    /**
     * @dev Computes the address of an account contract to be deployed using CREATE2, without actually deploying it.
     * @param recover The address with recovery rights for the account.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param salt The salt used for deterministic contract deployment with CREATE2.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address recover,
        address entryPoint,
        bytes32 x,
        bytes32 y,
        uint256 salt
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(verifier, recover, entryPoint, x, y)
        );
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), keccak256(bytecode)));
        return address(uint160(uint256(hash)));
    }

    /**
     * @dev Returns the list of accounts created by a particular signer.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @return An array of account addresses created by the signer.
     */
    function getAccounts(bytes32 x, bytes32 y) external view returns (address[] memory) {
        return accounts[x][y];
    }
}
