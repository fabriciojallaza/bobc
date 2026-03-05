// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC165 {
  function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
  function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract BankBalanceOracleReceiver is IReceiver {
  address public immutable forwarder;

  uint256 public lastBalance;     // scaled (18)
  uint256 public lastUpdatedAt;   // block.timestamp

  event BalanceUpdated(uint256 oldBalance, uint256 newBalance, uint256 delta, uint256 updatedAt);

  error OnlyForwarder();
  error BalanceDecreased();

  constructor(address _forwarder, uint256 _initialBalance) {
    forwarder = _forwarder;
    lastBalance = _initialBalance;
    lastUpdatedAt = block.timestamp;
  }

  modifier onlyForwarder() {
    if (msg.sender != forwarder) revert OnlyForwarder();
    _;
  }

  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
  }

  // report = abi.encode(uint256 bankBalanceScaled)
  function onReport(bytes calldata /*metadata*/, bytes calldata report) external onlyForwarder {
    uint256 newBalance = abi.decode(report, (uint256));
    if (newBalance < lastBalance) revert BalanceDecreased();

    uint256 old = lastBalance;
    uint256 delta = newBalance - old;

    lastBalance = newBalance;
    lastUpdatedAt = block.timestamp;

    emit BalanceUpdated(old, newBalance, delta, block.timestamp);
  }
}