const { config } = require('dotenv')
const path = require('path')
const axios = require('axios')
const humanizeDuration = require('humanize-duration')

const GasPriceList = require('./gasPriceList')

// reading variables from environment file, set them as you
// need in .env file in current working directory
config({ path: path.join(__dirname, '.env'), silent: true })

// setting environment variables
const SAFELOWV2 = process.env.v2SAFELOW || 200
const STANDARDV2 = process.env.v2STANDARD || 125
const FASTV2 = process.env.v2FAST || 50
const FASTESTV2 = process.env.v2FASTEST || 25
const RPC = process.env.RPC

// fetch pending transactions' gas prices from the txPool of the node
// using graphQL to fetch
// can be fetched using txPool API and web3 as well (not implemented here)
exports.fetchAndProcessPendingTxs = async (_rec, _avgBlockSize) => {
    const gasPriceList = new GasPriceList()

    // querying for pending txs
    const result = await axios.post(`${RPC}/graphql`, {
        query: `
            { block { number }, pending { transactions { gasPrice, gas, from { address } } } }
          `
    })

    const latestBlockNumber = result.data.data.block.number

    // updating the last mined block details
    _rec.blockNumber = latestBlockNumber

    const prices = result.data.data.pending.transactions

    // adding gas prices to the gasPriceList object
    // and processing for cummulative percentage values
    // to calculate recommendations
    // then, updating the new recommended values
    let lastProcessedAddress
    let wontPass = false
    for (let i = 0; i < prices.length; i++) {
        const gasPrice = parseInt(prices[i].gasPrice)
        const gas = parseInt(prices[i].gas)
        const address = prices[i].from.address
        if (address != lastProcessedAddress) {
            lastProcessedAddress = address
            wontPass = false
        }
        if (!wontPass) {
            if (gasPrice >= 1000000000) {
                gasPriceList.add(gasPrice, gas)
            } else {
                wontPass = true
            }
        }
    }

    if (gasPriceList.totalCount > 0) { gasPriceList.orderPrices() }

    _rec.updateGasPrices(
        gasPriceList.getRecommendation(Math.floor(_avgBlockSize.blockSize * SAFELOWV2)),
        gasPriceList.getRecommendation(Math.floor(_avgBlockSize.blockSize * STANDARDV2)),
        gasPriceList.getRecommendation(Math.floor(_avgBlockSize.blockSize * FASTV2)),
        gasPriceList.getRecommendation(Math.floor(_avgBlockSize.blockSize * FASTESTV2))
    )
}