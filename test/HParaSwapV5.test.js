const {
  balance,
  BN,
  ether,
  expectRevert,
  constants,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const utils = web3.utils;
const { expect, assert } = require('chai');
const {
  DAI_TOKEN,
  USDC_TOKEN,
  NATIVE_TOKEN_ADDRESS,
  NATIVE_TOKEN_DECIMAL,
} = require('./utils/constants');
const { ZERO_BYTES32 } = constants;
const {
  evmRevert,
  evmSnapshot,
  mulPercent,
  getHandlerReturn,
  getCallData,
  tokenProviderQuick,
  impersonateAndInjectEther,
  expectEqWithinBps,
  callExternalApi,
  mwei,
} = require('./utils/utils');
const queryString = require('query-string');

const HParaSwapV5 = artifacts.require('HParaSwapV5');
const IRegistry = artifacts.require('IRegistry');
const Registry = artifacts.require('Registry');
const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const IProxy = artifacts.require('IProxy');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');

const POLYGON_NETWORK_ID = 137;
const URL_PARASWAP = 'https://apiv5.paraswap.io/';
const IGNORE_CHECKS_PARAM = 'ignoreChecks=true';
const URL_PARASWAP_PRICE = URL_PARASWAP + 'prices';
const URL_PARASWAP_TRANSACTION =
  URL_PARASWAP +
  'transactions/' +
  POLYGON_NETWORK_ID +
  '?' +
  IGNORE_CHECKS_PARAM;

async function getPriceData(
  srcToken,
  srcDecimals,
  destToken,
  destDecimals,
  amount,
  route = '',
  excludeDirectContractMethods = ''
) {
  const priceReq = queryString.stringifyUrl({
    url: URL_PARASWAP_PRICE,
    query: {
      srcToken: srcToken,
      srcDecimals: srcDecimals,
      destToken: destToken,
      destDecimals: destDecimals,
      amount: amount,
      network: POLYGON_NETWORK_ID,
      route: route,
      excludeDirectContractMethods: excludeDirectContractMethods,
    },
  });

  // Call Paraswap price API
  const priceResponse = await callExternalApi(priceReq);
  let priceData = priceResponse.json();
  if (priceResponse.ok === false) {
    assert.fail('ParaSwap price api fail:' + priceData.error);
  }

  return priceData;
}

async function getTransactionData(
  priceData,
  slippageInBps,
  userAddress,
  txOrigin
) {
  const body = {
    srcToken: priceData.priceRoute.srcToken,
    srcDecimals: priceData.priceRoute.srcDecimals,
    destToken: priceData.priceRoute.destToken,
    destDecimals: priceData.priceRoute.destDecimals,
    srcAmount: priceData.priceRoute.srcAmount,
    slippage: slippageInBps,
    userAddress: userAddress,
    txOrigin: txOrigin,
    priceRoute: priceData.priceRoute,
  };

  const txResp = await callExternalApi(URL_PARASWAP_TRANSACTION, 'post', body);
  const txData = await txResp.json();
  if (txResp.ok === false) {
    assert.fail('ParaSwap transaction api fail:' + txData.error);
  }

  return txData;
}

contract('ParaSwapV5', function([_, user, user2]) {
  let id;
  let initialEvmId;
  before(async function() {
    initialEvmId = await evmSnapshot();
    this.registry = await Registry.new();
    this.hParaSwap = await HParaSwapV5.new();

    await this.registry.register(
      this.hParaSwap.address,
      utils.asciiToHex('ParaSwapV5')
    );

    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });
  after(async function() {
    await evmRevert(initialEvmId);
  });

  // Because on-chain Proxy is not fee-charged proxy.
  // Skip on-chain proxy test cases until on-chain proxy is fee-charged.
  describe.skip('with on chain proxy', function() {
    const configs = [ZERO_BYTES32];
    describe('MATIC to Token', function() {
      const tokenAddress = DAI_TOKEN;
      const tokenDecimal = 18;
      const slippageInBps = 100; // 1%
      const wrongTokenAddress = USDC_TOKEN;
      let userBalance, proxyBalance, userTokenBalance;
      before(async function() {
        this.token = await IToken.at(tokenAddress);
      });

      beforeEach(async function() {
        userBalance = await tracker(user);
        proxyBalance = await tracker(this.onchainProxy.address);
        userTokenBalance = await this.token.balanceOf(user);
      });

      describe('Swap', function() {
        it('normal', async function() {
          // Get price
          const amount = ether('0.1');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );

          const expectReceivedAmount = priceData.priceRoute.destAmount;

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.onchainProxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount,
            tokenAddress,
            txData.data,
          ]);

          // Execute
          const receipt = await this.onchainProxy.batchExec(
            [to],
            configs,
            [callData],
            {
              from: user,
              value: amount,
            }
          );

          const userTokenBalanceAfter = await this.token.balanceOf(user);

          // Verify user token balance
          expectEqWithinBps(
            userTokenBalanceAfter.sub(userTokenBalance),
            expectReceivedAmount,
            slippageInBps
          );

          // Proxy should not have remaining token
          expect(
            await this.token.balanceOf(this.onchainProxy.address)
          ).to.be.bignumber.zero;

          // Verify MATIC balance
          expect(await proxyBalance.get()).to.be.bignumber.zero;
          expect(await userBalance.delta()).to.be.bignumber.eq(
            ether('0').sub(amount)
          );
        });

        it('msg.value greater than input MATIC amount', async function() {
          // Get price
          const amount = ether('0.1');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );
          const expectReceivedAmount = priceData.priceRoute.destAmount;

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.onchainProxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount,
            tokenAddress,
            txData.data,
          ]);

          // Execute
          const receipt = await this.onchainProxy.batchExec(
            [to],
            configs,
            [callData],
            {
              from: user,
              value: amount.add(ether('1')),
            }
          );

          const userTokenBalanceAfter = await this.token.balanceOf(user);

          // Verify user balance
          expectEqWithinBps(
            userTokenBalanceAfter.sub(userTokenBalance),
            expectReceivedAmount,
            slippageInBps
          );

          // Proxy should not have remaining token
          expect(
            await this.token.balanceOf(this.onchainProxy.address)
          ).to.be.bignumber.zero;

          // Verify MATIC balance
          expect(await proxyBalance.get()).to.be.bignumber.zero;
          expect(await userBalance.delta()).to.be.bignumber.eq(
            ether('0').sub(amount)
          );
        });

        it('should revert: wrong destination token(erc20)', async function() {
          // Get price
          const amount = ether('0.1');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.onchainProxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount,
            wrongTokenAddress,
            txData.data,
          ]);

          // Execute
          await expectRevert(
            this.onchainProxy.batchExec([to], configs, [callData], {
              from: user,
              value: amount,
            }),
            'HParaSwapV5_swap: Invalid output token amount'
          );
        });

        it('should revert: msg.value less than api amount', async function() {
          // Get price
          const amount = ether('10');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.onchainProxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount.sub(ether('0.05')),
            tokenAddress,
            txData.data,
          ]);

          // Execute
          await expectRevert(
            this.onchainProxy.batchExec([to], configs, [callData], {
              from: user,
              value: amount.sub(ether('0.05')),
            }),
            'HParaSwapV5__paraswapCall:'
          );
        });
      });
    }); // describe('MATIC to token') end

    describe.skip('token to Matic', function() {
      const tokenAddress = USDC_TOKEN;
      const tokenDecimal = 6;
      const slippageInBps = 100; // 1%
      let providerAddress;
      let userBalance, proxyBalance;

      before(async function() {
        providerAddress = await tokenProviderQuick(tokenAddress);
        this.token = await IToken.at(tokenAddress);
      });

      beforeEach(async function() {
        proxyBalance = await tracker(this.onchainProxy.address);
        userBalance = await tracker(user);
      });

      it('normal', async function() {
        // Get price
        const amount = mwei('500');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          tokenAddress,
          tokenDecimal,
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          amount
        );
        const expectReceivedAmount = priceData.priceRoute.destAmount;

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.onchainProxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          tokenAddress,
          amount,
          NATIVE_TOKEN_ADDRESS,
          txData.data,
        ]);

        // Transfer token to proxy
        await this.token.transfer(this.onchainProxy.address, amount, {
          from: providerAddress,
        });

        // Execute
        await this.onchainProxy.batchExec([to], configs, [callData], {
          from: user,
        });

        // Verify user balance
        const userBalanceDelta = await userBalance.delta();
        expectEqWithinBps(
          userBalanceDelta,
          expectReceivedAmount,
          slippageInBps
        );

        // Proxy should not have remaining token
        expect(
          await this.token.balanceOf(this.onchainProxy.address)
        ).to.be.bignumber.zero;

        expect(await proxyBalance.get()).to.be.bignumber.zero;
      });

      it('should revert: not enough srcToken', async function() {
        // Get price
        const amount = mwei('5000');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          tokenAddress,
          tokenDecimal,
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          amount
        );

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.onchainProxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          tokenAddress,
          amount,
          NATIVE_TOKEN_ADDRESS,
          txData.data,
        ]);

        // Transfer token to proxy
        await this.token.transfer(
          this.onchainProxy.address,
          amount.sub(mwei('1')),
          {
            from: providerAddress,
          }
        );

        // Execute
        await expectRevert(
          this.onchainProxy.batchExec([to], configs, [callData], {
            from: user,
          }),
          'HParaSwapV5__paraswapCall'
        );
      });
    }); // describe('token to MATIC') end

    describe('token to token', function() {
      const token1Address = DAI_TOKEN;
      const token1Decimal = 18;
      const token2Address = USDC_TOKEN;
      const token2Decimal = 6;
      const slippageInBps = 100; // 1%
      let providerAddress;

      before(async function() {
        providerAddress = await tokenProviderQuick(token1Address);
        this.token = await IToken.at(token1Address);
        this.token2 = await IToken.at(token2Address);
      });

      it('normal', async function() {
        // Get price
        const amount = ether('500');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          token1Address,
          token1Decimal,
          token2Address,
          token2Decimal,
          amount
        );

        const expectReceivedAmount = priceData.priceRoute.destAmount;

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.onchainProxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          token1Address,
          amount,
          token2Address,
          txData.data,
        ]);

        // Transfer token to proxy
        await this.token.transfer(this.onchainProxy.address, amount, {
          from: providerAddress,
        });

        // Execute
        await this.onchainProxy.batchExec([to], configs, [callData], {
          from: user,
        });

        const userToken2Balance = await this.token2.balanceOf(user);

        // Verify user balance
        expectEqWithinBps(
          userToken2Balance,
          expectReceivedAmount,
          slippageInBps
        );

        // Proxy should not have remaining token
        expect(
          await this.token2.balanceOf(this.onchainProxy.address)
        ).to.be.bignumber.zero;
      });
    }); // describe('token to token') end
  });

  describe('with local deploy proxy', function() {
    describe('MATIC to Token', function() {
      const tokenAddress = DAI_TOKEN;
      const tokenDecimal = 18;
      const slippageInBps = 100; // 1%
      const wrongTokenAddress = USDC_TOKEN;
      let userBalance, proxyBalance, userTokenBalance;
      before(async function() {
        this.token = await IToken.at(tokenAddress);
      });

      beforeEach(async function() {
        userBalance = await tracker(user);
        proxyBalance = await tracker(this.proxy.address);
        userTokenBalance = await this.token.balanceOf(user);
      });

      describe('Swap', function() {
        it('normal', async function() {
          // Get price
          const amount = ether('0.1');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );

          const expectReceivedAmount = priceData.priceRoute.destAmount;

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.proxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount,
            tokenAddress,
            txData.data,
          ]);

          // Execute
          const receipt = await this.proxy.execMock(to, callData, {
            from: user,
            value: amount,
          });

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          const userTokenBalanceAfter = await this.token.balanceOf(user);

          // Verify user token balance
          expect(handlerReturn).to.be.bignumber.eq(
            userTokenBalanceAfter.sub(userTokenBalance)
          );
          expect(
            userTokenBalanceAfter.sub(userTokenBalance)
          ).to.be.bignumber.gt(
            mulPercent(expectReceivedAmount, 100 - slippageInBps / 100)
          );

          // Proxy should not have remaining token
          expect(
            await this.token.balanceOf(this.proxy.address)
          ).to.be.bignumber.zero;

          // Verify MATIC balance
          expect(await proxyBalance.get()).to.be.bignumber.zero;
          expect(await userBalance.delta()).to.be.bignumber.eq(
            ether('0').sub(amount)
          );
        });

        it('msg.value greater than input MATIC amount', async function() {
          // Get price
          const amount = ether('0.1');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.proxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount,
            tokenAddress,
            txData.data,
          ]);

          // Execute
          const receipt = await this.proxy.execMock(to, callData, {
            from: user,
            value: amount.add(ether('1')),
          });

          const handlerReturn = utils.toBN(
            getHandlerReturn(receipt, ['uint256'])[0]
          );

          const userTokenBalanceAfter = await this.token.balanceOf(user);

          // Verify user balance
          expect(handlerReturn).to.be.bignumber.eq(
            userTokenBalanceAfter.sub(userTokenBalance)
          );

          // Proxy should not have remaining token
          expect(
            await this.token.balanceOf(this.proxy.address)
          ).to.be.bignumber.zero;

          // Verify MATIC balance
          expect(await proxyBalance.get()).to.be.bignumber.zero;
          expect(await userBalance.delta()).to.be.bignumber.eq(
            ether('0').sub(amount)
          );
        });

        it('should revert: wrong destination token(erc20)', async function() {
          // Get price
          const amount = ether('0.1');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.proxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount,
            wrongTokenAddress,
            txData.data,
          ]);

          // Execute
          await expectRevert(
            this.proxy.execMock(to, callData, {
              from: user,
              value: amount,
            }),
            'HParaSwapV5_swap: Invalid output token amount'
          );
        });

        it('should revert: msg.value less than api amount', async function() {
          // Get price
          const amount = ether('10');
          const to = this.hParaSwap.address;

          // Call Paraswap price API
          const priceData = await getPriceData(
            NATIVE_TOKEN_ADDRESS,
            NATIVE_TOKEN_DECIMAL,
            tokenAddress,
            tokenDecimal,
            amount
          );

          // Call Paraswap transaction API
          const txData = await getTransactionData(
            priceData,
            slippageInBps,
            this.proxy.address,
            user
          );

          // Prepare handler data
          const callData = getCallData(HParaSwapV5, 'swap', [
            NATIVE_TOKEN_ADDRESS,
            amount.sub(ether('0.05')),
            tokenAddress,
            txData.data,
          ]);

          // Execute
          await expectRevert(
            this.proxy.execMock(to, callData, {
              from: user,
              value: amount.sub(ether('0.05')),
            }),
            'HParaSwapV5__paraswapCall:'
          );
        });
      });
    }); // describe('MATIC to token') end

    describe.skip('token to Matic', function() {
      const tokenAddress = DAI_TOKEN;
      const tokenDecimal = 18;
      const slippageInBps = 100; // 1%
      let providerAddress;
      let userBalance, proxyBalance;
      before(async function() {
        providerAddress = await tokenProviderQuick(tokenAddress);
        this.token = await IToken.at(tokenAddress);
      });

      beforeEach(async function() {
        proxyBalance = await tracker(this.proxy.address);
        userBalance = await tracker(user);
      });

      it('normal', async function() {
        // Get price
        const amount = ether('500');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          tokenAddress,
          tokenDecimal,
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          amount
        );

        const expectReceivedAmount = priceData.priceRoute.destAmount;

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.proxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          tokenAddress,
          amount,
          NATIVE_TOKEN_ADDRESS,
          txData.data,
        ]);

        // Transfer token to proxy
        await this.token.transfer(this.proxy.address, amount, {
          from: providerAddress,
        });

        // Execute
        const receipt = await this.proxy.execMock(to, callData, {
          from: user,
        });

        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify user balance
        const userBalanceDelta = await userBalance.delta();
        expect(handlerReturn).to.be.bignumber.eq(userBalanceDelta);

        // Proxy should not have remaining token
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify MATIC balance
        expect(await proxyBalance.get()).to.be.bignumber.zero;
        expect(userBalanceDelta).to.be.bignumber.gt(
          mulPercent(expectReceivedAmount, 100 - slippageInBps / 100)
        );
      });

      it('should revert: not enough srcToken', async function() {
        // Get price
        const amount = ether('5000');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          tokenAddress,
          tokenDecimal,
          NATIVE_TOKEN_ADDRESS,
          NATIVE_TOKEN_DECIMAL,
          amount
        );

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.proxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          tokenAddress,
          amount,
          NATIVE_TOKEN_ADDRESS,
          txData.data,
        ]);

        // Transfer token to proxy
        await this.token.transfer(this.proxy.address, amount.sub(ether('1')), {
          from: providerAddress,
        });

        // Execute
        await expectRevert(
          this.proxy.execMock(to, callData, {
            from: user,
          }),
          'HParaSwapV5__paraswapCall'
        );
      });
    }); // describe('token to MATIC') end

    describe('token to token', function() {
      const token1Address = DAI_TOKEN;
      const token1Decimal = 18;
      const token2Address = USDC_TOKEN;
      const token2Decimal = 6;
      const slippageInBps = 100; // 1%
      let providerAddress;
      before(async function() {
        providerAddress = await tokenProviderQuick(token1Address);
        this.token = await IToken.at(token1Address);
        this.token2 = await IToken.at(token2Address);
      });

      it('normal', async function() {
        // Get price
        const amount = ether('500');
        const to = this.hParaSwap.address;

        // Call Paraswap price API
        const priceData = await getPriceData(
          token1Address,
          token1Decimal,
          token2Address,
          token2Decimal,
          amount
        );

        const expectReceivedAmount = priceData.priceRoute.destAmount;

        // Call Paraswap transaction API
        const txData = await getTransactionData(
          priceData,
          slippageInBps,
          this.proxy.address,
          user
        );

        // Prepare handler data
        const callData = getCallData(HParaSwapV5, 'swap', [
          token1Address,
          amount,
          token2Address,
          txData.data,
        ]);

        // Transfer token to proxy
        await this.token.transfer(this.proxy.address, amount, {
          from: providerAddress,
        });

        // Execute
        const receipt = await this.proxy.execMock(to, callData, {
          from: user,
        });

        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        const userToken2Balance = await this.token2.balanceOf(user);

        // Verify user balance
        expect(handlerReturn).to.be.bignumber.eq(userToken2Balance);
        expect(userToken2Balance).to.be.bignumber.gt(
          mulPercent(expectReceivedAmount, 100 - slippageInBps / 100)
        );

        // Proxy should not have remaining token
        expect(
          await this.token2.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
      });
    }); // describe('token to token') end
  });
});
