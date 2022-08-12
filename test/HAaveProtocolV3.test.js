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
  ADAI_V3_TOKEN,
  AWMATIC_V3,
  AAVEPROTOCOL_V3_PROVIDER,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getHandlerReturn,
  mulPercent,
  expectEqWithinBps,
  tokenProviderQuick,
} = require('./utils/utils');

const HAaveV3 = artifacts.require('HAaveProtocolV3');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IAToken = artifacts.require('IATokenV3');
const IPool = artifacts.require('IPool');
const IProvider = artifacts.require('IPoolAddressesProvider');
const SimpleToken = artifacts.require('SimpleToken');
const ATOKEN_DUST = ether('0.00001');

contract('Aave V3', function([_, user]) {
  const aTokenAddress = ADAI_V3_TOKEN;
  const tokenAddress = DAI_TOKEN;
  const awmaticAddress = AWMATIC_V3;

  let id;
  let balanceUser;
  let balanceProxy;
  let providerAddress;
  let wmaticProviderAddress;

  before(async function() {
    providerAddress = await tokenProviderQuick(tokenAddress);
    wmaticProviderAddress = await tokenProviderQuick(WMATIC_TOKEN);
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

  describe('Supply', function() {
    describe('Matic', function() {
      it('normal', async function() {
        const value = ether('10');
        const to = this.hAaveV3.address;
        const data = abi.simpleEncode('supplyETH(uint256)', value);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expectEqWithinBps(await this.awmatic.balanceOf(user), value, 100);
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = ether('10');
        const to = this.hAaveV3.address;
        const data = abi.simpleEncode('supplyETH(uint256)', MAX_UINT256);

        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });
        expect(await balanceProxy.get()).to.be.bignumber.zero;
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expectEqWithinBps(await this.awmatic.balanceOf(user), value, 100);
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(value)
        );
        profileGas(receipt);
      });
    });

    describe('Token', function() {
      it('normal', async function() {
        const value = ether('10');
        const to = this.hAaveV3.address;
        const data = abi.simpleEncode(
          'supply(address,uint256)',
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
        expectEqWithinBps(await this.aToken.balanceOf(user), value, 100);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = ether('10');
        const to = this.hAaveV3.address;
        const data = abi.simpleEncode(
          'supply(address,uint256)',
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
        expectEqWithinBps(await this.aToken.balanceOf(user), value, 10);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('should revert: not supported token', async function() {
        const value = ether('10');
        const to = this.hAaveV3.address;
        const data = abi.simpleEncode(
          'supply(address,uint256)',
          this.mockToken.address,
          value
        );
        await this.mockToken.transfer(this.proxy.address, value, { from: _ });
        await expectRevert(
          this.proxy.execMock(to, data, { from: user }),
          'HAaveProtocolV3_General: aToken should not be zero address'
        );
      });
    });
  });

  describe('Withdraw', function() {
    var supplyAmount = ether('5');

    describe('Matic', function() {
      beforeEach(async function() {
        await this.wmatic.approve(this.pool.address, supplyAmount, {
          from: wmaticProviderAddress,
        });
        await this.pool.supply(this.wmatic.address, supplyAmount, user, 0, {
          from: wmaticProviderAddress,
        });

        supplyAmount = await this.awmatic.balanceOf(user);
      });

      it('partial', async function() {
        const value = supplyAmount.div(new BN(2));
        const to = this.hAaveV3.address;
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
        const aTokenUserAfter = await this.awmatic.balanceOf(user);
        const interestMax = supplyAmount.mul(new BN(1)).div(new BN(10000));

        // Verify handler return
        expect(value).to.be.bignumber.eq(handlerReturn);
        // Verify proxy balance
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        // Verify user balance
        // (supply - withdraw) <= aTokenAfter < (supply + interestMax - withdraw)
        expect(aTokenUserAfter).to.be.bignumber.gte(supplyAmount.sub(value));
        expect(aTokenUserAfter).to.be.bignumber.lt(
          supplyAmount.add(interestMax).sub(value)
        );
        expect(await balanceUser.delta()).to.be.bignumber.eq(value);
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = supplyAmount.div(new BN(2));
        const to = this.hAaveV3.address;
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
        const aTokenUserAfter = await this.awmatic.balanceOf(user);
        const interestMax = supplyAmount.mul(new BN(1)).div(new BN(10000));

        // Verify handler return
        // value  <= handlerReturn  <= value*1.01
        // Because AToken could be increase by timestamp in proxy
        expect(value).to.be.bignumber.lte(handlerReturn);
        expect(mulPercent(value, 101)).to.be.bignumber.gte(handlerReturn);

        // Verify proxy balance
        expect(
          await this.awmatic.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        // Verify user balance
        // (supply - withdraw) <= aTokenAfter < (supply + interestMax - withdraw)
        // NOTE: aTokenUserAfter == (supplyAmount - withdraw - 1) (sometime, Ganache bug maybe)
        expect(aTokenUserAfter).to.be.bignumber.gte(
          supplyAmount.sub(handlerReturn.add(new BN(1)))
        );
        expect(aTokenUserAfter).to.be.bignumber.lt(
          supplyAmount.add(interestMax).sub(handlerReturn)
        );
        expectEqWithinBps(await balanceUser.delta(), value, 100);
        profileGas(receipt);
      });
    });

    describe('Token', function() {
      beforeEach(async function() {
        await this.token.approve(this.pool.address, supplyAmount, {
          from: providerAddress,
        });
        await this.pool.supply(this.token.address, supplyAmount, user, 0, {
          from: providerAddress,
        });

        supplyAmount = await this.aToken.balanceOf(user);
      });

      it('partial', async function() {
        const value = supplyAmount.div(new BN(2));
        const to = this.hAaveV3.address;
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
        const aTokenUserAfter = await this.aToken.balanceOf(user);
        const tokenUserAfter = await this.token.balanceOf(user);
        const interestMax = supplyAmount.mul(new BN(1)).div(new BN(10000));

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
        // (supply - withdraw) <= aTokenAfter < (supply + interestMax - withdraw)
        expect(aTokenUserAfter).to.be.bignumber.gte(supplyAmount.sub(value));
        expect(aTokenUserAfter).to.be.bignumber.lt(
          supplyAmount.add(interestMax).sub(value)
        );
        expect(tokenUserAfter).to.be.bignumber.eq(value);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('max amount', async function() {
        const value = supplyAmount.div(new BN(2));
        const to = this.hAaveV3.address;
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
        const aTokenUserAfter = await this.aToken.balanceOf(user);
        const tokenUserAfter = await this.token.balanceOf(user);
        const interestMax = supplyAmount.mul(new BN(1)).div(new BN(10000));

        // Verify handler return
        // value  <= handlerReturn  <= value*1.01
        // Because AToken could be increase by timestamp in proxy
        expect(value).to.be.bignumber.lte(handlerReturn);
        expect(mulPercent(value, 101)).to.be.bignumber.gte(handlerReturn);

        // Verify proxy balance
        expect(
          await this.aToken.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        expect(
          await this.token.balanceOf(this.proxy.address)
        ).to.be.bignumber.zero;
        // Verify user balance
        // (supply - withdraw -1) <= aTokenAfter < (supply + interestMax - withdraw)
        // NOTE: aTokenUserAfter == (supplyAmount - withdraw - 1) (sometime, Ganache bug maybe)
        expect(aTokenUserAfter).to.be.bignumber.gte(
          supplyAmount.sub(handlerReturn.add(new BN(1)))
        );
        expect(aTokenUserAfter).to.be.bignumber.lt(
          supplyAmount.add(interestMax).sub(handlerReturn)
        );
        expect(tokenUserAfter).to.be.bignumber.eq(handlerReturn);
        expect(await balanceUser.delta()).to.be.bignumber.eq(ether('0'));
        profileGas(receipt);
      });

      it('whole', async function() {
        const value = MAX_UINT256;
        const to = this.hAaveV3.address;
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
        expect(handlerReturn).to.be.bignumber.gte(supplyAmount);
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
        const value = supplyAmount.add(ether('10'));
        const to = this.hAaveV3.address;
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
          'HAaveProtocolV3_withdraw: 32' // AAVEV3 Error Code: NOT_ENOUGH_AVAILABLE_USER_BALANCE
        );
      });

      it('should revert: not supported token', async function() {
        const value = supplyAmount.add(ether('10'));
        const to = this.hAaveV3.address;
        const data = abi.simpleEncode(
          'withdraw(address,uint256)',
          this.mockToken.address,
          value
        );

        await expectRevert(
          this.proxy.execMock(to, data, { from: user }),
          'HAaveProtocolV3_General: aToken should not be zero address'
        );
      });
    });
  });
});
