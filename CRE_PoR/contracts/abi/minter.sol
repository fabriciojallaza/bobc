// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface IOracle {
  function lastBalance() external view returns (uint256);
}

interface IMintableERC20 {
  function mint(address to, uint256 amount) external;
}

contract MintController is AccessControl, Pausable {
  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
  bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

  IOracle public immutable oracle;
  IMintableERC20 public immutable token;

  // Balance del oracle ya “consumido” para mintear órdenes
  uint256 public processedBalance;

  // Safety params
  uint256 public maxDeltaPerProcess;     // cap: si el delta es gigante, revert
  uint256 public minOrderAmount;         // anti-spam
  uint256 public maxOrdersPerProcess;    // evita out-of-gas

  enum Status { Pending, Processed, Cancelled, Expired }

  struct Order {
    address recipient;
    uint256 amount;      // scaled (18)
    uint256 createdAt;
    uint256 expiresAt;   // 0 = no expira
    Status status;
  }

  uint256 public nextOrderId;
  uint256 public head; // FIFO pointer
  mapping(uint256 => Order) public orders;

  event OrderCreated(uint256 indexed orderId, address indexed recipient, uint256 amount, uint256 expiresAt);
  event OrderCancelled(uint256 indexed orderId, string reason);
  event OrderProcessed(uint256 indexed orderId, address indexed recipient, uint256 amount);
  event ProcessedUpTo(uint256 oldProcessedBalance, uint256 newProcessedBalance, uint256 consumedDelta, uint256 ordersProcessed);
  event ParamsUpdated(uint256 maxDeltaPerProcess, uint256 minOrderAmount, uint256 maxOrdersPerProcess);

  error OracleDecreased();
  error DeltaTooBig(uint256 delta, uint256 cap);
  error BadRecipient();
  error AmountTooSmall();
  error BadExpiry();
  error NotPending();

  constructor(
    address _oracle,
    address _token,
    address admin,
    uint256 _initialProcessedBalance
  ) {
    oracle = IOracle(_oracle);
    token = IMintableERC20(_token);
    processedBalance = _initialProcessedBalance;

    _grantRole(DEFAULT_ADMIN_ROLE, admin);
    _grantRole(ADMIN_ROLE, admin);
    _grantRole(OPERATOR_ROLE, admin);

    // Defaults (puedes cambiarlos luego con setParams)
    maxDeltaPerProcess = 10_000_000e18;
    minOrderAmount = 1e18;
    maxOrdersPerProcess = 20;

    emit ParamsUpdated(maxDeltaPerProcess, minOrderAmount, maxOrdersPerProcess);
  }

  function setParams(uint256 _maxDelta, uint256 _minOrder, uint256 _maxOrders) external onlyRole(ADMIN_ROLE) {
    maxDeltaPerProcess = _maxDelta;
    minOrderAmount = _minOrder;
    maxOrdersPerProcess = _maxOrders;
    emit ParamsUpdated(_maxDelta, _minOrder, _maxOrders);
  }

  function pauseMinting() external onlyRole(ADMIN_ROLE) { _pause(); }
  function unpauseMinting() external onlyRole(ADMIN_ROLE) { _unpause(); }

  // ✅ Solo tu backend/agente crea órdenes
  function createOrder(address recipient, uint256 amount, uint256 expiresAt)
    external
    onlyRole(OPERATOR_ROLE)
    returns (uint256 id)
  {
    if (recipient == address(0)) revert BadRecipient();
    if (amount < minOrderAmount) revert AmountTooSmall();
    if (expiresAt != 0 && expiresAt <= block.timestamp) revert BadExpiry();

    id = nextOrderId++;
    orders[id] = Order({
      recipient: recipient,
      amount: amount,
      createdAt: block.timestamp,
      expiresAt: expiresAt,
      status: Status.Pending
    });

    emit OrderCreated(id, recipient, amount, expiresAt);
  }

  function cancelOrder(uint256 orderId, string calldata reason) external onlyRole(ADMIN_ROLE) {
    Order storage o = orders[orderId];
    if (o.status != Status.Pending) revert NotPending();
    o.status = Status.Cancelled;
    emit OrderCancelled(orderId, reason);
  }

  // ✅ Cualquiera puede llamar process(), pero respeta pause
  function process() external whenNotPaused {
    uint256 current = oracle.lastBalance();
    if (current < processedBalance) revert OracleDecreased();

    uint256 delta = current - processedBalance;
    if (delta > maxDeltaPerProcess) revert DeltaTooBig(delta, maxDeltaPerProcess);

    uint256 oldProcessed = processedBalance;
    uint256 consumed = 0;
    uint256 processedCount = 0;

    while (head < nextOrderId && delta > 0 && processedCount < maxOrdersPerProcess) {
      Order storage o = orders[head];

      if (o.status != Status.Pending) { head++; continue; }

      if (o.expiresAt != 0 && block.timestamp > o.expiresAt) {
        o.status = Status.Expired;
        emit OrderCancelled(head, "expired");
        head++;
        continue;
      }

      if (delta < o.amount) break; // aún no alcanza para la próxima orden FIFO

      // consume y mintea
      delta -= o.amount;
      consumed += o.amount;
      o.status = Status.Processed;

      token.mint(o.recipient, o.amount);
      emit OrderProcessed(head, o.recipient, o.amount);

      head++;
      processedCount++;
    }

    // avanzamos processedBalance hasta donde realmente consumimos
    processedBalance = current - delta;

    emit ProcessedUpTo(oldProcessed, processedBalance, consumed, processedCount);
  }
}