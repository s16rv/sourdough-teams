# Routing Railgun

RoutingRailgun is a minimal routing account used to forward privacy-preserving calls (e.g., Railgun `shield`/`shieldERC20`) under a bonded routing key. It executes bundles of calls atomically when authorized by an ECDSA signature and gated by the system EntryPoint.

The contract verifies a Sourdough-compatible signature over an encoded payload, enforces replay protection via a nonce, validates `chainId` and `accountAddress`, then executes each call with optional ETH value.

**Constructor**

- `(address routingKeyAddress, address railgunAddress, address entryPoint)`
    - `routingKeyAddress`: EOA that signs routing operations.
    - `railgunAddress`: target Railgun contract this router is intended to interact with.
    - `entryPoint`: only this address can invoke `handleOps`.

**State & Access Control**

- `routingKeyAddress() → address` (immutable)
- `railgunAddress() → address` (immutable)
- `entryPoint` (immutable)
- `nonce() → uint256` replay protection counter
- `onlyEntryPoint` modifier gates mutation entrypoints

**Events**

- `FundsReceived(address indexed sender, uint256 amount)`
- `CallExecuted(address indexed target, uint256 value, bytes data)`
- `OpsHandled(uint256 indexed nonce)`

**Errors**

- `NotEntryPoint()`
- `InvalidSignature()`
- `InvalidNonce()`
- `InvalidChainId()`
- `InvalidAccountAddress()`
- `CallFailed(uint256 index)`
- `PayloadTooShort()`

**Core Function**

- `handleOps(bytes payload, bytes signature) external onlyEntryPoint`
    - Verifies signature from `routingKeyAddress` over the payload hash using the Sourdough/Cosmos-style message:
        - `message = sha256( '{"tx_hash":"0x' + hex(keccak256(payload)) + '"}' )`
    - Validates header fields and executes the multicall atomically.
    - Emits `CallExecuted` per call and `OpsHandled(nonce)` on success.

**Payload Encoding**

- Header (128 bytes): `chainId(32) | accountAddress(32) | sequence(32) | count(32)`
- Calls (repeated):
    - Call header (96 bytes): `target(32) | value(32) | dataLen(32)`
    - `data` bytes, padded to 32-byte boundary

Validation rules:

- `chainId == block.chainid`
- `accountAddress == address(this)`
- `sequence == nonce` (then increments before external calls)

**Ether Handling**

- Contract can receive ETH via `receive()` and records deposits via `FundsReceived`.
- Each executed call may forward `value` wei from the contract’s balance.

**Usage Flow**

- Off-chain:
    - Construct the payload per the layout above.
    - Compute `message = sha256('{"tx_hash":"0x' + hex(keccak256(payload)) + '"}')`.
    - Sign `message` with the bonded `routingKeyAddress` to produce 65-byte `(r,s,v)`.
- On-chain:
    - The system `EntryPoint` calls `handleOps(payload, signature)`.
    - Contract verifies, increments `nonce`, and executes all calls in order.

**Notes**

- Designed as an intermediary to the Railgun protocol; however, it can forward calls to any `target` encoded in the payload.
- All validation and execution happen atomically; any failed call reverts the whole bundle with `CallFailed(index)`.
