// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              INC NETWORK — Proof-of-Signal                  ║
 * ║              Smart Contract v1.3 (Chainlink Oracle)         ║
 * ║                                                              ║
 * ║  · Staking de ETH por providers e followers                 ║
 * ║  · Distribuição automática de taxas (1.5%) para a rede      ║
 * ║  · Registro imutável de sinais on-chain                     ║
 * ║  · Resolução automática via Chainlink Price Feeds           ║
 * ║  · Automação via Chainlink Automation (antigo Keepers)      ║
 * ║  · Proteção contra reentrancy, DOS e overflow               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// Chainlink: leitura de preço de mercado
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80  roundId,
        int256  answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80  answeredInRound
    );
}

// Chainlink Automation: execução automática de upkeep
interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData)
        external returns (bool upkeepNeeded, bytes memory performData);
    function performUpkeep(bytes calldata performData) external;
}

// ── BASE CONTRACTS ────────────────────────────────────────────────────────────

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _status;

    constructor() { _status = _NOT_ENTERED; }

    modifier nonReentrant() {
        require(_status != _ENTERED, "INC: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

abstract contract Ownable2Step {
    address private _owner;
    address private _pendingOwner;

    event OwnershipTransferStarted(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);

    constructor(address owner_) {
        require(owner_ != address(0), "INC: zero address");
        _owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    modifier onlyOwner() {
        require(msg.sender == _owner, "INC: not owner");
        _;
    }

    function owner() public view returns (address) { return _owner; }
    function pendingOwner() public view returns (address) { return _pendingOwner; }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "INC: zero address");
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(_owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == _pendingOwner, "INC: not pending owner");
        emit OwnershipTransferred(_owner, _pendingOwner);
        _owner = _pendingOwner;
        _pendingOwner = address(0);
    }
}

// ── CONTRATO PRINCIPAL ────────────────────────────────────────────────────────

contract INCNetwork is ReentrancyGuard, Ownable2Step, AutomationCompatibleInterface {

    // ── CONSTANTES ────────────────────────────────────────────────────────────

    uint256 public constant NETWORK_FEE_BPS            = 150;
    uint256 public constant BPS_BASE                   = 10_000;
    uint256 public constant MIN_PROVIDER_STAKE         = 0.005 ether;
    uint256 public constant MIN_FOLLOWER_STAKE         = 0.001 ether;
    uint256 public constant SIGNAL_TIMEOUT             = 7 days;
    uint256 public constant MAX_FOLLOWERS              = 500;

    /// @notice Preço considerado stale se não atualizado neste intervalo
    uint256 public constant PRICE_STALENESS_THRESHOLD  = 3600; // 1 hora

    /// @notice Owner só pode propor resolução de emergência após este prazo
    uint256 public constant ADMIN_RESOLVE_DELAY        = 3 days;

    /// @notice Timelock entre proposta e execução da resolução de emergência
    uint256 public constant EMERGENCY_TIMELOCK         = 1 days;

    /// @notice Tolerância máxima entre entryPrice informado e preço atual do oracle (2%)
    uint256 public constant ENTRY_PRICE_TOLERANCE_BPS  = 200;

    // ── ENUMS ─────────────────────────────────────────────────────────────────

    enum SignalDirection { LONG, SHORT }
    enum SignalStatus    { OPEN, WIN, LOSS, EXPIRED }

    // ── STRUCTS ───────────────────────────────────────────────────────────────

    struct Signal {
        uint256         id;
        address         provider;
        string          pair;
        SignalDirection direction;
        uint256         entryPrice;      // 8 decimais — compatível com feeds Chainlink
        uint256         targetPrice;
        uint256         stopPrice;
        uint256         providerStake;
        uint256         followersStake;
        uint256         createdAt;
        uint256         resolvedAt;
        SignalStatus    status;
        uint256         rsi;
        uint256         totalPoolAtResolution;
        address         priceFeed;       // Endereço do AggregatorV3Interface para este par
    }

    struct FollowerPosition {
        uint256 amount;
        bool    claimed;
    }

    /// @notice Proposta de resolução de emergência com timelock de 1 dia
    struct EmergencyProposal {
        bool    proposed;
        bool    won;
        uint256 proposedAt;
    }

    // ── STATE ─────────────────────────────────────────────────────────────────

    address public immutable incTreasury;

    bool public paused;

    uint256 public totalSignals;
    uint256 public totalVolumeETH;
    uint256 public totalFeesCollected;

    mapping(address => uint256) public pendingWithdrawal;
    mapping(uint256 => Signal)  public signals;
    mapping(uint256 => mapping(address => FollowerPosition)) public positions;
    mapping(uint256 => address[]) public signalFollowers;
    mapping(uint256 => uint256)   public followerCount;

    mapping(address => uint256) public providerTotalSignals;
    mapping(address => uint256) public providerWins;
    mapping(address => uint256) public providerTotalStaked;

    /// @notice Feed Chainlink registrado para cada par (ex: keccak256("BTC/USDT"))
    mapping(bytes32 => address) public priceFeedForPair;

    /// @notice Propostas de resolução de emergência pendentes por sinal
    mapping(uint256 => EmergencyProposal) public emergencyProposals;

    /// @dev Lista de sinais abertos — usada pelo Chainlink Automation
    uint256[] private _openSignalIds;
    mapping(uint256 => uint256) private _openSignalIndex; // signalId => índice em _openSignalIds

    // ── EVENTS ────────────────────────────────────────────────────────────────

    event SignalCreated(
        uint256 indexed signalId,
        address indexed provider,
        string  pair,
        SignalDirection direction,
        uint256 entryPrice,
        uint256 targetPrice,
        uint256 stopPrice,
        uint256 stake,
        uint256 rsi,
        uint256 timestamp
    );
    event SignalFollowed(uint256 indexed signalId, address indexed follower, uint256 amount, uint256 networkFee);
    event SignalResolved(uint256 indexed signalId, SignalStatus status, uint256 resolvedAt);
    event RewardClaimed(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event FeeCollected(uint256 indexed signalId, uint256 amount, address treasury);
    event PriceFeedSet(string pair, address feed);
    event OracleResolved(uint256 indexed signalId, uint256 price, bool won);
    event EmergencyResolutionProposed(uint256 indexed signalId, bool won, uint256 executeAfter);
    event EmergencyResolved(uint256 indexed signalId, bool won);
    event Paused(address account);
    event Unpaused(address account);

    // ── CONSTRUCTOR ───────────────────────────────────────────────────────────

    /// @param _treasury Carteira que recebe as taxas (imutável, separada do owner)
    /// @param _owner    Carteira que pode registrar feeds e resolver emergências
    constructor(address _treasury, address _owner)
        Ownable2Step(_owner)
    {
        require(_treasury != address(0), "INC: treasury zero address");
        require(_treasury != _owner,     "INC: treasury deve ser diferente do owner");
        incTreasury = _treasury;
    }

    // ── PAUSA ─────────────────────────────────────────────────────────────────

    modifier whenNotPaused() {
        require(!paused, "INC: contrato pausado");
        _;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ── CONFIGURAÇÃO DE FEEDS ─────────────────────────────────────────────────

    /**
     * @notice Registra ou atualiza o Chainlink Price Feed para um par de moedas.
     * @dev    Os feeds devem retornar preços com 8 decimais (padrão Chainlink para crypto/USD).
     *         Feeds com outros decimais são normalizados automaticamente em _getPrice().
     *
     *         Mainnet (Ethereum):
     *           BTC/USD  0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b
     *           ETH/USD  0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
     *           SOL/USD  0x4ffC43a60e009B551865A93d232E33Fce9f01507
     *           BNB/USD  0x14e613AC84a31f709eadbEF2dD6360A0f0FC3Af6
     *
     *         Sepolia (testnet):
     *           BTC/USD  0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43
     *           ETH/USD  0x694AA1769357215DE4FAC081bf1f309aDC325306
     *
     * @param pair Par de moedas exatamente como será usado em createSignal (ex: "BTC/USDT")
     * @param feed Endereço do contrato AggregatorV3Interface na rede alvo
     */
    function setPriceFeed(string calldata pair, address feed) external onlyOwner {
        require(feed != address(0),           "INC: feed zero address");
        require(bytes(pair).length > 0,       "INC: par invalido");
        priceFeedForPair[keccak256(bytes(pair))] = feed;
        emit PriceFeedSet(pair, feed);
    }

    // ── FUNÇÕES PRINCIPAIS ────────────────────────────────────────────────────

    function createSignal(
        string  calldata pair,
        SignalDirection  direction,
        uint256 entryPrice,
        uint256 targetPrice,
        uint256 stopPrice,
        uint256 rsi
    ) external payable nonReentrant whenNotPaused returns (uint256 signalId) {
        require(msg.value >= MIN_PROVIDER_STAKE, "INC: stake abaixo do minimo");
        require(entryPrice  > 0,                 "INC: entry price invalido");
        require(targetPrice > 0,                 "INC: target price invalido");
        require(stopPrice   > 0,                 "INC: stop price invalido");
        require(rsi <= 100,                       "INC: RSI invalido");
        require(bytes(pair).length > 0 && bytes(pair).length <= 20, "INC: par invalido");

        address feed = priceFeedForPair[keccak256(bytes(pair))];
        require(feed != address(0), "INC: par sem oracle configurado");

        // Valida que entryPrice está dentro de 2% do preço atual do oracle,
        // impedindo que o provider manipule o entry para garantir WIN imediato.
        uint256 oraclePrice = _getPrice(feed);
        uint256 tolerance   = (oraclePrice * ENTRY_PRICE_TOLERANCE_BPS) / BPS_BASE;
        require(
            entryPrice >= oraclePrice - tolerance &&
            entryPrice <= oraclePrice + tolerance,
            "INC: entry price fora do preco de mercado"
        );

        if (direction == SignalDirection.LONG) {
            require(targetPrice > entryPrice, "INC: TP deve ser maior que entry em LONG");
            require(stopPrice   < entryPrice, "INC: SL deve ser menor que entry em LONG");
        } else {
            require(targetPrice < entryPrice, "INC: TP deve ser menor que entry em SHORT");
            require(stopPrice   > entryPrice, "INC: SL deve ser maior que entry em SHORT");
        }

        uint256 fee      = (msg.value * NETWORK_FEE_BPS) / BPS_BASE;
        uint256 stakeNet = msg.value - fee;

        signalId = ++totalSignals;
        signals[signalId] = Signal({
            id:                    signalId,
            provider:              msg.sender,
            pair:                  pair,
            direction:             direction,
            entryPrice:            entryPrice,
            targetPrice:           targetPrice,
            stopPrice:             stopPrice,
            providerStake:         stakeNet,
            followersStake:        0,
            createdAt:             block.timestamp,
            resolvedAt:            0,
            status:                SignalStatus.OPEN,
            rsi:                   rsi,
            totalPoolAtResolution: 0,
            priceFeed:             feed
        });

        providerTotalSignals[msg.sender]++;
        providerTotalStaked[msg.sender] += stakeNet;
        totalFeesCollected += fee;
        totalVolumeETH     += msg.value;

        // Registra na lista de sinais abertos para o Chainlink Automation
        _openSignalIndex[signalId] = _openSignalIds.length;
        _openSignalIds.push(signalId);

        // Pull-payment: treasury retira via withdraw() — evita falha se treasury não aceita ETH
        pendingWithdrawal[incTreasury] += fee;

        emit SignalCreated(signalId, msg.sender, pair, direction, entryPrice, targetPrice, stopPrice, stakeNet, rsi, block.timestamp);
        emit FeeCollected(signalId, fee, incTreasury);
    }

    function followSignal(uint256 signalId) external payable nonReentrant whenNotPaused {
        Signal storage sig = signals[signalId];
        require(sig.id != 0,                     "INC: sinal nao existe");
        require(sig.status == SignalStatus.OPEN,  "INC: sinal nao esta aberto");
        require(msg.value >= MIN_FOLLOWER_STAKE,  "INC: stake abaixo do minimo");
        require(msg.sender != sig.provider,       "INC: provider nao pode ser follower");
        require(block.timestamp < sig.createdAt + SIGNAL_TIMEOUT, "INC: sinal expirado");
        require(positions[signalId][msg.sender].amount == 0, "INC: ja esta seguindo");
        require(followerCount[signalId] < MAX_FOLLOWERS,     "INC: limite de followers atingido");

        uint256 fee      = (msg.value * NETWORK_FEE_BPS) / BPS_BASE;
        uint256 stakeNet = msg.value - fee;

        positions[signalId][msg.sender] = FollowerPosition({ amount: stakeNet, claimed: false });
        signalFollowers[signalId].push(msg.sender);
        followerCount[signalId]++;

        sig.followersStake += stakeNet;
        totalVolumeETH     += msg.value;
        totalFeesCollected += fee;

        // Pull-payment: treasury retira via withdraw() — evita falha se treasury não aceita ETH
        pendingWithdrawal[incTreasury] += fee;

        emit SignalFollowed(signalId, msg.sender, stakeNet, fee);
        emit FeeCollected(signalId, fee, incTreasury);
    }

    // ── RESOLUÇÃO POR ORACLE ──────────────────────────────────────────────────

    /**
     * @notice Qualquer pessoa pode chamar esta função para resolver um sinal
     *         quando o preço Chainlink atingiu o TP ou SL.
     *
     * @dev    Fluxo:
     *         1. Lê o preço atual do Chainlink Price Feed registrado para o par
     *         2. Verifica se TP (WIN) ou SL (LOSS) foi atingido
     *         3. Resolve o sinal sem depender da aprovação do owner
     *
     *         Esta é a função principal de resolução — o owner não tem vantagem
     *         sobre qualquer outro participante para chamar isso.
     */
    function resolveByOracle(uint256 signalId) public nonReentrant {
        Signal storage sig = signals[signalId];
        require(sig.id != 0,                    "INC: sinal nao existe");
        require(sig.status == SignalStatus.OPEN, "INC: sinal ja resolvido");

        uint256 currentPrice = _getPrice(sig.priceFeed);

        bool tpHit;
        bool slHit;

        if (sig.direction == SignalDirection.LONG) {
            tpHit = currentPrice >= sig.targetPrice;
            slHit = currentPrice <= sig.stopPrice;
        } else {
            tpHit = currentPrice <= sig.targetPrice;
            slHit = currentPrice >= sig.stopPrice;
        }

        require(tpHit || slHit, "INC: TP/SL ainda nao atingido");

        _resolve(signalId, tpHit);

        emit OracleResolved(signalId, currentPrice, tpHit);
    }

    /**
     * @notice Propõe resolução de emergência — disponível após ADMIN_RESOLVE_DELAY (3 dias).
     * @dev    Inicia um timelock de 1 dia antes da execução, dando visibilidade
     *         aos participantes. O owner não pode resolver instantaneamente.
     */
    function proposeEmergencyResolve(uint256 signalId, bool won) external onlyOwner {
        Signal storage sig = signals[signalId];
        require(sig.id != 0,                    "INC: sinal nao existe");
        require(sig.status == SignalStatus.OPEN, "INC: sinal ja resolvido");
        require(
            block.timestamp >= sig.createdAt + ADMIN_RESOLVE_DELAY,
            "INC: aguarde 3 dias para proposta de emergencia"
        );
        require(!emergencyProposals[signalId].proposed, "INC: proposta ja existe");

        emergencyProposals[signalId] = EmergencyProposal({
            proposed:   true,
            won:        won,
            proposedAt: block.timestamp
        });

        emit EmergencyResolutionProposed(signalId, won, block.timestamp + EMERGENCY_TIMELOCK);
    }

    /**
     * @notice Executa a resolução de emergência após o timelock de 1 dia.
     * @dev    Separado de proposeEmergencyResolve para garantir período de contestação.
     */
    function executeEmergencyResolve(uint256 signalId) external onlyOwner nonReentrant {
        EmergencyProposal storage proposal = emergencyProposals[signalId];
        require(proposal.proposed, "INC: sem proposta pendente");
        require(
            block.timestamp >= proposal.proposedAt + EMERGENCY_TIMELOCK,
            "INC: timelock de 1 dia nao expirou"
        );

        Signal storage sig = signals[signalId];
        require(sig.id != 0,                    "INC: sinal nao existe");
        require(sig.status == SignalStatus.OPEN, "INC: sinal ja resolvido");

        bool won = proposal.won;
        delete emergencyProposals[signalId];

        _resolve(signalId, won);

        emit EmergencyResolved(signalId, won);
    }

    /**
     * @notice Cancela uma proposta de resolução de emergência pendente.
     */
    function cancelEmergencyResolve(uint256 signalId) external onlyOwner {
        require(emergencyProposals[signalId].proposed, "INC: sem proposta pendente");
        delete emergencyProposals[signalId];
    }

    /**
     * @notice Expira sinais que ultrapassaram 7 dias sem resolução.
     *         Qualquer pessoa pode chamar — devolve stakes para todos.
     */
    function expireSignal(uint256 signalId) public nonReentrant {
        Signal storage sig = signals[signalId];
        require(sig.id != 0,                    "INC: sinal nao existe");
        require(sig.status == SignalStatus.OPEN, "INC: sinal ja resolvido");
        require(block.timestamp >= sig.createdAt + SIGNAL_TIMEOUT, "INC: prazo nao atingido");

        sig.status     = SignalStatus.EXPIRED;
        sig.resolvedAt = block.timestamp;

        pendingWithdrawal[sig.provider] += sig.providerStake;

        _removeFromOpen(signalId);

        emit SignalResolved(signalId, SignalStatus.EXPIRED, block.timestamp);
    }

    // ── CHAINLINK AUTOMATION ──────────────────────────────────────────────────

    /**
     * @notice Chainlink Automation chama esta função off-chain para verificar
     *         se há sinais que precisam ser resolvidos ou expirados.
     *
     * @param  checkData  ABI-encoded: (uint256 startIdx, uint256 batchSize)
     *                    Permite varrer a lista em lotes para evitar estouro de gas.
     *                    Se vazio, usa startIdx=0 e batchSize=20.
     *
     * @return upkeepNeeded  true se há trabalho a fazer
     * @return performData   ABI-encoded: (uint8 action, uint256 signalId)
     *                       action 0 = resolveByOracle, action 1 = expireSignal
     */
    function checkUpkeep(bytes calldata checkData)
        external
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        uint256 startIdx  = 0;
        uint256 batchSize = 20;

        if (checkData.length >= 64) {
            (startIdx, batchSize) = abi.decode(checkData, (uint256, uint256));
        }

        uint256 len = _openSignalIds.length;
        if (startIdx >= len) return (false, "");

        uint256 end = startIdx + batchSize;
        if (end > len) end = len;

        for (uint256 i = startIdx; i < end; i++) {
            uint256 signalId  = _openSignalIds[i];
            Signal storage sig = signals[signalId];

            // Verifica expiração primeiro
            if (block.timestamp >= sig.createdAt + SIGNAL_TIMEOUT) {
                return (true, abi.encode(uint8(1), signalId));
            }

            // Verifica condições de preço via oracle
            (bool ok, uint256 price) = _tryGetPrice(sig.priceFeed);
            if (ok) {
                bool tpHit = sig.direction == SignalDirection.LONG
                    ? price >= sig.targetPrice
                    : price <= sig.targetPrice;
                bool slHit = sig.direction == SignalDirection.LONG
                    ? price <= sig.stopPrice
                    : price >= sig.stopPrice;

                if (tpHit || slHit) {
                    return (true, abi.encode(uint8(0), signalId));
                }
            }
        }

        return (false, "");
    }

    /**
     * @notice Chainlink Automation executa o upkeep identificado em checkUpkeep.
     */
    function performUpkeep(bytes calldata performData) external override {
        (uint8 action, uint256 signalId) = abi.decode(performData, (uint8, uint256));

        if (action == 1) {
            expireSignal(signalId);
        } else {
            resolveByOracle(signalId);
        }
    }

    // ── CLAIM / SAQUE ─────────────────────────────────────────────────────────

    /// @notice Follower resgata recompensa proporcional após sinal LOSS
    function claimReward(uint256 signalId) external nonReentrant {
        Signal storage sig = signals[signalId];
        require(sig.status == SignalStatus.LOSS, "INC: sinal nao resolvido como LOSS");
        require(sig.followersStake > 0,          "INC: sem followers neste sinal");

        FollowerPosition storage pos = positions[signalId][msg.sender];
        require(pos.amount > 0, "INC: sem posicao neste sinal");
        require(!pos.claimed,   "INC: recompensa ja resgatada");

        pos.claimed = true;
        uint256 reward = (pos.amount * sig.totalPoolAtResolution) / sig.followersStake;
        pendingWithdrawal[msg.sender] += reward;

        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice Follower recupera stake após sinal EXPIRED
    function claimExpired(uint256 signalId) external nonReentrant {
        Signal storage sig = signals[signalId];
        require(sig.status == SignalStatus.EXPIRED, "INC: sinal nao expirou");

        FollowerPosition storage pos = positions[signalId][msg.sender];
        require(pos.amount > 0, "INC: sem posicao neste sinal");
        require(!pos.claimed,   "INC: stake ja recuperado");

        pos.claimed = true;
        pendingWithdrawal[msg.sender] += pos.amount;

        emit RewardClaimed(msg.sender, pos.amount);
    }

    /// @notice Saca todo o saldo disponível do chamador
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawal[msg.sender];
        require(amount > 0, "INC: sem saldo para sacar");
        pendingWithdrawal[msg.sender] = 0;
        _sendETH(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ── VIEWS ─────────────────────────────────────────────────────────────────

    function getSignal(uint256 signalId) external view returns (Signal memory) {
        return signals[signalId];
    }

    function getPosition(uint256 signalId, address follower) external view returns (FollowerPosition memory) {
        return positions[signalId][follower];
    }

    /// @notice Retorna taxa de acerto do provider em BPS (0–10000). Divida por 100 para percentual.
    function getWinRate(address provider) external view returns (uint256) {
        uint256 total = providerTotalSignals[provider];
        if (total == 0) return 0;
        return (providerWins[provider] * BPS_BASE) / total;
    }

    function getFollowers(uint256 signalId) external view returns (address[] memory) {
        return signalFollowers[signalId];
    }

    function openSignalsCount() external view returns (uint256) {
        return _openSignalIds.length;
    }

    /// @notice Retorna o preço atual do Chainlink para um par registrado
    function getCurrentPrice(string calldata pair) external view returns (uint256) {
        address feed = priceFeedForPair[keccak256(bytes(pair))];
        require(feed != address(0), "INC: par sem oracle configurado");
        return _getPrice(feed);
    }

    function networkStats() external view returns (
        uint256 _totalSignals,
        uint256 _totalVolumeETH,
        uint256 _totalFeesCollected,
        uint256 _contractBalance,
        uint256 _openSignals
    ) {
        return (totalSignals, totalVolumeETH, totalFeesCollected, address(this).balance, _openSignalIds.length);
    }

    // ── INTERNAL ──────────────────────────────────────────────────────────────

    /// @dev Resolve um sinal — centraliza a lógica usada por resolveByOracle e executeEmergencyResolve
    function _resolve(uint256 signalId, bool won) internal {
        Signal storage sig = signals[signalId];

        sig.status                = won ? SignalStatus.WIN : SignalStatus.LOSS;
        sig.resolvedAt            = block.timestamp;
        sig.totalPoolAtResolution = sig.providerStake + sig.followersStake;

        if (won) {
            pendingWithdrawal[sig.provider] += sig.totalPoolAtResolution;
            providerWins[sig.provider]++;
        }
        // LOSS: followers chamam claimReward() individualmente — sem loop

        _removeFromOpen(signalId);

        emit SignalResolved(signalId, sig.status, block.timestamp);
    }

    /// @dev Remove sinal da lista de abertos em O(1) via swap-and-pop
    function _removeFromOpen(uint256 signalId) internal {
        uint256 idx    = _openSignalIndex[signalId];
        uint256 lastId = _openSignalIds[_openSignalIds.length - 1];

        _openSignalIds[idx]      = lastId;
        _openSignalIndex[lastId] = idx;
        _openSignalIds.pop();

        delete _openSignalIndex[signalId];
    }

    /**
     * @dev Lê e normaliza o preço do Chainlink para 8 decimais.
     *      Reverte se o preço for inválido ou estiver desatualizado.
     */
    function _getPrice(address feed) internal view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = AggregatorV3Interface(feed).latestRoundData();
        require(answer > 0, "INC: preco invalido do oracle");
        require(
            block.timestamp - updatedAt <= PRICE_STALENESS_THRESHOLD,
            "INC: preco desatualizado"
        );

        uint8 dec = AggregatorV3Interface(feed).decimals();
        uint256 price = uint256(answer);

        if (dec < 8) return price * (10 ** uint256(8 - dec));
        if (dec > 8) return price / (10 ** uint256(dec - 8));
        return price;
    }

    /// @dev Versão segura de _getPrice para checkUpkeep — nunca reverte
    function _tryGetPrice(address feed) internal view returns (bool ok, uint256 price) {
        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (answer <= 0) return (false, 0);
            if (block.timestamp - updatedAt > PRICE_STALENESS_THRESHOLD) return (false, 0);

            uint8 dec = AggregatorV3Interface(feed).decimals();
            uint256 p = uint256(answer);
            if (dec < 8) p = p * (10 ** uint256(8 - dec));
            else if (dec > 8) p = p / (10 ** uint256(dec - 8));

            return (true, p);
        } catch {
            return (false, 0);
        }
    }

    function _sendETH(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "INC: ETH transfer failed");
    }

    // receive() removido — ETH só entra via createSignal() e followSignal()
}
