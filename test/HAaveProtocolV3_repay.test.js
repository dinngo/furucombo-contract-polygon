const {
  balance,
  BN,
  ether,
  expectRevert,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const {
  WMATIC_TOKEN,
  DAI_TOKEN,
  USDC_TOKEN,
  ADAI_V3_TOKEN,
  AAVEPROTOCOL_V3_PROVIDER,
  AWMATIC_V3_DEBT_VARIABLE,
  AUSDC_V3_DEBT_STABLE,
  AAVE_RATEMODE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getHandlerReturn,
  expectEqWithinBps,
  tokenProviderQuick,
  mwei,
} = require('./utils/utils');

const HAaveV3 = artifacts.require('HAaveProtocolV3');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IAToken = artifacts.require('IATokenV3');
const IPool = artifacts.require('IPool');
const IProvider = artifacts.require('IPoolAddressesProvider');
const SimpleToken = artifacts.require('SimpleToken');

contract('Aave V3', function([_, user]) {
  const aTokenAddress = ADAI_V3_TOKEN;
  const tokenAddress = DAI_TOKEN;

  let id;
  let balanceUser;
  let providerAddress;

  before(async function() {
    providerAddress = await tokenProviderQuick(tokenAddress);

    this.registry = await Registry.new();
    this.proxy = await Proxy.new(this.registry.address);
    this.hAaveV3 = await HAaveV3.new();
    await this.registry.register(
      this.hAaveV3.address,
      utils.asciiToHex('AaveProtocolV3')
    );
    this.provider = await IProvider.at(AAVEPROTOCOL_V3_PROVIDER);
    this.poolAddress = await this.provider.getPool();
    this.pool = await IPool.at(this.poolAddress);
    this.token = await IToken.at(tokenAddress);
    this.aToken = await IAToken.at(aTokenAddress);
    this.wmatic = await IToken.at(WMATIC_TOKEN);
    this.mockToken = await SimpleToken.new();
  });

  beforeEach(async function() {
    id = await evmSnapshot();
    balanceUser = await tracker(user);
    balanceProxy = await tracker(this.proxy.address);
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Repay Stable Rate', function() {
    var supplyAmount = ether('10000');
    const borrowAmount = mwei('2');
    const borrowTokenAddr = USDC_TOKEN;
    const rateMode = AAVE_RATEMODE.STABLE;
    const debtTokenAddr = AUSDC_V3_DEBT_STABLE;

    let borrowTokenProvider;
    let borrowTokenUserBefore;
    let debtTokenUserBefore;

    before(async function() {
      borrowTokenProvider = await tokenProviderQuick(borrowTokenAddr);
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.debtToken = await IToken.at(debtTokenAddr);
    });

    beforeEach(async function() {
      // Deposit
      await this.token.approve(this.pool.address, supplyAmount, {
        from: providerAddress,
      });
      expect(await this.aToken.balanceOf(user)).to.be.bignumber.zero;
      await this.pool.supply(this.token.address, supplyAmount, user, 0, {
        from: providerAddress,
      });
      expect(await this.aToken.balanceOf(user)).to.be.bignumber.eq(
        supplyAmount
      );

      // Borrow
      await this.pool.borrow(
        this.borrowToken.address,
        borrowAmount,
        rateMode,
        0,
        user,
        { from: user }
      );
      expect(await this.borrowToken.balanceOf(user)).to.be.bignumber.eq(
        borrowAmount
      );
      expectEqWithinBps(await this.debtToken.balanceOf(user), borrowAmount, 1);

      borrowTokenUserBefore = await this.borrowToken.balanceOf(user);
      debtTokenUserBefore = await this.debtToken.balanceOf(user);
    });

    it('partial', async function() {
      const repayAmount = borrowAmount.div(new BN('2'));
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        rateMode,
        user
      );

      await this.borrowToken.transfer(this.proxy.address, repayAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify handler return
      expectEqWithinBps(handlerReturn, debtTokenUserBefore.sub(repayAmount), 1);

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expectEqWithinBps(
        debtTokenUserBefore.sub(debtTokenUserAfter),
        repayAmount,
        1
      );
      expect(
        borrowTokenUserBefore.sub(borrowTokenUserAfter)
      ).to.be.bignumber.eq(repayAmount);
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
      profileGas(receipt);
    });

    it('whole', async function() {
      const extraNeed = mwei('1');
      const repayAmount = borrowAmount.add(extraNeed);
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        rateMode,
        user
      );
      await this.borrowToken.transfer(user, extraNeed, {
        from: borrowTokenProvider,
      });
      await this.borrowToken.transfer(this.proxy.address, repayAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify handler return
      expect(handlerReturn).to.be.bignumber.zero;

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(debtTokenUserAfter).to.be.bignumber.zero;
      expectEqWithinBps(borrowTokenUserAfter, extraNeed, 1);
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
      profileGas(receipt);
    });

    /** Stable Rate borrow is not available on WMATIC & MATIC
    it('partial by MATIC', async function() {
      const value = borrowAmount.div(new BN('2'));
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repayMATIC(uint256,uint256,address)',
        value,
        rateMode,
        user
      );
      await balanceUser.get();

      const debtTokenUserBefore = await this.debtToken.balanceOf(user);
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: value,
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));

      // Verify handler return
      expect(handlerReturn).to.be.bignumber.gte(borrowAmount.sub(value));
      expect(handlerReturn).to.be.bignumber.lt(
        borrowAmount.sub(value).add(interestMax)
      );
      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      // Verify user balance
      // (borrow - repay) <= debtTokenUserAfter < (borrow + interestMax - repay)
      expect(debtTokenUserAfter).to.be.bignumber.gte(borrowAmount.sub(value));
      expect(debtTokenUserAfter).to.be.bignumber.lt(
        borrowAmount.add(interestMax).sub(value)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0')
          .sub(value)

      );
      profileGas(receipt);
    });

    it('whole by MATIC', async function() {
      const extraNeed = ether('1');
      const value = borrowAmount.add(extraNeed);
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repayMATIC(uint256,uint256,address)',
        value,
        rateMode,
        user
      );
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: value,
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));

      // Verify handler return
      expect(handlerReturn).to.be.bignumber.zero;
      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      // Verify user balance
      expect(debtTokenUserAfter).to.be.bignumber.zero;
      // (repay - borrow - interestMax) < borrowTokenUserAfter <= (repay - borrow)
      expect(
        (await balanceUser.delta())
      ).to.be.bignumber.lte(ether('0').sub(borrowAmount));
      expect(
        (await balanceUser.delta())
      ).to.be.bignumber.gt(
        ether('0')
          .sub(borrowAmount)
          .sub(interestMax)
      );
      profileGas(receipt);
    });
    **/

    it('should revert: not enough balance', async function() {
      const repayAmount = mwei('0.5');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        rateMode,
        user
      );

      await this.borrowToken.transfer(
        this.proxy.address,
        repayAmount.sub(mwei('0.1')),
        { from: user }
      );
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_repay: ERC20: transfer amount exceeds balance'
      );
    });

    it('should revert: not supported token', async function() {
      const repayAmount = ether('0.5');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.mockToken.address,
        repayAmount,
        rateMode,
        user
      );

      await this.mockToken.transfer(this.proxy.address, repayAmount, {
        from: _,
      });
      await this.proxy.updateTokenMock(this.mockToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_repay: Unspecified'
      );
    });

    it('should revert: wrong rate mode', async function() {
      const repayAmount = mwei('0.5');
      const to = this.hAaveV3.address;
      const unborrowedRateMode = (rateMode % 2) + 1;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        unborrowedRateMode,
        user
      );

      await this.borrowToken.transfer(this.proxy.address, repayAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_repay: 39' // AAVEV3 Error Code: NO_DEBT_OF_SELECTED_TYPE
      );
    });
  });

  describe('Repay Variable Rate', function() {
    var supplyAmount = ether('10000');
    const borrowAmount = ether('2');
    const borrowTokenAddr = WMATIC_TOKEN;
    const rateMode = AAVE_RATEMODE.VARIABLE;
    const debtTokenAddr = AWMATIC_V3_DEBT_VARIABLE;

    let borrowTokenProvider;
    let borrowTokenUserBefore;
    let debtTokenUserBefore;

    before(async function() {
      borrowTokenProvider = await tokenProviderQuick(borrowTokenAddr);
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.debtToken = await IToken.at(debtTokenAddr);
    });

    beforeEach(async function() {
      // Deposit
      await this.token.approve(this.pool.address, supplyAmount, {
        from: providerAddress,
      });
      await this.pool.supply(this.token.address, supplyAmount, user, 0, {
        from: providerAddress,
      });
      supplyAmount = await this.aToken.balanceOf(user);

      // Borrow
      await this.pool.borrow(
        this.borrowToken.address,
        borrowAmount,
        rateMode,
        0,
        user,
        { from: user }
      );

      expect(await this.borrowToken.balanceOf(user)).to.be.bignumber.eq(
        borrowAmount
      );
      expectEqWithinBps(await this.debtToken.balanceOf(user), borrowAmount, 1);

      borrowTokenUserBefore = await this.borrowToken.balanceOf(user);
      debtTokenUserBefore = await this.debtToken.balanceOf(user);
    });

    it('partial', async function() {
      const repayAmount = borrowAmount.div(new BN('2'));
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        rateMode,
        user
      );
      await this.borrowToken.transfer(this.proxy.address, repayAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify handler return
      expectEqWithinBps(handlerReturn, debtTokenUserBefore.sub(repayAmount), 1);

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expectEqWithinBps(
        debtTokenUserBefore.sub(debtTokenUserAfter),
        repayAmount,
        1
      );
      expect(
        borrowTokenUserBefore.sub(borrowTokenUserAfter)
      ).to.be.bignumber.eq(repayAmount);
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
      profileGas(receipt);
    });

    it('partial by MATIC', async function() {
      const repayAmount = borrowAmount.div(new BN('2'));
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repayETH(uint256,uint256,address)',
        repayAmount,
        rateMode,
        user
      );
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: repayAmount,
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify handler return
      expectEqWithinBps(handlerReturn, debtTokenUserBefore.sub(repayAmount), 1);

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expectEqWithinBps(
        debtTokenUserBefore.sub(debtTokenUserAfter),
        repayAmount,
        1
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0').sub(repayAmount)
      );
      profileGas(receipt);
    });

    it('whole', async function() {
      const extraNeed = ether('1');
      const repayAmount = borrowAmount.add(extraNeed);
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        rateMode,
        user
      );
      await this.borrowToken.transfer(user, extraNeed, {
        from: borrowTokenProvider,
      });
      await this.borrowToken.transfer(this.proxy.address, repayAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify handler return
      expect(handlerReturn).to.be.bignumber.zero;

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(debtTokenUserAfter).to.be.bignumber.zero;
      expectEqWithinBps(borrowTokenUserAfter, extraNeed, 1);
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
      profileGas(receipt);
    });

    it('whole by MATIC', async function() {
      const extraNeed = ether('1');
      const repayAmount = borrowAmount.add(extraNeed);
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repayETH(uint256,uint256,address)',
        repayAmount,
        rateMode,
        user
      );
      const borrowWMATICUserBefore = await this.wmatic.balanceOf(user);
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: repayAmount,
      });

      // Get handler return result
      const handlerReturn = utils.toBN(
        getHandlerReturn(receipt, ['uint256'])[0]
      );
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);
      const borrowWMATICUserAfter = await this.wmatic.balanceOf(user);

      // Verify handler return
      expect(handlerReturn).to.be.bignumber.zero;

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(debtTokenUserAfter).to.be.bignumber.zero;
      expectEqWithinBps(
        borrowWMATICUserAfter.sub(borrowWMATICUserBefore),
        extraNeed,
        1
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0').sub(repayAmount)
      );
      profileGas(receipt);
    });

    it('should revert: not enough balance', async function() {
      const repayAmount = ether('0.5');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        rateMode,
        user
      );

      await this.borrowToken.transfer(
        this.proxy.address,
        repayAmount.sub(ether('0.1')),
        { from: user }
      );
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_repay: Unspecified'
      );
    });

    it('should revert: not supported token', async function() {
      const repayAmount = ether('0.5');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.mockToken.address,
        repayAmount,
        rateMode,
        user
      );

      await this.mockToken.transfer(this.proxy.address, repayAmount, {
        from: _,
      });
      await this.proxy.updateTokenMock(this.mockToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_repay: Unspecified'
      );
    });

    it('should revert: wrong rate mode', async function() {
      const repayAmount = ether('0.5');
      const to = this.hAaveV3.address;
      const unborrowedRateMode = (rateMode % 2) + 1;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        repayAmount,
        unborrowedRateMode,
        user
      );

      await this.borrowToken.transfer(this.proxy.address, repayAmount, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_repay: 39' // AAVEV3 Error Code: NO_DEBT_OF_SELECTED_TYPE
      );
    });
  });
});
