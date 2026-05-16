// scripts/deploy-fork.js
// Deploy em fork local do Sepolia — usa feeds Chainlink reais sem precisar de ETH
const { ethers, network } = require("hardhat");

const FEEDS = {
  "BTC/USDT": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  "ETH/USDT": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
};

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   INC Network — Deploy em Fork Sepolia           ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const INC_TREASURY = process.env.INC_TREASURY;
  const INC_OWNER    = process.env.INC_OWNER;
  if (!INC_TREASURY) throw new Error("Defina INC_TREASURY no .env");
  if (!INC_TREASURY || INC_TREASURY === INC_OWNER) throw new Error("Treasury deve ser diferente do owner");

  // Carrega carteira do deployer e financia com ETH no fork
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  await network.provider.send("hardhat_setBalance", [
    deployer.address,
    "0x56BC75E2D63100000", // 100 ETH
  ]);

  const saldo = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Saldo:   ", ethers.formatEther(saldo), "ETH (financiado no fork)\n");
  console.log("Treasury:", INC_TREASURY);
  console.log("Owner:   ", INC_OWNER, "\n");

  // Deploy
  console.log("Deployando INCNetwork...");
  const Factory  = await ethers.getContractFactory("INCNetwork", deployer);
  const contract = await Factory.deploy(INC_TREASURY, INC_OWNER);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✔ INCNetwork deployado em:", address);

  // Configura feeds Chainlink reais do Sepolia (disponíveis no fork)
  console.log("\nConfigurando Chainlink Price Feeds (Sepolia reais)...");
  for (const [pair, feed] of Object.entries(FEEDS)) {
    const tx = await contract.connect(deployer).setPriceFeed(pair, feed);
    await tx.wait();
    console.log(`  ✔ ${pair} => ${feed}`);
  }

  // Verifica preços ao vivo dos feeds no fork
  console.log("\nPreços ao vivo via Chainlink:");
  for (const pair of Object.keys(FEEDS)) {
    try {
      const price = await contract.getCurrentPrice(pair);
      const usd = Number(price) / 1e8;
      console.log(`  ${pair}: $${usd.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    } catch (e) {
      console.log(`  ${pair}: feed indisponivel no fork`);
    }
  }

  console.log("\n══════════════════════════════════════════════════");
  console.log("ENDEREÇO DO CONTRATO:");
  console.log(address);
  console.log("══════════════════════════════════════════════════");
  console.log("\nPara deploy real no Sepolia (quando tiver ETH):");
  console.log(`npx hardhat run scripts/deploy.js --network sepolia`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
