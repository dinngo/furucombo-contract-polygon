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
  ADAI_V2_TOKEN,
  AWMATIC_V2,
  AAVEPROTOCOL_V2_PROVIDER,
  AWMATIC_V2_DEBT_STABLE,
  AWMATIC_V2_DEBT_VARIABLE,
  ATUSD_V2_DEBT_STABLE,
  ATUSD_V2_DEBT_VARIABLE,
  AAVE_RATEMODE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getHandlerReturn,
  expectEqWithinBps,
  tokenProviderQuick,
} = require('./utils/utils');

const HAaveV2 = artifacts.require('HAaveProtocolV2');
const Registry = artifacts.require('Registry');
const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IAToken = artifacts.require('IATokenV2');
const ILendingPool = artifacts.require('ILendingPoolV2');
const IProvider = artifacts.require('ILendingPoolAddressesProviderV2');
const SimpleToken = artifacts.require('SimpleToken');

contract('Aave V2', function([_, user]) {
  const aTokenAddress = ADAI_V2_TOKEN;
  const tokenAddress = DAI_TOKEN;

  let id;
  let balanceUser;
  let providerAddress;

  before(async function() {
    providerAddress = await tokenProviderQuick(tokenAddress);

    this.registry = await Registry.new();
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
    this.hAaveV2 = await HAaveV2.new();
    await this.registry.register(
      this.hAaveV2.address,
      utils.asciiToHex('AaveProtocolV2')
    );
    this.provider = await IProvider.at(AAVEPROTOCOL_V2_PROVIDER);
    this.lendingPoolAddress = await this.provider.getLendingPool();
    this.lendingPool = await ILendingPool.at(this.lendingPoolAddress);
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

  /** Stable Rate borrow is not available yet
  describe('Repay Stable Rate', function() {
    var depositAmount = ether('10000');
    const borrowAmount = ether('2');
    const borrowTokenAddr = WMATIC_TOKEN;
    const borrowTokenProvider = WMATIC_PROVIDER;
    const rateMode = AAVE_RATEMODE.STABLE;
    const debtTokenAddr =
      rateMode == AAVE_RATEMODE.STABLE
        ? AWMATIC_V2_DEBT_STABLE
        : AWMATIC_V2_DEBT_VARIABLE;

    before(async function() {
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.debtToken = await IToken.at(debtTokenAddr);
    });

    beforeEach(async function() {
      // Deposit
      await this.token.approve(this.lendingPool.address, depositAmount, {
        from: providerAddress,
      });
      await this.lendingPool.deposit(
        this.token.address,
        depositAmount,
        user,
        0,
        { from: providerAddress }
      );
      depositAmount = await this.aToken.balanceOf(user);

      // Borrow
      await this.lendingPool.borrow(
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
      expect(await this.debtToken.balanceOf(user)).to.be.bignumber.eq(
        borrowAmount
      );
    });

    it('partial', async function() {
      const value = borrowAmount.div(new BN('2'));
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        rateMode,
        user
      );
      await this.borrowToken.transfer(this.proxy.address, value, {
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
      expect(borrowTokenUserAfter).to.be.bignumber.eq(borrowAmount.sub(value));
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0')
      );
      profileGas(receipt);
    });

    it('partial by MATIC', async function() {
      const value = borrowAmount.div(new BN('2'));
      const to = this.hAaveV2.address;
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

    it('whole', async function() {
      const extraNeed = ether('1');
      const value = borrowAmount.add(extraNeed);
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        rateMode,
        user
      );
      await this.borrowToken.transfer(user, extraNeed, {
        from: borrowTokenProvider,
      });
      await this.borrowToken.transfer(this.proxy.address, value, {
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
      expect(borrowTokenUserAfter).to.be.bignumber.lte(value.sub(borrowAmount));
      expect(borrowTokenUserAfter).to.be.bignumber.gt(
        value.sub(borrowAmount).sub(interestMax)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0')
      );
      profileGas(receipt);
    });

    it('whole by MATIC', async function() {
      const extraNeed = ether('1');
      const value = borrowAmount.add(extraNeed);
      const to = this.hAaveV2.address;
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

    it('should revert: not enough balance', async function() {
      const value = ether('0.5');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        rateMode,
        user
      );
      await this.borrowToken.transfer(
        this.proxy.address,
        value.sub(ether('0.1')),
        { from: user }
      );
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_repay: SafeERC20: low-level call failed'
      );
    });

    it('should revert: not supported token', async function() {
      const value = ether('0.5');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.mockToken.address,
        value,
        rateMode,
        user
      );
      await this.mockToken.transfer(this.proxy.address, value, { from: _ });
      await this.proxy.updateTokenMock(this.mockToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_repay: Unspecified'
      );
    });

    it('should revert: wrong rate mode', async function() {
      const value = ether('0.5');
      const to = this.hAaveV2.address;
      const unborrowedRateMode = (rateMode % 2) + 1;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        unborrowedRateMode,
        user
      );
      await this.borrowToken.transfer(this.proxy.address, value, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_repay: 15'
      );
    });
  });
  */

  describe('Repay Variable Rate', function() {
    var depositAmount = ether('10000');
    const borrowAmount = ether('2');
    const borrowTokenAddr = WMATIC_TOKEN;
    const rateMode = AAVE_RATEMODE.VARIABLE;
    const debtTokenAddr = AWMATIC_V2_DEBT_VARIABLE;

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
      await this.token.approve(this.lendingPool.address, depositAmount, {
        from: providerAddress,
      });
      await this.lendingPool.deposit(
        this.token.address,
        depositAmount,
        user,
        0,
        { from: providerAddress }
      );
      depositAmount = await this.aToken.balanceOf(user);

      // Borrow
      await this.lendingPool.borrow(
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
      const value = borrowAmount.div(new BN('2'));
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        rateMode,
        user
      );
      await this.borrowToken.transfer(this.proxy.address, value, {
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
      expectEqWithinBps(handlerReturn, debtTokenUserBefore.sub(value), 1);

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expectEqWithinBps(debtTokenUserBefore.sub(debtTokenUserAfter), value, 1);
      expect(borrowTokenUserAfter).to.be.bignumber.eq(borrowAmount.sub(value));
      expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
      profileGas(receipt);
    });

    it('partial by MATIC', async function() {
      const value = borrowAmount.div(new BN('2'));
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repayETH(uint256,uint256,address)',
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

      // Verify handler return
      expectEqWithinBps(handlerReturn, debtTokenUserBefore.sub(value), 1);

      // Verify proxy balance
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expectEqWithinBps(debtTokenUserBefore.sub(debtTokenUserAfter), value, 1);
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0').sub(value)
      );
      profileGas(receipt);
    });

    it('whole', async function() {
      const extraNeed = ether('1');
      const value = borrowAmount.add(extraNeed);
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        rateMode,
        user
      );
      await this.borrowToken.transfer(user, extraNeed, {
        from: borrowTokenProvider,
      });
      await this.borrowToken.transfer(this.proxy.address, value, {
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
      const value = borrowAmount.add(extraNeed);
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repayETH(uint256,uint256,address)',
        value,
        rateMode,
        user
      );
      const borrowWMATICUserBefore = await this.wmatic.balanceOf(user);
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
        ether('0').sub(value)
      );

      profileGas(receipt);
    });

    it('should revert: not enough balance', async function() {
      const value = ether('0.5');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        rateMode,
        user
      );
      await this.borrowToken.transfer(
        this.proxy.address,
        value.sub(ether('0.1')),
        { from: user }
      );
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_repay: SafeERC20: low-level call failed'
      );
    });

    it('should revert: not supported token', async function() {
      const value = ether('0.5');
      const to = this.hAaveV2.address;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.mockToken.address,
        value,
        rateMode,
        user
      );
      await this.mockToken.transfer(this.proxy.address, value, { from: _ });
      await this.proxy.updateTokenMock(this.mockToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_repay: Unspecified'
      );
    });

    it('should revert: wrong rate mode', async function() {
      const value = ether('0.5');
      const to = this.hAaveV2.address;
      const unborrowedRateMode = (rateMode % 2) + 1;
      const data = abi.simpleEncode(
        'repay(address,uint256,uint256,address)',
        this.borrowToken.address,
        value,
        unborrowedRateMode,
        user
      );
      await this.borrowToken.transfer(this.proxy.address, value, {
        from: user,
      });
      await this.proxy.updateTokenMock(this.borrowToken.address);
      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV2_repay: 15'
      );
    });
  });
});
