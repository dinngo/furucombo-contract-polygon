const {
  balance,
  BN,
  constants,
  ether,
  expectEvent,
  expectRevert,
  send,
} = require('@openzeppelin/test-helpers');
const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const { USDC_TOKEN, UNIVERSE_CAPITAL_FUND } = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  getHandlerReturn,
  tokenProviderQuick,
  mwei,
  impersonateAndInjectEther,
} = require('./utils/utils');

const HFundsOperation = artifacts.require('HFundsOperation');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IShareToken = artifacts.require('IShareToken');
const IFunds = artifacts.require('IFunds');

contract('HFundsOperation', function([_, user]) {
  // const denominationAddress = USDC_TOKEN;
  let id;
  // let denominationProviderAddress;

  before(async function() {
    // denominationProviderAddress = await tokenProviderQuick(denominationAddress);

    this.registry = await Registry.new();
    this.proxy = await Proxy.new(this.registry.address);
    this.hFundsOperation = await HFundsOperation.new();
    await this.registry.register(
      this.hFundsOperation.address,
      utils.asciiToHex('HFundsOperation')
    );
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Purchase', function() {
    let denomination, denominationAddress, denominationProvider;
    let funds;
    let shareToken;
    const fundsAddress = UNIVERSE_CAPITAL_FUND;
    before(async function() {
      funds = await IFunds.at(fundsAddress);
      denominationAddress = await funds.denomination();
      denomination = await IToken.at(denominationAddress);
      denominationProvider = await tokenProviderQuick(denominationAddress);
      shareToken = await IToken.at(await funds.shareToken());
    });

    it('normal', async function() {
      const purchaseAmount = mwei('500');
      const to = this.hFundsOperation.address;
      const data = abi.simpleEncode(
        'purchase(address,uint256)',
        fundsAddress,
        purchaseAmount
      );

      await denomination.transfer(this.proxy.address, purchaseAmount, {
        from: denominationProvider,
      });

      const expectedShare = await funds.calculateShare(purchaseAmount);

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
      });

      const handlerReturn = getHandlerReturn(receipt, ['uint256'])[0];

      const proxyShare = await shareToken.balanceOf(this.proxy.address);
      const userShare = await shareToken.balanceOf(user);

      const proxyDenomination = await denomination.balanceOf(
        this.proxy.address
      );

      // User's share should be equal with handler return share
      expect(userShare).to.be.bignumber.eq(handlerReturn);

      // User's share should greater or equal than expectedShare
      expect(userShare).to.be.bignumber.gte(expectedShare);

      // Proxy shouldn't have remaining share
      expect(proxyShare).to.be.zero;

      // Proxy shouldn't have remaining denomination
      expect(proxyDenomination).to.be.zero;
    });
  });

  describe('Redeem', function() {
    let denomination, denominationAddress, denominationProvider;
    let funds;
    let shareToken, shareTokenAddress, shareTokenOwner;
    const fundsAddress = UNIVERSE_CAPITAL_FUND;
    before(async function() {
      funds = await IFunds.at(fundsAddress);
      denominationAddress = await funds.denomination();
      denomination = await IToken.at(denominationAddress);
      denominationProvider = await tokenProviderQuick(denominationAddress);
      shareTokenAddress = await funds.shareToken();
      shareToken = await IShareToken.at(shareTokenAddress);
      shareTokenOwner = await shareToken.owner();
      await impersonateAndInjectEther(shareTokenOwner);
    });

    it('normal', async function() {
      const redeemShare = mwei('500');
      const to = this.hFundsOperation.address;
      const data = abi.simpleEncode(
        'redeem(address,uint256)',
        fundsAddress,
        redeemShare
      );

      await shareToken.mint(user, redeemShare, {
        from: shareTokenOwner,
      });

      await shareToken.transfer(this.proxy.address, redeemShare, {
        from: user,
      });

      const expectedShare = await funds.calculateBalance(redeemShare);

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
      });

      const handlerReturn = getHandlerReturn(receipt, ['uint256'])[0];

      const proxyShare = await shareToken.balanceOf(this.proxy.address);
      const userShare = await shareToken.balanceOf(user);

      const proxyDenomination = await denomination.balanceOf(
        this.proxy.address
      );

      // User's share should be equal with handler return share
      expect(userShare).to.be.bignumber.eq(handlerReturn);

      // User's share should greater or equal than expectedShare
      expect(userShare).to.be.bignumber.gte(expectedShare);

      // Proxy shouldn't have remaining share
      expect(proxyShare).to.be.zero;

      // Proxy shouldn't have remaining denomination
      expect(proxyDenomination).to.be.zero;
    });
  });
});
