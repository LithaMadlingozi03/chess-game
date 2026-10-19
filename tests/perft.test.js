// Run with: node tests/perft.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.__CHESS_TEST__ = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'));
const t = globalThis.__CHESS_TEST__;

const cases = [
  ['start position', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0', [14, 191, 2812, 43238]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1', [44, 1486, 62379]],
];

let failed = false;
for (const [name, fen, expected] of cases) {
  t.setupFromFen(fen);
  expected.forEach((want, i) => {
    const got = t.perft(i + 1);
    if (got !== want) { failed = true; console.error(`FAIL ${name} depth ${i + 1}: got ${got}, want ${want}`); }
  });
  console.log(`ok  ${name}`);
}

// Fool's mate
t.setupStandard();
const play = (from, to) => {
  const m = t.legalMoves(t.state.turn).find(m => m.from === from && m.to === to);
  if (!m) throw new Error(`illegal move ${from}-${to}`);
  return t.playMove(m);
};
play('6_2', '6_3'); play('5_7', '5_5'); play('7_2', '7_4'); play('4_8', '8_4');
if (!t.state.result || t.state.result.type !== 'checkmate') { failed = true; console.error('FAIL fool\'s mate'); }
else console.log('ok  fool\'s mate');

// Computer opponent: finds mate in one at every level (back-rank mate Ra8#).
for (const level of ['easy', 'medium', 'hard']) {
  t.setupFromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0');
  const m = t.chooseMove(level);
  if (!m || m.from !== '1_1' || m.to !== '1_8') { failed = true; console.error(`FAIL mate in one (${level})`); }
  else console.log(`ok  mate in one (${level})`);
}

// Computer opponent: grabs a free queen rather than ignoring it.
t.setupFromFen('4k3/8/8/3q4/8/8/8/3RK3 w - - 0');
{
  const m = t.chooseMove('medium');
  if (!m || m.to !== '4_5') { failed = true; console.error('FAIL wins free queen'); }
  else console.log('ok  wins free queen');
}

// Computer vs computer: every move it plays must be legal, and it must finish without errors.
t.setupStandard();
{
  let plies = 0;
  while (!t.state.result && plies < 120) {
    const m = t.chooseMove('easy');
    if (!m || !t.legalMoves(t.state.turn).some(x => x.from === m.from && x.to === m.to && x.promo === m.promo)) { failed = true; console.error('FAIL illegal CPU move'); break; }
    t.playMove(m);
    plies++;
  }
  console.log(`ok  cpu vs cpu (${plies} plies${t.state.result ? ', ' + t.state.result.text : ''})`);
}

process.exit(failed ? 1 : 0);
