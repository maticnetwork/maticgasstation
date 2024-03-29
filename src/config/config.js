import { config } from "dotenv";
import path from "path";
import url from "url";
import { getMetaUrl } from "../utils/importMetadata.js";

const __filename = url.fileURLToPath(getMetaUrl());
const __dirname = path.dirname(__filename);

// reading variables from environment file, set them as you
// need in .env file in current working directory
config({ path: path.join(__dirname, "../../.env"), silent: true });

// setting environment variables
export default {
    posRPC: process.env.POS_RPC,
    amoyRPC: process.env.AMOY_RPC,
    zkevmRPC: process.env.ZKEVM_RPC,
    cardonaRPC: process.env.CARDONA_RPC,
    v2: {
        safe: parseInt(process.env.SAFE),
        standard: parseInt(process.env.STANDARD),
        fast: parseInt(process.env.FAST),
        historyBlocks: parseInt(process.env.HISTORY_BLOCKS),
    },
    NODE_ENV: process.env.NODE_ENV || 'prod-mainnet'
};
