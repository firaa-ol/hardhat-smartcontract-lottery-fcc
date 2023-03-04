# Smart Contract Lottery

## Staging test steps

1. Get SubsdcriptionId for [Chainlink VRF](https://vrf.chain.link)
2. Deploy our contract using subscription Id
3. Register the contract with Chainlink VRF & it's subscriptionId
4. Register the contract with [Chainlink Keepers](https://keepers.chain.link)
5. Run the staging tests with

```
yarn hardhat test --network goerli
```
