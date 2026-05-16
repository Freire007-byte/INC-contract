// scripts/deploy.js
const { ethers } = require("hardhat");

// Endereços dos Chainlink Price Feeds por rede
const FEEDS = {
  mainnet: {
    "BTC/USDT": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b",
    "ETH/USDT": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    "SOL/USDT": "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
    "BNB/USDT": "0x14e613AC84a31f709eadbEF2dD6360A0f0FC3Af6",
  },
  sepolia: {
    "BTC/USDT": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
    "ETH/USDT": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  },
};

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   INC Network — Deploy + Configuração Oracle ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  const network    = hre.network.name;

  console.log("Rede:    ", network);
  console.log("Deployer:", deployer.address);
  console.log("Saldo:   ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const INC_TREASURY = process.env.INC_TREASURY;
  const INC_OWNER    = process.env.INC_OWNER || deployer.address;

  if (!INC_TREASURY) throw new Error("Defina INC_TREASURY no arquivo .env antes de fazer deploy");
  if (INC_TREASURY === INC_OWNER) throw new Error("INC_TREASURY e INC_OWNER devem ser carteiras diferentes");

  console.log("Treasury (recebe taxas):", INC_TREASURY);
  console.log("Owner    (emergências): ", INC_OWNER);

  // ── DEPLOY ────────────────────────────────────────────────────────────────
  console.log("\nDeployando INCNetwork...");
  const INCNetwork = await ethers.getContractFactory("INCNetwork");
  const contract   = await INCNetwork.deploy(INC_TREASURY, INC_OWNER);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✔ INCNetwork deployado em:", address);

  // ── CONFIGURAÇÃO DOS FEEDS CHAINLINK ──────────────────────────────────────
  const feeds = FEEDS[network];
  if (feeds) {
    console.log("\nConfigurando Chainlink Price Feeds...");
    for (const [pair, feedAddr] of Object.entries(feeds)) {
      const tx = await contract.setPriceFeed(pair, feedAddr);
      await tx.wait();
      console.log(`  ✔ ${pair} => ${feedAddr}`);
    }
  } else {
    console.log(`\n⚠ Nenhum feed configurado para a rede "${network}".`);
    console.log("  Configure manualmente via setPriceFeed() após o deploy.");
  }

  // ── CHAINLINK AUTOMATION ──────────────────────────────────────────────────
  console.log("\n── PRÓXIMOS PASSOS: Chainlink Automation ────────────────────");
  console.log("1. Acesse https://automation.chain.link");
  console.log("2. Clique em 'Register New Upkeep'");
  console.log("3. Selecione 'Custom Logic'");
  console.log("4. Contrato alvo:", address);
  console.log("5. checkData (varrer 20 sinais por vez, a partir do índice 0):");
  console.log("  ", ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256"], [0, 20]));
  console.log("6. Financie o Upkeep com LINK");

  console.log("\n── VERIFICAÇÃO NO ETHERSCAN ─────────────────────────────────");
  console.log(`npx hardhat verify --network ${network} ${address} "${INC_TREASURY}" "${INC_OWNER}"`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
