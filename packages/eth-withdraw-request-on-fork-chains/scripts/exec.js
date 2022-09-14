const { ethers, providers, Wallet } = require('ethers')
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
const { bigIntToUnpaddedBuffer } = require('@ethereumjs/util')
const rlp = require('rlp')
const fetch = require('node-fetch')
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L1RPC'])

/**
 * Set up: Instantiate L1 wallet connected to providers
 */
const walletPrivateKey = process.env.DEVNET_PRIVKEY
const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)
const l1Wallet = new Wallet(walletPrivateKey, l1Provider)

/**
 * Defining the abi of the Delayed Inbox, and Sequencer Inbox contracts
 */
const inboxAbi = [
  'function sendWithdrawEthToFork(uint256,uint256,uint256,uint256,address) external returns (uint256)',
]
const sequencerAbi = [
  'function forceInclusion(uint256,uint8,uint64[2],uint256,address,bytes32) external ',
  'function totalDelayedMessagesRead() public view returns(uint256)',
  'function removeDelayAfterFork() external',
  'function maxTimeVariation() public view returns (uint256,uint256,uint256,uint256)',
]

/**
 * Delayed Inbox, and Sequencer Inbox contract addresses
 * For testings:
 * 1. Change these addresses each time running Nitro node
 * 2. Change them to Arbitrum One addresses after testing
 * The below pre-configured value is for Arbitrum One
 */
const inboxAddress = '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f'
const sequencerInboxAddress = '0x1c479675ad559dc151f6ec7ed3fbf8cee79582b6'
const l2chainid = 42161

module.exports = async (nonce, value, address) => {
  const chainid = (await l1Provider.getNetwork()).chainId
  if (chainid === 1) {
    throw new Error('Do not run this on Mainnet')
  }
  if (ethers.utils.isAddress(address) === false) {
    throw new Error('Invalid destination address')
  }
  await arbLog('ETH Withdrawal Request on Fork chain')

  /**
   * Defining Delayed Inbox and Sequencer Inbox contracts
   */
  const inboxContract = new ethers.Contract(inboxAddress, inboxAbi, l1Wallet)
  const sequenceContract = new ethers.Contract(
    sequencerInboxAddress,
    sequencerAbi,
    l1Wallet
  )

  /**
   * Reading "delayBlocks" from Sequencer Inbox. This is the effective delay that should pass to be able to request for force inclusion
   * In Ethereum forks after merge this number will be changed into one block so that folks can force include right after putting their tx on Delayed Inbox
   * Note that on PoS chain we won't change this because we run sequencer on that chain.
   */
  const maxTimeVariationStruct = await sequenceContract.maxTimeVariation()
  const delayBlocks = maxTimeVariationStruct[0]

  /**
   * Target delayBlocks after Merge on fork chains will be 1 block
   */
  const targetDelayBlocksOnForks = ethers.BigNumber.from('1')

  /**
   * Checking if the delayBlocks has been changed into "1" or not
   * If it isn't changed, then will call removeDelayAfterFork function on Sequencer Inbox contract
   * This function is only callable on Ethereum fork chains and not PoS chain
   */
  if (delayBlocks.gt(targetDelayBlocksOnForks)) {
    const tx1 = await sequenceContract.removeDelayAfterFork()
    await tx1.wait()
    console.log(
      'Well! Now delayBlocks changed into 1 block, in this Ethereum Fork chain'
    )
  }

  /**
   * Setting maxFeePerGas to 0.12 gwei, which should be enough considering we won't have congestion on L2 side
   * Casting nonce, which is provided on input, from string to number type
   * Casting value, which is provided on input, from string to big number type
   */
  const maxFeePerGas = ethers.utils.parseUnits('0.12', 'gwei')
  const maxGas = 100000
  const nonceNumber = Number(nonce)
  let valueBN
  if (value === 'all') {
    const l2forkblock = process.env.L2FORKBLOCK
    if (l2forkblock === undefined) {
      throw new Error('L2FORKBLOCK is not set')
    }
    value = (
      await (
        await fetch(
          `https://api.arbiscan.io/api?module=account&action=balance&address=${address}&tag=0x${l2forkblock.toString(
            16
          )}`
        )
      ).json()
    ).result
    console.log(`Your balance at fork block is: ${value}`)
    valueBN = ethers.BigNumber.from(value).sub(
      ethers.BigNumber.from(maxFeePerGas).mul(maxGas)
    )
  } else {
    valueBN = ethers.BigNumber.from(value)
  }
  if (valueBN.lte(0)) {
    throw new Error('Value should be greater than 0')
  }

  /**
   * Sending ETH withdraw request to Delayed Inbox contract calling sendWithdrawEthToFork method
   * @param gasLimit set to hardcoded number 100k gas
   * @param maxFeePerGas hardcoded to '0.12' gwei
   * @param nonce the user's nonce on L2 before Merge event
   * @param value the amount user wants to withdraw
   * @param withdrawTo the address user provided as destination address
   */
  const tx2 = await inboxContract.sendWithdrawEthToFork(
    maxGas,
    maxFeePerGas,
    nonceNumber,
    valueBN,
    address
  )

  /**
   * Getting the transaction recipient
   */
  const txRec = await tx2.wait()
  console.warn(
    'Your withdrawal request is confirmed 🎉🎉. The receipt is:',
    txRec.transactionHash
  )

  /**
   * Calling sendWithdrawEthToFork function will emit two events:
   * 1. "MessageDelivered" event on the Bridge contract (https://github.com/OffchainLabs/nitro/blob/e907320733dafda6d22db6928b09227a4b2f61a5/contracts/src/bridge/IBridge.sol#L11-L20)
   * 2. "InboxMessageDelivered" event on Delayed Inbox contract (https://github.com/OffchainLabs/nitro/blob/e907320733dafda6d22db6928b09227a4b2f61a5/contracts/src/bridge/IDelayedMessageProvider.sol#L10)
   * For calling the "forceInclusion" function, we need inputs related to the delayed message
   * We use the transaction log to get these required inputs
   * We fetch these inputs from the first log of the transaction, which is MessageDelivered event log
   */
  const logsOfTx = await txRec.logs
  const eventMessageDelivered = logsOfTx[0]

  /**
   * Second topic of the "MessageDelivered" event returns messageIndex
   * Cast it into big number type
   */
  const messageIndex = eventMessageDelivered.topics[1]
  const messageIndexBN = ethers.BigNumber.from(messageIndex)

  /**
   * total messages of the contract is messageIndex plus one
   */
  const totalmessages = messageIndexBN.add(1)

  /**
   * Here we decode the log data of the transaction to have the non indexed fields of the event
   */
  var abiCoder = ethers.utils.defaultAbiCoder
  const data1 = abiCoder.decode(
    ['address', 'uint8', 'address', 'bytes32', 'uint256', 'uint64'],
    await eventMessageDelivered.data
  )

  /**
   * We fetch the messageType, sender, messageDataHash,l1BaseFee and l1Timestamp from event log data
   */
  const messageType = data1[1]
  const senderAddress = data1[2]
  const messageDataHash = data1[3]
  const l1BaseFee = data1[4]
  const l1Timestamp = data1[5].toNumber()

  /**
   * We also need block number of the delayed message which is not accessible in events.
   * Here we get the block number from the transaction recipient itself
   */
  const blockNumber = await txRec.blockNumber

  /**
   * In "forceInclusion" function blockNumberAndTime argument is an array of block number and timestamp
   */
  const blockNumberAndTime = [
    ethers.BigNumber.from(blockNumber),
    ethers.BigNumber.from(l1Timestamp),
  ]

  console.log(
    '-------------------------------------------------------------------'
  )
  console.log("Now let's force include your transaction. Wait a bit!")
  console.log(
    '-------------------------------------------------------------------'
  )

  // we can only call forceInclusion after 1 block has passed
  if ((await l1Provider.getBlockNumber()) < blockNumber + 1) {
    // wait for 30 seconds unless in hardhat fork
    if (chainid !== 31337)
      await new Promise(resolve => setTimeout(resolve, 30000))
    // check to see if there are any new blocks on L1
    if ((await l1Provider.getBlockNumber()) < blockNumber + 1) {
      // there are no new block, sending a self transfer to make a new block
      await (
        await l1Wallet.sendTransaction({
          to: l1Wallet.address,
        })
      ).wait()
    }
  }

  /**
   * Calling "forceInclusion" function of the Sequencer Inbox contract to force include the delayed message(s)
   * @param totalmessages total delayed messages
   * @param blockNumberAndTime Block number and timestamp of the latest delayed message
   * @param l1BaseFee L1 base fee of the latest delayed message
   * @param sender sender of the latest delayed message
   * @param messageDataHash message data hash of the latest delayed message
   */
  const tx3 = await sequenceContract.forceInclusion(
    totalmessages,
    ethers.BigNumber.from(messageType),
    blockNumberAndTime,
    l1BaseFee,
    senderAddress,
    messageDataHash
  )
  const txRec2 = await tx3.wait()

  /**
   * "forceInclusion" function will emit "SequencerBatchDelivered" event (https://github.com/OffchainLabs/nitro/blob/e907320733dafda6d22db6928b09227a4b2f61a5/contracts/src/bridge/ISequencerInbox.sol#L34-L42)
   * The second topic of the log returns batchSequenceNumber
   * We'll show the batch sequence number and the transaction hash in which the force inclusion is done
   */
  const SequencerBatchDeliveredLog = await txRec2.logs[0]
  const batchSequenceNumber = SequencerBatchDeliveredLog.topics[1]
  console.log(
    `Your withdrawal request is successfully force included with batch sequence number ${Number(
      batchSequenceNumber
    )} in transaction with transaction hash ${await txRec2.transactionHash} 🫡🫡`
  )

  // havn't tested this yet
  // https://github.com/OffchainLabs/go-ethereum/blob/2098a1668af945a81f5adb807387445693521a34/core/types/arb_types.go#L43-L53
  const ArbitrumUnsignedTxType = 101
  const txdata = `0x25e16063000000000000000000000000${address.substring(2)}`
  const txrlpbuffer = Buffer.concat([
    new Uint8Array([ArbitrumUnsignedTxType]),
    rlp.encode([
      bigIntToUnpaddedBuffer(BigInt(l2chainid)),
      l1Wallet.address,
      bigIntToUnpaddedBuffer(BigInt(nonceNumber)),
      bigIntToUnpaddedBuffer(BigInt(maxFeePerGas)),
      bigIntToUnpaddedBuffer(BigInt(maxGas)),
      '0x0000000000000000000000000000000000000064',
      bigIntToUnpaddedBuffer(BigInt(valueBN)),
      txdata,
    ]),
  ])
  console.log('Expected tx hash on L2:', ethers.utils.keccak256(txrlpbuffer))
}
