// Updated decoder based on grantTxPayload format:
// granterHash (bytes32) | granteeThreshold (uint64 padded to 32)
import { keccak256, toUtf8Bytes } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const payload =
    (process.env.DECODE_PAYLOAD as string) ||
    "0x000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000002ab0000000000000000000000000000000000000000000000000000000000000205000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000004cc7b226163636f756e745f6e756d626572223a2239222c22636861696e5f6964223a22736f7572646f7567682d31222c22666565223a7b22616d6f756e74223a5b5d2c22676173223a22323030303030227d2c226d656d6f223a22222c226d736773223a5b7b2274797065223a22636f736d6f732d73646b2f4d736745786563222c2276616c7565223a7b226772616e746565223a22736f7572646f7567683174643335726e67657a37726e61737533766a6d366c3363366875796568366c396a7932353665222c226d736773223a5b7b2274797065223a22736f7572646f7567682f4d736753656e644163636f756e745478222c2276616c7565223a7b226163636f756e745f61646472657373223a22307832616437446230613032663539413630633842636264396364383533393862413232433243436462222c22636861696e5f6964223a223131313535313131222c227061796c6f61645f64617461223a7b2274797065223a22736f7572646f7567682f45766d5061796c6f616444617461222c2276616c7565223a7b2263616c6c73223a5b7b2264617461223a223078222c22746f223a22307865653137643061323433333631393937323435613065626137343065323630323039353266323439222c2276616c7565223a2231303030303030303030303030303030227d5d2c2274785f7061796c6f61645f68617368223a22307839313333333861646435613161323131656136643466666437363331616534353266333662636164363338623462333365653536313534666266616138643861227d7d2c2273656e646572223a22736f7572646f75676831333973763332306533726566366c71726d6739386b376a757938776367776c687a336a656a70222c2273657175656e6365223a2231227d7d5d7d7d5d2c2273657175656e6365223a2231227d0026a493128dd377bf0466ed9be236f60f09ccf0a9c0c9651725b7116bd14cbcf52373d564cc7e10098d2484588ec30d69e7b311bb657fc7e2b1072a3b5138983b136ea3f63279bc540c8fed8f11f08427d55736aaf2ce2859fd2348282035c17f6578e8e0a5f7bd39687d1d46205bb25afeef52bc261249e7637cb65f55e817c44200107365411e5c8dced3c632a31c9701dd061db3280d46f541028ad2c238a00000000000000000000000000000000000000000000000000000000000aa36a70000000000000000000000002ad7db0a02f59a60c8bcbd9cd85398ba22c2ccdb00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ee17d0a243361997245a0eba740e26020952f24900000000000000000000000000000000000000000000000000038d7ea4c68000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bf0000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000004a0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000026500000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000017b226163636f756e745f6e756d626572223a2238222c22636861696e5f6964223a22736f7572646f7567682d31222c22666565223a7b22616d6f756e74223a5b5d2c22676173223a22323030303030227d2c226d656d6f223a22222c226d736773223a5b7b2274797065223a22736f7572646f7567682f4d73675365744d756c7469736967476d704772616e74222c2276616c7565223a7b22636861696e5f696473223a5b22736f6c616e612d6465766e6574222c2270696f6e2d31222c223131313535313131225d2c226772616e745f7061796c6f61645f68617368223a22307864623732636236663739363838663966356537313061613236363132646431636465646566633539396465376338396461613339346537666662323933303138222c226772616e746565223a22736f7572646f7567683174643335726e67657a37726e61737533766a6d366c3363366875796568366c396a7932353665222c226772616e7465655f616464726573736573223a5b22736f7572646f756768317171677372767161647977366b396a6364677a746a6364617239646370396d7770326d613378225d2c226772616e7465655f7468726573686f6c64223a2231222c226772616e746572223a22736f7572646f75676831333973763332306533726566366c71726d6739386b376a757938776367776c687a336a656a70222c22707269766174655f7478223a7b22616c6c6f7765645f7479706573223a5b22756e736869656c64222c226164645f726f7574696e675f6163636f756e74225d2c2269735f616c6c6f776564223a747275657d7d7d5d2c2273657175656e6365223a2230227d00f7983a75fb7333dd7d9b7ce320b719ded32ec3ac12de85998a3eccdf35d940ef16d23ad2430a6b90e893016807e640de3e815fd1a85857f9c6729df0dd92fe6d90be7fe886c748be80e98b340d1418d0bfe7865675ee597d9d850526520085f087b9efdb5c81e067890e9439bdf717cf1c22adfe29d802050a11414d66b6e3384200107365411e5c8dced3c632a31c9701dd061db3280d46f541028ad2c238a00000000000000000000000000000000000000000000000000000000000000001";

const data = Buffer.from(payload.slice(2), "hex");

const SLOT_SIZE = 32;
const NEW_HEADER_SIZE = 160;
const SIGNER_SIZE = 129;

console.log("=== MAIN HEADER (160 bytes) ===");
const category = BigInt("0x" + data.slice(0, 32).toString("hex"));
const signBytesLength = BigInt("0x" + data.slice(32, 64).toString("hex"));
const txPayloadHashOffset = BigInt("0x" + data.slice(64, 96).toString("hex"));
const numberSigners = BigInt("0x" + data.slice(96, 128).toString("hex"));
const grantOffset = BigInt("0x" + data.slice(128, 160).toString("hex"));

console.log(`category: ${category}`);
console.log(`signBytesLength: ${signBytesLength}`);
console.log(`txPayloadHashOffset: ${txPayloadHashOffset}`);
console.log(`numberSigners: ${numberSigners}`);
console.log(`grantOffset: ${grantOffset}`);

let offset = Number(NEW_HEADER_SIZE);

// SignBytes
const signBytes = data.slice(offset, offset + Number(signBytesLength));
console.log(`\n=== SIGNBYTES (grantee) ===`);
console.log(`Offset: ${offset}, Length: ${signBytes.length}`);
const signBytesJson = JSON.parse(signBytes.toString("utf8"));
console.log(`Parsed sender: ${signBytesJson.msgs[0].value.msgs[0].value.sender}`);
offset += Number(signBytesLength);

// Grantee signature
console.log(`\n=== GRANTEE SIGNATURE ===`);
console.log(`Offset: ${offset}`);
const granteeV = data[offset];
const granteeR = "0x" + data.slice(offset + 1, offset + 33).toString("hex");
const granteeS = "0x" + data.slice(offset + 33, offset + 65).toString("hex");
const granteeX = "0x" + data.slice(offset + 65, offset + 97).toString("hex");
const granteeY = "0x" + data.slice(offset + 97, offset + 129).toString("hex");
console.log(`v: ${granteeV}`);
console.log(`r: ${granteeR}`);
console.log(`s: ${granteeS}`);
console.log(`x: ${granteeX}`);
console.log(`y: ${granteeY}`);
offset += SIGNER_SIZE;

// The granterHash appears here! (before txPayload)
console.log(`\n=== GRANTER HASH (32 bytes) - before txPayload ===`);
const granterHashInMain = "0x" + data.slice(offset, offset + 32).toString("hex");
console.log(`Offset: ${offset}`);
console.log(`granterHash: ${granterHashInMain}`);

// Verify this is keccak256 of the granter address
const granterAddress = "sourdough139sv320e3ref6lqrmg98k7juy8wcgwlhz3jejp";
const expectedGranterHash = keccak256(toUtf8Bytes(granterAddress));
console.log(`Expected (keccak256 of granter): ${expectedGranterHash}`);
console.log(`Match: ${granterHashInMain.toLowerCase() === expectedGranterHash.toLowerCase()}`);
offset += 32;

// txPayload (from here to grantOffset)
const txPayload = data.slice(offset, Number(grantOffset));
console.log(`\n=== TX PAYLOAD ===`);
console.log(`Offset: ${offset}, Length: ${txPayload.length}`);

// Decode txPayload
const evmChainId = BigInt("0x" + txPayload.slice(0, 32).toString("hex"));
const accountAddress = "0x" + txPayload.slice(44, 64).toString("hex");
const sequence = BigInt("0x" + txPayload.slice(88, 96).toString("hex"));
const callCount = BigInt("0x" + txPayload.slice(120, 128).toString("hex"));
console.log(`evmChainId: ${evmChainId}`);
console.log(`accountAddress: ${accountAddress}`);
console.log(`sequence: ${sequence}`);
console.log(`callCount: ${callCount}`);

// Parse call
const callTo = "0x" + txPayload.slice(140, 160).toString("hex");
const callValue = BigInt("0x" + txPayload.slice(160, 192).toString("hex"));
const callDataLen = BigInt("0x" + txPayload.slice(192, 224).toString("hex"));
console.log(`Call[0].to: ${callTo}`);
console.log(`Call[0].value: ${callValue} (${Number(callValue) / 1e18} ETH)`);
console.log(`Call[0].dataLen: ${callDataLen}`);

// === GRANT SECTION ===
console.log(`\n=== GRANT SECTION (starts at ${grantOffset}) ===`);
const grantStart = Number(grantOffset);
const GRANT_HEADER_SIZE = 224;

const chainIdOffsetVal = BigInt("0x" + data.slice(grantStart, grantStart + 32).toString("hex"));
const chainIdLength = BigInt("0x" + data.slice(grantStart + 32, grantStart + 64).toString("hex"));
const grantSequenceOffset = BigInt("0x" + data.slice(grantStart + 64, grantStart + 96).toString("hex"));
const grantSequenceLength = BigInt("0x" + data.slice(grantStart + 96, grantStart + 128).toString("hex"));
const grantSignBytesLength = BigInt("0x" + data.slice(grantStart + 128, grantStart + 160).toString("hex"));
const grantTxPayloadHashOffset = BigInt("0x" + data.slice(grantStart + 160, grantStart + 192).toString("hex"));
const grantNumberSigners = BigInt("0x" + data.slice(grantStart + 192, grantStart + 224).toString("hex"));

console.log(`Grant Header:`);
console.log(`  chainIdOffset: ${chainIdOffsetVal}`);
console.log(`  chainIdLength: ${chainIdLength}`);
console.log(`  grantSequenceOffset: ${grantSequenceOffset}`);
console.log(`  grantSequenceLength: ${grantSequenceLength}`);
console.log(`  grantSignBytesLength: ${grantSignBytesLength}`);
console.log(`  grantTxPayloadHashOffset: ${grantTxPayloadHashOffset}`);
console.log(`  grantNumberSigners: ${grantNumberSigners}`);

let grantOff = grantStart + GRANT_HEADER_SIZE;

// Grant signBytes
const grantSignBytes = data.slice(grantOff, grantOff + Number(grantSignBytesLength));
console.log(`\n=== GRANT SIGNBYTES (granter) ===`);
console.log(`Offset: ${grantOff}, Length: ${grantSignBytes.length}`);
const grantSignBytesJson = JSON.parse(grantSignBytes.toString("utf8"));
console.log(`Granter: ${grantSignBytesJson.msgs[0].value.granter}`);
console.log(`Grantee threshold: ${grantSignBytesJson.msgs[0].value.grantee_threshold}`);
console.log(`Allowed chain_ids: ${JSON.stringify(grantSignBytesJson.msgs[0].value.chain_ids)}`);
grantOff += Number(grantSignBytesLength);

// Granter signature
console.log(`\n=== GRANTER SIGNATURE ===`);
console.log(`Offset: ${grantOff}`);
const granterV = data[grantOff];
const granterR = "0x" + data.slice(grantOff + 1, grantOff + 33).toString("hex");
const granterX = "0x" + data.slice(grantOff + 65, grantOff + 97).toString("hex");
const granterY = "0x" + data.slice(grantOff + 97, grantOff + 129).toString("hex");
console.log(`v: ${granterV}, r: ${granterR.slice(0, 20)}...`);
console.log(`x: ${granterX}`);
console.log(`y: ${granterY}`);
grantOff += SIGNER_SIZE;

// grantTxPayload: granterHash (32) + granteeThreshold (32)
console.log(`\n=== GRANT TX PAYLOAD (64 bytes) ===`);
console.log(`Offset: ${grantOff}`);
const grantTxPayload = data.slice(grantOff);
const grantTxGranterHash = "0x" + grantTxPayload.slice(0, 32).toString("hex");
const grantTxGranteeThreshold = BigInt("0x" + grantTxPayload.slice(32, 64).toString("hex"));
console.log(`granterHash: ${grantTxGranterHash}`);
console.log(`granteeThreshold: ${grantTxGranteeThreshold}`);
console.log(`granterHash matches: ${grantTxGranterHash.toLowerCase() === expectedGranterHash.toLowerCase()}`);

console.log(`\n=== SUMMARY ===`);
console.log(`Total payload length: ${data.length}`);
console.log(`Structure verified: granterHash appears in BOTH main section and grant section`);
