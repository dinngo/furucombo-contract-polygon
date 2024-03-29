const {
  balance,
  BN,
  constants,
  ether,
  expectRevert,
} = require('@openzeppelin/test-helpers');
const { MAX_UINT256 } = constants;
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
const ATOKEN_DUST = ether('0.00001');

contract('Aave V2', function([_, user, someone]) {
  const aTokenAddress = ADAI_V2_TOKEN;
  const tokenAddress = DAI_TOKEN;
  const awmaticAddress = AWMATIC_V2;

  let id;
  let balanceUser;
  let balanceProxy;
  let providerAddress;
  let wmaticProviderAddress;

  before(async function() {
    providerAddress = await tokenProviderQuick(tokenAddress);
    wmaticProviderAddress = await tokenProviderQuick(WMATIC_TOKEN);

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
    this.awmatic = await IAToken.at(awmaticAddress);
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

  describe('Deposit', function() {
    describe('Matic', function() {
      it('normal', async function() {
        const value = ether('10');
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode('depositETH(uint256)', value);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expectEqWithinBps(await this.awmatic.balanceOf(user), value, 1);
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = ether('10');
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode('depositETH(uint256)', MAX_UINT256);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expectEqWithinBps(await this.awmatic.balanceOf(user), value, 1);
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });
    });

    describe('Token', function() {
      it('normal', async function() {
        const value = ether('10');
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'deposit(address,uint256)',
          this.token.address,
          value
        );

        await this.token.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await this.aToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expectEqWithinBps(await this.aToken.balanceOf(user), value, 1);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = ether('10');
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'deposit(address,uint256)',
          this.token.address,
          MAX_UINT256
        );

        await this.token.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token.address);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await this.aToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expectEqWithinBps(await this.aToken.balanceOf(user), value, 1);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('should revert: not supported token', async function() {
        const value = ether('10');
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'deposit(address,uint256)',
          this.mockToken.address,
          value
        );
        await this.mockToken.transfer(this.proxy.address, value, { from: _ });
        await expectRevert(
          this.proxy.execMock(to, data, { from: user }),
          'HAaveProtocolV2_General: aToken should not be zero address'
        );
      });
    });
  });

  describe('Withdraw', function() {
    var depositAmount = ether('5');

    describe('Matic', function() {
      beforeEach(async function() {
        await this.wmatic.approve(this.lendingPool.address, depositAmount, {
          from: wmaticProviderAddress,
        });
        await this.lendingPool.deposit(
          this.wmatic.address,
          depositAmount,
          user,
          0,
          { from: wmaticProviderAddress }
        );

        depositAmount = await this.awmatic.balanceOf(user);
      });

      it('partial', async function() {
        const value = depositAmount.div(new BN(2));
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode('withdrawETH(uint256)', value);
        await this.awmatic.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(this.awmatic.address);
        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);
        // Verify proxy balance
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        // Verify user balance
        expectEqWithinBps(
          await this.awmatic.balanceOf(user),
          depositAmount.sub(value),
          1
        );
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = depositAmount.div(new BN(2));
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode('withdrawETH(uint256)', MAX_UINT256);
        await this.awmatic.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(this.awmatic.address);
        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        // Because AToken could be increase by timestamp in proxy
        expectEqWithinBps(handlerReturn, value, 1);

        // Verify proxy balance
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expectEqWithinBps(
          await this.awmatic.balanceOf(user),
          depositAmount.sub(handlerReturn),
          1
        );
        expectEqWithinBps(await balanceUser.delta(), value, 1);
        profileGas(receipt);
      });
    });

    describe('Token', function() {
      beforeEach(async function() {
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
      });

      it('partial', async function() {
        const value = depositAmount.div(new BN(2));
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'withdraw(address,uint256)',
          this.token.address,
          value
        );

        await this.aToken.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(this.aToken.address);
        await balanceUser.get();
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);
        // Verify proxy balance
        expect(
          await this.aToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;

        // Verify user balance
        expectEqWithinBps(
          await this.aToken.balanceOf(user),
          depositAmount.sub(value),
          1
        );
        expect(await this.token.balanceOf(user)).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = depositAmount.div(new BN(2));
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'withdraw(address,uint256)',
          this.token.address,
          MAX_UINT256
        );
        await this.aToken.transfer(this.proxy.address, value, { from: user });
        await this.proxy.updateTokenMock(this.aToken.address);
        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );

        // Verify handler return
        // Because AToken could be increase by timestamp in proxy
        expectEqWithinBps(handlerReturn, value, 1);

        // Verify proxy balance
        expect(
          await this.aToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        // Verify user balance
        expectEqWithinBps(
          await this.aToken.balanceOf(user),
          depositAmount.sub(handlerReturn),
          1
        );
        expect(await this.token.balanceOf(user)).to.be.bignumber.eq(
          handlerReturn
        );
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('whole', async function() {
        const value = MAX_UINT256;
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'withdraw(address,uint256)',
          this.token.address,
          value
        );
        await this.aToken.transfer(
          this.proxy.address,
          await this.aToken.balanceOf(user),
          { from: user }
        );
        await this.proxy.updateTokenMock(this.aToken.address);
        await balanceUser.get();

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Get handler return result
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        const aTokenUserAfter = await this.aToken.balanceOf(user);
        const tokenUserAfter = await this.token.balanceOf(user);

        // Verify handler return
        expect(handlerReturn).to.be.bignumber.gte(depositAmount);
        // Verify proxy balance
        expect(
          await this.aToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        // Verify user balance
        expect(aTokenUserAfter).to.be.bignumber.lt(ATOKEN_DUST);
        expect(tokenUserAfter).to.be.bignumber.eq(handlerReturn);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('should revert: not enough balance', async function() {
        const value = depositAmount.add(ether('10'));
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'withdraw(address,uint256)',
          this.token.address,
          value
        );

        await this.aToken.transfer(
          this.proxy.address,
          await this.aToken.balanceOf(user),
          { from: user }
        );
        await this.proxy.updateTokenMock(this.aToken.address);

        await expectRevert(
          this.proxy.execMock(to, data, { from: user }),
          'HAaveProtocolV2_withdraw: 5'
        );
      });

      it('should revert: not supported token', async function() {
        const value = depositAmount.add(ether('10'));
        const to = this.hAaveV2.address;
        const data = abi.simpleEncode(
          'withdraw(address,uint256)',
          this.mockToken.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, { from: user }),
          'HAaveProtocolV2_General: aToken should not be zero address'
        );
      });
    });
  });
});
