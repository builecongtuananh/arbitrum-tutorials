const { ethers } = require('hardhat')
const { BigNumber, providers, Wallet } = require('ethers')
const {
  getL2Network,
  Erc20Bridger,
} = require('@arbitrum/sdk')
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
const EthersAdapter = require('@gnosis.pm/safe-ethers-lib')['default']
const Safe = require('@gnosis.pm/safe-core-sdk')['default']
const {
  SafeEthersSigner,
  SafeService,
} = require('@gnosis.pm/safe-ethers-adapters')
require('dotenv').config()
requireEnvVariables([
  'DEVNET_PRIVKEY',
  'L1RPC',
  'L2RPC',
  'SAFE_SERVICE_URL',
  'SAFE_ADDRESS',
  'TOKEN_ADDRESS',
  'DEST_ADDRESS',
  'DEPOSIT_AMT'
])

/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY

const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)

const l1Wallet = new Wallet(walletPrivateKey, l1Provider)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)

const ethAdapter = new EthersAdapter({ ethers, signer: l1Wallet })
const service = new SafeService(process.env.SAFE_SERVICE_URL)

const main = async () => {
  await arbLog('Deposit token using Arbitrum SDK')

  const safe = await Safe.create({
    ethAdapter,
    safeAddress: process.env.SAFE_ADDRESS,
  })
  const safeSigner = new SafeEthersSigner(safe, service, l1Provider)

  /**
   * Use l2Network to create an Arbitrum SDK Erc20Bridger instance
   * We'll use Erc20Bridger for its convenience methods around transferring token to L2
   */
  const l2Network = await getL2Network(l2Provider)
  const erc20Bridge = new Erc20Bridger(l2Network)

  const erc20Address = process.env.TOKEN_ADDRESS
  const L1DappToken = await (
    await ethers.getContractFactory('DappToken')
  ).connect(l1Wallet)
  const l1DappToken = L1DappToken.attach(erc20Address)
  const expectedL1GatewayAddress = await erc20Bridge.getL1GatewayAddress(
    erc20Address,
    l1Provider
  )
  const tokenAllowance = await l1DappToken.allowance(safeSigner.address, expectedL1GatewayAddress)
  const tokenDepositAmount = BigNumber.from(process.env.DEPOSIT_AMT)

  if (tokenAllowance.lt(tokenDepositAmount)) {
    const approveTx = await erc20Bridge.approveToken({
      l1Signer: safeSigner,
      erc20L1Address: erc20Address,
    })
    console.log('sent approve')
    console.log("USER ACTION REQUIRED")
    console.log("Go to the Gnosis Safe Web App to confirm the transaction")
    await approveTx.wait()
    console.log("Transaction has been executed")
  }

  const depositTx = await erc20Bridge.deposit({
    amount: tokenDepositAmount,
    erc20L1Address: erc20Address,
    l1Signer: safeSigner,
    l2Provider: l2Provider,
    destinationAddress: process.env.DEST_ADDRESS,
  })
  console.log('sent deposit')
  console.log("USER ACTION REQUIRED")
  console.log("Go to the Gnosis Safe Web App to confirm the transaction")
  await depositTx.wait()
  console.log("Transaction has been executed")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
