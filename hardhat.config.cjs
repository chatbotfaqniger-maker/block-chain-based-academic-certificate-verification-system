require("@nomicfoundation/hardhat-ethers");
module.exports = {
  solidity: "0.8.24",
  networks: { localhost: { url: process.env.CHAIN_RPC_URL || "http://blockchain:8545", chainId: 31337 } }
};
