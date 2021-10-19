const utils = ethers.utils;

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('HQuickSwap', {
    from: deployer,
    args: [],
    log: true,
  });

  const registry = await ethers.getContract('Registry', deployer);
  const hQuickSwap = await ethers.getContract('HQuickSwap', deployer);

  await registry.register(
    hQuickSwap.address,
    utils.formatBytes32String('HQuickSwap')
  );
};

module.exports.tags = ['HQuickSwap'];
module.exports.dependencies = ['Registry'];
