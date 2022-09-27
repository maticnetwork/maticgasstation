const { config } = require('dotenv')
const path = require('path')
const Web3 = require('web3')
const humanizeDuration = require('humanize-duration')
const Recommendation = require('./recommendation')
const Transaction = require('./transaction')
const Transactions = require('./transactions')
const { runServer } = require('./serve')
const {logger} = require('./logger')

// reading variables from environment file, set them as you 
// need in .env file in current working directory
config({ path: path.join(__dirname, '.env'), silent: true })

// setting environment variables
const SAFELOW = process.env.SAFELOW || 30
const STANDARD = process.env.STANDARD || 60
const FAST = process.env.FAST || 90
const FASTEST = process.env.FASTEST || 100
const RPC = process.env.RPC
const BUFFERSIZE = process.env.BUFFERSIZE || 500

const checkRPC = _ => {
    if(process.env.RPC == undefined || process.env.RPC == "") {
        logger.error('RPC field not found in ENV')
        console.error('RPC field not found in ENV')
        process.exit(1)
    }
}

checkRPC()

// obtaining connection to websocket RPC endpoint
const getWeb3 = () => new Web3(RPC.startsWith('http') ? new Web3.providers.HttpProvider(RPC) : new Web3.providers.WebsocketProvider(RPC))

// fetch latest block & block previous to latest one,
// for computing blocktime i.e. block mining delay
const getBlockTime = async _web3 => {
    let latestBlock = await _web3.eth.getBlock('latest')
    let prevBlock = await _web3.eth.getBlock(latestBlock.number - 1)
    return latestBlock.timestamp - prevBlock.timestamp
}

// putting block time in object, which is keeping track of
// all data that's to be published, from gas station
const updateBlockTime = (_web3, _rec) => {
    getBlockTime(_web3).then(v => {
        _rec.blockTime = v
    })
}

// given hash of transaction i.e. unique identifier, it will
// fetch that transaction and put it inside transaction pool, 
// for further processing purposes
const processTransaction = async (_web3, _hash, _blockNumber, idx, _transactions) => {

    const start = new Date().getTime()
    const _transaction = await _web3.eth.getTransaction(_hash)

    if (_transaction !== null) {

        _transactions.add(new Transaction(
            _transaction.blockNumber,
            parseInt(_transaction.gasPrice, 10) / 1e9))

        logger.info(`➕ Processed tx ${idx} of block : ${_blockNumber} in ${humanizeDuration(new Date().getTime() - start)}`)
        console.log(`➕ Processed tx ${idx} of block : ${_blockNumber} in ${humanizeDuration(new Date().getTime() - start)}`)

    }

}

// given a non-empty ( having atleast 1 transaction ) block object, it'll
// go through each of them & put them inside transaction pool
const processBlock = async (_web3, _transactions, _block) => {

    console.log(`🔅 Processing Block : ${_block.number}`)
    logger.info(`🔅 Processing Block : ${_block.number}`)
    const start = new Date().getTime()
    const promises = []

    for (let i = 0; i < _block.transactions.length; i++) {

        promises.push(processTransaction(_web3, _block.transactions[i], _block.number, i, _transactions))

    }

    await Promise.all(promises)

    console.log(`✅ Block : ${_block.number} in ${humanizeDuration(new Date().getTime() - start)}`)
    logger.info(`✅ Block : ${_block.number} in ${humanizeDuration(new Date().getTime() - start)}`)

}

// fetch latest block mined, if it's not already processed & non-empty
// then we'll process each transaction in it, put them in transaction pool,
// after that it'll be computing gas price recommendation depending upon past data
// and env variable values
const fetchBlockAndProcess = async (_web3, _transactions, _rec) => {
    let latestBlock = await _web3.eth.getBlock('latest')

    if (!(_transactions.latestBlockNumber < latestBlock.number)) {
        return
    }

    if (latestBlock.transactions.length == 0) {
        _rec.blockNumber = latestBlock.number

        console.log(`❗️ Empty Block : ${latestBlock.number}`)
        logger.info(`❗️ Empty Block : ${latestBlock.number}`)
        return
    }

    await processBlock(_web3, _transactions, latestBlock)
    const cumsumGasPrices = _transactions.cumulativePercentageOfGasPrices()

    _rec.updateGasPrices(
        _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, SAFELOW),
        _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, STANDARD),
        _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, FAST),
        _transactions.getMinGasPriceWithAcceptanceRateX(cumsumGasPrices, FASTEST)
    )
    _rec.blockNumber = _transactions.latestBlockNumber
}

// sleep for `ms` miliseconds, just do nothing
const sleep = async (ms) => new Promise((res, _) => { setTimeout(res, ms) })

// infinite loop, for keep fetching latest block data, for computing
// gas price recommendation using past data available
const run = async (_web3, _transactions, _rec) => {
    while (true) {
        await fetchBlockAndProcess(_web3, _transactions, _rec)
        await sleep(1000)
    }
}


const web3 = getWeb3()
const transactions = new Transactions(BUFFERSIZE)
const recommendation = new Recommendation()

console.log('🔥 Matic Gas Station running ...')
logger.info('🔥 Matic Gas Station running ...')

setInterval(updateBlockTime, 60000, web3, recommendation)

run(web3, transactions, recommendation).then(_ => { }).catch(e => {
    console.error(e)
    process.exit(1)
})

runServer(recommendation)
