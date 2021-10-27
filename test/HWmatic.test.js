const {
  balance,
  BN,
  constants,
  ether,
  expectEvent,
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const { latest } = time;
const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const { WMATIC_TOKEN, WMATIC_PROVIDER } = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  profileGas,
  sendMaticToProviders,
} = require('./utils/utils');

const HWmatic = artifacts.require('HWmatic');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');

contract('Wmatic', function([_, user]) {
  const tokenAddress = WMATIC_TOKEN;
  const tokenProviderAddress = WMATIC_PROVIDER;
  let id;

  before(async function() {
    this.token = await IToken.at(tokenAddress);
    this.registry = await Registry.new();
    this.proxy = await Proxy.new(this.registry.address);
    this.hWmatic = await HWmatic.new();
    await this.registry.register(
      this.hWmatic.address,
      utils.asciiToHex('Wmatic')
    );
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [tokenProviderAddress],
    });
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('deposit', function() {
    beforeEach(async function() {
      tokenUserAmount = await this.token.balanceOf.call(user);
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
      expect(
        await this.token.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));

      // Verify user balance
      expect(await this.token.balanceOf.call(user)).to.be.bignumber.eq(
        tokenUserAmount.add(value)
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        ether('0')
          .sub(value)
          .sub(new BN(receipt.receipt.gasUsed))
      );

      profileGas(receipt);
    });
  });

  describe('withdraw', function() {
    beforeEach(async function() {
      this.token = await IToken.at(tokenAddress);
      tokenUserAmount = await this.token.balanceOf.call(user);
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
      expect(
        await this.token.balanceOf.call(this.proxy.address)
      ).to.be.bignumber.eq(ether('0'));

      // Verify user balance
      expect(await this.token.balanceOf.call(user)).to.be.bignumber.eq(
        tokenUserAmount
      );
      expect(await balanceUser.delta()).to.be.bignumber.eq(
        value.sub(new BN(receipt.receipt.gasUsed))
      );

      profileGas(receipt);
    });
  });
});
