// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFunds{
    function denomination() external view returns (IERC20);
    function shareToken() external view returns (IERC20);
    function calculateShare(uint256) external view returns (uint256);

    function purchase(uint256) external returns (uint256);
}
