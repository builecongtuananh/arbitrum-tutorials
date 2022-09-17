const { utils, providers, Wallet, ethers } = require('ethers')
const { parseEther } = utils
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L1RPC', 'L2RPC'])

/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY

const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)

const l1Wallet = new Wallet(walletPrivateKey, l1Provider)
const inboxAddress = '0x6BEbC4925716945D46F0Ec336D5C2564F419682C'
const abi = [
  'function calculateRetryableSubmissionFee(uint256,uint256) public view returns (uint256)',
  'function unsafeCreateRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes) public payable returns (uint256)',
]
/**
 * Set the amount to be deposited in L2 (in wei)
 */
const ethToL2DepositAmount = parseEther('0.0001')

const main = async () => {
  await arbLog('Deposit Eth via Arbitrum SDK')

  /**
   * Use l2Network to create an Arbitrum SDK EthBridger instance
   * We'll use EthBridger for its convenience methods around transferring ETH to L2
   */

  const zeroAmount = ethers.BigNumber.from(0)
  const inboxContract = new ethers.Contract(inboxAddress, abi, l1Wallet)
  const maxSubmissionCost = await inboxContract.calculateRetryableSubmissionFee(
    zeroAmount,
    zeroAmount
  )
  console.log(maxSubmissionCost)
  const tx = await inboxContract.unsafeCreateRetryableTicket(
    l1Wallet.address,
    zeroAmount,
    maxSubmissionCost.mul(2),
    l1Wallet.address,
    l1Wallet.address,
    zeroAmount,
    zeroAmount,
    utils.hexZeroPad(utils.hexlify(0), 32),
    { value: ethToL2DepositAmount }
  )
  const rec = await tx.wait()
  console.log(await rec.transactionHash)
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
