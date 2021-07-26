const Registry = artifacts.require('Registry');
const Handler = artifacts.require('HAaveProtocolV2');
const utils = web3.utils;
const AAVE_LENDINGPOOL_V2 = '0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf';

module.exports = async function(deployer) {
  if (deployer.network === 'development') {
    return;
  }
  await deployer.deploy(Handler);
  const registry = await Registry.deployed();
  await registry.register(Handler.address, utils.asciiToHex('HAaveProtocolV2'));
  await registry.registerCaller(AAVE_LENDINGPOOL_V2, Handler.address); // For flashloan callback use
};
