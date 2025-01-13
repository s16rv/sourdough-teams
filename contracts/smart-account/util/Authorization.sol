// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

library Authorization {
    enum Status {
        Nil,
        Active,
        Revoked
    }

    enum DataType {
        Nil,
        Balance,
        Address
    }

    enum Operator {
        Nil,
        Equal,
        LTE,
        Sum,
        DailySum
    }

    function isOperationMutable(uint256 operator) internal pure returns (bool) {
        Operator o = Operator(operator);
        if (o == Operator.DailySum) {
            return true;
        } else if (o == Operator.Sum) {
            return true;
        }

        return false;
    }

    function extractBaseValueMutable(uint8 dataType, uint8 operator) internal view returns (bytes memory value) {
        if (DataType(dataType) == DataType.Balance) {
            if (Operator(operator) == Operator.Sum) {
                return abi.encodePacked(uint(0));
            } else if (Operator(operator) == Operator.DailySum) {
                return abi.encodePacked(uint(0), block.timestamp);
            }
        }
    }
}
