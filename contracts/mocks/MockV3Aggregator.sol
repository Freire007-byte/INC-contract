// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Price feed falso para testes — simula o AggregatorV3Interface da Chainlink
contract MockV3Aggregator {
    uint8   public decimals;
    int256  public latestAnswer;
    uint256 public updatedAt;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals     = _decimals;
        latestAnswer = _initialAnswer;
        updatedAt    = block.timestamp;
    }

    function updateAnswer(int256 _answer) external {
        latestAnswer = _answer;
        updatedAt    = block.timestamp;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function latestRoundData() external view returns (
        uint80  roundId,
        int256  answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80  answeredInRound
    ) {
        return (1, latestAnswer, updatedAt, updatedAt, 1);
    }
}
