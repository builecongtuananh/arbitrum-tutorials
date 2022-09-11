require('@nomiclabs/hardhat-ethers')
const { hardhatConfig } = require('arb-shared-dependencies')
const main = require('./scripts/exec.js')

const { task } = require('hardhat/config.js')

task('withdraw-eth', 'Withdrawing ETH from fork chain')
  .addParam('nonce', 'Users nonce on L2')
  .addParam('value', 'Value for withdrawal')
  .addParam('address', 'Destination address of the withdrawal')

  .setAction(async args => {
    await main(args.nonce, args.value, args.address)
  })
module.exports = hardhatConfig
