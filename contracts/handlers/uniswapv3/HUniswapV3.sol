// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import "../wmatic/IWMATIC.sol";
import "../HandlerBase.sol";
import "./interfaces/ISwapRouter.sol";
import "./libraries/BytesLib.sol";

// @title: UniswapV3 Handler
contract HUniswapV3 is HandlerBase {
    using BytesLib for bytes;

    ISwapRouter public constant ROUTER =
        ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    IWMATIC public constant WMATIC =
        IWMATIC(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);

    uint256 private constant PATH_SIZE = 43; // address + fee(uint24) + address
    uint256 private constant ADDRESS_SIZE = 20;

    function getContractName() public pure override returns (string memory) {
        return "HUniswapV3";
    }

    //@dev Ether represents native token
    function exactInputSingleFromEther(
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountOut) {
        // Set tokenIn as WMATIC
        address tokenIn = address(WMATIC);

        // Get WMATIC balance
        amountIn = _getBalance(address(0), amountIn);

        // Swap token
        amountOut = _exactInputSingle(
            amountIn,
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        );

        // Add output token to stack
        _updateToken(tokenOut);
    }

    function exactInputSingleToEther(
        address tokenIn,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountOut) {
        // Set token out address as WMATIC
        address tokenOut = address(WMATIC);

        // Get tokenIn balance
        amountIn = _getBalance(tokenIn, amountIn);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // Swap token
        amountOut = _exactInputSingle(
            0,
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        );

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Exchange WMATIC to MATIC
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
        // Get tokenIn balance
        amountIn = _getBalance(tokenIn, amountIn);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // Swap token
        amountOut = _exactInputSingle(
            0,
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        );

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Add output token to stack
        _updateToken(tokenOut);
    }

    function exactInputFromEther(
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external payable returns (uint256 amountOut) {
        // Get tokenIn and tokenOut
        address tokenIn = _getFirstToken(path);
        address tokenOut = _getLastToken(path);

        // Input token must be WMATIC
        _requireMsg(
            tokenIn == address(WMATIC),
            "exactInputFromEther",
            "Input not WMATIC"
        );

        // Get MATIC balance
        amountIn = _getBalance(address(0), amountIn);

        // Swap token
        amountOut = _exactInput(amountIn, path, amountIn, amountOutMinimum);

        // Add token out to stack
        _updateToken(tokenOut);
    }

    function exactInputToEther(
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external payable returns (uint256 amountOut) {
        // Get token in and token out
        address tokenIn = _getFirstToken(path);
        address tokenOut = _getLastToken(path);

        // Output token must be WMATIC
        _requireMsg(
            tokenOut == address(WMATIC),
            "exactInputToEther",
            "Output not WMATIC"
        );

        // Get tokenIn balance
        amountIn = _getBalance(tokenIn, amountIn);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // Swap token
        amountOut = _exactInput(0, path, amountIn, amountOutMinimum);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Exchange WMATIC to MATIC
        WMATIC.withdraw(amountOut);
    }

    function exactInput(
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external payable returns (uint256 amountOut) {
        // Get tokenIn and tokenOut
        address tokenIn = _getFirstToken(path);
        address tokenOut = _getLastToken(path);

        // Get tokenIn balance
        amountIn = _getBalance(tokenIn, amountIn);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // Swap token
        amountOut = _exactInput(0, path, amountIn, amountOutMinimum);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Add token out to stack
        _updateToken(tokenOut);
    }

    function exactOutputSingleFromEther(
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountIn) {
        // Set tokenIn as WMATIC
        address tokenIn = address(WMATIC);

        // Get balance of MATIC
        amountInMaximum = _getBalance(address(0), amountInMaximum);

        // Swap token
        amountIn = _exactOutputSingle(
            amountInMaximum,
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96
        );

        // Refund unspent MATIC balance
        ROUTER.refundETH();

        // Add token out to stack
        _updateToken(tokenOut);
    }

    function exactOutputSingleToEther(
        address tokenIn,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountIn) {
        // Set tokenOut as WMATIC
        address tokenOut = address(WMATIC);

        // Get tokenIn balance
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // Swap token
        amountIn = _exactOutputSingle(
            0,
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96
        );

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Exchange WMATIC to MATIC
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
        // Get tokenIn balance
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // Swap token
        amountIn = _exactOutputSingle(
            0,
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96
        );

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Add token out to stack
        _updateToken(tokenOut);
    }

    function exactOutputFromEther(
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) external payable returns (uint256 amountIn) {
        // Get tokenIn and tokenOut
        address tokenIn = _getLastToken(path);
        address tokenOut = _getFirstToken(path);

        // Check tokenIn
        _requireMsg(
            tokenIn == address(WMATIC),
            "exactOutputFromMatic",
            "Input not WMATIC"
        );

        // Get MATIC balance
        amountInMaximum = _getBalance(address(0), amountInMaximum);

        // Swap token
        amountIn = _exactOutput(
            amountInMaximum,
            path,
            amountOut,
            amountInMaximum
        );

        // Refund unspent MATIC balance
        ROUTER.refundETH();

        // Add token out to stack
        _updateToken(tokenOut);
    }

    function exactOutputToEther(
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) external payable returns (uint256 amountIn) {
        // Get tokenIn and tokenOut
        address tokenIn = _getLastToken(path);
        address tokenOut = _getFirstToken(path);

        // Check tokenOut
        _requireMsg(
            tokenOut == address(WMATIC),
            "exactOutputToEther",
            "Output not WMATIC"
        );

        // Get tokenIn balance
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // Swap token
        amountIn = _exactOutput(0, path, amountOut, amountInMaximum);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Exchange WMATIC to MATIC
        WMATIC.withdraw(amountOut);
    }

    function exactOutput(
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) external payable returns (uint256 amountIn) {
        // Get tokenIn and tokenOut
        address tokenIn = _getLastToken(path);
        address tokenOut = _getFirstToken(path);

        // Get tokenIn balance
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // Swap token
        amountIn = _exactOutput(0, path, amountOut, amountInMaximum);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Add token out to stack
        _updateToken(tokenOut);
    }

    function _getFirstToken(bytes memory path) internal pure returns (address) {
        return path.toAddress(0);
    }

    function _getLastToken(bytes memory path) internal pure returns (address) {
        _requireMsg(path.length >= PATH_SIZE, "General", "Path size too small");
        return path.toAddress(path.length - ADDRESS_SIZE);
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
        // Init struct
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

        // Try swap token
        try ROUTER.exactInputSingle{value: value}(params) returns (
            uint256 amountOut
        ) {
            return amountOut;
        } catch Error(string memory reason) {
            _revertMsg("exactInputSingle", reason);
        } catch {
            _revertMsg("exactInputSingle");
        }
    }

    function _exactInput(
        uint256 value,
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) internal returns (uint256) {
        // Init struct
        ISwapRouter.ExactInputParams memory params =
            ISwapRouter.ExactInputParams({
                path: path,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum
            });

        // Try swap token
        try ROUTER.exactInput{value: value}(params) returns (
            uint256 amountOut
        ) {
            return amountOut;
        } catch Error(string memory reason) {
            _revertMsg("exactInput", reason);
        } catch {
            _revertMsg("exactInput");
        }
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
        // Init struct
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

        // Try swap
        try ROUTER.exactOutputSingle{value: value}(params) returns (
            uint256 amountIn
        ) {
            return amountIn;
        } catch Error(string memory reason) {
            _revertMsg("exactOutputSingle", reason);
        } catch {
            _revertMsg("exactOutputSingle");
        }
    }

    function _exactOutput(
        uint256 value,
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) internal returns (uint256) {
        // Init struct
        ISwapRouter.ExactOutputParams memory params =
            ISwapRouter.ExactOutputParams({
                path: path,
                recipient: address(this),
                deadline: block.timestamp,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum
            });

        // Try swap token
        try ROUTER.exactOutput{value: value}(params) returns (
            uint256 amountIn
        ) {
            return amountIn;
        } catch Error(string memory reason) {
            _revertMsg("exactOutput", reason);
        } catch {
            _revertMsg("exactOutput");
        }
    }
}
