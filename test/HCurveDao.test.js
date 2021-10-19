const {
  BN,
  ether,
  expectRevert,
  time,
  constants,
} = require('@openzeppelin/test-helpers');
const { MAX_UINT256 } = constants;
const { expect } = require('chai');
const abi = require('ethereumjs-abi');
const utils = web3.utils;
const { increase, duration } = time;
const {
  CRV_TOKEN,
  CURVE_AAVECRV,
  CURVE_AAVECRV_PROVIDER,
  CURVE_AAVE_GAUGE,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  getHandlerReturn,
} = require('./utils/utils');

const Proxy = artifacts.require('ProxyMock');
const Registry = artifacts.require('Registry');
const HCurveDao = artifacts.require('HCurveDao');
const IMinter = artifacts.require('IMinter');
const ILiquidityGauge = artifacts.require('ILiquidityGauge');
const IToken = artifacts.require('IERC20');

contract('Curve DAO', function([_, user]) {
  let id;
  // Wait for the gaude to be ready
  const token0Address = CURVE_AAVECRV;
  const token0Provider = CURVE_AAVECRV_PROVIDER;
  const gauge0Address = CURVE_AAVE_GAUGE;
  const gauge0Amount = ether('0.1');

  before(async function() {
    this.registry = await Registry.new();
    this.hCurveDao = await HCurveDao.new();
    await this.registry.register(
      this.hCurveDao.address,
      utils.asciiToHex('HCurveDao')
    );
    this.token0 = await IToken.at(token0Address);
    this.gauge0 = await ILiquidityGauge.at(gauge0Address);
    this.proxy = await Proxy.new(this.registry.address);

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [token0Provider],
    });
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Deposit lp token to gauge', function() {
    it('normal', async function() {
      await this.token0.transfer(this.proxy.address, gauge0Amount, {
        from: token0Provider,
      });
      const to = this.hCurveDao.address;
      const data = abi.simpleEncode(
        'deposit(address,uint256)',
        this.gauge0.address,
        gauge0Amount
      );
      await this.gauge0.set_approve_deposit(this.proxy.address, true, {
        from: user,
      });

      const depositUser = await this.gauge0.balanceOf.call(user);
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      const depositUserEnd = await this.gauge0.balanceOf.call(user);
      expect(depositUserEnd.sub(depositUser)).to.be.bignumber.eq(gauge0Amount);
      expect(
        await this.token0.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      profileGas(receipt);
    });

    it('max amount', async function() {
      await this.token0.transfer(this.proxy.address, gauge0Amount, {
        from: token0Provider,
      });
      const to = this.hCurveDao.address;
      const data = abi.simpleEncode(
        'deposit(address,uint256)',
        this.gauge0.address,
        MAX_UINT256
      );
      await this.gauge0.set_approve_deposit(this.proxy.address, true, {
        from: user,
      });

      const depositUser = await this.gauge0.balanceOf.call(user);
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: ether('0.1'),
      });

      const depositUserEnd = await this.gauge0.balanceOf.call(user);
      expect(depositUserEnd.sub(depositUser)).to.be.bignumber.eq(gauge0Amount);
      expect(
        await this.token0.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));
      profileGas(receipt);
    });

    it('without approval', async function() {
      await this.token0.transfer(this.proxy.address, gauge0Amount, {
        from: token0Provider,
      });
      const to = this.hCurveDao.address;
      const data = abi.simpleEncode(
        'deposit(address,uint256)',
        this.gauge0.address,
        gauge0Amount
      );
      await expectRevert(
        this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        }),
        'HCurveDao_deposit: Not approved'
      );
    });
  });
});
