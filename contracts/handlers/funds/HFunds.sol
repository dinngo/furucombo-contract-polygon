// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../lib/LibFeeStorage.sol";
import "../HandlerBase.sol";

contract HFunds is HandlerBase {
    using SafeERC20 for IERC20;
    using LibFeeStorage for mapping(bytes32 => bytes32);

    event ChargeFee(address indexed tokenIn, uint256 feeAmount);

    function getContractName() public pure override returns (string memory) {
        return "HFunds";
    }

    function updateTokens(address[] calldata tokens)
        external
        payable
        returns (uint256[] memory)
    {
        uint256[] memory balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            _notMaticToken(token);

            if (token != address(0) && token != NATIVE_TOKEN_ADDRESS) {
                // Update involved token
                _updateToken(token);
            }
            balances[i] = _getBalance(token, type(uint256).max);
        }
        return balances;
    }

    function updateTokensAndCharge(address[] calldata tokens)
        external
        payable
        returns (uint256[] memory)
    {
        uint256 feeRate = cache._getFeeRate();
        address collector = cache._getFeeCollector();
        uint256[] memory amountsInProxy = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            _notMaticToken(token);
            uint256 amount = _getBalance(token, type(uint256).max);

            if (feeRate > 0) {
                uint256 fee = _calFee(amount, feeRate);
                if ((token == address(0) || token == NATIVE_TOKEN_ADDRESS)) {
                    // It will fail if fee collector is gnosis contract, because .transfer() will only consume 2300 gas limit.
                    // Replacing .transfer() with .call('') to avoid out of gas
                    (bool success, ) = collector.call{value: fee}("");
                    require(success, "Send fee to collector failed");
                } else {
                    IERC20(token).safeTransfer(collector, fee);

                    // Update involved token
                    _updateToken(token);
                }
                amountsInProxy[i] = amount - fee;
                emit ChargeFee(token, fee);
            } else {
                amountsInProxy[i] = amount;
            }
        }
        return amountsInProxy;
    }

    function inject(address[] calldata tokens, uint256[] calldata amounts)
        external
        payable
        returns (uint256[] memory)
    {
        return _inject(tokens, amounts);
    }

    // Same as inject() and just to make another interface for different use case
    function addFunds(address[] calldata tokens, uint256[] calldata amounts)
        external
        payable
        returns (uint256[] memory)
    {
        return _inject(tokens, amounts);
    }

    function sendTokens(
        address[] calldata tokens,
        uint256[] calldata amounts,
        address payable receiver
    ) external payable {
        for (uint256 i = 0; i < tokens.length; i++) {
            // token can't be matic token
            _notMaticToken(tokens[i]);

            uint256 amount = _getBalance(tokens[i], amounts[i]);
            if (amount > 0) {
                // ETH case
                if (
                    tokens[i] == address(0) || tokens[i] == NATIVE_TOKEN_ADDRESS
                ) {
                    receiver.transfer(amount);
                } else {
                    IERC20(tokens[i]).safeTransfer(receiver, amount);
                }
            }
        }
    }

    function send(uint256 amount, address payable receiver) external payable {
        amount = _getBalance(address(0), amount);
        if (amount > 0) {
            receiver.transfer(amount);
        }
    }

    function sendToken(
        address token,
        uint256 amount,
        address receiver
    ) external payable {
        // token can't be matic token
        _notMaticToken(token);

        amount = _getBalance(token, amount);
        if (amount > 0) {
            IERC20(token).safeTransfer(receiver, amount);
        }
    }

    function checkSlippage(
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external payable {
        _requireMsg(
            tokens.length == amounts.length,
            "checkSlippage",
            "token and amount do not match"
        );

        for (uint256 i = 0; i < tokens.length; i++) {
            // token can't be matic token
            _notMaticToken(tokens[i]);

            if (tokens[i] == address(0)) {
                if (address(this).balance < amounts[i]) {
                    string memory errMsg =
                        string(
                            abi.encodePacked(
                                "error: ",
                                _uint2String(i),
                                "_",
                                _uint2String(address(this).balance)
                            )
                        );
                    _revertMsg("checkSlippage", errMsg);
                }
            } else if (
                IERC20(tokens[i]).balanceOf(address(this)) < amounts[i]
            ) {
                string memory errMsg =
                    string(
                        abi.encodePacked(
                            "error: ",
                            _uint2String(i),
                            "_",
                            _uint2String(
                                IERC20(tokens[i]).balanceOf(address(this))
                            )
                        )
                    );

                _revertMsg("checkSlippage", errMsg);
            }
        }
    }

    function getBalance(address token) external payable returns (uint256) {
        return _getBalance(token, type(uint256).max);
    }

    function _inject(address[] calldata tokens, uint256[] calldata amounts)
        internal
        returns (uint256[] memory)
    {
        _requireMsg(
            tokens.length == amounts.length,
            "inject",
            "token and amount does not match"
        );
        address sender = _getSender();
        uint256 feeRate = cache._getFeeRate();
        address collector = cache._getFeeCollector();
        uint256[] memory amountsInProxy = new uint256[](amounts.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            _notMaticToken(tokens[i]);
            IERC20(tokens[i]).safeTransferFrom(
                sender,
                address(this),
                amounts[i]
            );
            if (feeRate > 0) {
                uint256 fee = _calFee(amounts[i], feeRate);
                IERC20(tokens[i]).safeTransfer(collector, fee);
                amountsInProxy[i] = amounts[i] - fee;
                emit ChargeFee(tokens[i], fee);
            } else {
                amountsInProxy[i] = amounts[i];
            }

            // Update involved token
            _updateToken(tokens[i]);
        }
        return amountsInProxy;
    }

    function _calFee(uint256 amount, uint256 feeRate)
        internal
        pure
        returns (uint256)
    {
        return (amount * feeRate) / PERCENTAGE_BASE;
    }
}
