module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log('deployer:' + deployer);

  const feeRate = '0.002'; // 0.2%
  const basisFeeRate = ethers.utils.parseUnits(feeRate, 'ether'); // 0.2%
  const feeRuleRegistry = await deploy('FeeRuleRegistry', {
    from: deployer,
    args: [basisFeeRate, deployer],
    log: true,
  });
};

module.exports.tags = ['FeeRuleRegistry'];
