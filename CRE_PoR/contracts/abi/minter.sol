// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC165 { function supportsInterface(bytes4 interfaceId) external view returns (bool); }
interface IReceiver is IERC165 { function onReport(bytes calldata metadata, bytes calldata report) external; }

interface IMintableERC20 {
    function totalSupply() external view returns (uint256);
    function mint(address to, uint256 amount) external;
}

contract SequentialBankPoRReceiver is IReceiver {
    address public immutable forwarder;     // MockForwarder (simulate) o KeystoneForwarder (prod)
    IMintableERC20 public immutable token;
    address public admin;

    uint256 public lastBankBalance;         // “balance confirmado”
    bool public hasPending;
    address public pendingRecipient;
    uint256 public pendingAmount;

    error OnlyForwarder();
    error OnlyAdmin();
    error NoPending();
    error BalanceDecreased();
    error DeltaMismatch(uint256 delta, uint256 expected);

    constructor(address _forwarder, address _token, address _admin, uint256 _initialBankBalance) {
        forwarder = _forwarder;
        token = IMintableERC20(_token);
        admin = _admin;
        lastBankBalance = _initialBankBalance;
    }

    modifier onlyForwarder() { if (msg.sender != forwarder) revert OnlyForwarder(); _; }
    modifier onlyAdmin() { if (msg.sender != admin) revert OnlyAdmin(); _; }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // Admin crea/actualiza la orden SECUENCIAL (solo una activa)
    function setPending(address recipient, uint256 amount) external onlyAdmin {
        pendingRecipient = recipient;
        pendingAmount = amount;
        hasPending = true;
    }

    function clearPending() external onlyAdmin {
        hasPending = false;
        pendingRecipient = address(0);
        pendingAmount = 0;
    }

    // report = abi.encode(uint256 bankBalanceScaled)
    function onReport(bytes calldata /*metadata*/, bytes calldata report) external onlyForwarder {
        uint256 bankBalance = abi.decode(report, (uint256));

        if (bankBalance < lastBankBalance) revert BalanceDecreased();
        if (!hasPending) revert NoPending();

        uint256 delta = bankBalance - lastBankBalance;
        if (delta != pendingAmount) revert DeltaMismatch(delta, pendingAmount);

        token.mint(pendingRecipient, pendingAmount);

        lastBankBalance = bankBalance;
        hasPending = false;
        pendingRecipient = address(0);
        pendingAmount = 0;
    }
}