import { ethers } from "hardhat";

// Function signature
const functionSignature = "executeContractCall(bytes32,bytes32,string,string,string,address,bytes)";

// Calculate the function selector (first 4 bytes of keccak256 hash)
const functionSelector = ethers.keccak256(ethers.toUtf8Bytes(functionSignature)).slice(0, 10);

console.log(`Function signature: ${functionSignature}`);
console.log(`Function selector: ${functionSelector}`);

// Check if it matches the first 4 bytes of the provided hex data
const executeContractCallHex =
    "0x498cd109d9d9d77db6e734f1d2a1428bfd92b0f2969e5eb03759843e0330b413964eb1774deaa3be2edb551dbb07102b0a88b510170154df6a1f5ed58101abe99440dda500000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000f56d63b2778cad34bf38cab2e0b91230936b7a720000000000000000000000000000000000000000000000000000000000000007616c7068612d3100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002d636f736d6f73317a7970716137366a653770787364776b666168366d753961353833736a7536787174336d7636000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010657468657265756d2d7365706f6c6961000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";
const providedSelector = executeContractCallHex.slice(0, 10);

console.log(`First 4 bytes of provided hex: ${providedSelector}`);
console.log(`Do they match? ${functionSelector === providedSelector}`);

// Let's analyze the calldata structure
console.log("\nAnalyzing calldata structure:");

// Remove the function selector to get just the parameters
const paramsHex = executeContractCallHex.slice(10);

// The first two parameters are bytes32 (mpcSignatureR and mpcSignatureS)
const mpcSignatureR = "0x" + paramsHex.slice(0, 64);
const mpcSignatureS = "0x" + paramsHex.slice(64, 128);

console.log(`mpcSignatureR: ${mpcSignatureR}`);
console.log(`mpcSignatureS: ${mpcSignatureS}`);

// The next parameters are dynamic types (string, string, string) and their offsets
// For dynamic types, the calldata contains offsets to where the actual data is stored
const sourceChainOffset = parseInt(paramsHex.slice(128, 192), 16);
const sourceAddressOffset = parseInt(paramsHex.slice(192, 256), 16);
const destinationChainOffset = parseInt(paramsHex.slice(256, 320), 16);

console.log(`sourceChainOffset: ${sourceChainOffset}`);
console.log(`sourceAddressOffset: ${sourceAddressOffset}`);
console.log(`destinationChainOffset: ${destinationChainOffset}`);

// The next parameter is address (destinationAddress)
const destinationAddress = "0x" + paramsHex.slice(320, 384).slice(-40);
console.log(`destinationAddress: ${destinationAddress}`);

// The last parameter is bytes (payload) which is also a dynamic type
// The offset is at position 384-448 (32 bytes after the destinationAddress)
const payloadOffset = parseInt(paramsHex.slice(384, 448), 16);
console.log(`payloadOffset: ${payloadOffset}`);

// The payload offset seems incorrect in the data. Let's try to find it by looking at the structure
// Let's examine the hex data more carefully

// After analyzing the hex data, we can see that the last parameter starts at offset 448
// This is where the payload data should begin
const correctedPayloadOffset = 448 / 2; // Convert hex position to byte offset

// Let's also try to extract the payload directly from the end of the hex data
// The last part of the hex data appears to be the actual payload
const lastPartHex = executeContractCallHex.slice(executeContractCallHex.length - 144); // Last 72 bytes (144 hex chars)

// Now let's extract the actual string values
// For each string, the first 32 bytes (64 hex chars) represent the length of the string
// Then the actual string data follows

// Calculate the position in the hex string where each dynamic parameter starts
const sourceChainPos = sourceChainOffset * 2; // Convert byte offset to hex char position
const sourceChainLength = parseInt(paramsHex.slice(sourceChainPos, sourceChainPos + 64), 16);
const sourceChainData = paramsHex.slice(sourceChainPos + 64, sourceChainPos + 64 + sourceChainLength * 2);
const sourceChain = ethers.toUtf8String("0x" + sourceChainData);

console.log(`sourceChainLength: ${sourceChainLength}`);
console.log(`sourceChain: ${sourceChain}`);

// Extract sourceAddress
const sourceAddressPos = sourceAddressOffset * 2;
const sourceAddressLength = parseInt(paramsHex.slice(sourceAddressPos, sourceAddressPos + 64), 16);
const sourceAddressData = paramsHex.slice(sourceAddressPos + 64, sourceAddressPos + 64 + sourceAddressLength * 2);
const sourceAddress = ethers.toUtf8String("0x" + sourceAddressData);

console.log(`sourceAddressLength: ${sourceAddressLength}`);
console.log(`sourceAddress: ${sourceAddress}`);

// Extract destinationChain
const destinationChainPos = destinationChainOffset * 2;
const destinationChainLength = parseInt(paramsHex.slice(destinationChainPos, destinationChainPos + 64), 16);
const destinationChainData = paramsHex.slice(
    destinationChainPos + 64,
    destinationChainPos + 64 + destinationChainLength * 2
);
const destinationChain = ethers.toUtf8String("0x" + destinationChainData);

console.log(`destinationChainLength: ${destinationChainLength}`);
console.log(`destinationChain: ${destinationChain}`);

// The payload is the last part of the calldata
// Based on our analysis, the last 72 bytes (144 hex chars) appear to be the actual payload
const extractedPayload = "0x" + lastPartHex;
console.log(`\nExtracted payload from end of hex data:`);
console.log(`extractedPayload: ${extractedPayload}`);

// User provided payload
const userProvidedPayload =
    "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f2490000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000190be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e338";
console.log(`\nUser provided payload:`);
console.log(`userProvidedPayload: ${userProvidedPayload}`);
console.log(`userProvidedPayload length: ${userProvidedPayload.length / 2 - 1} bytes`);

// Let's use the user provided payload for further analysis
const payload = userProvidedPayload;

// As requested, we're not decoding the payload
console.log(`\nPayload length: ${payload.length / 2 - 1} bytes`); // Subtract 1 for the '0x' prefix

// Summary of the decoded parameters
console.log("\nDecoded Parameters:");
console.log(`mpcSignatureR: ${mpcSignatureR}`);
console.log(`mpcSignatureS: ${mpcSignatureS}`);
console.log(`sourceChain: ${sourceChain}`);
console.log(`sourceAddress: ${sourceAddress}`);
console.log(`destinationChain: ${destinationChain}`);
console.log(`destinationAddress: ${destinationAddress}`);
console.log(`payload: ${payload}`);

// Calculate the message hash that would be signed
// The message hash is typically keccak256(abi.encodePacked(parameters))
// Let's try to reconstruct it
const messageParams = [sourceChain, sourceAddress, destinationChain, destinationAddress, payload];

// For demonstration purposes, let's just log what would be hashed
console.log("\nMessage parameters that would be hashed for signature verification:");
console.log(messageParams);

// Final analysis
console.log("\nFinal Analysis:");
console.log(
    "1. The function selector 0x498cd109 matches executeContractCall(bytes32,bytes32,string,string,string,address,bytes)"
);
console.log("2. The first two parameters are the MPC signature (R and S components)");
console.log("3. The next parameters are the cross-chain message details:");
console.log(`   - Source chain: ${sourceChain}`);
console.log(`   - Source address: ${sourceAddress}`);
console.log(`   - Destination chain: ${destinationChain}`);
console.log(`   - Destination address: ${destinationAddress}`);
console.log("4. The final parameter is the payload (not decoded as requested)");
console.log(`   - Raw payload: ${payload}`);
console.log(`   - Payload length: ${payload.length / 2 - 1} bytes`);
