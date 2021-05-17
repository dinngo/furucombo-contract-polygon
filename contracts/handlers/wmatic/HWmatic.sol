pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../HandlerBase.sol";
import "./IWMATIC.sol";

contract HWmatic is HandlerBase {
    // prettier-ignore
    address payable public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

    function getContractName() public pure override returns (string memory) {
        return "HWMatic";
    }

    function deposit(uint256 value) external payable {
        try IWMATIC(WMATIC).deposit{value: value}() {} catch Error(
            string memory reason
        ) {
            _revertMsg("deposit", reason);
        } catch {
            _revertMsg("deposit");
        }
        _updateToken(WMATIC);
    }

    function withdraw(uint256 wad) external payable {
        try IWMATIC(WMATIC).withdraw(wad) {} catch Error(string memory reason) {
            _revertMsg("withdraw", reason);
        } catch {
            _revertMsg("withdraw");
        }
    }
}
