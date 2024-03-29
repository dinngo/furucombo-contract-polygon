const {
  balance,
  BN,
  constants,
  ether,
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');
const { MAX_UINT256 } = constants;
const { tracker } = balance;
const { latest } = time;
const abi = require('ethereumjs-abi');
const utils = web3.utils;
const { expect } = require('chai');
const {
  DAI_TOKEN,
  USDC_TOKEN,
  SUSHISWAP_DAI_WMATIC,
  SUSHISWAP_DAI_USDC,
  SUSHISWAP_ROUTER,
  MATIC_TOKEN,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getHandlerReturn,
  decimal6,
  tokenProviderQuick,
} = require('./utils/utils');

const HSushiSwap = artifacts.require('HSushiSwap');
const Registry = artifacts.require('Registry');
const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const UniswapV2Router02 = artifacts.require('IUniswapV2Router02');

contract('SushiSwap Liquidity', function([_, user]) {
  let id;
  const tokenAAddress = DAI_TOKEN;
  const tokenBAddress = USDC_TOKEN;
  const sushiswapPoolAAddress = SUSHISWAP_DAI_WMATIC;
  const sushiswapPoolBAddress = SUSHISWAP_DAI_USDC;
  const sushiswapRouterAddress = SUSHISWAP_ROUTER;

  let balanceUser;
  let uniTokenUserAmount;
  let tokenAProviderAddress;
  let tokenBProviderAddress;

  before(async function() {
    tokenAProviderAddress = await tokenProviderQuick(tokenAAddress);
    tokenBProviderAddress = await tokenProviderQuick(tokenBAddress);

    this.registry = await Registry.new();
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
    this.hSushiSwap = await HSushiSwap.new();
    await this.registry.register(
      this.hSushiSwap.address,
      utils.asciiToHex('SushiSwap')
    );
    this.tokenA = await IToken.at(tokenAAddress);
    this.tokenB = await IToken.at(tokenBAddress);
    this.uniTokenMatic = await IToken.at(sushiswapPoolAAddress);
    this.uniTokenToken = await IToken.at(sushiswapPoolBAddress);
    this.router = await UniswapV2Router02.at(sushiswapRouterAddress);
  });

  beforeEach(async function() {
    id = await evmSnapshot();
    balanceUser = await tracker(user);
    balanceProxy = await tracker(this.proxy.address);
    tokenAUserAmount = await this.tokenA.balanceOf(user);
    tokenBUserAmount = await this.tokenB.balanceOf(user);
    uniTokenMaticUserAmount = await this.uniTokenMatic.balanceOf(user);
    uniTokenTokenUserAmount = await this.uniTokenToken.balanceOf(user);

    await this.tokenA.transfer(user, ether('1000'), {
      from: tokenAProviderAddress,
    });
    await this.tokenB.transfer(user, decimal6('1000'), {
      from: tokenBProviderAddress,
    });
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Add Matic', function() {
    beforeEach(async function() {
      uniTokenUserAmount = await this.uniTokenMatic.balanceOf(user);
    });

    it('normal', async function() {
      // Prepare handler data
      const tokenAmount = ether('100');
      const minTokenAmount = new BN('1');
      const minMaticAmount = new BN('1');
      const value = ether('1');
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'addLiquidityETH(uint256,address,uint256,uint256,uint256):(uint256,uint256,uint256)',
        value,
        tokenAAddress,
        tokenAmount,
        minTokenAmount,
        minMaticAmount
      );

      tokenAUserAmount = await this.tokenA.balanceOf(user);
      await this.tokenA.transfer(this.proxy.address, tokenAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.tokenA.address);

      // Execute handler
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: value,
      });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, [
        'uint256',
        'uint256',
        'uint256',
      ]);

      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const uniTokenUserAmountEnd = await this.uniTokenMatic.balanceOf(user);
      const userBalanceDelta = await balanceUser.delta();

      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmount.sub(tokenAUserAmountEnd)
      );

      expect(userBalanceDelta).to.be.bignumber.eq(
        ether('0').sub(utils.toBN(handlerReturn[1]))
      );

      expect(utils.toBN(handlerReturn[2])).to.be.bignumber.eq(
        uniTokenUserAmountEnd.sub(uniTokenUserAmount)
      );

      // Result Verification
      // Verify spent matic
      expect(userBalanceDelta).to.be.bignumber.lte(
        ether('0').sub(minMaticAmount)
      );

      // Verify spent token
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.lte(
        tokenAUserAmount.sub(minTokenAmount)
      );

      // Verify proxy token should be zero
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // TODO: Find out the exact number of uniToken for testing
      // Verify spent matic
      expect(await this.uniTokenMatic.balanceOf(user)).to.be.bignumber.gt(
        uniTokenMaticUserAmount
      );

      // Gas profile
      profileGas(receipt);
    });

    it('max amount', async function() {
      // Prepare handler data
      const tokenAmount = ether('0.002');
      const minTokenAmount = ether('0.000001');
      const minMaticAmount = ether('0.000001');
      const value = ether('1');
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'addLiquidityETH(uint256,address,uint256,uint256,uint256):(uint256,uint256,uint256)',
        MAX_UINT256,
        tokenAAddress,
        MAX_UINT256,
        minTokenAmount,
        minMaticAmount
      );

      tokenAUserAmount = await this.tokenA.balanceOf(user);
      await this.tokenA.transfer(this.proxy.address, tokenAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.tokenA.address);

      // Execute handler
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: value,
      });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, [
        'uint256',
        'uint256',
        'uint256',
      ]);

      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const uniTokenUserAmountEnd = await this.uniTokenMatic.balanceOf(user);
      const userBalanceDelta = await balanceUser.delta();

      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmount.sub(tokenAUserAmountEnd)
      );

      expect(userBalanceDelta).to.be.bignumber.eq(
        ether('0').sub(utils.toBN(handlerReturn[1]))
      );

      expect(utils.toBN(handlerReturn[2])).to.be.bignumber.eq(
        uniTokenUserAmountEnd.sub(uniTokenUserAmount)
      );

      // Result Verification
      // Verify spent matic
      expect(userBalanceDelta).to.be.bignumber.lte(
        ether('0').sub(minMaticAmount)
      );

      // Verify spent token
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.lte(
        tokenAUserAmount.sub(minTokenAmount)
      );

      // Verify proxy token should be zero
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // TODO: Find out the exact number of uniToken for testing
      // Verify spent matic
      expect(await this.uniTokenMatic.balanceOf(user)).to.be.bignumber.gt(
        uniTokenMaticUserAmount
      );

      // Gas profile
      profileGas(receipt);
    });

    it('matic token', async function() {
      // Prepare handler data
      const tokenAmount = ether('100');
      const minTokenAmount = new BN('1');
      const minMaticAmount = new BN('1');
      const value = ether('1');
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'addLiquidityETH(uint256,address,uint256,uint256,uint256):(uint256,uint256,uint256)',
        value,
        MATIC_TOKEN,
        tokenAmount,
        minTokenAmount,
        minMaticAmount
      );
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: value,
        }),
        'Not support matic token'
      );
    });
  });

  describe('Add Token', function() {
    beforeEach(async function() {
      uniTokenUserAmount = await this.uniTokenToken.balanceOf(user);
    });

    it('normal', async function() {
      // Prepare handler data
      const tokenAAmount = ether('20');
      const tokenBAmount = decimal6('200');
      const minTokenAAmount = ether('1');
      const minTokenBAmount = decimal6('1');
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'addLiquidity(address,address,uint256,uint256,uint256,uint256):(uint256,uint256,uint256)',
        tokenAAddress,
        tokenBAddress,
        tokenAAmount,
        tokenBAmount,
        minTokenAAmount,
        minTokenBAmount
      );

      tokenAUserAmount = await this.tokenA.balanceOf(user);
      tokenBUserAmount = await this.tokenB.balanceOf(user);
      // Send tokens to proxy
      await this.tokenA.transfer(this.proxy.address, tokenAAmount, {
        from: user,
      });
      await this.tokenB.transfer(this.proxy.address, tokenBAmount, {
        from: user,
      });
      // Add tokens to cache for return user after handler execution
      await this.proxy.updateTokenMock(this.tokenA.address);
      await this.proxy.updateTokenMock(this.tokenB.address);

      // Execute handler
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
      });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, [
        'uint256',
        'uint256',
        'uint256',
      ]);

      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const tokenBUserAmountEnd = await this.tokenB.balanceOf(user);
      const uniTokenUserAmountEnd = await this.uniTokenToken.balanceOf(user);

      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmount.sub(tokenAUserAmountEnd)
      );
      expect(utils.toBN(handlerReturn[1])).to.be.bignumber.eq(
        tokenBUserAmount.sub(tokenBUserAmountEnd)
      );
      expect(utils.toBN(handlerReturn[2])).to.be.bignumber.eq(
        uniTokenUserAmountEnd.sub(uniTokenUserAmount)
      );

      // Verify user tokens
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.lte(
        tokenAUserAmount.sub(minTokenAAmount)
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.lte(
        tokenBUserAmount.sub(minTokenBAmount)
      );

      // Verify proxy token should be zero
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // TODO: Find out the exact number of uniToken for testing
      // Verify spent ether
      expect(await this.uniTokenToken.balanceOf(user)).to.be.bignumber.gt(
        uniTokenTokenUserAmount
      );

      // Gas profile
      profileGas(receipt);
    });

    it('max amount', async function() {
      // Prepare handler data
      const tokenAAmount = ether('20');
      const tokenBAmount = decimal6('200');
      const minTokenAAmount = ether('1');
      const minTokenBAmount = decimal6('1');
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'addLiquidity(address,address,uint256,uint256,uint256,uint256):(uint256,uint256,uint256)',
        tokenAAddress,
        tokenBAddress,
        MAX_UINT256,
        MAX_UINT256,
        minTokenAAmount,
        minTokenBAmount
      );

      tokenAUserAmount = await this.tokenA.balanceOf(user);
      tokenBUserAmount = await this.tokenB.balanceOf(user);
      // Send tokens to proxy
      await this.tokenA.transfer(this.proxy.address, tokenAAmount, {
        from: user,
      });
      await this.tokenB.transfer(this.proxy.address, tokenBAmount, {
        from: user,
      });
      // Add tokens to cache for return user after handler execution
      await this.proxy.updateTokenMock(this.tokenA.address);
      await this.proxy.updateTokenMock(this.tokenB.address);

      // Execute handler
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
      });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, [
        'uint256',
        'uint256',
        'uint256',
      ]);

      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const tokenBUserAmountEnd = await this.tokenB.balanceOf(user);
      const uniTokenUserAmountEnd = await this.uniTokenToken.balanceOf(user);

      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmount.sub(tokenAUserAmountEnd)
      );
      expect(utils.toBN(handlerReturn[1])).to.be.bignumber.eq(
        tokenBUserAmount.sub(tokenBUserAmountEnd)
      );
      expect(utils.toBN(handlerReturn[2])).to.be.bignumber.eq(
        uniTokenUserAmountEnd.sub(uniTokenUserAmount)
      );

      // Verify user tokens
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.lte(
        tokenAUserAmount.sub(minTokenAAmount)
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.lte(
        tokenBUserAmount.sub(minTokenBAmount)
      );

      // Verify proxy token should be zero
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // TODO: Find out the exact number of uniToken for testing
      // Verify spent ether
      expect(await this.uniTokenToken.balanceOf(user)).to.be.bignumber.gt(
        uniTokenTokenUserAmount
      );

      // Gas profile
      profileGas(receipt);
    });

    it('tokenA is matic token', async function() {
      // Prepare handler data
      const tokenAAmount = ether('20');
      const tokenBAmount = decimal6('200');
      const minTokenAAmount = ether('1');
      const minTokenBAmount = decimal6('1');
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'addLiquidity(address,address,uint256,uint256,uint256,uint256):(uint256,uint256,uint256)',
        MATIC_TOKEN,
        tokenBAddress,
        tokenAAmount,
        tokenBAmount,
        minTokenAAmount,
        minTokenBAmount
      );

      tokenBUserAmount = await this.tokenB.balanceOf(user);
      // Send tokens to proxy
      await this.tokenB.transfer(this.proxy.address, tokenBAmount, {
        from: user,
      });
      // Add tokens to cache for return user after handler execution
      await this.proxy.updateTokenMock(this.tokenB.address);

      // Execute handler
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
        }),
        'Not support matic token'
      );
    });

    it('tokenB is matic token', async function() {
      // Prepare handler data
      const tokenAAmount = ether('20');
      const tokenBAmount = decimal6('200');
      const minTokenAAmount = ether('1');
      const minTokenBAmount = decimal6('1');
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'addLiquidity(address,address,uint256,uint256,uint256,uint256):(uint256,uint256,uint256)',
        tokenAAddress,
        MATIC_TOKEN,
        tokenAAmount,
        tokenBAmount,
        minTokenAAmount,
        minTokenBAmount
      );

      tokenAUserAmount = await this.tokenA.balanceOf(user);
      // Send tokens to proxy
      await this.tokenA.transfer(this.proxy.address, tokenAAmount, {
        from: user,
      });
      // Add tokens to cache for return user after handler execution
      await this.proxy.updateTokenMock(this.tokenA.address);

      // Execute handler
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
        }),
        'Not support matic token'
      );
    });
  });

  describe('Remove Matic', function() {
    let deadline;

    beforeEach(async function() {
      // Add liquidity for getting uniToken before remove liquidity
      await this.tokenA.approve(this.router.address, ether('1000'), {
        from: user,
      });
      deadline = (await latest()).add(new BN('100'));
      await this.router.addLiquidityETH(
        this.tokenA.address,
        ether('100'),
        new BN('1'),
        new BN('1'),
        user,
        deadline,
        {
          from: user,
          value: ether('0.1'),
        }
      );

      // Get user tokenA/uniToken balance
      tokenAUserAmount = await this.tokenA.balanceOf(user);
      uniTokenUserAmount = await this.uniTokenMatic.balanceOf(user);
    });

    it('normal', async function() {
      // Get simulation result
      await this.uniTokenMatic.approve(
        this.router.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      const result = await this.router.removeLiquidityETH.call(
        this.tokenA.address,
        uniTokenUserAmount,
        new BN('1'),
        new BN('1'),
        user,
        deadline,
        { from: user }
      );

      // Send uniToken to proxy and prepare handler data
      await this.uniTokenMatic.transfer(
        this.proxy.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      await this.proxy.updateTokenMock(this.uniTokenMatic.address);

      const value = uniTokenUserAmount;
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'removeLiquidityETH(address,uint256,uint256,uint256):(uint256,uint256)',
        tokenAAddress,
        value,
        new BN('1'),
        new BN('1')
      );

      // Execute handler
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, { from: user });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, ['uint256', 'uint256']);
      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const userBalanceDelta = await balanceUser.delta();
      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmountEnd.sub(tokenAUserAmount)
      );
      expect(userBalanceDelta).to.be.bignumber.eq(utils.toBN(handlerReturn[1]));

      // Verify User Token
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUserAmount.add(result[0])
      );
      expect(await this.uniTokenMatic.balanceOf(user)).to.be.bignumber.eq(
        ether('0')
      );

      // Verify proxy token should be zero
      expect(
        await this.uniTokenMatic.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // Verify spent matic
      expect(userBalanceDelta).to.be.bignumber.eq(result[1]);

      // Gas profile
      profileGas(receipt);
    });

    it('max amount', async function() {
      // Get simulation result
      await this.uniTokenMatic.approve(
        this.router.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      const result = await this.router.removeLiquidityETH.call(
        this.tokenA.address,
        uniTokenUserAmount,
        new BN('1'),
        new BN('1'),
        user,
        deadline,
        { from: user }
      );

      // Send uniToken to proxy and prepare handler data
      await this.uniTokenMatic.transfer(
        this.proxy.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      await this.proxy.updateTokenMock(this.uniTokenMatic.address);

      const value = uniTokenUserAmount;
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'removeLiquidityETH(address,uint256,uint256,uint256):(uint256,uint256)',
        tokenAAddress,
        MAX_UINT256,
        new BN('1'),
        new BN('1')
      );

      // Execute handler
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, { from: user });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, ['uint256', 'uint256']);
      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const userBalanceDelta = await balanceUser.delta();
      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmountEnd.sub(tokenAUserAmount)
      );
      expect(userBalanceDelta).to.be.bignumber.eq(utils.toBN(handlerReturn[1]));

      // Verify User Token
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUserAmount.add(result[0])
      );
      expect(await this.uniTokenMatic.balanceOf(user)).to.be.bignumber.eq(
        ether('0')
      );

      // Verify proxy token should be zero
      expect(
        await this.uniTokenMatic.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // Verify spent matic
      expect(userBalanceDelta).to.be.bignumber.eq(result[1]);

      // Gas profile
      profileGas(receipt);
    });

    it('matic token', async function() {
      const value = MAX_UINT256;
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'removeLiquidityETH(address,uint256,uint256,uint256):(uint256,uint256)',
        MATIC_TOKEN,
        value,
        new BN('1'),
        new BN('1')
      );

      // Execute handler
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'revert'
      );
    });
  });

  describe('Remove Token', function() {
    let deadline;

    beforeEach(async function() {
      await this.tokenA.transfer(user, ether('100'), {
        from: tokenAProviderAddress,
      });

      await this.tokenB.transfer(user, decimal6('100'), {
        from: tokenBProviderAddress,
      });

      await this.tokenA.approve(this.router.address, ether('1000'), {
        from: user,
      });
      await this.tokenB.approve(this.router.address, decimal6('1000'), {
        from: user,
      });
      deadline = (await latest()).add(new BN('100'));

      await this.router.addLiquidity(
        this.tokenA.address,
        this.tokenB.address,
        ether('100'),
        decimal6('100'),
        new BN('1'),
        new BN('1'),
        user,
        deadline,
        {
          from: user,
        }
      );
      tokenAUserAmount = await this.tokenA.balanceOf(user);
      tokenBUserAmount = await this.tokenB.balanceOf(user);
      uniTokenUserAmount = await this.uniTokenToken.balanceOf(user);
    });

    it('normal', async function() {
      // Get simulation result
      await this.uniTokenToken.approve(
        this.router.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      const result = await this.router.removeLiquidity.call(
        this.tokenA.address,
        this.tokenB.address,
        uniTokenUserAmount,
        new BN('1'),
        new BN('1'),
        user,
        deadline,
        { from: user }
      );
      // Send uniToken to proxy and prepare handler data
      await this.uniTokenToken.transfer(
        this.proxy.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      await this.proxy.updateTokenMock(this.uniTokenToken.address);

      const value = uniTokenUserAmount;
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'removeLiquidity(address,address,uint256,uint256,uint256):(uint256,uint256)',
        tokenAAddress,
        tokenBAddress,
        value,
        new BN('1'),
        new BN('1')
      );

      // Execute handler
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, { from: user });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, ['uint256', 'uint256']);
      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const tokenBUserAmountEnd = await this.tokenB.balanceOf(user);

      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmountEnd.sub(tokenAUserAmount)
      );
      expect(utils.toBN(handlerReturn[1])).to.be.bignumber.eq(
        tokenBUserAmountEnd.sub(tokenBUserAmount)
      );

      // Verify user token
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUserAmount.add(result[0])
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.eq(
        tokenBUserAmount.add(result[1])
      );
      expect(await this.uniTokenToken.balanceOf(user)).to.be.bignumber.eq(
        ether('0')
      );

      // Verify proxy token should be zero
      expect(
        await this.uniTokenToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // Verify spent matic
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));

      // Gas profile
      profileGas(receipt);
    });

    it('max amount', async function() {
      // Get simulation result
      await this.uniTokenToken.approve(
        this.router.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      const result = await this.router.removeLiquidity.call(
        this.tokenA.address,
        this.tokenB.address,
        uniTokenUserAmount,
        new BN('1'),
        new BN('1'),
        user,
        deadline,
        { from: user }
      );
      // Send uniToken to proxy and prepare handler data
      await this.uniTokenToken.transfer(
        this.proxy.address,
        uniTokenUserAmount,
        {
          from: user,
        }
      );
      await this.proxy.updateTokenMock(this.uniTokenToken.address);

      const value = uniTokenUserAmount;
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'removeLiquidity(address,address,uint256,uint256,uint256):(uint256,uint256)',
        tokenAAddress,
        tokenBAddress,
        MAX_UINT256,
        new BN('1'),
        new BN('1')
      );

      // Execute handler
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, { from: user });

      // Get handler return result
      const handlerReturn = getHandlerReturn(receipt, ['uint256', 'uint256']);
      const tokenAUserAmountEnd = await this.tokenA.balanceOf(user);
      const tokenBUserAmountEnd = await this.tokenB.balanceOf(user);

      expect(utils.toBN(handlerReturn[0])).to.be.bignumber.eq(
        tokenAUserAmountEnd.sub(tokenAUserAmount)
      );
      expect(utils.toBN(handlerReturn[1])).to.be.bignumber.eq(
        tokenBUserAmountEnd.sub(tokenBUserAmount)
      );

      // Verify user token
      expect(await this.tokenA.balanceOf(user)).to.be.bignumber.eq(
        tokenAUserAmount.add(result[0])
      );
      expect(await this.tokenB.balanceOf(user)).to.be.bignumber.eq(
        tokenBUserAmount.add(result[1])
      );
      expect(await this.uniTokenToken.balanceOf(user)).to.be.bignumber.eq(
        ether('0')
      );

      // Verify proxy token should be zero
      expect(
        await this.uniTokenToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenA.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(
        await this.tokenB.balanceOf(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));

      // Verify spent matic
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));

      // Gas profile
      profileGas(receipt);
    });

    it('tokenA is matic token', async function() {
      const value = MAX_UINT256;
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'removeLiquidity(address,address,uint256,uint256,uint256):(uint256,uint256)',
        MATIC_TOKEN,
        tokenBAddress,
        value,
        new BN('1'),
        new BN('1')
      );

      // Execute handler
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'revert'
      );
    });

    it('tokenB is matic token', async function() {
      const value = MAX_UINT256;
      const to = this.hSushiSwap.address;
      const data = abi.simpleEncode(
        'removeLiquidity(address,address,uint256,uint256,uint256):(uint256,uint256)',
        tokenAAddress,
        MATIC_TOKEN,
        value,
        new BN('1'),
        new BN('1')
      );

      // Execute handler
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'revert'
      );
    });
  });
});
