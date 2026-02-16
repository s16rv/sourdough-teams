// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAccountFactory {
    /**
     * @dev Error thrown when a zero address is provided.
     */
    error ZeroAddress();

    /**
     * @dev Error thrown when caller is not the owner.
     */
    error OnlyOwner();

    /**
     * @dev Error thrown when the threshold is invalid.
     */
    error InvalidThreshold();

    /**
     * @dev Error thrown when the signature is invalid.
     */
    error InvalidSignature();

    /**
     * @dev Error thrown when the account deployment fails.
     */
    error FailedDeployAccount();

    /**
     * @dev Error thrown when the authorization provided for a transaction is invalid.
     */
    error InvalidAuthorization();

    /**
     * @dev Error thrown when the account already exists.
     */
    error AccountAlreadyExists();

    /**
     * @dev Error thrown when the caller is not the EntryPoint.
     */
    error NotEntryPoint();

    /**
     * @dev Event emitted when the EntryPoint address is updated.
     * @param oldEntryPoint The previous EntryPoint address.
     * @param newEntryPoint The new EntryPoint address.
     */
    event EntryPointUpdated(address oldEntryPoint, address newEntryPoint);

    /**
     * @dev Creates a new account contract using the provided parameters and deploys it using CREATE2.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param threshold The threshold of the account.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param salt A salt value to allow multiple accounts per sourceAddress.
     * @return accountAddress The address of the newly created account contract.
     */
    function createAccount(
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 threshold,
        string calldata sourceAddress,
        bytes32 salt
    ) external returns (address);

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
    ) external returns (address);

    /**
     * @dev Computes the address of an account contract to be deployed using CREATE2, without actually deploying it.
     * @param entryPoint The address of the entry point contract.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param addrHash The hash address on the source chain where the transaction originated.
     * @param threshold The threshold of the account.
     * @param salt A salt value to allow multiple accounts per sourceAddress.
     * @return The address at which the contract would be deployed.
     */
    function computeAddress(
        address entryPoint,
        bytes32[] memory x,
        bytes32[] memory y,
        bytes32 addrHash,
        uint64 threshold,
        bytes32 salt
    ) external view returns (address);

    /**
     * @dev Returns the first account created by a particular signer (backward compatibility).
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return An account address created by the signer, or address(0) if none exists.
     */
    function getAccount(string calldata sourceAddress) external view returns (address);

    /**
     * @dev Returns all accounts created by a particular signer.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @return An array of account addresses created by the signer.
     */
    function getAccounts(string calldata sourceAddress) external view returns (address[] memory);

    /**
     * @notice Sets the EntryPoint address.
     * @dev Only the owner can set the EntryPoint address.
     * @param _entryPoint The address of the EntryPoint contract.
     */
    function setEntryPoint(address _entryPoint) external;
}
