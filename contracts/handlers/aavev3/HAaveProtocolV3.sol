// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "../../interface/IProxy.sol";
import "../HandlerBase.sol";
import "../wmatic/IWMATIC.sol";
import "./IPool.sol";
import "./IFlashLoanReceiver.sol";

contract HAaveProtocolV3 is HandlerBase, IFlashLoanReceiver {
    // prettier-ignore
    address public constant PROVIDER = 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb;
    // prettier-ignore
    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
    uint16 public constant REFERRAL_CODE = 56;

    function getContractName() public pure override returns (string memory) {
        return "HAaveProtocolV3";
    }

    function supply(address asset, uint256 amount) external payable {
        _notMaticToken(asset);
        amount = _getBalance(asset, amount);
        _supply(asset, amount);
    }

    function supplyETH(uint256 amount) external payable {
        amount = _getBalance(NATIVE_TOKEN_ADDRESS, amount);
        IWMATIC(WMATIC).deposit{value: amount}();
        _supply(WMATIC, amount);

        _updateToken(WMATIC);
    }

    function withdraw(address asset, uint256 amount)
        external
        payable
        returns (uint256 withdrawAmount)
    {
        _notMaticToken(asset);
        withdrawAmount = _withdraw(asset, amount);

        _updateToken(asset);
    }

    function withdrawETH(uint256 amount)
        external
        payable
        returns (uint256 withdrawAmount)
    {
        withdrawAmount = _withdraw(WMATIC, amount);
        IWMATIC(WMATIC).withdraw(withdrawAmount);
    }

    function borrow(
        address asset,
        uint256 amount,
        uint256 rateMode
    ) external payable {
        _notMaticToken(asset);
        address onBehalfOf = _getSender();
        _borrow(asset, amount, rateMode, onBehalfOf);
        _updateToken(asset);
    }

    function borrowETH(uint256 amount, uint256 rateMode) external payable {
        address onBehalfOf = _getSender();
        _borrow(WMATIC, amount, rateMode, onBehalfOf);
        IWMATIC(WMATIC).withdraw(amount);
    }

    function repay(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) external payable returns (uint256 remainDebt) {
        _notMaticToken(asset);
        remainDebt = _repay(asset, amount, rateMode, onBehalfOf);
    }

    function repayETH(
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) external payable returns (uint256 remainDebt) {
        IWMATIC(WMATIC).deposit{value: amount}();
        remainDebt = _repay(WMATIC, amount, rateMode, onBehalfOf);

        _updateToken(WMATIC);
    }

    function flashLoan(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        bytes calldata params
    ) external payable {
        _notMaticToken(assets);
        _requireMsg(
            assets.length == amounts.length,
            "flashLoan",
            "assets and amounts do not match"
        );

        _requireMsg(
            assets.length == modes.length,
            "flashLoan",
            "assets and modes do not match"
        );

        address onBehalfOf = _getSender();
        address pool = IPoolAddressesProvider(PROVIDER).getPool();

        try
            IPool(pool).flashLoan(
                address(this),
                assets,
                amounts,
                modes,
                onBehalfOf,
                params,
                REFERRAL_CODE
            )
        {} catch Error(string memory reason) {
            _revertMsg("flashLoan", reason);
        } catch {
            _revertMsg("flashLoan");
        }

        // approve pool zero
        for (uint256 i = 0; i < assets.length; i++) {
            _tokenApproveZero(assets[i], pool);
            if (modes[i] != 0) _updateToken(assets[i]);
        }
    }

    function executeOperation(
        address[] memory assets,
        uint256[] memory amounts,
        uint256[] memory premiums,
        address initiator,
        bytes memory params
    ) external override returns (bool) {
        _notMaticToken(assets);
        _requireMsg(
            msg.sender == IPoolAddressesProvider(PROVIDER).getPool(),
            "executeOperation",
            "invalid caller"
        );

        _requireMsg(
            initiator == address(this),
            "executeOperation",
            "not initiated by the proxy"
        );

        (address[] memory tos, bytes32[] memory configs, bytes[] memory datas) =
            abi.decode(params, (address[], bytes32[], bytes[]));
        IProxy(address(this)).execs(tos, configs, datas);

        address pool = IPoolAddressesProvider(PROVIDER).getPool();
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 amountOwing = amounts[i] + premiums[i];
            _tokenApprove(assets[i], pool, amountOwing);
        }
        return true;
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _supply(address asset, uint256 amount) internal {
        (address pool, address aToken) = _getPoolAndAToken(asset);
        _tokenApprove(asset, pool, amount);
        try
            IPool(pool).supply(asset, amount, address(this), REFERRAL_CODE)
        {} catch Error(string memory reason) {
            _revertMsg("supply", reason);
        } catch {
            _revertMsg("supply");
        }
        _tokenApproveZero(asset, pool);
        _updateToken(aToken);
    }

    function _withdraw(address asset, uint256 amount)
        internal
        returns (uint256 withdrawAmount)
    {
        (address pool, address aToken) = _getPoolAndAToken(asset);
        amount = _getBalance(aToken, amount);

        try IPool(pool).withdraw(asset, amount, address(this)) returns (
            uint256 ret
        ) {
            withdrawAmount = ret;
        } catch Error(string memory reason) {
            _revertMsg("withdraw", reason);
        } catch {
            _revertMsg("withdraw");
        }
    }

    function _borrow(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) internal {
        address pool = IPoolAddressesProvider(PROVIDER).getPool();

        try
            IPool(pool).borrow(
                asset,
                amount,
                rateMode,
                REFERRAL_CODE,
                onBehalfOf
            )
        {} catch Error(string memory reason) {
            _revertMsg("borrow", reason);
        } catch {
            _revertMsg("borrow");
        }
    }

    function _repay(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) internal returns (uint256 remainDebt) {
        address pool = IPoolAddressesProvider(PROVIDER).getPool();
        _tokenApprove(asset, pool, amount);

        try
            IPool(pool).repay(asset, amount, rateMode, onBehalfOf)
        {} catch Error(string memory reason) {
            _revertMsg("repay", reason);
        } catch {
            _revertMsg("repay");
        }

        _tokenApproveZero(asset, pool);

        DataTypes.ReserveData memory reserve =
            IPool(pool).getReserveData(asset);
        remainDebt = DataTypes.InterestRateMode(rateMode) ==
            DataTypes.InterestRateMode.STABLE
            ? IERC20(reserve.stableDebtTokenAddress).balanceOf(onBehalfOf)
            : IERC20(reserve.variableDebtTokenAddress).balanceOf(onBehalfOf);
    }

    function _getPoolAndAToken(address underlying)
        internal
        view
        returns (address pool, address aToken)
    {
        pool = IPoolAddressesProvider(PROVIDER).getPool();
        try IPool(pool).getReserveData(underlying) returns (
            DataTypes.ReserveData memory data
        ) {
            aToken = data.aTokenAddress;
            _requireMsg(
                aToken != address(0),
                "General",
                "aToken should not be zero address"
            );
        } catch Error(string memory reason) {
            _revertMsg("General", reason);
        } catch {
            _revertMsg("General");
        }
    }
}
