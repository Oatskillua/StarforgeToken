// contracts/test.MockRelayTarget.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockRelayTarget {
    address public lastSender;   // has auto-getter lastSender()
    bytes   public lastData;     // has auto-getter lastData()
    uint256 private _counter;

    event Ping(address indexed caller, bytes data);

    function ping(bytes calldata data) external {
        lastSender = msg.sender;   // will be the Governor
        lastData   = data;
        unchecked { ++_counter; }
        emit Ping(msg.sender, data);
    }

    // Add this so tests can call target.counter()
    function counter() external view returns (uint256) {
        return _counter;
    }
}
