// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../HandlerBase.sol";
import "./IFunds.sol";

/// @title Furucombo funds operation handler.
/// @notice Deposit or withdraw to/from funds.
contract HFundsOperation is HandlerBase {
    using SafeERC20 for IERC20;

    function getContractName() public pure override returns (string memory) {
        return "HFundsOperation";
    }

    function purchase(
        address fundsAddr,
        address tokenIn,
        uint256 amount
    ) external payable returns (uint256) {
        IFunds funds = IFunds(fundsAddr);

        // Check denomination
        IERC20 denomination = funds.denomination();
        _requireMsg(
            address(denomination) == tokenIn,
            "purchase",
            "denomination not match"
        );

        // Check amount
        uint256 amountIn = _getBalance(tokenIn, type(uint256).max);
        _requireMsg(amountIn == amount, "purchase", "amount not match");

        // Purchase
        _tokenApprove(tokenIn, fundsAddr, amount);
        uint256 share = funds.purchase(amount);
        _tokenApproveZero(tokenIn, fundsAddr);

        IERC20 shareToken = funds.shareToken();
        _updateToken(address(shareToken));

        return share;
    }
}
