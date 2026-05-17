require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  defaultNetwork: "hardhat",
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.eth.gateway.fm",
        enabled: true,
      },
      chainId: 11155111,
    },
    ethereum:  { url: "https://eth.llamarpc.com",                      chainId: 1,      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    arbitrum:  { url: "https://arb1.arbitrum.io/rpc",                  chainId: 42161,  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    polygon:   { url: "https://polygon-rpc.com",                       chainId: 137,    accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    bnb:       { url: "https://bsc-dataseed.binance.org",              chainId: 56,     accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    optimism:  { url: "https://mainnet.optimism.io",                   chainId: 10,     accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    avalanche: { url: "https://api.avax.network/ext/bc/C/rpc",         chainId: 43114,  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    rootstock: { url: "https://public-node.rsk.co",                    chainId: 30,     accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
    sepolia:   { url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.eth.gateway.fm", chainId: 11155111, accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY || "",
    customChains: [
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=11155111",
          browserURL: "https://sepolia.etherscan.io",
        },
      },
    ],
  },
};
