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
                return abi.encode(uint(0));
            } else if (Operator(operator) == Operator.DailySum) {
                return abi.encode(uint(0), block.timestamp);
            }
        }
    }

    function isAuthorizationValid(
        uint8 dataType,
        uint8 operator,
        bytes memory paramValue,
        bytes memory payloadValue,
        bytes memory mutableAuthValue
    ) internal view returns (bool isValid, bool needUpdate, bytes memory updatedMutableAuthValue) {
        Operator o = Operator(operator);
        DataType d = DataType(dataType);

        if (o == Operator.DailySum) {
            if (d == DataType.Balance) {
                // Extract balance as uint256 from paramValue and payloadValue
                uint256 paramBalance = abi.decode(paramValue, (uint256));
                uint256 payloadBalance = abi.decode(payloadValue, (uint256));
                (uint256 mutableBalance, uint256 mutableTimestamp) = abi.decode(mutableAuthValue, (uint256, uint256));

                uint256 blockDay = block.timestamp / 86400;
                uint256 mutableDay = mutableTimestamp / 86400;

                // reset balance if different day
                if (blockDay != mutableDay) {
                    mutableBalance = uint256(0);
                }

                if (payloadBalance + mutableBalance <= paramBalance) {
                    return (true, true, abi.encode((payloadBalance + mutableBalance), block.timestamp));
                }
            }
        } else if (o == Operator.Sum) {
            if (d == DataType.Balance) {
                // Extract balance as uint256
                uint256 paramBalance = abi.decode(paramValue, (uint256));
                uint256 payloadBalance = abi.decode(payloadValue, (uint256));
                uint256 mutableBalance = abi.decode(mutableAuthValue, (uint256));

                if (payloadBalance + mutableBalance <= paramBalance) {
                    return (true, true, abi.encode((payloadBalance + mutableBalance)));
                }
            }
        } else if (o == Operator.Equal) {
            if (d == DataType.Balance) {
                // Extract balance as uint256
                uint256 paramBalance = abi.decode(paramValue, (uint256));
                uint256 payloadBalance = abi.decode(payloadValue, (uint256));
                if (paramBalance == payloadBalance) {
                    return (true, false, "");
                }
            } else if (d == DataType.Address) {
                // Extract address from paramValue and payloadValue
                address paramAddress = abi.decode(paramValue, (address));
                address payloadAddress = abi.decode(payloadValue, (address));
                if (paramAddress == payloadAddress) {
                    return (true, false, "");
                }
            }
        } else if (o == Operator.LTE) {
            if (d == DataType.Balance) {
                // Extract balance as uint256
                uint256 paramBalance = abi.decode(paramValue, (uint256));
                uint256 payloadBalance = abi.decode(payloadValue, (uint256));
                if (payloadBalance <= paramBalance) {
                    return (true, false, "");
                }
            }
        }

        return (false, false, "");
    }

    function sliceBytesFromStorage(bytes storage source, uint start, uint end) internal view returns (bytes memory) {
        if (start >= end || end > source.length) {
            return new bytes(0); // Return an empty bytes array if the indices are invalid
        }

        bytes memory result = new bytes(end - start);

        for (uint i = 0; i < result.length; i++) {
            result[i] = source[start + i];
        }

        return result;
    }

    function bytesToHex(bytes memory _bytes) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory hexString = new bytes(2 + _bytes.length * 2);
        hexString[0] = "0";
        hexString[1] = "x";
        for (uint i = 0; i < _bytes.length; i++) {
            hexString[2 + i * 2] = hexChars[uint(uint8(_bytes[i] >> 4))];
            hexString[3 + i * 2] = hexChars[uint(uint8(_bytes[i] & 0x0f))];
        }
        return string(hexString);
    }
}
