const {
  balance,
  BN,
  constants,
  ether,
  expectRevert,
} = require('@openzeppelin/test-helpers');

const { tracker } = balance;
const { MAX_UINT256 } = constants;
const utils = web3.utils;
const { expect } = require('chai');
const {
  DAI_TOKEN,
  WETH_TOKEN,
  UNISWAPV3_ROUTER,
  UNISWAPV3_QUOTER,
  USDT_TOKEN,
  USDC_TOKEN,
  WMATIC_TOKEN,
} = require('./utils/constants');

const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getHandlerReturn,
  getCallData,
  tokenProviderUniV3,
  mwei,
} = require('./utils/utils');

const HUniswapV3 = artifacts.require('HUniswapV3');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IERC20 = artifacts.require('IERC20');
const ISwapRouter = artifacts.require('ISwapRouter');
const IQuoter = artifacts.require('IQuoter');

contract('UniswapV3 Swap', function([_, user, someone]) {
  let id;
  const tokenAddress = DAI_TOKEN;
  const token2Address = USDC_TOKEN;
  const token3Address = USDT_TOKEN;

  const fee = 100; // 0.01%
  const fee2 = 500; // 0.05%

  let balanceUser;
  let balanceProxy;
  let tokenUser;
  let token2User;
  let wethUser;
  let tokenProvider;
  let tokenProvider2;

  before(async function() {
    tokenProvider = await tokenProviderUniV3(tokenAddress, token2Address, fee);
    tokenProvider2 = await tokenProviderUniV3(WETH_TOKEN, token2Address, fee2);

    this.registry = await Registry.new();
    this.hUniswapV3 = await HUniswapV3.new();
    await this.registry.register(
      this.hUniswapV3.address,
      utils.asciiToHex('UniswapV3')
    );
    this.router = await ISwapRouter.at(UNISWAPV3_ROUTER);
    this.quoter = await IQuoter.at(UNISWAPV3_QUOTER);
    this.proxy = await Proxy.new(this.registry.address);
    this.token = await IERC20.at(tokenAddress);
    this.token2 = await IERC20.at(token2Address);
    this.token3 = await IERC20.at(token3Address);

    this.wmatic = await IERC20.at(WMATIC_TOKEN);
    this.weth = await IERC20.at(WETH_TOKEN);
  });

  beforeEach(async function() {
    id = await evmSnapshot();
    balanceUser = await tracker(user);
    balanceProxy = await tracker(this.proxy.address);
    tokenUser = await this.token.balanceOf.call(user);
    token2User = await this.token2.balanceOf.call(user);
    token3User = await this.token3.balanceOf.call(user);
    wethUser = await this.weth.balanceOf.call(user);
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Matic to Token', function() {
    describe('Exact input', function() {
      describe('single path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const tokenOut = token2Address;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Estimate result
          const result = await this.quoter.quoteExactInputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleFromMatic', [
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            value,
            this.token2,
            token2User,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const tokenOut = token2Address;
          const fee = new BN('500'); // 0.05%;
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Estimate result
          const result = await this.quoter.quoteExactInputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleFromMatic', [
            tokenOut,
            fee,
            MAX_UINT256,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            value,
            this.token2,
            token2User,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenOut = token2Address;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN(mwei('100').toString());
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleFromMatic', [
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert.unspecified(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'Too little received'
          );
        });

        it('Matic balance < amountIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const tokenOut = token2Address;
          const fee = new BN('3000');
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleFromMatic', [
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert.unspecified(
            this.proxy.execMock(to, data, {
              from: user,
              value: value.div(new BN('2')),
            })
          );
        });

        it('to Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleFromMatic', [
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token out is WMATIC'
          );
        });
      });

      describe('multi-path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const path = encodePath(tokens, fees);

          // Estimate result
          const result = await this.quoter.quoteExactInput.call(path, amountIn);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputFromMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            value,
            this.token,
            tokenUser,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const path = encodePath(tokens, fees);

          // Estimate result
          const result = await this.quoter.quoteExactInput.call(path, amountIn);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputFromMatic', [
            path,
            MAX_UINT256,
            amountOutMinimum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            value,
            this.token,
            tokenUser,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const amountIn = value;
          const amountOutMinimum = ether('100'); //new BN('1');
          const path = encodePath(tokens, fees);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputFromMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'Too little received'
          );
        });

        it('Matic balance < amountIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const path = encodePath(tokens, fees);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputFromMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert.unspecified(
            this.proxy.execMock(to, data, {
              from: user,
              value: value.div(new BN('2')),
            })
          );
        });

        it('from non Matic token', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WETH_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const path = encodePath(tokens, fees);

          await this.weth.transfer(this.proxy.address, amountIn, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(this.weth.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputFromMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token in is not WMATIC'
          );
        });
      });
    });

    describe('Exact output', function() {
      describe('single path', function() {
        it('normal', async function() {
          const value = ether('10');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const tokenOut = token2Address;
          const fee = new BN('500'); /* 0.05% */
          const amountOut = new BN(mwei('1').toString());
          const amountInMaximum = value;
          const sqrtPriceLimitX96 = new BN('0');

          // Estimate result
          const result = await this.quoter.quoteExactOutputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleFromMatic', [
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            amountOut,
            token2User,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('10');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const tokenOut = token2Address;
          const fee = new BN('500'); /* 0.05% */
          const amountOut = new BN(mwei('1').toString());
          const sqrtPriceLimitX96 = new BN('0');

          // Estimate result
          const result = await this.quoter.quoteExactOutputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleFromMatic', [
            tokenOut,
            fee,
            amountOut,
            MAX_UINT256,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            amountOut,
            token2User,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokenOut = token2Address;
          const fee = new BN('500'); /* 0.05% */
          const amountOut = new BN(mwei('100000').toString());
          const amountInMaximum = value;
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleFromMatic', [
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutputSingle: STF'
          );
        });

        it('to Matic', async function() {
          const value = ether('10');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); /* 0.05% */
          const amountOut = new BN(mwei('1').toString());
          const amountInMaximum = value;
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleFromMatic', [
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token out is WMATIC'
          );
        });
      });

      describe('multi-path', function() {
        it('normal', async function() {
          const value = ether('1000');
          const to = this.hUniswapV3.address;

          // Set swap info
          // path is in reverse order
          const tokens = [tokenAddress, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('100');
          const amountInMaximum = value;

          // Estimate result
          const result = await this.quoter.quoteExactOutput.call(
            path,
            amountOut
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputFromMatic', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            amountOut,
            tokenUser,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1000');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [tokenAddress, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('100');

          // Estimate result
          const result = await this.quoter.quoteExactOutput.call(
            path,
            amountOut
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputFromMatic', [
            path,
            amountOut,
            MAX_UINT256,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutputFromMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            amountOut,
            tokenUser,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [tokenAddress, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('200000');
          const amountInMaximum = value;

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputFromMatic', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutput: STF'
          );
        });
      });
    });
  });

  describe('Token to Matic', function() {
    describe('Exact input', function() {
      describe('single path', function() {
        it('normal', async function() {
          const value = new BN(mwei('1').toString());
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountIn, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(this.token2.address);

          // Estimate result
          const result = await this.quoter.quoteExactInputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleToMatic', [
            tokenIn,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          await verifyExactInputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            token2User,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = new BN(mwei('1').toString());
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountIn, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(this.token.address);

          // Estimate result
          const result = await this.quoter.quoteExactInputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleToMatic', [
            tokenIn,
            fee,
            MAX_UINT256,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify result
          await verifyExactInputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            token2User,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn', async function() {
          const value = new BN(mwei('1').toString());
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = ether('100');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountIn, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(this.token2.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleToMatic', [
            tokenIn,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInputSingle: Too little received'
          );
        });

        it('tokenIn balance < amountIn', async function() {
          const value = new BN(mwei('1').toString());
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = ether('100');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(
            this.proxy.address,
            amountIn.div(new BN('2')),
            {
              from: tokenProvider2,
            }
          );
          await this.proxy.updateTokenMock(this.token2.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleToMatic', [
            tokenIn,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInputSingle: STF'
          );
        });

        it('from Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingleToMatic', [
            tokenIn,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token in is WMATIC'
          );
        });
      });

      describe('multi-path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [tokenAddress, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.token.transfer(this.proxy.address, amountIn, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(this.token.address);

          // Estimate result
          const result = await this.quoter.quoteExactInput.call(path, amountIn);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputToMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify result
          await verifyExactInputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            tokenUser,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [tokenAddress, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.token.transfer(this.proxy.address, amountIn, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(this.token.address);

          // Estimate result
          const result = await this.quoter.quoteExactInput.call(path, amountIn);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputToMatic', [
            path,
            MAX_UINT256,
            amountOutMinimum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify result
          await verifyExactInputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            tokenUser,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [tokenAddress, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = ether('100');
          await this.token.transfer(this.proxy.address, amountIn, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputToMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInput: Too little received'
          );
        });

        it('tokenIn balance < amountIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [tokenAddress, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = ether('100');
          await this.token.transfer(
            this.proxy.address,
            amountIn.div(new BN('2')),
            {
              from: tokenProvider,
            }
          );
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputToMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInput: STF'
          );
        });

        it('token out is not Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [tokenAddress, token2Address, WETH_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.token.transfer(this.proxy.address, amountIn, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputToMatic', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token out is not WMATIC'
          );
        });
      });
    });

    describe('Exact output', function() {
      describe('single path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('1');
          const amountInMaximum = new BN(mwei('3000').toString());
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(token2Address);

          // Estimate result
          const result = await this.quoter.quoteExactOutputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleToMatic', [
            tokenIn,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify result
          await verifyExactOutputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            token2User,
            amountInMaximum,
            amountOut,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('1');
          const amountInMaximum = new BN(mwei('3000').toString());
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(token2Address);

          // Estimate result
          const result = await this.quoter.quoteExactOutputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleToMatic', [
            tokenIn,
            fee,
            amountOut,
            MAX_UINT256,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify result
          await verifyExactOutputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            token2User,
            amountInMaximum,
            amountOut,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokenIn = token2Address;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('10000');
          const amountInMaximum = new BN(mwei('3000').toString());
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(token2Address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleToMatic', [
            tokenIn,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutputSingle: STF'
          );
        });

        it('tokenIn is Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('1');
          const amountInMaximum = new BN(mwei('100').toString());
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingleToMatic', [
            tokenIn,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token in is WMATIC'
          );
        });
      });

      describe('multi-path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('1');
          const amountInMaximum = ether('10000');
          await this.token.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(tokenAddress);

          // Estimate result
          const result = await this.quoter.quoteExactOutput.call(
            path,
            amountOut
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputToMatic', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify result
          await verifyExactOutputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            tokenUser,
            amountInMaximum,
            amountOut,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('1');
          const amountInMaximum = ether('10000');
          await this.token.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(tokenAddress);

          // Estimate result
          const result = await this.quoter.quoteExactOutput.call(
            path,
            amountOut
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputToMatic', [
            path,
            amountOut,
            MAX_UINT256,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify result
          await verifyExactOutputToMatic(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            tokenUser,
            amountInMaximum,
            amountOut,
            balanceProxy,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;
          // Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('10000');
          const amountInMaximum = ether('10');
          await this.token.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(tokenAddress);

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputToMatic', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutput: STF'
          );
        });

        it('tokenOut is not Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WETH_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('10000');
          const amountInMaximum = ether('10');
          await this.token.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(tokenAddress);

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputToMatic', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token out is not WMATIC'
          );
        });
      });
    });
  });

  describe('Token to Token', function() {
    describe('Exact input', function() {
      describe('single path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = new BN(mwei('5000').toString());
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountIn, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(this.token2.address);

          // Estimate result
          const result = await this.quoter.quoteExactInputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            token2User,
            this.weth,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = new BN(mwei('5000').toString());
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountIn, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(this.token2.address);

          // Estimate result
          const result = await this.quoter.quoteExactInputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingle', [
            tokenIn,
            tokenOut,
            fee,
            MAX_UINT256,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            tokenUser,
            this.weth,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = new BN(mwei('1').toString());
          const amountOutMinimum = ether('1');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountIn, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(this.token2.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInputSingle: Too little received'
          );
        });

        it('tokenIn amount < amountIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = new BN(mwei('5000').toString());
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(
            this.proxy.address,
            amountIn.div(new BN('2')),
            {
              from: tokenProvider,
            }
          );
          await this.proxy.updateTokenMock(this.token2.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInputSingle: STF'
          );
        });

        it('from Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token in or token out is WMATIC'
          );
        });

        it('to Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WETH_TOKEN;
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactInputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'token in or token out is WMATIC'
          );
        });
      });

      describe('multi-path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [tokenAddress, token2Address, WETH_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.token.transfer(this.proxy.address, amountIn, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(this.token.address);

          // Estimate result
          const result = await this.quoter.quoteExactInput.call(path, amountIn);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            tokenUser,
            this.weth,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [tokenAddress, token2Address, WETH_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.token.transfer(this.proxy.address, amountIn, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(this.token.address);

          // Estimate result
          const result = await this.quoter.quoteExactInput.call(path, amountIn);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            MAX_UINT256,
            amountOutMinimum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactInput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            tokenUser,
            this.weth,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [tokenAddress, token2Address, WETH_TOKEN];
          const fees = [new BN(500) /* 0.05% */, new BN(500) /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = ether('100');

          await this.token.transfer(
            this.proxy.address,
            amountIn.div(new BN('2')),
            {
              from: tokenProvider,
            }
          );
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInput: STF'
          );
        });

        it('tokenIn balance < amountIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [tokenAddress, token2Address, WETH_TOKEN];
          const fees = [new BN(500) /* 0.05% */, new BN(500) /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');

          await this.token.transfer(
            this.proxy.address,
            amountIn.div(new BN('2')),
            {
              from: tokenProvider,
            }
          );
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactInput: STF'
          );
        });

        it('from Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, WETH_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          //   const receipt = await
          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'path include WMATIC'
          );
        });

        it('to Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [WETH_TOKEN, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          //   const receipt = await
          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'path include WMATIC'
          );
        });
      });
    });

    describe('Exact output', function() {
      describe('single path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('1');
          const amountInMaximum = new BN(mwei('10000').toString());
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(token2Address);

          // Estimate result
          const result = await this.quoter.quoteExactOutputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            amountInMaximum,
            token2User,
            this.weth,
            amountOut,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('1');
          const amountInMaximum = new BN(mwei('10000').toString());
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(token2Address);

          // Estimate result
          const result = await this.quoter.quoteExactOutputSingle.call(
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            sqrtPriceLimitX96
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            MAX_UINT256,
            sqrtPriceLimitX96,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token2,
            amountInMaximum,
            token2User,
            this.weth,
            amountOut,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('100');
          const amountInMaximum = new BN(mwei('10000').toString());
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider2,
          });
          await this.proxy.updateTokenMock(tokenAddress);

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutputSingle: STF'
          );
        });

        it('tokenIn balance < amountIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = token2Address;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('100');
          const amountInMaximum = new BN(mwei('10000').toString());
          const sqrtPriceLimitX96 = new BN('0');
          await this.token2.transfer(
            this.proxy.address,
            amountInMaximum.div(new BN('2')),
            {
              from: tokenProvider2,
            }
          );
          await this.proxy.updateTokenMock(tokenAddress);

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutputSingle: STF'
          );
        });

        it('from Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WMATIC_TOKEN;
          const tokenOut = WETH_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('1');
          const amountInMaximum = ether('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'toke in or token out is WMATIC'
          );
        });

        it('to Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokenIn = WETH_TOKEN;
          const tokenOut = WMATIC_TOKEN;
          const fee = new BN('500'); // 0.05%
          const amountOut = ether('1');
          const amountInMaximum = ether('1');
          const sqrtPriceLimitX96 = new BN('0');

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutputSingle', [
            tokenIn,
            tokenOut,
            fee,
            amountOut,
            amountInMaximum,
            sqrtPriceLimitX96,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'toke in or token out is WMATIC'
          );
        });
      });

      describe('multi-path', function() {
        it('normal', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          // path is in reverse order
          const tokens = [WETH_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('1');
          const amountInMaximum = ether('10000');
          await this.token.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider,
          });

          await this.proxy.updateTokenMock(tokenAddress);

          // Estimate result
          const result = await this.quoter.quoteExactOutput.call(
            path,
            amountOut
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutput', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            amountInMaximum,
            tokenUser,
            this.weth,
            amountOut,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        it('max amount', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WETH_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('1');
          const amountInMaximum = ether('10000');
          await this.token.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(tokenAddress);

          // Estimate result
          const result = await this.quoter.quoteExactOutput.call(
            path,
            amountOut
          );

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutput', [
            path,
            amountOut,
            MAX_UINT256,
          ]);

          const receipt = await this.proxy.execMock(to, data, {
            from: user,
            value: value,
          });

          profileGas(receipt);

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          // Verify
          await verifyExactOutput(
            this.proxy.address,
            handlerReturn,
            result,
            user,
            this.token,
            amountInMaximum,
            tokenUser,
            this.weth,
            amountOut,
            wethUser,
            balanceUser,
            receipt.receipt.gasUsed
          );
        });

        // should revert
        it('insufficient tokenIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WETH_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('100');
          const amountInMaximum = ether('10000');
          await this.token.transfer(this.proxy.address, amountInMaximum, {
            from: tokenProvider,
          });
          await this.proxy.updateTokenMock(tokenAddress);

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutput', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutput: STF'
          );
        });

        it('tokenIn balance < amountIn', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          // Set swap info
          const tokens = [WETH_TOKEN, token2Address, tokenAddress];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountOut = ether('100');
          const amountInMaximum = ether('10000');
          await this.token.transfer(
            this.proxy.address,
            amountInMaximum.div(new BN('2')),
            {
              from: tokenProvider,
            }
          );
          await this.proxy.updateTokenMock(tokenAddress);

          // Execution
          const data = getCallData(HUniswapV3, 'exactOutput', [
            path,
            amountOut,
            amountInMaximum,
          ]);

          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'HUniswapV3_exactOutput: STF'
          );
        });

        it('from Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [WETH_TOKEN, token2Address, WMATIC_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          //   const receipt = await
          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'path include WMATIC'
          );
        });

        it('to Matic', async function() {
          const value = ether('1');
          const to = this.hUniswapV3.address;

          //   Set swap info
          const tokens = [WMATIC_TOKEN, token2Address, WETH_TOKEN];
          const fees = [new BN('500') /* 0.05% */, new BN('500') /* 0.05% */];
          const path = encodePath(tokens, fees);
          const amountIn = value;
          const amountOutMinimum = new BN('1');
          await this.proxy.updateTokenMock(this.token.address);

          // Execution
          const data = getCallData(HUniswapV3, 'exactInput', [
            path,
            amountIn,
            amountOutMinimum,
          ]);

          //   const receipt = await
          await expectRevert(
            this.proxy.execMock(to, data, {
              from: user,
              value: value,
            }),
            'path include WMATIC'
          );
        });
      });
    });
  });
});

function encodePath(path, fees) {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match');
  }

  let encoded = '0x';
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2);
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * 3, '0');
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2);

  return encoded.toLowerCase();
}

async function verifyExactInputFromMatic(
  proxyAddress,
  tokenOutAmt,
  tokenOutExpAmt,
  user,
  tokenInAmt,
  tokenOut,
  tokenOutBeforeBalance,
  nativeTokenProxyBalance,
  nativeTokenUserBalance,
  gasUsed
) {
  // Verify result
  expect(tokenOutAmt).to.be.bignumber.eq(tokenOutExpAmt);
  expect(tokenOutAmt).to.be.bignumber.gt(new BN('0'));
  expect(await tokenOut.balanceOf.call(user)).to.be.bignumber.eq(
    tokenOutBeforeBalance.add(tokenOutExpAmt)
  );
  expect(await tokenOut.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );
  expect(await nativeTokenProxyBalance.delta()).to.be.bignumber.eq(ether('0'));
  expect(await nativeTokenUserBalance.delta()).to.be.bignumber.eq(
    ether('0')
      .sub(tokenInAmt)
      .sub(new BN(gasUsed))
  );
}

async function verifyExactInputToMatic(
  proxyAddress,
  tokenOutAmt,
  tokenOutExpAmt,
  user,
  tokenIn,
  tokenInBeforeBalance,
  nativeTokenProxyBalance,
  nativeTokenUserBalance,
  gasUsed
) {
  // Verify result
  expect(tokenOutAmt).to.be.bignumber.gt(new BN('0'));
  expect(tokenOutAmt).to.be.bignumber.eq(tokenOutExpAmt);
  expect(await nativeTokenUserBalance.delta()).to.be.bignumber.eq(
    ether('0')
      .add(tokenOutAmt)
      .sub(new BN(gasUsed))
  );

  expect(await tokenIn.balanceOf.call(user)).to.be.bignumber.eq(
    tokenInBeforeBalance
  );
  expect(await tokenIn.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );
  expect(await nativeTokenProxyBalance.delta()).to.be.bignumber.eq(ether('0'));
}

async function verifyExactOutputFromMatic(
  proxyAddress,
  tokenInAmt,
  tokenInExpAmt,
  user,
  tokenOut,
  tokenOutAmt,
  tokenOutBeforeBalance,
  nativeTokenProxyBalance,
  nativeTokenUserBalance,
  gasUsed
) {
  // Verify result
  expect(tokenInAmt).to.be.bignumber.eq(tokenInExpAmt);
  expect(await tokenOut.balanceOf.call(user)).to.be.bignumber.eq(
    tokenOutBeforeBalance.add(tokenOutAmt)
  );
  expect(await tokenOut.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );
  expect(await nativeTokenProxyBalance.delta()).to.be.bignumber.eq(ether('0'));
  expect(await nativeTokenUserBalance.delta()).to.be.bignumber.eq(
    ether('0')
      .sub(tokenInExpAmt)
      .sub(new BN(gasUsed))
  );
}

async function verifyExactOutputToMatic(
  proxyAddress,
  tokenInAmt,
  tokenInExpAmt,
  user,
  tokenIn,
  tokenInBeforeBalance,
  amountInMaximum,
  amountOut,
  nativeTokenProxyBalance,
  nativeTokenUserBalance,
  gasUsed
) {
  expect(tokenInAmt).to.be.bignumber.eq(tokenInExpAmt);
  expect(await tokenIn.balanceOf.call(user)).to.be.bignumber.eq(
    tokenInBeforeBalance.add(amountInMaximum).sub(tokenInExpAmt)
  );
  expect(await tokenIn.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );
  expect(await nativeTokenProxyBalance.delta()).to.be.bignumber.eq(ether('0'));
  expect(await nativeTokenUserBalance.delta()).to.be.bignumber.eq(
    amountOut.sub(new BN(gasUsed))
  );
}

async function verifyExactInput(
  proxyAddress,
  tokenOutAmt,
  tokenOutExpAmt,
  user,
  tokenIn,
  tokenInBeforeBalance,
  tokenOut,
  tokenOutBeforeBalance,
  nativeTokenUserBalance,
  gasUsed
) {
  // Verify if the amount of tokenOut is the same as pre-quote amount
  expect(tokenOutAmt).to.be.bignumber.eq(tokenOutExpAmt);

  // Verify if the amount of tokenOut is greater than 0
  expect(tokenOutAmt).to.be.bignumber.gt(new BN('0'));

  // Verify if user does spend all amount of tokenIn
  expect(await tokenIn.balanceOf.call(user)).to.be.bignumber.eq(
    tokenInBeforeBalance
  );

  // Verify if proxy swap all the tokenIn
  expect(await tokenIn.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );

  // Verify if proxy does not keep any tokenOut
  expect(await tokenOut.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );

  // Verify if user's tokenOut balance is correct
  expect(await tokenOut.balanceOf.call(user)).to.be.bignumber.eq(
    tokenOutBeforeBalance.add(tokenOutExpAmt)
  );

  // Verify if native token is returned to user
  expect(await nativeTokenUserBalance.delta()).to.be.bignumber.eq(
    ether('0').sub(new BN(gasUsed))
  );
}

async function verifyExactOutput(
  proxyAddress,
  tokenInAmt,
  tokenInExpAmt,
  user,
  tokenIn,
  amountInMaximum,
  tokenInBeforeBalance,
  tokenOut,
  amountOut,
  tokenOutBeforeBalance,
  nativeTokenUserBalance,
  gasUsed
) {
  // Verify if the amount of tokenIn is the same as pre-quote amount
  expect(tokenInAmt).to.be.bignumber.eq(tokenInExpAmt);

  // Verify if user's remaining tokenIn balance is the same as calculated amount
  expect(await tokenIn.balanceOf.call(user)).to.be.bignumber.eq(
    tokenInBeforeBalance.add(amountInMaximum).sub(tokenInExpAmt)
  );

  // Verify if proxy does not keep any tokenIn
  expect(await tokenIn.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );

  // Verify if proxy does not keep any tokenOut
  expect(await tokenOut.balanceOf.call(proxyAddress)).to.be.bignumber.eq(
    ether('0')
  );

  // Verify if user's tokenOut balance is correct
  expect(await tokenOut.balanceOf.call(user)).to.be.bignumber.eq(
    tokenOutBeforeBalance.add(amountOut)
  );

  // Verify if native token is returned to user
  expect(await nativeTokenUserBalance.delta()).to.be.bignumber.eq(
    ether('0').sub(new BN(gasUsed))
  );
}
