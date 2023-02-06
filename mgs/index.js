const { config } = require("dotenv");
const path = require("path");
const Web3 = require("web3");
const axios = require("axios");
const humanizeDuration = require("humanize-duration");
const V1Recommendation = require("./v1recommendation");
const V2Recommendation = require("./v2recommendation");
const Transaction = require("./transaction");
const Transactions = require("./transactions");
const { runServer } = require("./serve");

// reading variables from environment file, set them as you
// need in .env file in current working directory
config({ path: path.join(__dirname, ".env"), silent: true });

// setting environment variables
const SAFELOW = process.env.SAFELOW || 30;
const STANDARD = process.env.STANDARD || 60;
const FAST = process.env.FAST || 90;
const FASTEST = process.env.FASTEST || 100;
const MUMBAI_RPC = process.env.MUMBAI_RPC;
const ZKEVM_RPC = process.env.ZKEVM_RPC;
const BUFFERSIZE = process.env.BUFFERSIZE || 500;
const v2SAFE = parseFloat(process.env.v2SAFE);
const v2STANDARD = parseFloat(process.env.v2STANDARD);
const v2FAST = parseFloat(process.env.v2FAST);
const HISTORY_BLOCKS = parseFloat(process.env.HISTORY_BLOCKS);

const checkRPC = (_) => {
  if (
    process.env.MUMBAI_RPC == undefined ||
    process.env.MUMBAI_RPC == "" ||
    process.env.ZKEVM_RPC == undefined ||
    process.env.ZKEVM_RPC == ""
  ) {
    console.error("RPC field not found in ENV");
    process.exit(1);
  }
};

checkRPC();

// obtaining connection to websocket RPC endpoint
const getWeb3 = (rpc) =>
  new Web3(
    rpc.startsWith("http")
      ? new Web3.providers.HttpProvider(rpc)
      : new Web3.providers.WebsocketProvider(rpc)
  );

// fetch latest block & block previous to latest one,
// for computing blocktime i.e. block mining delay
const getBlockTime = async (_web3) => {
  const latestBlock = await _web3.eth.getBlock("latest");
  const prevBlock = await _web3.eth.getBlock(latestBlock.number - 1);
  return latestBlock.timestamp - prevBlock.timestamp;
};

// putting block time in object, which is keeping track of
// all data that's to be published, from gas station
const updateBlockTime = (_web3, _v1rec, _v2rec) => {
  getBlockTime(_web3).then((v) => {
    _v1rec.blockTime = v;
    _v2rec.blockTime = v;
  });
};

// given hash of transaction i.e. unique identifier, it will
// fetch that transaction and put it inside transaction pool,
// for further processing purposes
const processTransaction = async (
  _web3,
  _hash,
  _blockNumber,
  idx,
  _transactions
) => {
  const start = new Date().getTime();
  const _transaction = await _web3.eth.getTransaction(_hash);

  if (_transaction !== null) {
    const gasPrice = parseInt(_transaction.gasPrice, 10) / 1e9;
    console.log(gasPrice);
    _transactions.add(
      new Transaction(_transaction.blockNumber, gasPrice > 0 ? gasPrice : 1)
    );

    console.log(
      `➕ Processed tx ${idx} of block : ${_blockNumber} in ${humanizeDuration(
        new Date().getTime() - start
      )}`
    );
  }
};

// given a non-empty ( having atleast 1 transaction ) block object, it'll
// go through each of them & put them inside transaction pool
const processBlock = async (_web3, _transactions, _block) => {
  console.log(`🔅 Processing Block : ${_block.number}`);

  const start = new Date().getTime();
  const promises = [];

  for (let i = 0; i < _block.transactions.length; i++) {
    promises.push(
      processTransaction(
        _web3,
        _block.transactions[i],
        _block.number,
        i,
        _transactions
      )
    );
  }

  await Promise.all(promises);

  console.log(
    `✅ Block : ${_block.number} in ${humanizeDuration(
      new Date().getTime() - start
    )}`
  );
};

// fetch latest block mined, if it's not already processed & non-empty
// then we'll process each transaction in it, put them in transaction pool,
// after that it'll be computing gas price recommendation depending upon past data
// and env variable values
const fetchBlockAndProcess = async (_web3, _transactions, _rec) => {
  const latestBlock = await _web3.eth.getBlock("latest");

  if (!(_transactions.latestBlockNumber < latestBlock.number)) {
    return;
  }

  if (latestBlock.transactions.length == 0) {
    _rec.blockNumber = latestBlock.number;

    console.log(`❗️ Empty Block : ${latestBlock.number}`);
    return;
  }

  await processBlock(_web3, _transactions, latestBlock);
  const cumsumGasPrices = _transactions.cumulativePercentageOfGasPrices();

  _rec.updateGasPrices(
    _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, SAFELOW),
    _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, STANDARD),
    _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, FAST),
    _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, FASTEST)
  );
  _rec.blockNumber = _transactions.latestBlockNumber;
};

// function to format fee history response
function formatFeeHistory(result, includePending) {
  let initBlockNum = Number(result.oldestBlock);
  let blockNum = initBlockNum;
  let index = 0;
  const blocks = [];
  while (blockNum < initBlockNum + HISTORY_BLOCKS) {
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
      baseFeePerGas: Number(result.baseFeePerGas[HISTORY_BLOCKS]),
      gasUsedRatio: NaN,
      priorityFeePerGas: [],
    });
  }
  return blocks;
}

// Functions to calculate average fee estimations
function avg(arr) {
  const sum = arr.reduce((a, v) => a + v);
  return sum / arr.length;
}

function avgBaseFee(arr) {
  const change = ((arr[5] - arr[0]) * 10) / HISTORY_BLOCKS;
  return Math.round(arr[HISTORY_BLOCKS - 1] + change) / 1e9;
}

// Feth v2 price estimations
const fetchPricesV2 = async (_web3, _rec) => {
  const blockNumber = await axios
    .post(MUMBAI_RPC, {
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1,
    })
    .then((response) => {
      return _web3.utils.hexToNumber(response.data.result);
    });
  await axios
    .post(MUMBAI_RPC, {
      jsonrpc: "2.0",
      method: "eth_feeHistory",
      params: [HISTORY_BLOCKS, "pending", [v2SAFE, v2STANDARD, v2FAST]],
      id: 1,
    })
    .then((response) => {
      const blocks = formatFeeHistory(response.data.result, false);
      const safeLow = avg(blocks.map((b) => b.priorityFeePerGas[0])) / 1e9;
      const standard = avg(blocks.map((b) => b.priorityFeePerGas[1])) / 1e9;
      const fast = avg(blocks.map((b) => b.priorityFeePerGas[2])) / 1e9;
      const baseFeeEstimate = avgBaseFee(blocks.map((b) => b.baseFeePerGas));

      _rec.updateGasPrices(
        safeLow,
        standard,
        fast,
        baseFeeEstimate,
        blockNumber
      );
    });
};

// sleep for `ms` miliseconds, just do nothing
const sleep = async (ms) =>
  new Promise((res, _) => {
    setTimeout(res, ms);
  });

// infinite loop, for keep fetching latest block data, for computing
// gas price recommendation using past data available
const runV1 = async (_web3, _transactions, _rec) => {
  while (true) {
    await fetchBlockAndProcess(_web3, _transactions, _rec);
    await sleep(3000);
  }
};

const runV2 = async (_web3, _rec) => {
  while (true) {
    await fetchPricesV2(_web3, _rec);
    await sleep(5000);
  }
};

const runZkevm = async (_web3, _transactions, _rec) => {
  while (true) {
    await fetchBlockAndProcess(_web3, _transactions, _rec);
    await sleep(5000);
  }
};

const web3PoS = getWeb3(MUMBAI_RPC);
const web3zkevm = getWeb3(ZKEVM_RPC);
const transactions = new Transactions(BUFFERSIZE);
const zkevmTransactions = new Transactions(BUFFERSIZE);
const v1Rec = new V1Recommendation();
const v2Rec = new V2Recommendation();
const zkevmRec = new V1Recommendation();

console.log("🔥 Matic Gas Station running ...");

// setInterval(updateBlockTime, 60000, _web3, v1Rec, v2Rec);

runV1(web3PoS, transactions, v1Rec)
  .then((_) => {})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

runV2(web3PoS, v2Rec)
  .then((_) => {})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

runZkevm(web3zkevm, zkevmTransactions, zkevmRec)
  .then((_) => {})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

runServer(v1Rec, v2Rec, zkevmRec);
