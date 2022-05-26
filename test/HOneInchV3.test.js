const {
  balance,
  BN,
  ether,
  expectRevert,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const utils = web3.utils;
const { expect } = require('chai');
const {
  DAI_TOKEN,
  USDC_TOKEN,
  WETH_TOKEN,
  NATIVE_TOKEN_ADDRESS,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  mulPercent,
  profileGas,
  getHandlerReturn,
  getFuncSig,
  getCallData,
  tokenProviderDyfn,
} = require('./utils/utils');
const fetch = require('node-fetch');
const queryString = require('query-string');

const HOneInch = artifacts.require('HOneInchV3');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IOneInch = artifacts.require('IAggregationRouterV3');

const SELECTOR_1INCH_SWAP = getFuncSig(IOneInch, 'swap');
const SELECTOR_1INCH_UNOSWAP = getFuncSig(IOneInch, 'unoswap');

/// Change url for different chain
/// - Ethereum: https://api.1inch.exchange/v3.0/1/
/// - Polygon: https://api.1inch.exchange/v3.0/137/
/// - BSC: https://api.1inch.exchange/v3.0/56/
const URL_1INCH = 'https://api.1inch.exchange/v3.0/137/';
const URL_1INCH_SWAP = URL_1INCH + 'swap';

const UNOSWAP_PROTOCOLS = ['POLYGON_SUSHISWAP', 'POLYGON_QUICKSWAP'].join(',');
const NON_UNOSWAP_PROTOCOLS = [
  'POLYGON_DODO',
  'POLYGON_DODO_V2',
  'POLYGON_KYBER_DMM',
  'POLYGON_BALANCER_V2',
  'WMATIC',
  'POLYGON_CURVE',
  'POLYGON_AAVE_V2',
].join(',');

contract('OneInchV3 Swap', function([_, user]) {
  let id;

  before(async function() {
    // ============= 1inch API Health Check =============
    const healthCkeck = await fetch(URL_1INCH + 'healthcheck');
    if (!healthCkeck.ok) {
      console.error(`=====> 1inch API not healthy now, skip the tests`);
      this.skip();
    }
    // ==================================================

    this.registry = await Registry.new();
    this.hOneInch = await HOneInch.new();
    await this.registry.register(
      this.hOneInch.address,
      utils.asciiToHex('OneInchV3')
    );
    this.proxy = await Proxy.new(this.registry.address);
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Matic to Token', function() {
    const tokenAddress = DAI_TOKEN;

    let balanceUser;
    let balanceProxy;
    let tokenUser;

    before(async function() {
      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      tokenUser = await this.token.balanceOf(user);
    });

    describe('Swap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: NATIVE_TOKEN_ADDRESS,
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify return value
        const tokenUserEnd = await this.token.balanceOf(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        // Verify token balance
        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );

        profileGas(receipt);
      });

      it('msg.value greater than input matic amount', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;

        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: NATIVE_TOKEN_ADDRESS,
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value.add(ether('1')),
        });

        // Verify return value
        const tokenUserEnd = await this.token.balanceOf(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        // Verify token balance
        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );

        profileGas(receipt);
      });
    });

    describe.skip('Unoswap', function() {
      // Prepare data
      it('normal', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: NATIVE_TOKEN_ADDRESS,
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          NATIVE_TOKEN_ADDRESS,
          value,
          tokenAddress,
          swapData.tx.data,
        ]);

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify return value
        const tokenUserEnd = await this.token.balanceOf(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        // Verify token balance
        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );

        profileGas(receipt);
      });

      it('should revert: wrong src token amount(matic)', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: NATIVE_TOKEN_ADDRESS,
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          NATIVE_TOKEN_ADDRESS,
          value.sub(new BN(1000)),
          tokenAddress,
          swapData.tx.data,
        ]);

        // Execute
        await expectRevert(
          this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
          'HOneInchV3_unoswap: invalid msg.value'
        );
      });
    });
  });

  describe('Token to Matic', function() {
    const tokenAddress = DAI_TOKEN;

    let balanceUser;
    let balanceProxy;
    let tokenUser;
    let providerAddress;

    before(async function() {
      providerAddress = await tokenProviderDyfn(tokenAddress, USDC_TOKEN);

      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      tokenUser = await this.token.balanceOf(user);
    });

    describe('Swap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: tokenAddress,
            toTokenAddress: NATIVE_TOKEN_ADDRESS,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const balanceUserDelta = await balanceUser.delta();
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(balanceUserDelta);

        // Verify token balance
        expect(await this.token.balanceOf(user)).to.be.bignumber.eq(tokenUser);
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(balanceUserDelta).to.be.bignumber.gte(
          ether('0')
            // sub 1 more percent to tolerate the slippage calculation difference with 1inch
            .add(mulPercent(quote, 100 - slippage - 1))
        );

        profileGas(receipt);
      });
    });

    describe.skip('Unoswap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: tokenAddress,
            toTokenAddress: NATIVE_TOKEN_ADDRESS,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          tokenAddress,
          value,
          NATIVE_TOKEN_ADDRESS,
          swapData.tx.data,
        ]);

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const balanceUserDelta = await balanceUser.delta();
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(balanceUserDelta);

        // Verify token balance
        expect(await this.token.balanceOf(user)).to.be.bignumber.eq(tokenUser);
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(balanceUserDelta).to.be.bignumber.gte(
          ether('0')
            // sub 1 more percent to tolerate the slippage calculation difference with 1inch
            .add(mulPercent(quote, 100 - slippage - 1))
        );

        profileGas(receipt);
      });
    });
  });

  describe('Token to Token', function() {
    const token0Address = DAI_TOKEN;
    const token1Address = USDC_TOKEN;

    let balanceUser;
    let balanceProxy;
    let token0User;
    let token1User;
    let wethUser;
    let wethProxy;
    let providerAddress;

    before(async function() {
      providerAddress = await tokenProviderDyfn(token0Address, USDC_TOKEN);

      this.token0 = await IToken.at(token0Address);
      this.token1 = await IToken.at(token1Address);
      this.weth = await IToken.at(WETH_TOKEN);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      token0User = await this.token0.balanceOf(user);
      token1User = await this.token1.balanceOf(user);
      wethUser = await this.weth.balanceOf(user);
      wethProxy = await this.weth.balanceOf(this.proxy.address);
    });

    describe('Swap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const token1UserEnd = await this.token1.balanceOf(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(token1UserEnd.sub(token1User));

        // Verify token0 balance
        expect(await this.token0.balanceOf(user)).to.be.bignumber.eq(
          token0User
        );
        expect(
          await this.token0.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify token1 balance
        expect(await this.token1.balanceOf(user)).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          token1User.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token1.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));

        profileGas(receipt);
      });
    });

    describe.skip('Unoswap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          token0Address,
          value,
          token1Address,
          swapData.tx.data,
        ]);

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const token1UserEnd = await this.token1.balanceOf(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(token1UserEnd.sub(token1User));

        // Verify token0 balance
        expect(await this.token0.balanceOf(user)).to.be.bignumber.eq(
          token0User
        );
        expect(
          await this.token0.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify token1 balance
        expect(await this.token1.balanceOf(user)).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          token1User.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token1.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));

        profileGas(receipt);
      });

      it('to weth', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: WETH_TOKEN,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          token0Address,
          value,
          WETH_TOKEN,
          swapData.tx.data,
        ]);

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const wethUserEnd = await this.weth.balanceOf(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(wethUserEnd.sub(wethUser));

        // Verify token0 balance
        expect(await this.token0.balanceOf(user)).to.be.bignumber.eq(
          token0User
        );
        expect(
          await this.token0.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify weth balance
        expect(await this.weth.balanceOf(user)).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          wethUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.weth.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));

        profileGas(receipt);
      });

      it('append extra data to API data at the end', async function() {
        // Prepare data
        const appendData = 'ff0000ff';
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: WETH_TOKEN,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        var data = getCallData(HOneInch, 'unoswap', [
          token0Address,
          value,
          WETH_TOKEN,
          swapData.tx.data,
        ]);
        data = data + appendData;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const wethUserEnd = await this.weth.balanceOf(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(wethUserEnd.sub(wethUser));

        // Verify token0 balance
        expect(await this.token0.balanceOf(user)).to.be.bignumber.eq(
          token0User
        );
        expect(
          await this.token0.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify weth balance
        expect(await this.weth.balanceOf(user)).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          wethUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.weth.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));

        profileGas(receipt);
      });

      it('should revert: wrong dst token(matic)', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          token0Address,
          value,
          NATIVE_TOKEN_ADDRESS,
          swapData.tx.data,
        ]);

        await expectRevert(
          this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
          'HOneInchV3_unoswap: Invalid output token amount'
        );
      });

      it('should revert: wrong dst token(erc20)', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          token0Address,
          value,
          WETH_TOKEN,
          swapData.tx.data,
        ]);

        await expectRevert(
          this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
          'HOneInchV3_unoswap: Invalid output token amount'
        );
      });

      it('should revert: wrong src token(matic)', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          NATIVE_TOKEN_ADDRESS,
          value,
          token1Address,
          swapData.tx.data,
        ]);

        await expectRevert.unspecified(
          this.proxy.execMock(to, data, { from: user, value: ether('0.1') })
        );
      });

      it('should revert: wrong src token(erc20)', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          WETH_TOKEN,
          value,
          token1Address,
          swapData.tx.data,
        ]);

        await expectRevert(
          this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
          'HOneInchV3_unoswap: Dai/insufficient-allowance'
        );
      });

      it('should revert: wrong src token amount(erc20)', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );

        // Prepare handler data
        const data = getCallData(HOneInch, 'unoswap', [
          token0Address,
          value.sub(new BN(1000)),
          token1Address,
          swapData.tx.data,
        ]);

        await expectRevert(
          this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
          'HOneInchV3_unoswap: Dai/insufficient-allowance'
        );
      });
    });
  });
});
