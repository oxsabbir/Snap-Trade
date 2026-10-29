/**
 * Unit tests for signal detection and parsing rules.
 *
 *   bun src/lib/signalDetection.test.ts
 */
import { checkForSignal, type XNotification } from './signalDetection';

const tests: { name: string; run: () => void }[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}
function fail(message: string): never {
  throw new Error(message);
}
function eq(actual: unknown, expected: unknown): void {
  if (actual !== expected) fail(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function makeNotification(text: string): XNotification {
  return {
    id: 1,
    text,
    bigText: text,
    postTime: Date.now(),
    title: 'Alpha Signals',
    subText: '',
    packageName: 'com.twitter.android',
  };
}

test('detects #P2p before TPs and ignores bottom SEO decoys like $Btc', () => {
  const text = `#P2p
Tp1 0.000094
Tp2 0.000099
Tp3 0.000125
Tp4 0.000161
Tp5 0.000232
Sl 15%

#Kucoin #mexc

$Btc
 
$bnb
 
$eth`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'tp');
  eq(result.ticker, 'P2P');
  eq(result.tp1, 0.000094);
  eq(result.tpCount, 5);
});

test('prioritizes $cashtag over #hashtag before TPs', () => {
  const text = `🔥 #VIP #CALL
$SOL
Tp1 150
Tp2 160
Tp3 170

$Btc`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'tp');
  eq(result.ticker, 'SOL');
  eq(result.tp1, 150);
});

test('ignores blacklisted exchange hashtags before TPs', () => {
  const text = `New listing on #KuCoin:
#P2P
Tp1 0.001
Tp2 0.002
Tp3 0.003`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.ticker, 'P2P');
});

test('does not trade if no ticker is found before TPs even with decoys at the bottom', () => {
  const text = `Market update:
Tp1 1
Tp2 2
Tp3 3

$Btc $Eth`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, false);
  eq(result.ticker, null);
});

test('detects gem post format with cashtag', () => {
  const text = `$SKY
Buying this GEM on #KuCoin
Current market price - 0.0007306 $
$BTC $ETH`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'gem');
  eq(result.ticker, 'SKY');
  eq(result.entry, '0.0007306');
});

test('detects gem post format with hashtag ignoring #KuCoin in marker', () => {
  const text = `#SKY
Buying this GEM on #KuCoin
Current market price - 0.0007306 $`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'gem');
  eq(result.ticker, 'SKY');
  eq(result.entry, '0.0007306');
});

test('detects #UNION in gem post with trailing $q decoys at the bottom', () => {
  const text = `#UNION

    Buying this GEM 💎 on #KuCoin

    Current market price - 0.0001155 $

    $q $sqr $xr $obi $cho $ava $hmnd`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'gem');
  eq(result.ticker, 'UNION');
  eq(result.entry, '0.0001155');
});

test('detects the lite cmp format with cashtag ($CHO on Kucoin)', () => {
  const text = `$CHO on Kucoin Buying CMP 0.000552 Keeping high targets SL manage`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'cmp');
  eq(result.ticker, 'CHO');
  eq(result.entry, '0.000552');
});

test('detects the lite cmp format across wrapped X lines', () => {
  const text = `$CHO on Kucoin

Buying CMP 0.000552

Keeping high targets
SL manage`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'cmp');
  eq(result.ticker, 'CHO');
  eq(result.entry, '0.000552');
});

test('detects the lite cmp format with colon separator and trailing decoys', () => {
  const text = `$CHO on Kucoin Buying CMP: 0.000552 Keeping high targets SL manage $BTC $ETH`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'cmp');
  eq(result.ticker, 'CHO');
  eq(result.entry, '0.000552');
});

test('ignores a CMP price mention without the buying context', () => {
  const text = `$CHO market review. CMP 0.000552 while we wait for confirmation`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, false);
  eq(result.format, null);
});

test('gem entry wins over a stray CMP mention in the same post', () => {
  const text = `$SKY
Buying this GEM on #KuCoin
Current market price - 0.0007306 $
CMP update above`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'gem');
  eq(result.ticker, 'SKY');
  eq(result.entry, '0.0007306');
});

test('detects plain-text ticker Ithaca before Mc 400k and TPs', () => {
  const text = `Ithaca
Mc 400k👀🚀
Tp1 0.00078
Tp2 0.00092
Tp3 0.00099
Tp4 0.00122
Tp5 0.00150
Tp6 0.00200
Sl 16%`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'tp');
  eq(result.ticker, 'ITHACA');
  eq(result.tp1, 0.00078);
  eq(result.tpCount, 6);
});

test('detects plain-text ticker with action word and Market Cap', () => {
  const text = `BUY SOL NOW!
Market Cap: 500k
Tp1 150
Tp2 160
Tp3 170`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'tp');
  eq(result.ticker, 'SOL');
  eq(result.tp1, 150);
});

test('detects plain-text ticker surrounded by emojis', () => {
  const text = `🚀 P2P 🚀
MCAP 1M
Tp1 0.001
Tp2 0.002
Tp3 0.003`;

  const result = checkForSignal(makeNotification(text));
  eq(result.isSignal, true);
  eq(result.format, 'tp');
  eq(result.ticker, 'P2P');
});

// --- runner -----------------------------------------------------------------------------------

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}: ${(error as Error).message}`);
  }
}

if (failures > 0) throw new Error(`${failures} of ${tests.length} checks failed`);
console.log(`${tests.length} checks passed`);
