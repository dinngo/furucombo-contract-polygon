pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "./ERC20/IERC20.sol";

interface IRegistry {
    function isValid(address handler) external view returns (bool result);
    function getInfo(address handler) external view returns (bytes32 info);
}

contract Proxy {
    address[] public tokens;

    modifier isTokenEmpty() {
        require(tokens.length == 0, "token list not empty");
        _;
    }

    function () payable external {
        require(_isValid(msg.sender));

        if (msg.data.length != 0) {
            address target = address(bytes20(IRegistry(_getRegistry()).getInfo(msg.sender)));
            require(_isValid(target), "Invalid handler");
            _exec(target, msg.data);
        }
    }

    // keccak256 hash of "furucombo.handler.registry"
    bytes32 private constant HANDLER_REGISTRY =
        0x6874162fd62902201ea0f4bf541086067b3b88bd802fac9e150fd2d1db584e19;

    constructor(address registry) public {
        bytes32 slot = HANDLER_REGISTRY;
        assembly {
            sstore(slot, registry)
        }
    }

    function _getRegistry() internal view returns (address registry) {
        bytes32 slot = HANDLER_REGISTRY;
        assembly {
            registry := sload(slot)
        }
    }

    function _isValid(address handler) internal view returns (bool result) {
        return IRegistry(_getRegistry()).isValid(handler);
    }

    function batchExec(address[] memory tos, bytes[] memory datas)
        isTokenEmpty
        public
        payable
    {
        _preProcess();
        _execs(tos, datas);
        _postProcess();
    }

    function execs(address[] memory tos, bytes[] memory datas) public payable {
        require(msg.sender == address(this), "Does not allow external calls");
        _execs(tos, datas);
    }

    function _execs(address[] memory tos, bytes[] memory datas) public payable {
        for (uint256 i = 0; i < tos.length; i++) {
            require(_isValid(tos[i]), "Invalid handler");
            _exec(tos[i], datas[i]);
        }
    }

    function _exec(address _to, bytes memory _data) internal returns (bytes memory result) {
        assembly {
            let succeeded := delegatecall(sub(gas, 5000), _to, add(_data, 0x20), mload(_data), 0, 0)
            let size := returndatasize

            result := mload(0x40)
            mstore(0x40, add(result, and(add(add(size, 0x20), 0x1f), not(0x1f))))
            mstore(result, size)
            returndatacopy(add(result, 0x20), 0, size)

            switch iszero(succeeded)
            case 1 {
                revert(add(result, 0x20), size)
            }
        }
    }

    function _preProcess() internal {
    }

    function _postProcess() internal {
        // Token involved should be returned to user
        while (tokens.length > 0) {
            address token = tokens[tokens.length - 1];
            uint256 amount = IERC20(token).balanceOf(address(this));
            if (amount > 0)
                IERC20(token).transfer(msg.sender, amount);
            tokens.pop();
        }

        // Balance should also be returned to user
        uint256 amount = address(this).balance;
        if (amount > 0)
            msg.sender.transfer(amount);
    }
}
