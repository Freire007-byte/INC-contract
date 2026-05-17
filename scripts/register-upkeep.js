// scripts/register-upkeep.js
const { ethers } = require("hardhat");

const LINK_TOKEN    = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
const REGISTRAR     = "0xb0E49c5D0d05cbc241d68c05BC5BA1d1B7B72976";
const INC_CONTRACT  = "0x83F723a613a47cE2F0FB805bCA71C4AAA2F8d9EC";
const LINK_AMOUNT   = ethers.parseEther("5"); // 5 LINK

const LINK_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const REGISTRAR_ABI = [
  {
    name: "registerUpkeep",
    type: "function",
    inputs: [{
      name: "requestParams",
      type: "tuple",
      components: [
        { name: "name",           type: "string"  },
        { name: "encryptedEmail", type: "bytes"   },
        { name: "upkeepContract", type: "address" },
        { name: "gasLimit",       type: "uint32"  },
        { name: "adminAddress",   type: "address" },
        { name: "triggerType",    type: "uint8"   },
        { name: "checkData",      type: "bytes"   },
        { name: "triggerConfig",  type: "bytes"   },
        { name: "offchainConfig", type: "bytes"   },
        { name: "amount",         type: "uint96"  },
      ],
    }],
    outputs: [{ name: "id", type: "uint256" }],
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Registrando Upkeep com:", deployer.address);

  const link      = new ethers.Contract(LINK_TOKEN, LINK_ABI, deployer);
  const registrar = new ethers.Contract(REGISTRAR, REGISTRAR_ABI, deployer);

  const balance = await link.balanceOf(deployer.address);
  console.log("Saldo LINK:", ethers.formatEther(balance));

  // checkData: startIdx=0, batchSize=20
  const checkData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256"], [0, 20]
  );

  console.log("\n1. Aprovando LINK para o Registrar...");
  const approveTx = await link.approve(REGISTRAR, LINK_AMOUNT);
  await approveTx.wait();
  console.log("   ✔ Aprovado");

  console.log("2. Registrando Upkeep...");
  const tx = await registrar.registerUpkeep({
    name:           "INC Network",
    encryptedEmail: "0x",
    upkeepContract: INC_CONTRACT,
    gasLimit:       500000,
    adminAddress:   deployer.address,
    triggerType:    0,
    checkData:      checkData,
    triggerConfig:  "0x",
    offchainConfig: "0x",
    amount:         LINK_AMOUNT,
  });

  const receipt = await tx.wait();
  console.log("   ✔ Tx:", receipt.hash);

  // Extrai o upkeepId do evento
  const iface = new ethers.Interface([
    "event RegistrationRequested(bytes32 indexed hash, string name, bytes encryptedEmail, address indexed upkeepContract, uint32 gasLimit, address adminAddress, uint8 triggerType, bytes triggerConfig, address indexed sender, bytes checkData, uint96 amount)",
    "event RegistrationApproved(bytes32 indexed hash, string displayName, uint256 indexed upkeepId)",
  ]);

  let upkeepId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "RegistrationApproved") {
        upkeepId = parsed.args.upkeepId.toString();
      }
    } catch (_) {}
  }

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   Upkeep registrado com sucesso!             ║");
  console.log("╚══════════════════════════════════════════════╝");
  if (upkeepId) console.log("Upkeep ID:", upkeepId);
  console.log("Dashboard: https://automation.chain.link/sepolia");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1); });
