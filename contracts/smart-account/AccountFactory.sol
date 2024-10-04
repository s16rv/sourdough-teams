// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./interfaces/IAccountFactory.sol";
import "./util/SignatureVerifier.sol";
import "./account/Account.sol";

import "hardhat/console.sol";

contract AccountFactory is IAccountFactory, SignatureVerifier {
    // Mapping of signers to their list of created accounts
    mapping(address => address[]) public signerAccounts;

    uint8 private constant SIGNATURE_V = 27;

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
        bytes32 s
    ) external returns (address) {
        address signer = recoverSigner(messageHash, r, s, SIGNATURE_V);
        uint256 salt = uint256(keccak256(abi.encodePacked(signer, signerAccounts[signer].length)));
        address accountAddress = _deployAccount(recover, signer, entryPoint, salt);

        // Store the new account for the signer
        signerAccounts[signer].push(accountAddress);

        emit AccountCreated(signer, accountAddress);
        return accountAddress;
    }

    /**
     * @dev Deploys the account contract using the CREATE2 opcode for address predictability.
     * @param recover The address with recovery rights for the account.
     * @param signer The address of the signer, which will be tied to the new account.
     * @param entryPoint The address of the entry point contract.
     * @param salt The salt used for deterministic contract deployment with CREATE2.
     * @return accountAddress The address of the newly deployed account contract.
     */
    function _deployAccount(
        address recover,
        address signer,
        address entryPoint,
        uint256 salt
    ) internal returns (address) {
        // Encode the creation bytecode of the Account contract
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(recover, signer, entryPoint)
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
     * @param signer The address of the signer for the account.
     * @param entryPoint The address of the entry point contract.
     * @param salt The salt used for deterministic contract deployment with CREATE2.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address recover,
        address signer,
        address entryPoint,
        uint256 salt
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(recover, signer, entryPoint)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }

    /**
     * @dev Returns the list of accounts created by a particular signer.
     * @param signer The address of the signer whose accounts to retrieve.
     * @return An array of account addresses created by the signer.
     */
    function getAccounts(address signer) external view returns (address[] memory) {
        return signerAccounts[signer];
    }
}
