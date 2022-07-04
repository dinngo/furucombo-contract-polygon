// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../../HandlerBase.sol";
import "./IFunds.sol";

import "hardhat/console.sol";

/// @title Furucombo funds operation handler.
/// @notice Deposit or withdraw to/from funds.
contract HFundsOperation is HandlerBase {
    using SafeERC20 for IERC20;

    function getContractName() public pure override returns (string memory) {
        return "HFundsOperation";
    }

    function purchase(address fundsAddr, uint256 amount)
        external
        payable
        returns (uint256)
    {
        IFunds funds = IFunds(fundsAddr);
        address denomination = funds.denomination();

        // Check amount
        uint256 amountIn = _getBalance(denomination, type(uint256).max);
        _requireMsg(amountIn == amount, "purchase", "amount not match");

        // Purchase
        _tokenApprove(denomination, fundsAddr, amount);
        uint256 share = funds.purchase(amount);
        _tokenApproveZero(denomination, fundsAddr);

        address shareToken = funds.shareToken();
        _updateToken(shareToken);

        return share;
    }

    function redeem(address fundsAddr, uint256 share)
        external
        payable
        returns (uint256)
    {
        IFunds funds = IFunds(fundsAddr);
        address shareToken = funds.shareToken();

        // Check share
        uint256 shareIn = IERC20(shareToken).balanceOf(address(this));
        _requireMsg(shareIn == share, "redeem", "share not match");

        // Redeem
        _tokenApprove(shareToken, fundsAddr, share);
        uint256 amount;

        try funds.redeem(share, false) returns (uint256 balance) {
            amount = balance;
        } catch Error(string memory reason) {
            _revertMsg("redeem", reason);
        } catch (bytes memory data) {
            // The last 32 bytes should be Funds RevertCode.
            // Ex: 0x64c41b44000000000000000000000000000000000000000000000000000000000000004a
            uint256 revertCode;
            assembly {
                revertCode := mload(add(data, add(0x20, 4)))
            }
            _revertMsg(
                "redeem",
                string(
                    abi.encodePacked(
                        "RevertCode:",
                        Strings.toString(revertCode)
                    )
                )
            );
        }
        _tokenApproveZero(shareToken, fundsAddr);

        address denomination = funds.denomination();
        _updateToken(denomination);

        return amount;
    }
}
