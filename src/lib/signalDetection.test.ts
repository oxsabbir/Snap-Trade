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
