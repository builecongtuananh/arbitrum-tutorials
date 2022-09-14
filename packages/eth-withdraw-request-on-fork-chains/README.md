# eth-withdraw-request-on-fork-chains Tutorial

`eth-withdraw-request-on-fork-chains` shows how to create a request for ETH withdrawal on fork chains after the Merge and also force include the withdrawal request.

## How it works (Under the hood)

Users are concerned about the possible Ethereum forks (mostly PoW fork) and how to claim their forked Ether on the other chain(s), in case they have money on the L2 Arbitrum. In this tutorial we'll show the workflow to request for the withdrawal of your Ether from Arbitrum Bridge on the L1 Forked chain and also force inclusion of the withdrawal request.
For running the script you need to provide 3 inputs. The inputs are nonce, value, and withdrawTo address. `nonce` is the least unused nonce of the user's address on L2 before the Merge event. `value` represents the value of ETH (in wei), user wants to withdraw from L2 to L1. `withdrawTo` is the destination address that the user wants to receive the funds on L1 fork chain.

See [./exec.js](./scripts/exec.js) for inline explanation.

Note that you can use [Arbiscan](https://arbiscan.io/) and its [API](https://arbiscan.io/apis) to find `nonce`, `balance` of your L2 address at the time of Merge event and use them to call the script.

To run:

```
yarn withdraw-eth --nonce myNonceNumber --value myValueInWei  --address myWithdrawToAddress
```

## Config Environment Variables

Set the values shown in `.env-sample` as environmental variables. To copy it into a `.env` file:

```bash
cp .env-sample .env
```

(you'll still need to edit some variables, i.e., `DEVNET_PRIVKEY`)

---

<p align="center"><img src="../../assets/offchain_labs_logo.png" width="600"></p>
