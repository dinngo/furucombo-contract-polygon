const { network } = require('hardhat');

const utils = ethers.utils;

// beta parameter
const registryOwner = '0x64585922a9703d9EdE7d353a6522eb2970f75066';
const registryAddress = '0x5E56d6c6F763d6B1f21723a11be98533E168C3c9';

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('HUniswapV3', {
    from: deployer,
    args: [],
    log: true,
  });

  const HUniswapV3 = await ethers.getContract('HUniswapV3', deployer);

  if (network.name == 'hardhat') {
    await localDeployment(deployer, HUniswapV3);
  } else {
    await betaDeployment(HUniswapV3);
  }
};

async function localDeployment(deployer, HUniswapV3) {
  console.log('local deployment...');
  const registry = await ethers.getContract('Registry', deployer);

  await registry.register(
    HUniswapV3.address,
    utils.formatBytes32String('HUniswapV3')
  );
}

async function betaDeployment(HUniswapV3) {
  console.log('beta deployment...');

  const provider = ethers.provider;
  const [signer] = await ethers.getSigners();

  // register to Registry
  const iface = new utils.Interface([
    'function register(address registration,bytes32 info)',
  ]);

  const registerData = iface.encodeFunctionData('register', [
    HUniswapV3.address,
    utils.formatBytes32String('HUniswapV3'),
  ]);

  const customData = registerData + 'ff00ff' + registryOwner.replace('0x', '');

  const nonce = await provider.getTransactionCount(registryOwner);

  await signer.sendTransaction({
    to: registryAddress,
    nonce: nonce,
    data: customData,
    gasLimit: 6000000,
  });
}

module.exports.tags = ['HUniswapV3'];
module.exports.dependencies = ['Registry'];
