import "@nomicfoundation/hardhat-ethers";

/** Hardhat configuration for the Verity certificate registry. */
export default {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    amoy: {
      url: process.env.CHAIN_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: process.env.CHAIN_PRIVATE_KEY ? [process.env.CHAIN_PRIVATE_KEY] : []
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
