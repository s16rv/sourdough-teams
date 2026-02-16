// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IAccountFactory.sol";
import "./account/Account.sol";
import "../routing-railgun/RoutingRailgun.sol";

contract AccountFactory is IAccountFactory, Initializable, UUPSUpgradeable, OwnableUpgradeable {
    /// @custom:storage-location erc7201:sourdough.storage.AccountFactory
    struct AccountFactoryStorage {
        address entryPoint;
        mapping(bytes32 => address[]) accountsBySource;
    }

    // keccak256(abi.encode(uint256(keccak256("sourdough.storage.AccountFactory")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION =
        keccak256(abi.encode(uint256(keccak256("sourdough.storage.AccountFactory")) - 1)) & ~bytes32(uint256(0xff));

    function _getAccountFactoryStorage() private pure returns (AccountFactoryStorage storage $) {
        bytes32 slot = STORAGE_LOCATION;
        assembly {
            $.slot := slot
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the AccountFactory contract
     * @param _entryPoint Address of the EntryPoint contract
     * @param _owner Address of the contract owner
     */
    function initialize(address _entryPoint, address _owner) public initializer {
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        AccountFactoryStorage storage $ = _getAccountFactoryStorage();
        $.entryPoint = _entryPoint;
    }

    /**
     * @notice Returns the EntryPoint address
     * @return The address of the EntryPoint
     */
    function entryPoint() external view returns (address) {
        AccountFactoryStorage storage $ = _getAccountFactoryStorage();
        return $.entryPoint;
    }

    /**
     * @notice Sets the EntryPoint address
     * @param _entryPoint The address of the EntryPoint contract
     * @dev Only the owner can set the EntryPoint address
     */
    function setEntryPoint(address _entryPoint) external onlyOwner {
        AccountFactoryStorage storage $ = _getAccountFactoryStorage();
        emit EntryPointUpdated($.entryPoint, _entryPoint);
        $.entryPoint = _entryPoint;
    }

    /**
     * @notice Modifier to restrict access to only the EntryPoint
     */
    modifier onlyEntryPoint() {
        AccountFactoryStorage storage $ = _getAccountFactoryStorage();
        if (msg.sender != $.entryPoint) {
            revert NotEntryPoint();
        }
        _;
    }

    /**
     * @dev Creates a new account contract using a signature for verification.
     *      The account is deployed using the CREATE2 opcode for address predictability.
     * @param entryPointAddr The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param threshold The threshold of the account.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param salt A salt value to allow multiple accounts per sourceAddress.
     * @return accountAddress The address of the newly created account contract.
     */
    function createAccount(
        address entryPointAddr,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 threshold,
        string calldata sourceAddress,
        bytes32 salt
    ) external onlyEntryPoint returns (address) {
        bytes32 addrHash = keccak256(abi.encodePacked(sourceAddress));
        bytes32 create2Salt = keccak256(abi.encodePacked(addrHash, salt));

        if (threshold == 0 || threshold > x.length) revert InvalidThreshold();

        address accAddr = _deployAccount(entryPointAddr, x, y, addrHash, threshold, create2Salt);

        // Store the new account
        storeAccount(addrHash, accAddr);

        return accAddr;
    }

    /**
     * @dev Deploys the account contract using the CREATE2 opcode for address predictability.
     * @param entryPointAddr The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @param threshold The threshold of the account.
     * @param create2Salt The salt for CREATE2 deployment (combined addrHash + salt).
     * @return accountAddress The address of the newly deployed account contract.
     */
    function _deployAccount(
        address entryPointAddr,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint64 threshold,
        bytes32 create2Salt
    ) internal returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(entryPointAddr, x, y, addrHash, threshold)
        );

        // Compute the expected address before deployment
        bytes32 bytecodeHash = keccak256(bytecode);
        address expectedAddress = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), create2Salt, bytecodeHash))))
        );

        // Check if account already exists at this address
        if (expectedAddress.code.length > 0) revert AccountAlreadyExists();

        // Use CREATE2 with combined salt - address depends on addrHash + salt
        address accountAddress;
        assembly {
            accountAddress := create2(0, add(bytecode, 0x20), mload(bytecode), create2Salt)
        }

        if (accountAddress == address(0)) revert FailedDeployAccount();

        return accountAddress;
    }

    /**
     * @dev Creates a new RoutingRailgun account using CREATE2 for deterministic addresses.
     * @param routingKeyAddress The EOA address bonded to this routing account.
     * @param railgunAddress The address of the Railgun contract.
     * @param salt A salt value for CREATE2 deployment.
     * @return routingAccountAddress The address of the newly created RoutingRailgun contract.
     */
    function createRoutingRailgunAccount(
        address routingKeyAddress,
        address railgunAddress,
        bytes32 salt
    ) external onlyEntryPoint returns (address) {
        bytes32 create2Salt = keccak256(abi.encodePacked(routingKeyAddress, salt));

        address routingAddr = _deployRoutingRailgun(routingKeyAddress, railgunAddress, create2Salt);

        return routingAddr;
    }

    /**
     * @dev Deploys a RoutingRailgun contract using CREATE2.
     * @param routingKeyAddress The EOA address bonded to this routing account.
     * @param railgunAddress The address of the Railgun contract.
     * @param create2Salt The salt for CREATE2 deployment.
     * @return routingAccountAddress The address of the newly deployed RoutingRailgun contract.
     */
    function _deployRoutingRailgun(
        address routingKeyAddress,
        address railgunAddress,
        bytes32 create2Salt
    ) internal returns (address) {
        AccountFactoryStorage storage $ = _getAccountFactoryStorage();

        bytes memory bytecode = abi.encodePacked(
            type(RoutingRailgun).creationCode,
            abi.encode(routingKeyAddress, railgunAddress, $.entryPoint)
        );

        // Compute the expected address before deployment
        bytes32 bytecodeHash = keccak256(bytecode);
        address expectedAddress = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), create2Salt, bytecodeHash))))
        );

        // Check if account already exists at this address
        if (expectedAddress.code.length > 0) revert AccountAlreadyExists();

        address routingAddress;
        assembly {
            routingAddress := create2(0, add(bytecode, 0x20), mload(bytecode), create2Salt)
        }

        if (routingAddress == address(0)) revert FailedDeployAccount();

        return routingAddress;
    }

    /**
     * @dev Computes the address of an account contract to be deployed using CREATE2, without actually deploying it.
     * @param entryPointAddr The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @param threshold The threshold of the account.
     * @param salt A salt value to allow multiple accounts per sourceAddress.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address entryPointAddr,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint64 threshold,
        bytes32 salt
    ) external view returns (address) {
        bytes32 create2Salt = keccak256(abi.encodePacked(addrHash, salt));
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(entryPointAddr, x, y, addrHash, threshold)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), create2Salt, keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }

    /**
     * @dev Returns the first account created by a particular signer (backward compatibility).
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return An account address created by the signer, or address(0) if none exists.
     */
    function getAccount(string calldata sourceAddress) external view returns (address) {
        AccountFactoryStorage storage $ = _getAccountFactoryStorage();
        bytes32 addrHash = keccak256(abi.encodePacked(sourceAddress));
        address[] storage accounts = $.accountsBySource[addrHash];
        if (accounts.length == 0) {
            return address(0);
        }
        return accounts[0];
    }

    /**
     * @dev Returns all accounts created by a particular signer.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return An array of account addresses created by the signer.
     */
    function getAccounts(string calldata sourceAddress) external view returns (address[] memory) {
        AccountFactoryStorage storage $ = _getAccountFactoryStorage();
        bytes32 addrHash = keccak256(abi.encodePacked(sourceAddress));
        return $.accountsBySource[addrHash];
    }

    /**
     * @dev Stores the account address for a given address hash.
     * @param addrHash The hash of the source address.
     * @param accAddr The address of the deployed account.
     */
    function storeAccount(bytes32 addrHash, address accAddr) internal {
        AccountFactoryStorage storage $ = _getAccountFactoryStorage();
        $.accountsBySource[addrHash].push(accAddr);
    }

    /**
     * @dev Authorizes an upgrade to a new implementation
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
