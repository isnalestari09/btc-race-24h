[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/isnalestari09/btc-race-24h/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/isnalestari09/btc-race-24h/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# Dip-buy cbBTC bot — make.fun "Race a BTC trading bot live for 24 hours"

Long-only bot trading Coinbase Wrapped BTC (CBBTC) on 1-minute Orca
Whirlpool bars, $1,000 paper money, protocol `agent-fun/bars-replay/v1`
(Node 22, `node /bot/main.ts`, standard library only).

## Strategy

Buy the deep multi-hour dip, exit on a fixed target/stop:

- **Entry** (flat only): close is more than **1.2% below the close 180 bars
  ago** AND 14-bar Wilder **RSI < 40**. One full-size buy (all cash).
- **Exit**: take profit at **+1.0%** of cost, stop loss at **-0.5%** of cost,
  or after **360 bars** held — whichever comes first. Sells the whole position.
- No new entries in the last 20 scored bars of the window.

Why: a full-size round trip costs ~26 bps (4 bps fee + 2 bps slippage +
~7 bps pool impact per side), while 1-minute BTC noise is only ~7 bps/min,
so scalping and fast EMA crossovers lose to fees. The only durable edge in
the dev window is the multi-hour V-shape (BTC fell ~2.8%, then recovered
~1.9%). A 51-of-108 parameter sweep around this rule is positive, i.e. a
plateau, not a single fitted point.

## Verified dev-window results (local grade, kit harness, process driver)

```
Net PnL:        +$17.63  (+1.763%)
Trades:         4
Max drawdown:   0.93%  (limit 25%)
Net PnL at 2x fees: +$16.00  (still profitable if fees doubled)
Constraints:    compliant (min 1 trade, drawdown OK)
Determinism:    two executions reproduced byte-for-byte
```

Step-down take profit (bank +0.6% after 120 bars held) and a 60-bar
re-entry cooldown after any exit lifted the dev PnL from +$12.65 to
+$17.63 on the same window, with the same 4 trades.

House baselines on the same dev window, for comparison:

| bot | net PnL |
|---|---|
| this bot | **+$17.63** |
| hold-cash | $0.00 |
| momentum | -$23.87 |
| buy-and-hold | -$31.63 |
| rsi-bollinger | -$39.92 |
| adx-momentum | -$75.57 |
| ema-cross | -$148.17 |

This bot is the only one of the seven that is profitable on the dev window —
which is the gate: only entries with dev net PnL > $0 race live.

## Files

- `main.ts` — the bot (strategy + nothing else).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.

## Submit (do this before the deadline, Thu 19 Nov 2026 03:44 WIB)

1. Create a **public GitHub repository** owned by your own GitHub account,
   created after the competition opened, and push this directory to it
   (MIT license included).
2. From the unpacked kit directory, build the transcript bundle of the
   agent sessions that built this entry:
   `node cli/makefun.mjs bundle`
3. Submit the repo URL + commit SHA + bundle with the kit CLI
   (`node cli/makefun.mjs submit ...`) or on the bounty page, before the
   deadline. Your last submission before the deadline is your final entry.
4. If the dev grade passes (net PnL > $0), the bot races live for 24 hours
   from 15 minutes after the deadline; prizes go to the 10 highest net
   PnLs on the race window.
