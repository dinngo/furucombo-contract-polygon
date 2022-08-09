const AAVE_POOL_V3 = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const utils = ethers.utils;

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('HAaveProtocolV3', {
    from: deployer,
    args: [],
    log: true,
  });

  const registry = await ethers.getContract('Registry', deployer);
  const hAaveProtocolV3 = await ethers.getContract('HAaveProtocolV3', deployer);

  await registry.register(
    hAaveProtocolV3.address,
    utils.formatBytes32String('HAaveProtocolV3')
  );

  await registry.registerCaller(
    AAVE_POOL_V3,
    utils.hexConcat([hAaveProtocolV3.address, '0x000000000000000000000000'])
  );
};

module.exports.tags = ['HAaveProtocolV3'];
module.exports.dependencies = ['Registry'];
