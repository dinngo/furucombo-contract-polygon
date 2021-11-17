// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../HandlerBase.sol";
import "./IMinter.sol";
import "./ILiquidityGauge.sol";

contract HCurveDao is HandlerBase {
    using SafeERC20 for IERC20;

    function getContractName() public pure override returns (string memory) {
        return "HCurveDao";
    }

    function deposit(address gaugeAddress, uint256 _value) external payable {
        ILiquidityGauge gauge = ILiquidityGauge(gaugeAddress);
        address token = gauge.lp_token();
        address user = _getSender();

        // if amount == type(uint256).max return balance of Proxy
        _value = _getBalance(token, _value);
        _tokenApprove(token, gaugeAddress, _value);

        try gauge.deposit(_value, user) {} catch Error(string memory reason) {
            _revertMsg("deposit", reason);
        } catch {
            _revertMsg("deposit");
        }
        _tokenApproveZero(token, gaugeAddress);
    }
}
