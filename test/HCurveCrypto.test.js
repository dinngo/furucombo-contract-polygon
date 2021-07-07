const { balance, BN, ether, constants } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const { tracker } = balance;
const { expect } = require('chai');
const abi = require('ethereumjs-abi');
const utils = web3.utils;
const {
  WETH_TOKEN,
  WETH_PROVIDER,
  USDT_TOKEN,
  USDT_PROVIDER,
  WBTC_TOKEN,
  WBTC_PROVIDER,
  CURVE_ATRICRYPTO_DEPOSIT,
  CURVE_ATRICRYPTOCRV,
  CURVE_ATRICRYPTOCRV_PROVIDER,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  mulPercent,
  profileGas,
  getHandlerReturn,
} = require('./utils/utils');

const Proxy = artifacts.require('ProxyMock');
const Registry = artifacts.require('Registry');
const HCurve = artifacts.require('HCurve');
const ICurveHandler = artifacts.require('ICurveHandler');
const IToken = artifacts.require('IERC20');

contract('Curve', function([_, user]) {
  const slippage = new BN('3');
  let id;
  before(async function() {
    this.registry = await Registry.new();
    this.hCurve = await HCurve.new();
    await this.registry.register(
      this.hCurve.address,
      utils.asciiToHex('HCurve')
    );
    this.proxy = await Proxy.new(this.registry.address);
    this.atricryptoDeposit = await ICurveHandler.at(CURVE_ATRICRYPTO_DEPOSIT);
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Exchange underlying', function() {
    describe('atricrypto pool', function() {
      const token0Address = USDT_TOKEN;
      const token1Address = WBTC_TOKEN;
      const token2Address = WETH_TOKEN;
      const provider0Address = USDT_PROVIDER;
      const provider1Address = WBTC_PROVIDER;

      let token0, token1, token2;
      let balanceUser, balanceProxy;
      let token0User, token1User, token2User;
      let answer, handlerReturn;

      before(async function() {
        token0 = await IToken.at(token0Address);
        token1 = await IToken.at(token1Address);
        token2 = await IToken.at(token2Address);
      });

      beforeEach(async function() {
        balanceUser = await tracker(user);
        balanceProxy = await tracker(this.proxy.address);
        token0User = await token0.balanceOf.call(user);
        token1User = await token1.balanceOf.call(user);
        token2User = await token2.balanceOf.call(user);
      });

      afterEach(async function() {
        // Check handler return
        expect(handlerReturn).to.be.bignumber.gte(mulPercent(answer, 99));
        expect(handlerReturn).to.be.bignumber.lte(mulPercent(answer, 101));

        // Check proxy
        expect(await balanceProxy.get()).to.be.zero;
        expect(await token0.balanceOf.call(this.proxy.address)).to.be.zero;
        expect(await token1.balanceOf.call(this.proxy.address)).to.be.zero;
        expect(await token2.balanceOf.call(this.proxy.address)).to.be.zero;

        profileGas(receipt);
      });

      it('Exact input swap USDT to WBTC by exchangeUnderlying', async function() {
        const value = new BN('100000000'); // 1e8
        answer = await this.atricryptoDeposit.methods[
          'get_dy_underlying(uint256,uint256,uint256)'
        ](2, 3, value);

        const data = abi.simpleEncode(
          'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256,bool,bool)',
          this.atricryptoDeposit.address,
          token0.address,
          token1.address,
          2,
          3,
          value,
          mulPercent(answer, new BN('100').sub(slippage)),
          true, // isUint256
          false // useEth
        );
        await token0.transfer(this.proxy.address, value, {
          from: provider0Address,
        });
        await this.proxy.updateTokenMock(token0.address);
        receipt = await this.proxy.execMock(this.hCurve.address, data, {
          from: user,
          value: ether('1'), // Ensure handler can correctly deal with matic
        });
        handlerReturn = utils.toBN(getHandlerReturn(receipt, ['uint256'])[0]);

        // Check user
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(new BN(receipt.receipt.gasUsed))
        );
        expect(await token1.balanceOf.call(user)).to.be.bignumber.eq(
          handlerReturn
        );
      });

      it('Exact input swap WBTC to WETH by exchangeUnderlying', async function() {
        const value = new BN('1000000'); // 1e6
        answer = await this.atricryptoDeposit.methods[
          'get_dy_underlying(uint256,uint256,uint256)'
        ](3, 4, value);

        const data = abi.simpleEncode(
          'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256,bool,bool)',
          this.atricryptoDeposit.address,
          token1.address,
          token2.address,
          3,
          4,
          value,
          mulPercent(answer, new BN('100').sub(slippage)),
          true, // isUint256
          false // useEth
        );
        await token1.transfer(this.proxy.address, value, {
          from: provider1Address,
        });
        await this.proxy.updateTokenMock(token1.address);
        receipt = await this.proxy.execMock(this.hCurve.address, data, {
          from: user,
          value: ether('1'), // Ensure handler can correctly deal with matic
        });
        handlerReturn = utils.toBN(getHandlerReturn(receipt, ['uint256'])[0]);

        // Check user
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(new BN(receipt.receipt.gasUsed))
        );
        expect(await token2.balanceOf.call(user)).to.be.bignumber.eq(
          handlerReturn
        );
      });
    });
  });

  describe('Liquidity', function() {
    describe('atricrypto pool', function() {
      const token0Address = USDT_TOKEN;
      const token1Address = WBTC_TOKEN;
      const token2Address = WETH_TOKEN;
      const provider0Address = USDT_PROVIDER;
      const provider1Address = WBTC_PROVIDER;
      const provider2Address = WETH_PROVIDER;
      const poolTokenAddress = CURVE_ATRICRYPTOCRV;
      const poolTokenProvider = CURVE_ATRICRYPTOCRV_PROVIDER;

      let token0, token1, token2, poolToken;
      let balanceUser, balanceProxy;
      let token0User, token1User, token2User, poolTokenUser;
      let answer, handlerReturn;

      before(async function() {
        token0 = await IToken.at(token0Address);
        token1 = await IToken.at(token1Address);
        token2 = await IToken.at(token2Address);
        poolToken = await IToken.at(poolTokenAddress);
      });

      beforeEach(async function() {
        balanceUser = await tracker(user);
        balanceProxy = await tracker(this.proxy.address);
        token0User = await token0.balanceOf.call(user);
        token1User = await token1.balanceOf.call(user);
        token2User = await token2.balanceOf.call(user);
        poolTokenUser = await poolToken.balanceOf.call(user);
      });

      afterEach(async function() {
        // Check handler
        expect(handlerReturn).to.be.bignumber.gte(mulPercent(answer, 99));
        expect(handlerReturn).to.be.bignumber.lte(mulPercent(answer, 101));

        // Check proxy
        expect(await balanceProxy.get()).to.be.zero;
        expect(await token0.balanceOf.call(this.proxy.address)).to.be.zero;
        expect(await token1.balanceOf.call(this.proxy.address)).to.be.zero;
        expect(await token2.balanceOf.call(this.proxy.address)).to.be.zero;
        expect(await poolToken.balanceOf.call(this.proxy.address)).to.be.zero;
      });

      it('add USDT, WBTC and WETH to pool by addLiquidity', async function() {
        const token0Amount = new BN('100000000'); // 1e8
        const token1Amount = new BN('1000000'); // 1e6
        const token2Amount = ether('0.1');
        const tokens = [
          constants.ZERO_ADDRESS,
          constants.ZERO_ADDRESS,
          token0.address,
          token1.address,
          token2.address,
        ];
        const amounts = [
          new BN('0'),
          new BN('0'),
          token0Amount,
          token1Amount,
          token2Amount,
        ];

        // Get expected answer
        answer = await this.atricryptoDeposit.methods[
          'calc_token_amount(uint256[5],bool)'
        ](amounts, true);

        // Execute handler
        await token0.transfer(this.proxy.address, token0Amount, {
          from: provider0Address,
        });
        await token1.transfer(this.proxy.address, token1Amount, {
          from: provider1Address,
        });
        await token2.transfer(this.proxy.address, token2Amount, {
          from: provider2Address,
        });
        await this.proxy.updateTokenMock(token0.address);
        await this.proxy.updateTokenMock(token1.address);
        await this.proxy.updateTokenMock(token2.address);
        const minMintAmount = mulPercent(answer, new BN('100').sub(slippage));
        const data = abi.simpleEncode(
          'addLiquidity(address,address,address[],uint256[],uint256)',
          this.atricryptoDeposit.address,
          poolToken.address,
          tokens,
          amounts,
          minMintAmount
        );
        const receipt = await this.proxy.execMock(this.hCurve.address, data, {
          from: user,
          value: ether('1'), // Ensure handler can correctly deal with matic
        });
        handlerReturn = utils.toBN(getHandlerReturn(receipt, ['uint256'])[0]);

        // Check user
        expect(await token0.balanceOf.call(user)).to.be.bignumber.eq(
          token0User
        );
        expect(await token1.balanceOf.call(user)).to.be.bignumber.eq(
          token1User
        );
        expect(await token2.balanceOf.call(user)).to.be.bignumber.eq(
          token2User
        );
        expect(await poolToken.balanceOf.call(user)).to.be.bignumber.eq(
          handlerReturn
        );

        profileGas(receipt);
      });

      it('remove from pool to USDT by removeLiquidityOneCoin', async function() {
        const amount = ether('0.1');
        answer = await this.atricryptoDeposit.methods[
          'calc_withdraw_one_coin(uint256,uint256)'
        ](amount, 2);
        await poolToken.transfer(this.proxy.address, amount, {
          from: poolTokenProvider,
        });
        await this.proxy.updateTokenMock(poolToken.address);
        const minAmount = mulPercent(answer, new BN('100').sub(slippage));
        const data = abi.simpleEncode(
          'removeLiquidityOneCoin(address,address,address,uint256,int128,uint256,bool)',
          this.atricryptoDeposit.address,
          poolToken.address,
          token0.address,
          amount,
          2,
          minAmount,
          true // isUint256
        );
        const receipt = await this.proxy.execMock(this.hCurve.address, data, {
          from: user,
          value: ether('1'), // Ensure handler can correctly deal with matic
        });
        handlerReturn = utils.toBN(getHandlerReturn(receipt, ['uint256'])[0]);

        // Check user
        expect(await token0.balanceOf.call(user)).to.be.bignumber.eq(
          token0User.add(handlerReturn)
        );

        profileGas(receipt);
      });

      it('remove from pool to WETH by removeLiquidityOneCoin', async function() {
        const amount = ether('0.1');
        answer = await this.atricryptoDeposit.methods[
          'calc_withdraw_one_coin(uint256,uint256)'
        ](amount, 4);
        await poolToken.transfer(this.proxy.address, amount, {
          from: poolTokenProvider,
        });
        await this.proxy.updateTokenMock(poolToken.address);
        const minAmount = mulPercent(answer, new BN('100').sub(slippage));
        const data = abi.simpleEncode(
          'removeLiquidityOneCoin(address,address,address,uint256,int128,uint256,bool)',
          this.atricryptoDeposit.address,
          poolToken.address,
          token2.address,
          amount,
          4,
          minAmount,
          true // isUint256
        );
        const receipt = await this.proxy.execMock(this.hCurve.address, data, {
          from: user,
          value: ether('1'), // Ensure handler can correctly deal with matic
        });
        handlerReturn = utils.toBN(getHandlerReturn(receipt, ['uint256'])[0]);

        // Check user
        expect(await token2.balanceOf.call(user)).to.be.bignumber.eq(
          token2User.add(handlerReturn)
        );

        profileGas(receipt);
      });
    });
  });
});
