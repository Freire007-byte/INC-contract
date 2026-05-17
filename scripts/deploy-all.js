// scripts/deploy-all.js
// INC Network — Deploy em todas as redes principais
const { ethers, network } = require("hardhat");

const INC_TREASURY = "0xb855fcF72730C703394317b5316f00404caf5417";

const NETWORKS = [
  { name: "ethereum",  label: "Ethereum Mainnet", explorer: "https://etherscan.io/address/" },
  { name: "arbitrum",  label: "Arbitrum One",     explorer: "https://arbiscan.io/address/" },
  { name: "polygon",   label: "Polygon",           explorer: "https://polygonscan.com/address/" },
  { name: "bnb",       label: "BNB Chain",         explorer: "https://bscscan.com/address/" },
  { name: "optimism",  label: "Optimism",          explorer: "https://optimistic.etherscan.io/address/" },
  { name: "avalanche", label: "Avalanche C-Chain", explorer: "https://snowscan.xyz/address/" },
  { name: "rootstock", label: "Rootstock (BTC)",   explorer: "https://explorer.rsk.co/address/" },
];

async function deployToNetwork() {
  const [deployer] = await ethers.getSigners();
  const net = network.name;
  const info = NETWORKS.find(n => n.name === net) || { label: net, explorer: "" };

  console.log("\n" + "═".repeat(56));
  console.log(`  Deployando em: ${info.label}`);
  console.log("═".repeat(56));
  console.log(`  Deployer : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Saldo    : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.log("  ⚠ SALDO ZERO — pulando esta rede\n");
    return null;
  }

  console.log(`  Tesouraria INC: ${INC_TREASURY}`);
  console.log("  Deployando contrato...");

  const Factory  = await ethers.getContractFactory("INCNetwork");
  const contract = await Factory.deploy(INC_TREASURY, deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const receipt = await contract.deploymentTransaction().wait();

  console.log(`\n  ✔ CONTRATO DEPLOYADO`);
  console.log(`  Endereço : ${address}`);
  console.log(`  Gas usado: ${receipt.gasUsed.toString()}`);
  console.log(`  Explorer : ${info.explorer}${address}`);

  return { network: net, label: info.label, address, explorer: info.explorer, deployer: deployer.address };
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║         INC Network — Multi-Chain Deploy               ║");
  console.log("║         Proof-of-Signal · v1.0                         ║");
  console.log("╚════════════════════════════════════════════════════════╝");

  const result = await deployToNetwork();

  if (result) {
    console.log("\n" + "═".repeat(56));
    console.log("  RESUMO DO DEPLOY");
    console.log("═".repeat(56));
    console.log(`  Rede     : ${result.label}`);
    console.log(`  Endereço : ${result.address}`);
    console.log(`  Tesouraria: ${INC_TREASURY}`);
    console.log(`  Taxa INC : 1.5%`);
    console.log("═".repeat(56));
    console.log("\n  PRÓXIMO PASSO — Verificar código-fonte:");
    console.log(`  npx hardhat verify --network ${result.network} ${result.address} "${INC_TREASURY}" "${result.deployer}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
