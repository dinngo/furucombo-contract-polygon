const utils = ethers.utils;

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('HWmatic', {
    from: deployer,
    args: [],
    log: true,
  });

  const registry = await ethers.getContract('Registry', deployer);
  const hWmatic = await ethers.getContract('HWmatic', deployer);

  await registry.register(
    hWmatic.address,
    utils.formatBytes32String('HWmatic')
  );
};

module.exports.tags = ['HWmatic'];
module.exports.dependencies = ['Registry'];
