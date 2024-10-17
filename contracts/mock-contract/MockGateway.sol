// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract MockGateway {
    bool public callValid;

    // Set the result of validateContractCall
    function setCallValid(bool _valid) public {
        callValid = _valid;
    }

    // Mock the validateContractCall method
    function validateContractCall(
        bytes32,  // commandId
        string memory,  // sourceChain
        string memory,  // sourceAddress
        bytes32  // payloadHash
    ) public view returns (bool) {
        return callValid;
    }
}
