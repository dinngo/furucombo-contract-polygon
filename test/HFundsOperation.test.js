const abi = require('ethereumjs-abi');
const utils = web3.utils;

const { expect } = require('chai');

const { UNIVERSE_CAPITAL_FUND } = require('./utils/constants');
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

contract('HFundsOperation', function([_, user, dummy]) {
  let id;

  before(async function() {
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
    let to;
    const fundsAddress = UNIVERSE_CAPITAL_FUND;
    const purchaseAmount = mwei('500');

    before(async function() {
      to = this.hFundsOperation.address;
      funds = await IFunds.at(fundsAddress);
      denominationAddress = await funds.denomination();
      denomination = await IToken.at(denominationAddress);
      denominationProvider = await tokenProviderQuick(denominationAddress);
      shareToken = await IToken.at(await funds.shareToken());
    });

    it('normal', async function() {
      const data = abi.simpleEncode(
        'purchase(address,uint256)',
        fundsAddress,
        purchaseAmount
      );

      await denomination.transfer(this.proxy.address, purchaseAmount, {
        from: denominationProvider,
      });

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

      // Proxy shouldn't have remaining share
      expect(proxyShare).to.be.zero;

      // Proxy shouldn't have remaining denomination
      expect(proxyDenomination).to.be.zero;
    });

    it('should revert: invalid funds address', async function() {
      const data = abi.simpleEncode(
        'purchase(address,uint256)',
        dummy,
        purchaseAmount
      );

      await expect(
        this.proxy.execMock(to, data, {
          from: user,
        })
      ).to.be.revertedWith('invalid funds');
    });

    it('should revert: insufficient amount', async function() {
      const data = abi.simpleEncode(
        'purchase(address,uint256)',
        fundsAddress,
        purchaseAmount.add(mwei('1'))
      );

      await denomination.transfer(this.proxy.address, purchaseAmount, {
        from: denominationProvider,
      });

      await expect(
        this.proxy.execMock(to, data, {
          from: user,
        })
      ).to.be.revertedWith('insufficient amount');
    });

    it('should revert: purchase 0', async function() {
      const data = abi.simpleEncode(
        'purchase(address,uint256)',
        fundsAddress,
        0
      );

      await expect(
        this.proxy.execMock(to, data, {
          from: user,
        })
      ).to.be.revertedWith('RevertCode_70'); // SHARE_MODULE_PURCHASE_ZERO_BALANCE
    });
  });

  describe('Redeem', function() {
    let denomination, denominationAddress;
    let funds;
    let shareToken, shareTokenAddress, shareTokenOwner;
    let to;
    const fundsAddress = UNIVERSE_CAPITAL_FUND;
    const redeemShare = mwei('100');

    before(async function() {
      to = this.hFundsOperation.address;
      funds = await IFunds.at(fundsAddress);
      denominationAddress = await funds.denomination();
      denomination = await IToken.at(denominationAddress);
      shareTokenAddress = await funds.shareToken();
      shareToken = await IShareToken.at(shareTokenAddress);
      shareTokenOwner = await shareToken.owner();
      await impersonateAndInjectEther(shareTokenOwner);
    });

    it('normal', async function() {
      const data = abi.simpleEncode(
        'redeem(address,uint256)',
        fundsAddress,
        redeemShare
      );

      // Mint share token to user
      await shareToken.mint(user, redeemShare, {
        from: shareTokenOwner,
      });

      await shareToken.transfer(this.proxy.address, redeemShare, {
        from: user,
      });

      const receipt = await this.proxy.execMock(to, data, {
        from: user,
      });

      const handlerReturn = getHandlerReturn(receipt, ['uint256'])[0];

      const proxyShare = await shareToken.balanceOf(this.proxy.address);

      const proxyDenomination = await denomination.balanceOf(
        this.proxy.address
      );

      const userDenomination = await denomination.balanceOf(user);

      // User's denomination balance should be equal with handler return.
      expect(userDenomination).to.be.bignumber.eq(handlerReturn);

      // Proxy shouldn't have remaining share
      expect(proxyShare).to.be.zero;

      // Proxy shouldn't have remaining denomination
      expect(proxyDenomination).to.be.zero;
    });

    it('should revert: invalid funds address', async function() {
      const data = abi.simpleEncode(
        'redeem(address,uint256)',
        dummy,
        redeemShare
      );

      await expect(
        this.proxy.execMock(to, data, {
          from: user,
        })
      ).to.be.revertedWith('invalid funds');
    });

    it('should revert: insufficient share', async function() {
      const data = abi.simpleEncode(
        'redeem(address,uint256)',
        fundsAddress,
        redeemShare.add(mwei('1'))
      );

      // Mint share token to user
      await shareToken.mint(user, redeemShare, {
        from: shareTokenOwner,
      });

      await shareToken.transfer(this.proxy.address, redeemShare, {
        from: user,
      });

      await expect(
        this.proxy.execMock(to, data, {
          from: user,
        })
      ).to.be.revertedWith('insufficient share');
    });

    it('should revert: redeem 0 share', async function() {
      const data = abi.simpleEncode('redeem(address,uint256)', fundsAddress, 0);

      await expect(
        this.proxy.execMock(to, data, {
          from: user,
        })
      ).to.be.revertedWith('RevertCode_72'); // SHARE_MODULE_REDEEM_ZERO_SHARE
    });

    it('should revert: redeem pending', async function() {
      // makes funds no denomination
      const vault = await funds.vault();
      await impersonateAndInjectEther(vault);
      await denomination.transfer(dummy, await denomination.balanceOf(vault), {
        from: vault,
      });
      expect(await denomination.balanceOf(vault)).to.be.zero;

      // Mint share token to user
      await shareToken.mint(user, redeemShare, {
        from: shareTokenOwner,
      });

      await shareToken.transfer(this.proxy.address, redeemShare, {
        from: user,
      });

      const data = abi.simpleEncode(
        'redeem(address,uint256)',
        fundsAddress,
        redeemShare
      );

      await expect(
        this.proxy.execMock(to, data, {
          from: user,
        })
      ).to.be.revertedWith('RevertCode_74'); // SHARE_MODULE_REDEEM_IN_PENDING_WITHOUT_PERMISSION
    });
  });
});
