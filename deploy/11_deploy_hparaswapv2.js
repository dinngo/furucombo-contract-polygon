const utils = ethers.utils;

// beta parameter
const registryOwner = '0x64585922a9703d9EdE7d353a6522eb2970f75066';
const registryAddress = '0x5E56d6c6F763d6B1f21723a11be98533E168C3c9';
const fakeKey =
  'd74d952106fcdc7fe598eea01a3e9f5a081d928cea7869e9921e69abc5a7dd44';
module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('HParaSwapV5', {
    from: deployer,
    args: [],
    log: true,
  });

  const hParaSwapV5 = await ethers.getContract('HParaSwapV5', deployer);

  if (network.name == 'hardhat') {
    await localDeployment(deployer, hParaSwapV5);
  } else {
    await betaDeployment(hParaSwapV5);
  }
};

async function localDeployment(deployer, hParaSwapV5) {
  console.log('local deployment...');
  const registry = await ethers.getContract('Registry', deployer);

  await registry.register(
    hParaSwapV5.address,
    utils.formatBytes32String('HParaSwapV5')
  );
}

async function betaDeployment(hParaSwapV5) {
  console.log('beta deployment...');

  const provider = ethers.provider;
  const signer = new ethers.Wallet(fakeKey, provider);

  // register to Registry
  const iface = new utils.Interface([
    'function register(address registration,bytes32 info)',
  ]);

  const registerData = iface.encodeFunctionData('register', [
    hParaSwapV5.address,
    utils.formatBytes32String('HParaSwapV5'),
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

module.exports.tags = ['HParaSwapV5'];
module.exports.dependencies = ['Registry'];
