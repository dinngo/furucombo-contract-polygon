// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IRegistry {
    function handlers(address) external view returns (bytes32);
    function callers(address) external view returns (bytes32);
    function bannedAgents(address) external view returns (uint256);
    function fHalt() external view returns (bool);
    function isValidHandler(address handler) external view returns (bool);
    function isValidCaller(address handler) external view returns (bool);

    function register(address registration, bytes32 info) external;
    function unregister(address registration) external;
    function registerCaller(address registration, bytes32 info) external;
    function unregisterCaller(address registration) external;
    function ban(address agent) external;
    function unban(address agent) external;
}
