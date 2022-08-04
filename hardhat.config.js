require('@nomiclabs/hardhat-waffle');
require('hardhat-deploy');
require('hardhat-deploy-ethers');
require('solidity-coverage');
// Truffle and Web3.js plugin
require('@nomiclabs/hardhat-web3');
require('@nomiclabs/hardhat-truffle5');

require('dotenv').config();

const fs = require('fs');
let key_beta;

try {
  key_beta = fs
    .readFileSync('.secret_beta')
    .toString()
    .trim();
} catch (err) {
  console.log('No available .secret_beta');
}

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.10',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    beta: {
      accounts: key_beta ? [key_beta] : [],
      chainId: 137,
      url: 'https://polygon-beta.furucombo.app/',
    },
    hardhat: {
      forking: {
        url: process.env.POLYGON_MAINNET_NODE,
      },
      chainId: 137, // hardhat sets 31337 as chainId rather than a forked chainId, so we set here.
      accounts: {
        mnemonic:
          'dice shove sheriff police boss indoor hospital vivid tenant method game matter',
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
      },
      initialBaseFeePerGas: 0,
      gasPrice: 0,
      gas: 30000000,
    },
  },
  mocha: {
    timeout: 900000,
  },
};
