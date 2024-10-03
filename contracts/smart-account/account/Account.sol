// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../interfaces/IAccount.sol";
import "../util/SignatureVerifier.sol";
import "../EntryPoint.sol";

contract Account is IAccount, SignatureVerifier {
    address public recover;
    address public immutable signer;
    EntryPoint public immutable entryPoint;

    uint8 private constant SIGNATURE_V = 27;

    constructor(
        address _recoverAddr,
        address _signerAddr,
        address _entryPointAddr
    ) {
        recover = _recoverAddr;
        signer = _signerAddr;
        entryPoint = EntryPoint(_entryPointAddr);

        emit AccountInitialized(_recoverAddr, signer);
    }

    modifier onlyEntryPointOrRecover() {
        if (!(msg.sender == address(entryPoint) || msg.sender == recover)) {
            revert NotEntryPointOrRecover();
        }
        _;
    }

    function _call(address target, uint256 value, bytes memory data) internal returns (bool) {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return success;
    }

    // Allow the recover to change the account recover
    function changeRecover(address newRecover) public onlyEntryPointOrRecover {
        emit RecoverChanged(recover, newRecover);
        recover = newRecover;
    }

    // Validate operation by checking the signature
    function validateOperation(bytes32 messageHash, bytes32 r, bytes32 s) external view returns (bool) {
        return verifySignature(messageHash, r, s, SIGNATURE_V, signer);
    }

    // Allow the contract to execute arbitrary transactions
    function executeTransaction(address dest, uint256 value, bytes calldata data) external onlyEntryPointOrRecover returns (bool) {
        bool success = _call(dest, value, data);
        emit TransactionExecuted(dest, value, data);
        return success;
    }

    // Allow the contract to receive Ether
    receive() external payable {}
}
