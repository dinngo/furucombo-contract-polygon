// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import "../wmatic/IWMATIC.sol";
import "../HandlerBase.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/IPeripheryPayments.sol";
import "./libraries/BytesLib.sol";

contract HUniswapV3 is HandlerBase {
    using BytesLib for bytes;

    address public constant ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    IWMATIC public constant WMATIC =
        IWMATIC(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);

    address public constant MATIC_ADDRESS =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE; // self-defined address for native token

    /// @dev from uniswapV3 - Path.sol
    /// @dev The length of the bytes encoded address
    uint256 private constant ADDR_SIZE = 20;
    /// @dev The length of the bytes encoded fee
    uint256 private constant FEE_SIZE = 3;
    /// @dev The offset of a single token address and pool fee
    uint256 private constant NEXT_OFFSET = ADDR_SIZE + FEE_SIZE;
    /// @dev The offset of an encoded pool key
    uint256 private constant POP_OFFSET = NEXT_OFFSET + ADDR_SIZE;

    uint256 private constant ZERO_MATIC_VALUE = 0;

    function getContractName() public pure override returns (string memory) {
        return "HUniswapV3";
    }

    function exactInputFromMatic(
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external payable returns (uint256 amountOut) {
        // get token in and token out
        address tokenIn = _getFirstToken(path);
        address tokenOut = _getLastToken(path);

        if (tokenIn != address(WMATIC)) {
            _revertMsg("exactInputFromMatic", "token in is not WMATIC");
        }

        // get MATIC balance
        amountIn = _getBalance(MATIC_ADDRESS, amountIn);

        // swap token
        amountOut = _exactInput(amountIn, path, amountIn, amountOutMinimum);

        // add token out to stack
        _updateToken(tokenOut);
    }

    function exactInputToMatic(
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external payable returns (uint256 amountOut) {
        // get token in and token out
        address tokenIn = _getFirstToken(path);
        address tokenOut = _getLastToken(path);

        // check token out
        if (tokenOut != address(WMATIC)) {
            _revertMsg("exactInputToMatic", "token out is not WMATIC");
        }

        // get token in balance
        amountIn = _getBalance(tokenIn, amountIn);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // swap token
        amountOut = _exactInput(
            ZERO_MATIC_VALUE,
            path,
            amountIn,
            amountOutMinimum
        );

        // exchange WMATIC to MATIC
        WMATIC.withdraw(amountOut);
    }

    function exactInput(
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external payable returns (uint256 amountOut) {
        // get token in and token out
        address tokenIn = _getFirstToken(path);
        address tokenOut = _getLastToken(path);

        // check if is Matic token
        if (tokenIn == address(WMATIC) || tokenOut == address(WMATIC)) {
            _revertMsg("exactInput", "path include WMATIC");
        }

        // get token in balance
        amountIn = _getBalance(tokenIn, amountIn);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // swap token
        amountOut = _exactInput(
            ZERO_MATIC_VALUE,
            path,
            amountIn,
            amountOutMinimum
        );

        // add token out to stack
        _updateToken(tokenOut);
    }

    function _exactInput(
        uint256 value,
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) internal returns (uint256) {
        // init struct
        ISwapRouter.ExactInputParams memory params =
            ISwapRouter.ExactInputParams({
                path: path,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum
            });

        // try swap token
        try ISwapRouter(ROUTER).exactInput{value: value}(params) returns (
            uint256 amountOut
        ) {
            return amountOut;
        } catch Error(string memory reason) {
            _revertMsg("exactInput", reason);
        } catch {
            _revertMsg("exactInput");
        }
    }

    function exactInputSingleFromMatic(
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountOut) {
        if (tokenOut == address(WMATIC)) {
            _revertMsg("exactInputSingleFromMatic", "token out is WMATIC");
        }

        // fix token in as WMATIC
        address tokenIn = address(WMATIC);

        // get MATIC balance
        amountIn = _getBalance(MATIC_ADDRESS, amountIn);

        // swap token
        amountOut = _exactInputSingle(
            amountIn,
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        );

        // add output token to stack
        _updateToken(tokenOut);
    }

    function exactInputSingleToMatic(
        address tokenIn,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountOut) {
        if (tokenIn == address(WMATIC)) {
            _revertMsg("exactInputSingleToMatic", "token in is WMATIC");
        }

        // init fixed token out address
        address tokenOut = address(WMATIC);

        // get token in balance
        amountIn = _getBalance(tokenIn, amountIn);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // swap token
        amountOut = _exactInputSingle(
            ZERO_MATIC_VALUE,
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        );

        // exchange WMATIC to MATIC
        WMATIC.withdraw(amountOut);
    }

    function exactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountOut) {
        if (tokenIn == address(WMATIC) || tokenOut == address(WMATIC)) {
            _revertMsg("exactInputSingle", "token in or token out is WMATIC");
        }

        // get token in balance
        amountIn = _getBalance(tokenIn, amountIn);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // swap token
        amountOut = _exactInputSingle(
            ZERO_MATIC_VALUE,
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        );

        // add output token to stack
        _updateToken(tokenOut);
    }

    function _exactInputSingle(
        uint256 value,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) internal returns (uint256) {
        // init struct
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: sqrtPriceLimitX96
            });

        // try swap token
        try ISwapRouter(ROUTER).exactInputSingle{value: value}(params) returns (
            uint256 amountOut
        ) {
            return amountOut;
        } catch Error(string memory reason) {
            _revertMsg("exactInputSingle", reason);
        } catch {
            _revertMsg("exactInputSingle");
        }
    }

    function exactOutputSingleFromMatic(
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountIn) {
        if (tokenOut == address(WMATIC)) {
            _revertMsg("exactOutputSingleFromMatic", "token out is WMATIC");
        }

        // fix token in as WMATIC
        address tokenIn = address(WMATIC);

        // get balance of MATIC
        amountInMaximum = _getBalance(MATIC_ADDRESS, amountInMaximum);

        // swap token
        amountIn = _exactOutputSingle(
            amountInMaximum,
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96
        );

        // refund unspent MATIC balance
        IPeripheryPayments(ROUTER).refundETH();

        // add token out to stack
        _updateToken(tokenOut);
    }

    function exactOutputSingleToMatic(
        address tokenIn,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountIn) {
        if (tokenIn == address(WMATIC)) {
            _revertMsg("exactOutputSingleToMatic", "token in is WMATIC");
        }
        // fix token out as WMATIC
        address tokenOut = address(WMATIC);

        // get balance of token in
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // swap token
        amountIn = _exactOutputSingle(
            ZERO_MATIC_VALUE,
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96
        );

        // exchange WMATIC to MATIC
        WMATIC.withdraw(amountOut);
    }

    function exactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountIn) {
        if (tokenIn == address(WMATIC) || tokenOut == address(WMATIC)) {
            _revertMsg("exactOutputSingle", "toke in or token out is WMATIC");
        }

        // get balance of token in
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // swap token
        amountIn = _exactOutputSingle(
            ZERO_MATIC_VALUE,
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96
        );

        // add token out to stack
        _updateToken(tokenOut);
    }

    function _exactOutputSingle(
        uint256 value,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) internal returns (uint256) {
        //init struct
        ISwapRouter.ExactOutputSingleParams memory params =
            ISwapRouter.ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum,
                sqrtPriceLimitX96: sqrtPriceLimitX96
            });

        // try swap
        try
            ISwapRouter(ROUTER).exactOutputSingle{value: value}(params)
        returns (uint256 amountIn) {
            return amountIn;
        } catch Error(string memory reason) {
            _revertMsg("exactOutputSingle", reason);
        } catch {
            _revertMsg("exactOutputSingle");
        }
    }

    function exactOutputFromMatic(
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) external payable returns (uint256 amountIn) {
        // get token in and token out
        address tokenIn = _getLastToken(path);
        address tokenOut = _getFirstToken(path);

        // check token in
        if (tokenIn != address(WMATIC)) {
            _revertMsg("exactOutputFromMatic", "token in is not WMATIC");
        }

        // get MATIC balance
        amountInMaximum = _getBalance(MATIC_ADDRESS, amountInMaximum);

        // swap token
        amountIn = _exactOutput(
            amountInMaximum,
            path,
            amountOut,
            amountInMaximum
        );

        // refund unspent MATIC balance
        IPeripheryPayments(ROUTER).refundETH();

        // add token out to stack
        _updateToken(tokenOut);
    }

    function exactOutputToMatic(
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) external payable returns (uint256 amountIn) {
        // get token in and token out
        address tokenIn = _getLastToken(path);
        address tokenOut = _getFirstToken(path);

        // check token out
        if (tokenOut != address(WMATIC)) {
            _revertMsg("exactOutputToMatic", "token out is not WMATIC");
        }

        // get balance of token in
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // swap token
        amountIn = _exactOutput(
            ZERO_MATIC_VALUE,
            path,
            amountOut,
            amountInMaximum
        );

        // exchange WMATIC to MATIC
        WMATIC.withdraw(amountOut);
    }

    function exactOutput(
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) external payable returns (uint256 amountIn) {
        // get token in and token out
        address tokenIn = _getLastToken(path);
        address tokenOut = _getFirstToken(path);

        // check if first or last token is WMATIC
        if (tokenIn == address(WMATIC) || tokenOut == address(WMATIC)) {
            _revertMsg("exactOutput", "path include WMATIC");
        }

        // get balance of token in
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // swap token
        amountIn = _exactOutput(
            ZERO_MATIC_VALUE,
            path,
            amountOut,
            amountInMaximum
        );

        // add token out to stack
        _updateToken(tokenOut);
    }

    function _exactOutput(
        uint256 value,
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) internal returns (uint256) {
        // init struct
        ISwapRouter.ExactOutputParams memory params =
            ISwapRouter.ExactOutputParams({
                path: path,
                recipient: address(this),
                deadline: block.timestamp,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum
            });

        // try swap token
        try ISwapRouter(ROUTER).exactOutput{value: value}(params) returns (
            uint256 amountIn
        ) {
            return amountIn;
        } catch Error(string memory reason) {
            _revertMsg("exactOutput", reason);
        } catch {
            _revertMsg("exactOutput");
        }
    }

    function _getFirstToken(bytes memory path) internal pure returns (address) {
        return path.toAddress(0);
    }

    function _getLastToken(bytes memory path) internal pure returns (address) {
        return path.toAddress(path.length - ADDR_SIZE);
    }
}
