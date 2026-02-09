// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IEntryPoint.sol";
import "./interfaces/IAccount.sol";
import "./interfaces/IAccountFactory.sol";

// Payload parsing constants
uint64 constant SLOT_SIZE = 32; // Size of an ABI-encoded slot
uint64 constant PUBKEY_SIZE = 64; // Size of a public key (x + y)
uint64 constant SIGNER_WITH_SIG_SIZE = 129; // Size of signer block (v(1) + r(32) + s(32) + x(32) + y(32))
uint64 constant CREATE_ACCOUNT_HEADER_SIZE = 128; // Category 1: category(32) + totalSigners(32) + threshold(32) + salt(32)
uint64 constant NEW_HEADER_SIZE = 160; // Category 2: category(32) + signBytesLen(32) + hashOffset(32) + numSigners(32) + grantOffset(32)
uint64 constant GRANT_HEADER_SIZE = 224; // Grant header: chainIdOffset(32) + chainIdLen(32) + seqOffset(32) + seqLen(32) + signBytesLen(32) + hashOffset(32) + numSigners(32)

contract EntryPoint is IEntryPoint, Initializable, UUPSUpgradeable, OwnableUpgradeable {
    /// @custom:storage-location erc7201:sourdough.storage.EntryPoint
    struct EntryPointStorage {
        IAccountFactory accountFactory;
        address mpcGateway;
    }

    // keccak256(abi.encode(uint256(keccak256("sourdough.storage.EntryPoint")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION =
        keccak256(abi.encode(uint256(keccak256("sourdough.storage.EntryPoint")) - 1)) & ~bytes32(uint256(0xff));

    function _getEntryPointStorage() private pure returns (EntryPointStorage storage $) {
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
     * @notice Initializes the EntryPoint contract
     * @param _accountFactory Address of the account factory that manages account creation
     * @param _owner Address of the owner
     * @param _mpcGateway Address of the MPCGateway contract
     */
    function initialize(
        address _accountFactory,
        address _owner,
        address _mpcGateway
    ) public initializer {
        if (_accountFactory == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        EntryPointStorage storage $ = _getEntryPointStorage();
        $.accountFactory = IAccountFactory(_accountFactory);
        $.mpcGateway = _mpcGateway;
    }

    /**
     * @notice Returns the account factory address
     * @return The address of the account factory
     */
    function accountFactory() external view returns (IAccountFactory) {
        EntryPointStorage storage $ = _getEntryPointStorage();
        return $.accountFactory;
    }

    /**
     * @notice Returns the MPCGateway address
     * @return The address of the MPCGateway
     */
    function mpcGateway() external view returns (address) {
        EntryPointStorage storage $ = _getEntryPointStorage();
        return $.mpcGateway;
    }

    /**
     * @notice Sets the MPCGateway address
     * @param _mpcGateway The address of the MPCGateway contract
     * @dev Only the owner can set the MPCGateway address
     */
    function setMPCGateway(address _mpcGateway) external onlyOwner {
        EntryPointStorage storage $ = _getEntryPointStorage();
        emit MPCGatewayUpdated($.mpcGateway, _mpcGateway);
        $.mpcGateway = _mpcGateway;
    }

    /**
     * @notice Modifier to restrict access to only the MPCGateway
     */
    modifier onlyMPCGateway() {
        EntryPointStorage storage $ = _getEntryPointStorage();
        if (msg.sender != $.mpcGateway) {
            revert NotMPCGateway();
        }
        _;
    }

    /**
     * @notice Executes a payload on the destination chain.
     * @dev This function is called by the MPCGateway on the destination chain to execute a payload.
     * It verifies the caller is the MPCGateway and then calls the internal `_execute` function.
     * @param _sourceChain The blockchain where the transaction originated.
     * @param _sourceAddress The address on the source chain where the transaction originated.
     * @param _payload The encoded GMP (General Message Passing) message sent from the source chain.
     */
    function executePayload(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) external onlyMPCGateway returns (bool) {
        _execute(_sourceChain, _sourceAddress, _payload);
        return true;
    }

    /**
     * @notice Logic to be executed on the destination chain.
     * @dev This function is triggered automatically by the relayer when a cross-chain message is received.
     * It decodes the payload to identify which function to execute based on the `category`.
     * @param _sourceChain The blockchain where the transaction originated.
     * @param _sourceAddress The address on the source chain where the transaction originated.
     * @param _payload The encoded GMP (General Message Passing) message sent from the source chain.
     */
    function _execute(
        string calldata _sourceChain,
        string calldata _sourceAddress,
        bytes calldata _payload
    ) internal {
        uint8 category = abi.decode(_payload[:SLOT_SIZE], (uint8));

        if (category == 1) {
            (uint64 totalSigners, uint64 threshold, bytes32 salt) = abi.decode(
                _payload[SLOT_SIZE:CREATE_ACCOUNT_HEADER_SIZE],
                (uint64, uint64, bytes32)
            );

            uint64 offset = CREATE_ACCOUNT_HEADER_SIZE;

            // Dynamic arrays for x, y based on the total signers
            bytes32[] memory x = new bytes32[](totalSigners);
            bytes32[] memory y = new bytes32[](totalSigners);

            // Loop through the total signers to extract their public keys
            for (uint64 i = 0; i < totalSigners; i++) {
                uint64 index = offset + i * PUBKEY_SIZE;

                // Decode x, y for the current signer
                (x[i], y[i]) = abi.decode(_payload[index:index + PUBKEY_SIZE], (bytes32, bytes32));
            }

            _createAccount(x, y, threshold, _sourceAddress, salt);
        } else if (category == 2) {
            // Parse payload to extract components for forwarding to Account
            // Header: category(32) + signBytesLen(32) + hashOffset(32) + numSigners(32) + grantOffset(32)
            (uint256 signBytesLength, uint256 txPayloadHashOffset, uint64 numberSigners, uint256 grantOffset) = abi
                .decode(_payload[SLOT_SIZE:NEW_HEADER_SIZE], (uint256, uint256, uint64, uint256));

            uint256 offset = NEW_HEADER_SIZE;

            // Extract signBytes
            bytes calldata signBytes = _payload[offset:offset + signBytesLength];
            offset += signBytesLength;

            // Extract signatures and public keys into struct (grantee signatures)
            IAccount.SignatureData memory sigs;
            sigs.v = new uint8[](numberSigners);
            sigs.r = new bytes32[](numberSigners);
            sigs.s = new bytes32[](numberSigners);
            sigs.x = new bytes32[](numberSigners);
            sigs.y = new bytes32[](numberSigners);

            for (uint64 i = 0; i < numberSigners; i++) {
                uint256 index = offset + i * SIGNER_WITH_SIG_SIZE;
                sigs.v[i] = uint8(_payload[index]);
                sigs.r[i] = bytes32(_payload[index + 1:index + 33]);
                sigs.s[i] = bytes32(_payload[index + 33:index + 65]);
                sigs.x[i] = bytes32(_payload[index + 65:index + 97]);
                sigs.y[i] = bytes32(_payload[index + 97:index + 129]);
            }

            offset += numberSigners * SIGNER_WITH_SIG_SIZE;

            // Extract txPayload - ends at grantOffset if grant exists, otherwise to end of payload
            bytes calldata txPayload;
            if (grantOffset > 0) {
                txPayload = _payload[offset:grantOffset];
            } else {
                txPayload = _payload[offset:];
            }

            // Extract target account from txPayload (address is at offset 32, after evmChainId)
            if (txPayload.length < 64) revert PayloadTooShort();
            address target = abi.decode(txPayload[32:64], (address));

            if (grantOffset > 0) {
                // Grant flow: call validateAndExecuteGrant which handles everything
                _executeWithGrant(_payload, grantOffset, target, signBytes, txPayloadHashOffset, sigs, txPayload);
            } else {
                // Normal flow: call validateAndExecute
                try
                    IAccount(payable(target)).validateAndExecute(signBytes, txPayloadHashOffset, sigs, txPayload)
                returns (bool success) {
                    if (!success) {
                        revert TransactionFailed();
                    }
                    emit TransactionHandled(target, 0);
                } catch Error(string memory reason) {
                    revert TransactionError(reason);
                } catch {
                    revert TransactionFailed();
                }
            }
        }

        emit Executed(_sourceChain, _sourceAddress);
    }

    /**
     * @dev Executes a transaction with grant authorization.
     * Parses grant payload and calls Account.validateAndExecuteGrant with all required data.
     * @param _payload The full payload containing grant data.
     * @param grantOffset The offset where grant data starts in the payload.
     * @param target The target account address.
     * @param signBytes The AMINO_JSON message signed by grantees.
     * @param txPayloadHashOffset The offset to hash in signBytes.
     * @param granteeSigs Signature data from grantees.
     * @param txPayload The transaction payload.
     */
    function _executeWithGrant(
        bytes calldata _payload,
        uint256 grantOffset,
        address target,
        bytes calldata signBytes,
        uint256 txPayloadHashOffset,
        IAccount.SignatureData memory granteeSigs,
        bytes calldata txPayload
    ) internal {
        // Grant Header: chainIdOffset(32) + chainIdLen(32) + seqOffset(32) + seqLen(32) + signBytesLen(32) + hashOffset(32) + numSigners(32)
        (
            uint256 chainIdOffset,
            uint256 chainIdLength,
            uint256 grantSequenceOffset,
            uint256 grantSequenceLength,
            uint256 grantSignBytesLength,
            uint256 grantTxPayloadHashOffset,
            uint64 grantNumberSigners
        ) = abi.decode(
                _payload[grantOffset:grantOffset + GRANT_HEADER_SIZE],
                (uint256, uint256, uint256, uint256, uint256, uint256, uint64)
            );

        uint256 offset = grantOffset + GRANT_HEADER_SIZE;

        // Extract grantSignBytes
        bytes calldata grantSignBytes = _payload[offset:offset + grantSignBytesLength];
        offset += grantSignBytesLength;

        // Extract granter signatures and public keys into struct
        IAccount.SignatureData memory granterSigs;
        granterSigs.v = new uint8[](grantNumberSigners);
        granterSigs.r = new bytes32[](grantNumberSigners);
        granterSigs.s = new bytes32[](grantNumberSigners);
        granterSigs.x = new bytes32[](grantNumberSigners);
        granterSigs.y = new bytes32[](grantNumberSigners);

        for (uint64 i = 0; i < grantNumberSigners; i++) {
            uint256 index = offset + i * SIGNER_WITH_SIG_SIZE;
            granterSigs.v[i] = uint8(_payload[index]);
            granterSigs.r[i] = bytes32(_payload[index + 1:index + 33]);
            granterSigs.s[i] = bytes32(_payload[index + 33:index + 65]);
            granterSigs.x[i] = bytes32(_payload[index + 65:index + 97]);
            granterSigs.y[i] = bytes32(_payload[index + 97:index + 129]);
        }

        offset += grantNumberSigners * SIGNER_WITH_SIG_SIZE;

        // Remaining is grantTxPayload
        bytes calldata grantTxPayload = _payload[offset:];

        // Build GrantData struct
        IAccount.GrantData memory grantData;
        grantData.chainIdOffset = chainIdOffset;
        grantData.chainIdLength = chainIdLength;
        grantData.grantSequenceOffset = grantSequenceOffset;
        grantData.grantSequenceLength = grantSequenceLength;
        grantData.grantTxPayloadHashOffset = grantTxPayloadHashOffset;

        // Call validateAndExecuteGrant on the Account
        // This handles: validate txPayload header, validate grant, validate granter sigs, validate grantee sigs, increment, execute
        try
            IAccount(payable(target)).validateAndExecuteGrant(
                signBytes,
                txPayloadHashOffset,
                granteeSigs,
                txPayload,
                grantSignBytes,
                grantData,
                granterSigs,
                grantTxPayload
            )
        returns (bool success) {
            if (!success) {
                revert TransactionFailed();
            }
            emit TransactionHandled(target, 0);
        } catch Error(string memory reason) {
            revert TransactionError(reason);
        } catch {
            revert TransactionFailed();
        }
    }

    /**
     * @dev Creates a new account by calling the `createAccount` function in the account factory.
     * @param x The x part of the public key.
     * @param y The y part of the public key.
     * @param threshold The threshold of the account.
     * @param sourceAddress The address on the source chain where the transaction originated.
     * @param salt A salt value to allow multiple accounts per sourceAddress.
     * @return accountAddress The address of the newly created account.
     */
    function _createAccount(
        bytes32[] memory x,
        bytes32[] memory y,
        uint64 threshold,
        string calldata sourceAddress,
        bytes32 salt
    ) internal returns (address) {
        EntryPointStorage storage $ = _getEntryPointStorage();
        address accountAddress = $.accountFactory.createAccount(
            address(this),
            x,
            y,
            threshold,
            sourceAddress,
            salt
        );

        emit AccountCreated(accountAddress);
        return accountAddress;
    }

    /**
     * @dev Authorizes an upgrade to a new implementation
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
