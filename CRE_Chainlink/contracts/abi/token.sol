// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MintableToken is ERC20, Ownable {
    address public minter;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) Ownable(msg.sender) {}

    function setMinter(address m) external onlyOwner {
        minter = m;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "NOT_MINTER");
        _mint(to, amount);
    }
}