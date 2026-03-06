// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Importing AccessControl for role-based access and Pausable for pause functionality
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// IERC165 interface for contract interface detection
interface IERC165 { function supportsInterface(bytes4 interfaceId) external view returns (bool); }
// IReceiver interface that must implement onReport
interface IReceiver is IERC165 { function onReport(bytes calldata metadata, bytes calldata report) external; }

// Interface for mintable ERC20 token
interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

// Main contract that manages batch Proof-of-Reserve approvals and minting
contract BatchPoRApprovalMinter is AccessControl, Pausable, IReceiver {
    // Role definitions
    bytes32 public constant ADMIN_ROLE    = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // The only address allowed to call onReport (trusted forwarder)
    address public immutable forwarder; // MockForwarder (simulate/broadcast) or KeystoneForwarder (prod)
    // The ERC20 token to be minted
    IMintableERC20 public immutable token;

    // Security/limit: Max number of ids processed per report
    uint256 public maxIdsPerReport = 25;

    // Pointer to last processed bank balance (scaled to 18 decimals)
    uint256 public lastProcessedBankBalance;

    // Status codes for Order lifecycle
    enum Status { None, Pending, Minted, Cancelled }

    // Order struct: represents a mint request
    struct Order {
        address recipient;
        uint256 amount;   // scaled 18
        uint256 createdAt;
        Status status;
    }

    // Mapping: orderId => Order details
    mapping(uint256 => Order) public orders;

    // Events for external monitoring
    event OrderCreated(uint256 indexed orderId, address indexed recipient, uint256 amount);
    event OrderCancelled(uint256 indexed orderId, string reason);
    event BatchProcessed(uint256 newBankBalance, uint256 delta, uint256 sum, uint256 count);
    event Minted(uint256 indexed orderId, address indexed recipient, uint256 amount);

    // Custom errors for more efficient and descriptive failure conditions
    error OnlyForwarder();
    error BadRecipient();
    error BadAmount();
    error AlreadyExists();
    error NotPending(uint256 id);
    error BalanceDecreased();
    error TooManyIds(uint256 count, uint256 max);
    error DeltaMismatch(uint256 delta, uint256 sum);

    // Contract constructor: sets roles and configuration at deployment
    constructor(address _forwarder, address _token, address admin, uint256 _initialBankBalance) {
        forwarder = _forwarder;
        token = IMintableERC20(_token);
        lastProcessedBankBalance = _initialBankBalance;

        // Grant all main roles to the deployer/admin
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // Modifier to allow actions only from the trusted forwarder
    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert OnlyForwarder();
        _;
    }

    // Required for detecting supported interfaces (IERC165)
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // Admin function to set the per-report id limit
    function setMaxIdsPerReport(uint256 v) external onlyRole(ADMIN_ROLE) {
        require(v > 0 && v <= 200, "BAD_MAX"); // reasonable limit
        maxIdsPerReport = v;
    }

    // Admin functions to pause/unpause minting operations
    function pauseMinting() external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpauseMinting() external onlyRole(ADMIN_ROLE) { _unpause(); }

    // Create a new minting order; called by backend/agent with OPERATOR_ROLE
    function createOrder(uint256 orderId, address recipient, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (recipient == address(0)) revert BadRecipient();
        if (amount == 0) revert BadAmount();
        if (orders[orderId].status != Status.None) revert AlreadyExists();

        orders[orderId] = Order({
            recipient: recipient,
            amount: amount,
            createdAt: block.timestamp,
            status: Status.Pending
        });

        emit OrderCreated(orderId, recipient, amount);
    }

    // Cancel a pending mint order (Admin only)
    function cancelOrder(uint256 orderId, string calldata reason) external onlyRole(ADMIN_ROLE) {
        Order storage o = orders[orderId];
        if (o.status != Status.Pending) revert NotPending(orderId);
        o.status = Status.Cancelled;
        emit OrderCancelled(orderId, reason);
    }

    // Main callback for processing Proof-of-Reserve reports from trusted forwarder
    //   report = abi.encode(uint256 bankBalanceScaled, uint256[] approvedIds)
    function onReport(bytes calldata /*metadata*/, bytes calldata report)
        external
        onlyForwarder
        whenNotPaused
    {
        // Decode the bank balance and list of approved order ids
        (uint256 bankBalanceScaled, uint256[] memory ids) = abi.decode(report, (uint256, uint256[]));

        // Reject if the bank balance goes down (should never happen)
        if (bankBalanceScaled < lastProcessedBankBalance) revert BalanceDecreased();
        // Restrict batch size for safety
        if (ids.length > maxIdsPerReport) revert TooManyIds(ids.length, maxIdsPerReport);

        // Calculate delta (increase) in total balance
        uint256 delta = bankBalanceScaled - lastProcessedBankBalance;

        // 1) Sum the order amounts for all approved ids and check each is pending
        uint256 sum = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            Order storage o = orders[ids[i]];
            if (o.status != Status.Pending) revert NotPending(ids[i]);
            sum += o.amount;
        }

        // 2) Strictly enforce PoR: total approved mint must match delta
        if (delta != sum) revert DeltaMismatch(delta, sum);

        // 3) Mint tokens for each approved order and mark as minted
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            Order storage o = orders[id];

            o.status = Status.Minted;
            token.mint(o.recipient, o.amount);

            emit Minted(id, o.recipient, o.amount);
        }

        // Update pointer for last processed Proof-of-Reserve balance
        lastProcessedBankBalance = bankBalanceScaled;
        emit BatchProcessed(bankBalanceScaled, delta, sum, ids.length);
    }
}