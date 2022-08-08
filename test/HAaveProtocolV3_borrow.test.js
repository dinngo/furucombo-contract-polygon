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
  WETH_TOKEN,
  COMP_TOKEN,
  ADAI_V3_TOKEN,
  AAVEPROTOCOL_V3_PROVIDER,
  AWMATIC_V3_DEBT_VARIABLE,
  AWETH_V3_DEBT_VARIABLE,
  AUSDC_V3_DEBT_STABLE,
  AAVE_RATEMODE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  tokenProviderQuick,
  expectEqWithinBps,
} = require('./utils/utils');

const HAaveV3 = artifacts.require('HAaveProtocolV3');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IAToken = artifacts.require('IATokenV3');
const IPool = artifacts.require('IPool');
const IProvider = artifacts.require('IPoolAddressesProvider');
const SimpleToken = artifacts.require('SimpleToken');

const IStableDebtToken = artifacts.require('IStableDebtToken');
const IVariableDebtToken = artifacts.require('IVariableDebtTokenV3');

contract('Aave V3', function([_, user, someone]) {
  const aTokenAddress = ADAI_V3_TOKEN;
  const tokenAddress = DAI_TOKEN;

  let id;
  let balanceUser;
  let balanceProxy;
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

  describe('Borrow with Stable Rate', function() {
    const depositAmount = ether('10000');
    const borrowTokenAddr = USDC_TOKEN;
    const rateMode = AAVE_RATEMODE.STABLE;
    const debtTokenAddr = AUSDC_V3_DEBT_STABLE;

    let borrowTokenUserBefore;
    let debtTokenUserBefore;

    before(async function() {
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.debtToken = await IStableDebtToken.at(debtTokenAddr);
    });

    beforeEach(async function() {
      // Deposit
      await this.token.approve(this.pool.address, depositAmount, {
        from: providerAddress,
      });
      expect(await this.aToken.balanceOf(user)).to.be.bignumber.zero;
      await this.pool.deposit(this.token.address, depositAmount, user, 0, {
        from: providerAddress,
      });
      expect(await this.aToken.balanceOf(user)).to.be.bignumber.eq(
        depositAmount
      );

      borrowTokenUserBefore = await this.borrowToken.balanceOf(user);
      debtTokenUserBefore = await this.debtToken.balanceOf(user);
    });

    it('borrow token', async function() {
      const borrowAmount = new BN('1000000'); // 1e6
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );
      await this.debtToken.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowTokenUserAfter.sub(borrowTokenUserBefore)
      ).to.be.bignumber.eq(borrowAmount);

      // borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtTokenUserAfter.sub(debtTokenUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtTokenUserAfter.sub(debtTokenUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    /** Stable Rate borrow is not available on WMATIC & MATIC
    it('borrow wmatic', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        WMATIC_TOKEN,
        borrowAmount,
        rateMode
      );

      await this.debtWMATIC.approveDelegation(
        this.proxy.address,
        borrowAmount,
        {
          from: user,
        }
      );
      await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const borrowWMATICUserAfter = await this.wmatic.balanceOf(user);
      const debtWMATICUserAfter = await this.debtWMATIC.balanceOf(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowWMATICUserAfter.sub(borrowWMATICUserBefore)
      ).to.be.bignumber.eq(borrowAmount);

      // borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    it('borrow matic', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrowETH(uint256,uint256)',
        borrowAmount,
        rateMode
      );
      await this.debtWMATIC.approveDelegation(
        this.proxy.address,
        borrowAmount,
        {
          from: user,
        }
      );
      const balancerUserBefore = await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      const balancerUserAfter = await balanceUser.get();
      const debtWMATICUserAfter = await this.debtWMATIC.balanceOf(user);
      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(balancerUserAfter.sub(balancerUserBefore)).to.be.bignumber.eq(
        borrowAmount
      );
      // borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });
    **/

    it('should revert: borrow token over the collateral value', async function() {
      const borrowAmount = new BN('20000000000'); // 20000 * 1e6
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await this.debtToken.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });

      await expectRevert(
        this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
        'HAaveProtocolV3_borrow: 36' // AAVEV3 Error Code: COLLATERAL_CANNOT_COVER_NEW_BORROW
      );
    });

    it('should revert: borrow token without approveDelegation', async function() {
      const borrowAmount = new BN('2000000'); // 1e6
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified' // decreaseBorrowAllowance Failed
      );
    });

    it('should revert: borrow token approveDelegation < borrow amount', async function() {
      const borrowAmount = new BN('2000000'); // 1e6
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await this.debtToken.approveDelegation(
        this.proxy.address,
        borrowAmount.sub(new BN('1000000')),
        {
          from: user,
        }
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified' // decreaseBorrowAllowance Failed
      );
    });

    it('should revert: borrow token that is not in aaveV3 pool', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        COMP_TOKEN,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified'
      );
    });

    it('should revert: borrow token that is not enable stable mode', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        WETH_TOKEN,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: 31' // AAVEV3 Error Code: STABLE_BORROWING_NOT_ENABLED
      );
    });

    it('should revert: borrow token with no collateral ', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: someone }),
        'HAaveProtocolV3_borrow: 34' // AAVEV3 Error Code: COLLATERAL_BALANCE_IS_ZERO
      );
    });

    it('should revert: borrow token is the same with collateral', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.token.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: 37' // AAVEV3 Error Code: COLLATERAL_SAME_AS_BORROWING_CURRENCY
      );
    });
  });

  describe('Borrow with Variable Rate', function() {
    const depositAmount = ether('10000');
    const borrowTokenAddr = WETH_TOKEN;
    const rateMode = AAVE_RATEMODE.VARIABLE;
    const debtTokenAddr = AWETH_V3_DEBT_VARIABLE;
    const debtWMATICAddr = AWMATIC_V3_DEBT_VARIABLE;

    let borrowTokenUserBefore;
    let debtTokenUserBefore;
    let debtWMATICUserBefore;

    before(async function() {
      this.borrowToken = await IToken.at(borrowTokenAddr);
      this.wmatic = await IToken.at(WMATIC_TOKEN);
      this.debtWMATIC = await IVariableDebtToken.at(debtWMATICAddr);
      this.debtToken = await IVariableDebtToken.at(debtTokenAddr);
    });

    beforeEach(async function() {
      // Deposit
      await this.token.approve(this.pool.address, depositAmount, {
        from: providerAddress,
      });

      expect(await this.aToken.balanceOf(user)).to.be.bignumber.zero;
      await this.pool.deposit(this.token.address, depositAmount, user, 0, {
        from: providerAddress,
      });
      expectEqWithinBps(await this.aToken.balanceOf(user), depositAmount, 10);

      borrowTokenUserBefore = await this.borrowToken.balanceOf(user);
      borrowWMATICUserBefore = await this.wmatic.balanceOf(user);
      debtTokenUserBefore = await this.debtToken.balanceOf(user);
      debtWMATICUserBefore = await this.debtWMATIC.balanceOf(user);
    });

    it('borrow token', async function() {
      const borrowAmount = ether('1');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );
      await this.debtToken.approveDelegation(this.proxy.address, borrowAmount, {
        from: user,
      });
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const borrowTokenUserAfter = await this.borrowToken.balanceOf(user);
      const debtTokenUserAfter = await this.debtToken.balanceOf(user);

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowTokenUserAfter.sub(borrowTokenUserBefore)
      ).to.be.bignumber.eq(borrowAmount);

      // borrowAmount <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtTokenUserAfter.sub(debtTokenUserBefore)).to.be.bignumber.gte(
        borrowAmount
      );
      expect(debtTokenUserAfter.sub(debtTokenUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    it('borrow wmatic', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        WMATIC_TOKEN,
        borrowAmount,
        rateMode
      );

      await this.debtWMATIC.approveDelegation(
        this.proxy.address,
        borrowAmount,
        {
          from: user,
        }
      );
      await balanceUser.get();

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const borrowWMATICUserAfter = await this.wmatic.balanceOf(user);
      const debtWMATICUserAfter = await this.debtWMATIC.balanceOf(user);

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.borrowToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(
        borrowWMATICUserAfter.sub(borrowWMATICUserBefore)
      ).to.be.bignumber.eq(borrowAmount);

      // borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    it('borrow matic', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrowETH(uint256,uint256)',
        borrowAmount,
        rateMode
      );
      await this.debtWMATIC.approveDelegation(
        this.proxy.address,
        borrowAmount,
        {
          from: user,
        }
      );

      const balancerUserBefore = await balanceUser.get();
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });
      const balancerUserAfter = await balanceUser.get();
      const debtWMATICUserAfter = await this.debtWMATIC.balanceOf(user);

      // Verify proxy balance
      expect(await balanceProxy.get()).to.be.bignumber.zero;
      expect(
        await this.debtToken.balanceOf(this.proxy.address)
      ).to.be.bignumber.zero;

      // Verify user balance
      expect(balancerUserAfter.sub(balancerUserBefore)).to.be.bignumber.eq(
        borrowAmount
      );

      // borrowAmount - 1 <= (debtTokenUserAfter-debtTokenUserBefore) < borrowAmount + interestMax
      const interestMax = borrowAmount.mul(new BN(1)).div(new BN(10000));
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.gte(
        borrowAmount.sub(new BN(1))
      );
      expect(debtWMATICUserAfter.sub(debtWMATICUserBefore)).to.be.bignumber.lt(
        borrowAmount.add(interestMax)
      );
      profileGas(receipt);
    });

    it('should revert: borrow token over the collateral value', async function() {
      const borrowAmount = ether('20000');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await this.debtWMATIC.approveDelegation(
        this.proxy.address,
        borrowAmount,
        {
          from: user,
        }
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user, value: ether('0.1') }),
        'HAaveProtocolV3_borrow: 36' // AAVEV3 Error Code: COLLATERAL_CANNOT_COVER_NEW_BORROW
      );
    });

    it('should revert: borrow token without approveDelegation', async function() {
      const borrowAmount = ether('0.2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified' // decreaseBorrowAllowance Failed
      );
    });

    it('should revert: borrow token that is not in aaveV3 pool', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        COMP_TOKEN,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified'
      );
    });

    it('should revert: borrow token with no collateral', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.borrowToken.address,
        borrowAmount,
        rateMode
      );

      await expectRevert(
        this.proxy.execMock(to, data, { from: someone }),
        'HAaveProtocolV3_borrow: 34' // AAVEV3 Error Code: COLLATERAL_BALANCE_IS_ZERO
      );
    });

    it('should revert: borrow token is the same with collateral', async function() {
      const borrowAmount = ether('2');
      const to = this.hAaveV3.address;
      const data = abi.simpleEncode(
        'borrow(address,uint256,uint256)',
        this.token.address,
        borrowAmount,
        rateMode
      );

      await this.debtWMATIC.approveDelegation(user, borrowAmount, {
        from: user,
      });

      await expectRevert(
        this.proxy.execMock(to, data, { from: user }),
        'HAaveProtocolV3_borrow: Unspecified'
        // Variable rate doesn't check collateral and debt
      );
    });
  });
});
