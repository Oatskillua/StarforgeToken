// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStarforgeToken {
    function balanceOf(address account) external view returns (uint256);
}