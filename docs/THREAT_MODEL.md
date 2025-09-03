Assets: SFG treasury, SRV balance, vesting escrow, governance control.
Risks: reentrancy on token flows, misconfigured roles, allowance abuse, proposal mis-execution.
Controls: SafeERC20, ReentrancyGuard, CEI, Timelock+Multisig roles, coverage gates, Slither, invariants.
Assumptions: OZ libs unchanged; owner handed to Timelock; no privileged EOAs.
