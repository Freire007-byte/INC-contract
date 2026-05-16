# INC Network — Deploy Multi-Chain

Tesouraria: 0xb855fcF72730C703394317b5316f00404caf5417
Taxa INC   : 1.5%

## Redes suportadas

| # | Rede            | Chain ID | Moeda | Custo est.  |
|---|-----------------|----------|-------|-------------|
| 1 | Ethereum        | 1        | ETH   | ~$80–150    |
| 2 | Arbitrum        | 42161    | ETH   | ~$2–5       |
| 3 | Polygon         | 137      | MATIC | ~$0.10      |
| 4 | BNB Chain       | 56       | BNB   | ~$0.50      |
| 5 | Optimism        | 10       | ETH   | ~$1–3       |
| 6 | Avalanche       | 43114    | AVAX  | ~$0.50      |
| 7 | Rootstock (BTC) | 30       | RBTC  | ~$0.10      |

## Passo a passo

### 1. Instalar
npm install

### 2. Testar local (grátis)
npx hardhat test

### 3. Sepolia (teste, sem custo)
Pegue ETH de teste em sepoliafaucet.com

Windows:
  set PRIVATE_KEY=sua_key
  npx hardhat run scripts/deploy-all.js --network sepolia

Mac/Linux:
  export PRIVATE_KEY=sua_key
  npx hardhat run scripts/deploy-all.js --network sepolia

### 4. Deploy em cada rede principal

Windows:
  set PRIVATE_KEY=sua_key
  npx hardhat run scripts/deploy-all.js --network ethereum
  npx hardhat run scripts/deploy-all.js --network arbitrum
  npx hardhat run scripts/deploy-all.js --network polygon
  npx hardhat run scripts/deploy-all.js --network bnb
  npx hardhat run scripts/deploy-all.js --network optimism
  npx hardhat run scripts/deploy-all.js --network avalanche
  npx hardhat run scripts/deploy-all.js --network rootstock

Mac/Linux:
  export PRIVATE_KEY=sua_key
  for net in ethereum arbitrum polygon bnb optimism avalanche rootstock; do
    npx hardhat run scripts/deploy-all.js --network $net
  done

### 5. Verificar código no explorer

npx hardhat verify --network REDE ENDERECO "0xb855fcF72730C703394317b5316f00404caf5417"

Explorers:
  Ethereum  → etherscan.io
  Arbitrum  → arbiscan.io
  Polygon   → polygonscan.com
  BNB       → bscscan.com
  Optimism  → optimistic.etherscan.io
  Avalanche → snowscan.xyz
  Rootstock → explorer.rsk.co

## Fluxo de taxa

Usuário stake 1 ETH → contrato separa 1.5% → vai direto para 0xb855...
O restante fica em escrow até WIN/LOSS/EXPIRADO.

## ⚠ Segurança
Nunca salve a PRIVATE_KEY em arquivos.
Sempre use variável de ambiente no terminal.
Teste sempre na Sepolia antes de mainnet.
