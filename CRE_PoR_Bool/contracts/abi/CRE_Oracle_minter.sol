// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IMintableBurnableERC20 {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
}

contract CRE_BOBC is AccessControl, Pausable, IReceiver {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    address public constant FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address public constant ADMIN = 0xB73D0739675aE6f7E18cf6846F78BeB49125e60E;

    IMintableBurnableERC20 public constant token = IMintableBurnableERC20(0xf132Ba93754206DF89E61B43A9800498B7062C13);

    uint256 public maxIdsPerReport = 25;
    uint256 public lastProcessedBankBalance = 0;

    uint256 public nextOrderId = 1;
    uint256 public nextRedeemId = 1;

    bool public initialized;

    enum Status {
        None,
        Pending,
        Minted,
        Cancelled
    }

    struct Order {
        address recipient;
        uint256 amount;
        uint256 createdAt;
        Status status;
    }

    mapping(uint256 => Order) public orders;

    event Initialized(address admin);
    event OrderCreated(uint256 indexed orderId, address indexed recipient, uint256 amount);
    event OrderCancelled(uint256 indexed orderId, string reason);
    event BatchProcessed(uint256 newBankBalance, uint256 delta, uint256 sum, uint256 count);
    event BatchMinted(uint256[] orderIds);
    event RedeemRequested(uint256 indexed redeemId, address indexed user, uint256 amount);

    error OnlyForwarder();
    error BadRecipient();
    error BadAmount();
    error NotPending(uint256 id);
    error BalanceDecreased();
    error TooManyIds(uint256 count, uint256 max);
    error DeltaMismatch(uint256 delta, uint256 sum);
    error AlreadyInitialized();

    modifier onlyForwarder() {
        if (msg.sender != FORWARDER) revert OnlyForwarder();
        _;
    }

    function initialize() external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;

        _grantRole(DEFAULT_ADMIN_ROLE, ADMIN);
        _grantRole(ADMIN_ROLE, ADMIN);
        _grantRole(OPERATOR_ROLE, ADMIN);

        emit Initialized(ADMIN);
    }

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

    function setMaxIdsPerReport(uint256 v) external onlyRole(ADMIN_ROLE) {
        require(v > 0 && v <= 200, "BAD_MAX");
        maxIdsPerReport = v;
    }

    function pauseMinting() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpauseMinting() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function createOrder(address recipient, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 orderId)
    {
        if (recipient == address(0)) revert BadRecipient();
        if (amount == 0) revert BadAmount();

        orderId = nextOrderId;
        nextOrderId = nextOrderId + 1;

        orders[orderId] = Order({
            recipient: recipient,
            amount: amount,
            createdAt: block.timestamp,
            status: Status.Pending
        });

        emit OrderCreated(orderId, recipient, amount);
    }

    function cancelOrder(uint256 orderId, string calldata reason) external onlyRole(ADMIN_ROLE) {
        Order storage o = orders[orderId];
        if (o.status != Status.Pending) revert NotPending(orderId);
        o.status = Status.Cancelled;
        emit OrderCancelled(orderId, reason);
    }

    function onReport(bytes calldata, bytes calldata report) external onlyForwarder whenNotPaused {
        (uint256 bankBalanceScaled, uint256[] memory ids) = abi.decode(report, (uint256, uint256[]));

        if (bankBalanceScaled < lastProcessedBankBalance) revert BalanceDecreased();
        if (ids.length > maxIdsPerReport) revert TooManyIds(ids.length, maxIdsPerReport);

        uint256 delta = bankBalanceScaled - lastProcessedBankBalance;
        uint256 sum = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            Order storage o = orders[ids[i]];
            if (o.status != Status.Pending) revert NotPending(ids[i]);
            sum += o.amount;
        }

        if (delta != sum) revert DeltaMismatch(delta, sum);

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            Order storage o = orders[id];
            o.status = Status.Minted;
            token.mint(o.recipient, o.amount);
        }

        emit BatchMinted(ids);

        lastProcessedBankBalance = bankBalanceScaled;
        emit BatchProcessed(bankBalanceScaled, delta, sum, ids.length);
    }

    function redeem(uint256 amount) external whenNotPaused returns (uint256 redeemId) {
        require(amount > 0, "BAD_AMOUNT");

        redeemId = nextRedeemId++;
        token.burnFrom(msg.sender, amount);

        emit RedeemRequested(redeemId, msg.sender, amount);
    }
}