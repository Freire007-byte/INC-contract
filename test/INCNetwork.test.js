// test/INCNetwork.test.js
const { expect }        = require("chai");
const { ethers }        = require("hardhat");

describe("INCNetwork — Testes Completos com Oracle", function () {
  let contract, mockFeed, owner, treasury, provider, follower1, follower2;

  const MIN_STAKE      = ethers.parseEther("0.005");
  const PROVIDER_STAKE = ethers.parseEther("0.1");
  const FOLLOWER_STAKE = ethers.parseEther("0.05");

  // Preços com 8 decimais (padrão Chainlink)
  const ENTRY_BTC  = 6500000000000n; // $65.000
  const TP_BTC     = 6800000000000n; // $68.000 (LONG TP)
  const SL_BTC     = 6200000000000n; // $62.000 (LONG SL)

  async function deployAll(initialPrice = ENTRY_BTC) {
    [owner, treasury, provider, follower1, follower2] = await ethers.getSigners();

    // Mock do Chainlink Price Feed
    const MockFactory = await ethers.getContractFactory("MockV3Aggregator");
    mockFeed = await MockFactory.deploy(8, initialPrice);
    await mockFeed.waitForDeployment();

    // Contrato principal
    const Factory = await ethers.getContractFactory("INCNetwork");
    contract = await Factory.deploy(treasury.address, owner.address);
    await contract.waitForDeployment();

    // Registra o feed mock para "BTC/USDT"
    await contract.connect(owner).setPriceFeed("BTC/USDT", await mockFeed.getAddress());
  }

  async function createBtcSignal(direction = 0) {
    const tp = direction === 0 ? TP_BTC : SL_BTC;
    const sl = direction === 0 ? SL_BTC : TP_BTC;
    await contract.connect(provider).createSignal(
      "BTC/USDT", direction, ENTRY_BTC, tp, sl, 28,
      { value: PROVIDER_STAKE }
    );
  }

  // ── DEPLOY ────────────────────────────────────────────────────────────────
  describe("Deploy", () => {
    beforeEach(() => deployAll());

    it("Treasury e owner são distintos", async () => {
      expect(await contract.incTreasury()).to.equal(treasury.address);
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.incTreasury()).to.not.equal(await contract.owner());
    });

    it("Rejeita deploy com treasury igual ao owner", async () => {
      const F = await ethers.getContractFactory("INCNetwork");
      await expect(F.deploy(owner.address, owner.address))
        .to.be.revertedWith("INC: treasury deve ser diferente do owner");
    });
  });

  // ── FEED CHAINLINK ────────────────────────────────────────────────────────
  describe("setPriceFeed()", () => {
    beforeEach(() => deployAll());

    it("Owner registra feed corretamente", async () => {
      const feedAddr = await mockFeed.getAddress();
      expect(await contract.priceFeedForPair(ethers.keccak256(ethers.toUtf8Bytes("BTC/USDT"))))
        .to.equal(feedAddr);
    });

    it("Não-owner não pode registrar feed", async () => {
      await expect(
        contract.connect(provider).setPriceFeed("ETH/USDT", await mockFeed.getAddress())
      ).to.be.revertedWith("INC: not owner");
    });

    it("createSignal falha se par não tem feed", async () => {
      await expect(
        contract.connect(provider).createSignal(
          "XRP/USDT", 0, ENTRY_BTC, TP_BTC, SL_BTC, 28, { value: PROVIDER_STAKE }
        )
      ).to.be.revertedWith("INC: par sem oracle configurado");
    });

    it("getCurrentPrice retorna preço normalizado do feed", async () => {
      const price = await contract.getCurrentPrice("BTC/USDT");
      expect(price).to.equal(ENTRY_BTC);
    });
  });

  // ── CRIAR SINAL ───────────────────────────────────────────────────────────
  describe("createSignal()", () => {
    beforeEach(() => deployAll());

    it("Cria sinal LONG e adiciona à lista de abertos", async () => {
      await createBtcSignal(0);
      expect(await contract.totalSignals()).to.equal(1);
      expect(await contract.openSignalsCount()).to.equal(1);
      const sig = await contract.getSignal(1);
      expect(sig.status).to.equal(0); // OPEN
    });

    it("Cobra taxa de 1.5% para a treasury", async () => {
      await createBtcSignal();
      const fee = PROVIDER_STAKE * 150n / 10000n;
      // Taxa acumulada via pull-payment em pendingWithdrawal[treasury]
      expect(await contract.pendingWithdrawal(treasury.address)).to.equal(fee);
    });
  });

  // ── RESOLUÇÃO POR ORACLE ──────────────────────────────────────────────────
  describe("resolveByOracle()", () => {
    beforeEach(async () => {
      await deployAll(ENTRY_BTC); // preço começa em $65.000
      await createBtcSignal(0);   // LONG: TP=$68k, SL=$62k
      await contract.connect(follower1).followSignal(1, { value: FOLLOWER_STAKE });
    });

    it("WIN: qualquer pessoa resolve quando preço atinge TP", async () => {
      await mockFeed.updateAnswer(TP_BTC); // $68.000 — atinge TP
      await contract.connect(follower2).resolveByOracle(1); // follower2 chama (não é o owner)
      const sig = await contract.getSignal(1);
      expect(sig.status).to.equal(1); // WIN
    });

    it("WIN: provider recebe o pool completo via pendingWithdrawal", async () => {
      await mockFeed.updateAnswer(TP_BTC);
      await contract.resolveByOracle(1);
      expect(await contract.pendingWithdrawal(provider.address)).to.be.gt(0);
    });

    it("LOSS: resolve quando preço atinge SL", async () => {
      await mockFeed.updateAnswer(SL_BTC); // $62.000 — atinge SL
      await contract.resolveByOracle(1);
      const sig = await contract.getSignal(1);
      expect(sig.status).to.equal(2); // LOSS
    });

    it("LOSS: follower resgata recompensa após resolução", async () => {
      await mockFeed.updateAnswer(SL_BTC);
      await contract.resolveByOracle(1);
      await contract.connect(follower1).claimReward(1);
      expect(await contract.pendingWithdrawal(follower1.address)).to.be.gt(0);
    });

    it("Reverte se TP/SL ainda não foi atingido", async () => {
      // Preço continua em $65.000 — entre entry e TP
      await expect(contract.resolveByOracle(1))
        .to.be.revertedWith("INC: TP/SL ainda nao atingido");
    });

    it("Reverte se preço estiver stale (>1 hora sem atualização)", async () => {
      await mockFeed.updateAnswer(TP_BTC);
      // Simula feed desatualizado há mais de 1 hora
      await mockFeed.setUpdatedAt(Math.floor(Date.now() / 1000) - 7200);
      await expect(contract.resolveByOracle(1))
        .to.be.revertedWith("INC: preco desatualizado");
    });

    it("Remove sinal da lista de abertos após resolução", async () => {
      await mockFeed.updateAnswer(TP_BTC);
      await contract.resolveByOracle(1);
      expect(await contract.openSignalsCount()).to.equal(0);
    });

    it("Normaliza decimais: feed com 6 decimais → 8 decimais internamente", async () => {
      const MockFactory = await ethers.getContractFactory("MockV3Aggregator");
      // Feed com 6 decimais — preço $3.200 = 3200000000 (6 dec) → normalizado 320000000000 (8 dec)
      const feed6dec = await MockFactory.deploy(6, 3200000000n);
      await contract.connect(owner).setPriceFeed("ETH/USDT", await feed6dec.getAddress());

      // entryPrice deve estar dentro de 2% do oracle normalizado ($3.200 = 320000000000)
      await contract.connect(provider).createSignal(
        "ETH/USDT", 0,
        320000000000n, // $3.200 entry — igual ao oracle
        350000000000n, // $3.500 TP
        290000000000n, // $2.900 SL
        50,
        { value: PROVIDER_STAKE }
      );
      // $3.200 está entre SL e TP — não deve resolver
      await expect(contract.resolveByOracle(2))
        .to.be.revertedWith("INC: TP/SL ainda nao atingido");
    });
  });

  // ── SINAL SHORT ───────────────────────────────────────────────────────────
  describe("resolveByOracle() — SHORT", () => {
    const ENTRY = 6500000000000n;
    const TP    = 6200000000000n; // SHORT: TP é menor que entry
    const SL    = 6800000000000n; // SHORT: SL é maior que entry

    beforeEach(async () => {
      await deployAll(ENTRY);
      await contract.connect(provider).createSignal(
        "BTC/USDT", 1, ENTRY, TP, SL, 72, { value: PROVIDER_STAKE }
      );
      await contract.connect(follower1).followSignal(1, { value: FOLLOWER_STAKE });
    });

    it("SHORT WIN: resolve quando preço cai até TP", async () => {
      await mockFeed.updateAnswer(TP); // $62.000
      await contract.resolveByOracle(1);
      expect((await contract.getSignal(1)).status).to.equal(1); // WIN
    });

    it("SHORT LOSS: resolve quando preço sobe até SL", async () => {
      await mockFeed.updateAnswer(SL); // $68.000
      await contract.resolveByOracle(1);
      expect((await contract.getSignal(1)).status).to.equal(2); // LOSS
    });
  });

  // ── EMERGENCY RESOLVE ─────────────────────────────────────────────────────
  describe("emergencyResolve()", () => {
    beforeEach(async () => {
      await deployAll();
      await createBtcSignal();
    });

    it("Bloqueia proposta de emergência antes de 3 dias", async () => {
      await expect(contract.connect(owner).proposeEmergencyResolve(1, true))
        .to.be.revertedWith("INC: aguarde 3 dias para proposta de emergencia");
    });

    it("Permite resolução de emergência após 3 dias + 1 dia de timelock", async () => {
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await contract.connect(owner).proposeEmergencyResolve(1, true);

      await ethers.provider.send("evm_increaseTime", [1 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await contract.connect(owner).executeEmergencyResolve(1);
      expect((await contract.getSignal(1)).status).to.equal(1); // WIN
    });

    it("Não-owner não pode propor resolução de emergência", async () => {
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await expect(contract.connect(follower1).proposeEmergencyResolve(1, true))
        .to.be.revertedWith("INC: not owner");
    });
  });

  // ── CHAINLINK AUTOMATION ──────────────────────────────────────────────────
  describe("checkUpkeep() + performUpkeep()", () => {
    beforeEach(async () => {
      await deployAll(ENTRY_BTC);
      await createBtcSignal(0); // signalId=1
    });

    it("checkUpkeep retorna false quando preço está entre TP e SL", async () => {
      const [needed] = await contract.checkUpkeep.staticCall("0x");
      expect(needed).to.equal(false);
    });

    it("checkUpkeep retorna true quando TP é atingido", async () => {
      await mockFeed.updateAnswer(TP_BTC);
      const [needed, performData] = await contract.checkUpkeep.staticCall("0x");
      expect(needed).to.equal(true);
      const [action, signalId] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint8", "uint256"], performData
      );
      expect(action).to.equal(0);   // resolveByOracle
      expect(signalId).to.equal(1);
    });

    it("checkUpkeep detecta sinal expirado", async () => {
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      const [needed, performData] = await contract.checkUpkeep.staticCall("0x");
      expect(needed).to.equal(true);
      const [action] = ethers.AbiCoder.defaultAbiCoder().decode(["uint8","uint256"], performData);
      expect(action).to.equal(1); // expireSignal
    });

    it("performUpkeep resolve sinal quando TP atingido", async () => {
      await mockFeed.updateAnswer(TP_BTC);
      const [, performData] = await contract.checkUpkeep.staticCall("0x");
      await contract.performUpkeep(performData);
      expect((await contract.getSignal(1)).status).to.equal(1); // WIN
    });

    it("performUpkeep expira sinal após timeout", async () => {
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      const [, performData] = await contract.checkUpkeep.staticCall("0x");
      await contract.performUpkeep(performData);
      expect((await contract.getSignal(1)).status).to.equal(3); // EXPIRED
    });

    it("checkUpkeep respeita batchSize via checkData", async () => {
      // Cria 2 sinais, mas varre apenas 1 (startIdx=1, batchSize=1)
      await createBtcSignal(0); // signalId=2
      await mockFeed.updateAnswer(TP_BTC);
      const checkData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256"], [1, 1]);
      const [needed, performData] = await contract.checkUpkeep.staticCall(checkData);
      expect(needed).to.equal(true);
      const [, signalId] = ethers.AbiCoder.defaultAbiCoder().decode(["uint8","uint256"], performData);
      expect(signalId).to.equal(2); // varreu a partir do índice 1
    });
  });

  // ── CLAIM + SAQUE ─────────────────────────────────────────────────────────
  describe("claimReward() + withdraw()", () => {
    beforeEach(async () => {
      await deployAll();
      await createBtcSignal(0);
      await contract.connect(follower1).followSignal(1, { value: FOLLOWER_STAKE });
      await contract.connect(follower2).followSignal(1, { value: FOLLOWER_STAKE });
    });

    it("Follower resgata recompensa após LOSS e saca", async () => {
      await mockFeed.updateAnswer(SL_BTC);
      await contract.resolveByOracle(1);
      await contract.connect(follower1).claimReward(1);

      const before = await ethers.provider.getBalance(follower1.address);
      await contract.connect(follower1).withdraw();
      const after = await ethers.provider.getBalance(follower1.address);
      expect(after).to.be.gt(before);
    });

    it("Dois followers com stake igual recebem recompensas iguais", async () => {
      await mockFeed.updateAnswer(SL_BTC);
      await contract.resolveByOracle(1);
      await contract.connect(follower1).claimReward(1);
      await contract.connect(follower2).claimReward(1);
      expect(await contract.pendingWithdrawal(follower1.address))
        .to.equal(await contract.pendingWithdrawal(follower2.address));
    });

    it("Não pode reivindicar duas vezes", async () => {
      await mockFeed.updateAnswer(SL_BTC);
      await contract.resolveByOracle(1);
      await contract.connect(follower1).claimReward(1);
      await expect(contract.connect(follower1).claimReward(1))
        .to.be.revertedWith("INC: recompensa ja resgatada");
    });
  });

  // ── OWNERSHIP EM DOIS PASSOS ──────────────────────────────────────────────
  describe("Ownable2Step", () => {
    beforeEach(() => deployAll());

    it("Transferência exige aceitação do novo owner", async () => {
      await contract.connect(owner).transferOwnership(follower1.address);
      expect(await contract.owner()).to.equal(owner.address); // ainda não mudou
      await contract.connect(follower1).acceptOwnership();
      expect(await contract.owner()).to.equal(follower1.address);
    });

    it("Terceiro não pode aceitar ownership", async () => {
      await contract.connect(owner).transferOwnership(follower1.address);
      await expect(contract.connect(follower2).acceptOwnership())
        .to.be.revertedWith("INC: not pending owner");
    });
  });

  // ── RECUSA ETH DIRETO ────────────────────────────────────────────────────
  describe("Sem receive()", () => {
    beforeEach(() => deployAll());

    it("Rejeita ETH enviado diretamente ao contrato", async () => {
      await expect(
        owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("1") })
      ).to.be.reverted;
    });
  });
});
