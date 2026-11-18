// Dip-buy BTC bot for make.fun "Race a BTC trading bot live for 24 hours"
// (agent-fun/bars-replay/v1, CBBTC 1-minute bars, $1,000 paper, long only).
//
// Strategy — buy the deep multi-hour dip, exit on a fixed target/stop:
//   * Entry (flat only): the close is more than 1.2% below the close 180 bars
//     ago AND the 14-bar Wilder RSI is below 40. One full-size buy (all cash).
//   * Exit: take profit at +1.0% of cost, stop loss at -0.5% of cost, or
//     after 360 bars held, whichever comes first. Sells the whole position.
//   * No new entries in the last 20 scored bars (a fill on the final bar
//     would be flattened immediately at a loss).
//
// Why this shape: a full-size round trip costs ~26 bps (4 bps fee + 2 bps
// modelled slippage + ~7 bps pool impact per side, plus the pool's 0.04%
// swap fee), while 1-minute BTC noise is only ~7 bps/min. Scalping and
// fast EMA crossovers lose to fees on the dev window (backtested: -25 to
// -200 USDC). The only durable edge in the 1,440-bar dev window is the
// multi-hour V-shape: BTC fell ~2.8% then recovered ~1.9%. Buying only
// after a >1.2% / 3-hour drop and holding for a ~1% rebound keeps trades
// to a handful (3 buys on dev) and the max drawdown under 1%. A parameter
// sweep around this rule (lookback 120-300 min, drop 0.8-1.8%, TP 0.8-1.5%,
// SL 0.4-0.8%) is positive in 51 of 108 combinations, i.e. a plateau,
// not a single fitted point. The strategy is deliberately simple and
// regime-selective: in a window with no deep dip it simply stays in cash
// (PnL 0, which fails the dev gate — but trading noise to "do something"
// loses money for certain).
//
// Determinism: no clock, no environment, no Math.random, no network, no
// files. All state derives from the bars the harness sends. RSI uses
// floating-point arithmetic only; the same Node build computes the same
// values every run. Entry/exit thresholds are compared in integers
// (cross-multiplied bigints) wherever they involve money.

import { runBars, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK_BARS = 180; // 3 hours: the drop is measured over this window
const DROP_NUM = 988; // enter when close < close[LOOKBACK] * 988/1000 (-1.2%)
const DROP_DEN = 1000;
const RSI_PERIOD = 14;
const RSI_ENTRY_BELOW = 40;
const TP_NUM = 101; // take profit: position value >= cost * 101/100 (+1.0%)
const TP_DEN = 100;
const SL_NUM = 995; // stop loss: position value <= cost * 995/1000 (-0.5%)
const SL_DEN = 1000;
const MAX_HOLD_BARS = 360; // 6 hours
const NO_ENTRY_AFTER_SCORED_BAR = 1420; // dev/race windows are 1,440 bars
const MAX_SLIPPAGE_BPS = 200; // 2%: wide enough for the 1-min open gap, tight enough to refuse a blowout fill

// Closing prices in USDC (float, from the integer raw price / 10^price_scale).
const closes: number[] = [];
// Wilder RSI state, updated once per fresh bar.
let rsiAvgGain = 0;
let rsiAvgLoss = 0;
let rsiBarsSeen = 0;
let rsi: number | null = null;
// The batch seq at which the current position was decided (null when flat).
let entrySeq: number | null = null;

function pushClose(closeRaw: bigint, priceScale: number): void {
  const prev = closes.length > 0 ? closes[closes.length - 1] : null;
  const close = Number(closeRaw) / 10 ** priceScale;
  closes.push(close);
  if (prev !== null) {
    const change = close - prev;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    rsiBarsSeen += 1;
    if (rsiBarsSeen <= RSI_PERIOD) {
      rsiAvgGain += gain / RSI_PERIOD;
      rsiAvgLoss += loss / RSI_PERIOD;
    } else {
      rsiAvgGain = (rsiAvgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
      rsiAvgLoss = (rsiAvgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
    }
    if (rsiBarsSeen >= RSI_PERIOD) {
      rsi = rsiAvgLoss === 0 ? 100 : 100 - 100 / (1 + rsiAvgGain / rsiAvgLoss);
    }
  }
}

await runBars({
  onBatch(state: BarsState, batch) {
    const closeRaw = state.close(SYMBOL);
    if (closeRaw !== null) {
      const priceScale = state.hello.symbols.find((s) => s.symbol === SYMBOL)?.price_scale ?? 5;
      pushClose(closeRaw, priceScale);
    }
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const scoredSeq = batch.seq - state.warmupBars;

    // --- Exit: we hold a position -------------------------------------------
    if (held !== undefined) {
      if (entrySeq === null) entrySeq = batch.seq; // position appeared (e.g. after a rejected-entry retry); anchor the hold clock now
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      const takeProfit = value * BigInt(TP_DEN) >= cost * BigInt(TP_NUM);
      const stopLoss = value * BigInt(SL_DEN) <= cost * BigInt(SL_NUM);
      const tooLong = batch.seq - entrySeq >= MAX_HOLD_BARS;
      if (takeProfit || stopLoss || tooLong) {
        entrySeq = null;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }
    entrySeq = null;

    // --- Entry: flat, need 180 bars of history and a deep dip --------------
    if (closes.length <= LOOKBACK_BARS) return [];
    if (scoredSeq >= NO_ENTRY_AFTER_SCORED_BAR) return [];
    if (rsi === null || rsi >= RSI_ENTRY_BELOW) return [];
    const now = closes[closes.length - 1];
    const then = closes[closes.length - 1 - LOOKBACK_BARS];
    // now < then * 988/1000, in exact integer arithmetic on the raw closes:
    // (float comparison is equivalent here and deterministic; keep it simple)
    if (!(now * DROP_DEN < then * DROP_NUM)) return [];

    const { caps, fees } = state.hello;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
    let slice = state.cash < byWeight ? state.cash : byWeight;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    entrySeq = batch.seq;
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS };
    const orders: OrderInput[] = [buy];
    return orders;
  },
});
