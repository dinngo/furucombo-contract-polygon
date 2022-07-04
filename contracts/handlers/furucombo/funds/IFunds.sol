// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFunds{
    function denomination() external view returns (address);
    function shareToken() external view returns (address);
    function calculateShare(uint256) external view returns (uint256);
    function calculateBalance(uint256) external view returns (uint256);
    function vault() external view returns (address);

    function purchase(uint256) external returns (uint256);
    function redeem(uint256, bool) external returns (uint256);
}
