# INC Network — Proof-of-Signal

Smart contract de staking de sinais on-chain com resolução automática via Chainlink Oracle.

## Contrato em produção (Sepolia Testnet)

| Item | Valor |
|---|---|
| **Contrato** | `0x83F723a613a47cE2F0FB805bCA71C4AAA2F8d9EC` |
| **Etherscan** | https://sepolia.etherscan.io/address/0x83F723a613a47cE2F0FB805bCA71C4AAA2F8d9EC#code |
| **Versão** | v1.3 |
| **Rede** | Sepolia Testnet (Chain ID: 11155111) |
| **Treasury** | `0xc23dC262362C105774c0F05f7a166D3515310D03` |
| **Taxa** | 1.5% |

## Chainlink Automation

| Item | Valor |
|---|---|
| **Upkeep ID** | `30272584736006106819135222498325581770119847735504215194734786949589372446626` |
| **Dashboard** | https://automation.chain.link/sepolia |
| **LINK depositado** | 5 LINK |

## Feeds Chainlink configurados (Sepolia)

| Par | Feed |
|---|---|
| BTC/USDT | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |
| ETH/USDT | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |

## Instalação

```bash
npm install
```

## Testes (33/33 passando)

```bash
npx hardhat test
```

## Deploy Sepolia

Configure o `.env`:
```
PRIVATE_KEY=sua_chave_privada
INC_TREASURY=endereco_da_treasury
INC_OWNER=endereco_do_owner
SEPOLIA_RPC_URL=https://1rpc.io/sepolia
ETHERSCAN_KEY=sua_api_key
```

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

## Verificação no Etherscan

```bash
npx hardhat verify --network sepolia ENDERECO_CONTRATO "TREASURY" "OWNER"
```

## Registro do Chainlink Automation

```bash
npx hardhat run scripts/register-upkeep.js --network sepolia
```

## Deploy multi-chain (mainnet)

```bash
npx hardhat run scripts/deploy-all.js --network ethereum
npx hardhat run scripts/deploy-all.js --network arbitrum
npx hardhat run scripts/deploy-all.js --network polygon
npx hardhat run scripts/deploy-all.js --network bnb
npx hardhat run scripts/deploy-all.js --network optimism
npx hardhat run scripts/deploy-all.js --network avalanche
```

## Segurança

- `entryPrice` validado contra oracle Chainlink (tolerância 2%)
- Treasury usa pull-payment — nunca bloqueia o protocolo
- `emergencyResolve` com timelock de 1 dia (proposta + execução separadas)
- Circuit breaker: `pause()` / `unpause()` disponível para o owner
- ReentrancyGuard em todas as funções que movimentam ETH
- Ownable2Step — transferência de owner exige confirmação

## Redes suportadas para mainnet

| Rede | Chain ID | Moeda |
|---|---|---|
| Ethereum | 1 | ETH |
| Arbitrum | 42161 | ETH |
| Polygon | 137 | MATIC |
| BNB Chain | 56 | BNB |
| Optimism | 10 | ETH |
| Avalanche | 43114 | AVAX |
| Rootstock | 30 | RBTC |
