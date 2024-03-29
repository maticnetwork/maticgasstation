import Logger from "../helpers/logger.js";
import config from "../config/config.js";

let v1Recommendation, v2Recommendation;
let v1AmoyRecommendation, v2AmoyRecommendation;

/**
 * function to format fee history response
 *
 * @param {*} result - the fee history response
 * @param {*} includePending - boolean to include or exclude pending txns
 * @returns - Formatted result
 */

function formatFeeHistory(result, includePending) {
    const initBlockNum = Number(result.oldestBlock);
    let blockNum = initBlockNum;
    let index = 0;
    const blocks = [];

    while (blockNum < initBlockNum + result.reward.length) {
        blocks.push({
            number: blockNum,
            baseFeePerGas: Number(result.baseFeePerGas[index]),
            gasUsedRatio: Number(result.gasUsedRatio[index]),
            priorityFeePerGas: result.reward[index].map((x) => Number(x)),
        });
        blockNum += 1;
        index += 1;
    }
    if (includePending) {
        blocks.push({
            number: "pending",
            baseFeePerGas: Number(result.baseFeePerGas[config.v2.historyBlocks]),
            gasUsedRatio: NaN,
            priorityFeePerGas: [],
        });
    }
    return blocks;
}

/**
 * Functions to calculate average fee estimations
 *
 * @param {*} arr - Array of gas fee
 * @returns - Average of gas fee
 */
function avg(arr) {
    let invalidValues = 0;
    const sum = arr.reduce((a, v) => {
        if (v == 0) {
            invalidValues += 1;
        }
        return a + v;
    });
    const average = sum / (arr.length - invalidValues) / 1e9;
    return average > 30 ? average : 30;
}

/**
 * Functions to calculate average of base fee estimations
 *
 * @param {*} arr - Array of base gas fee
 * @returns - Average of base gas fee
 */
function avgBaseFee(arr) {
    const change = ((arr[5] - arr[0]) * 10) / arr.length;
    return Math.round(arr[arr.length - 1] + change) / 1e9;
}

/**
 * fetch latest prices of v2, and set recommendations - v1 and v2
 *
 * @param {*} _v1rec - v1 recommendation class
 * @param {*} _v2rec - v2 recommendation class
 * @param {*} _web3 - web3 instance
 */

const posV2FetchPrices = async (_v1rec, _v2rec, _web3, network = 'mainnet') => {
    try {
        Logger.debug({
            location: "posV2FetchPrices",
            status: "Function call",
        });

        if (network === 'amoy') {
            v1AmoyRecommendation = _v1rec;
            v2AmoyRecommendation = _v2rec;
        } else {
            v1Recommendation = _v1rec;
            v2Recommendation = _v2rec;
        }

        const latestBlock = await _web3.eth.getBlock("latest");

        let blockNumber = latestBlock.number;
        let timestamp = latestBlock.timestamp;

        if (typeof blockNumber === "bigint") {
            blockNumber = parseInt(blockNumber);
        }

        if (typeof timestamp === "bigint") {
            timestamp = parseInt(timestamp);
        }

        if (_v1rec.blockNumber < blockNumber) {
            const blockTime = _v2rec.blockTimestamp
                ? (timestamp - _v2rec.blockTimestamp) / (blockNumber - _v2rec.blockNumber)
                : timestamp;

            const response = await _web3.eth.getFeeHistory(config.v2.historyBlocks, "pending", [
                config.v2.safe,
                config.v2.standard,
                config.v2.fast,
            ]);
            //.then((response) => {
            if (response) {
                const blocks = formatFeeHistory(response, false);
                const safeLow = avg(blocks.map((b) => b.priorityFeePerGas[0]));
                const standard = avg(blocks.map((b) => b.priorityFeePerGas[1]));
                const fast = avg(blocks.map((b) => b.priorityFeePerGas[2]));
                const baseFeeEstimate = avgBaseFee(blocks.map((b) => b.baseFeePerGas));

                _v2rec.updateGasPrices(safeLow, standard, fast, baseFeeEstimate, blockNumber, blockTime, timestamp);

                const v2Result = _v2rec.servable();

                _v1rec.updateGasPrices(
                    v2Result.safeLow.maxFee,
                    v2Result.standard.maxFee,
                    v2Result.fast.maxFee,
                    blockNumber,
                    blockTime,
                    timestamp,
                );
            }
        }
    } catch (error) {
        Logger.error({
            location: "posV2FetchPrices",
            error,
        });
    }
};

export const getV1Recommendation = () => {
    return v1Recommendation?.servable();
};

export const getV2Recommendation = () => {
    return v2Recommendation?.servable();
};

export const getAmoyV1Recommendation = () => {
    return v1AmoyRecommendation?.servable();
};

export const getAmoyV2Recommendation = () => {
    return v2AmoyRecommendation?.servable();
};

export default posV2FetchPrices;
