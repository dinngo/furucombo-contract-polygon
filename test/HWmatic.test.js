const { balance, BN, ether } = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const { WMATIC_TOKEN } = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  tokenProviderQuick,
} = require('./utils/utils');

const HWmatic = artifacts.require('HWmatic');
const Registry = artifacts.require('Registry');
const FeeRuleRegistry = artifacts.require('FeeRuleRegistry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');

contract('Wmatic', function([_, user]) {
  const tokenAddress = WMATIC_TOKEN;
  let id;
  let tokenProviderAddress;

  before(async function() {
    tokenProviderAddress = await tokenProviderQuick(tokenAddress);

    this.token = await IToken.at(tokenAddress);
    this.registry = await Registry.new();
    this.feeRuleRegistry = await FeeRuleRegistry.new('0', _);
    this.proxy = await Proxy.new(
      this.registry.address,
      this.feeRuleRegistry.address
    );
    this.hWmatic = await HWmatic.new();
    await this.registry.register(
      this.hWmatic.address,
      utils.asciiToHex('Wmatic')
    );
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('deposit', function() {
    beforeEach(async function() {
      tokenUserAmount = await this.token.balanceOf(user);
      balanceProxy = await tracker(this.proxy.address);
      balanceUser = await tracker(user);
    });

    it('normal', async function() {
      // Prepare handler data
      const token = this.token.address;
      const value = ether('10');
      const to = this.hWmatic.address;
      const data = abi.simpleEncode('deposit(uint256)', value);

      // Send tokens to proxy
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: value,
      });

      // Verify proxy balance should be zero
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));
      expect(await this.token.balanceOf(this.proxy.address)).to.be.bignumber.eq(
        ether('0')
      );

      // Verify user balance
      expect(await this.token.balanceOf(user)).to.be.bignumber.eq(
        tokenUserAmount.add(value)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0').sub(value)
      );

      profileGas(receipt);
    });
  });

  describe('withdraw', function() {
    beforeEach(async function() {
      this.token = await IToken.at(tokenAddress);
      tokenUserAmount = await this.token.balanceOf(user);
      balanceProxy = await tracker(this.proxy.address);
      balanceUser = await tracker(user);
    });

    it('normal', async function() {
      // Prepare handler data
      const token = this.token.address;
      const value = ether('10');
      const to = this.hWmatic.address;
      const data = abi.simpleEncode('withdraw(uint256)', value);

      // Send WMATIC to proxy and prepare handler data
      await this.token.transfer(this.proxy.address, value, {
        from: tokenProviderAddress,
      });
      await this.proxy.updateTokenMock(this.token.address);

      // Send tokens to proxy
      const receipt = await this.proxy.execMock(to, data, {
        from: user,
        value: value,
      });

      // Verify proxy balance should be zero
      expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));
      expect(await this.token.balanceOf(this.proxy.address)).to.be.bignumber.eq(
        ether('0')
      );

      // Verify user balance
      expect(await this.token.balanceOf(user)).to.be.bignumber.eq(
        tokenUserAmount
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(value);

      profileGas(receipt);
    });
  });
});
