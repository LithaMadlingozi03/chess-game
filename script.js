/*
 * Chess engine + UI.
 * Coordinates use the existing HTML IDs: "file_rank" (1_1 through 8_8), file 1 = a, rank 1 = White's back rank.
 *
 * Rules implemented: all piece movement, check / pinned pieces, castling, en passant,
 * promotion (with a piece choice), checkmate, stalemate, insufficient material,
 * fifty-move rule and threefold repetition.
 */
(() => {
  'use strict';

  const symbols = {
    w_king: '♔', w_queen: '♕', w_rook: '♖', w_bishop: '♗', w_knight: '♘', w_pawn: '♙',
    b_king: '♚', b_queen: '♛', b_rook: '♜', b_bishop: '♝', b_knight: '♞', b_pawn: '♟'
  };
  const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  const PROMOTIONS = ['queen', 'rook', 'bishop', 'knight'];
  const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORTHOGONALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const key = (x, y) => `${x}_${y}`;
  const inside = (x, y) => x >= 1 && x <= 8 && y >= 1 && y <= 8;
  const sideOf = piece => piece.type[0];
  const kindOf = piece => piece.type.slice(2);
  const enemy = side => (side === 'w' ? 'b' : 'w');

  /* ------------------------------------------------------------------ */
  /* Engine (no DOM access)                                              */
  /* ------------------------------------------------------------------ */

  const state = {
    turn: 'w',
    board: new Map(),   // square id -> piece
    pieces: [],         // every piece still on the board
    ep: null,           // en passant target square id, or null
    halfmove: 0,        // plies since last pawn move or capture
    repetitions: new Map(),
    result: null        // null while playing, else { type, winner?, text }
  };

  function addPiece(id, type, x, y, moved = false) {
    const piece = { id, type, x, y, moved };
    state.pieces.push(piece);
    state.board.set(key(x, y), piece);
    return piece;
  }

  function resetEngine() {
    state.turn = 'w';
    state.board.clear();
    state.pieces = [];
    state.ep = null;
    state.halfmove = 0;
    state.repetitions.clear();
    state.result = null;
  }

  function setupStandard() {
    resetEngine();
    for (let x = 1; x <= 8; x++) {
      const kind = BACK_RANK[x - 1];
      const suffix = kind === 'rook' ? (x === 1 ? 'rook1' : 'rook2')
        : kind === 'knight' ? (x === 2 ? 'knight1' : 'knight2')
        : kind === 'bishop' ? (x === 3 ? 'bishop1' : 'bishop2') : kind;
      addPiece(`w_${suffix}`, `w_${kind}`, x, 1);
      addPiece(`w_pawn${x}`, 'w_pawn', x, 2);
      addPiece(`b_pawn${x}`, 'b_pawn', x, 7);
      addPiece(`b_${suffix}`, `b_${kind}`, x, 8);
    }
  }

  // Minimal FEN loader (used for testing the engine).
  function setupFromFen(fen) {
    resetEngine();
    const [placement, turn, castling, ep, half] = fen.split(' ');
    const names = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
    placement.split('/').forEach((row, i) => {
      let x = 1;
      const y = 8 - i;
      for (const ch of row) {
        if (/\d/.test(ch)) { x += Number(ch); continue; }
        const side = ch === ch.toUpperCase() ? 'w' : 'b';
        const kind = names[ch.toLowerCase()];
        const homeRank = side === 'w' ? 1 : 8;
        const pawnHome = side === 'w' ? 2 : 7;
        const moved = kind === 'pawn' ? y !== pawnHome : true;
        const piece = addPiece(`${side}_${kind}_${x}${y}`, `${side}_${kind}`, x, y, moved);
        // Unmoved kings/rooks are only those implied by the castling rights.
        if (kind === 'king' && y === homeRank && x === 5) {
          piece.moved = !(castling.includes(side === 'w' ? 'K' : 'k') || castling.includes(side === 'w' ? 'Q' : 'q'));
        }
        if (kind === 'rook' && y === homeRank) {
          if (x === 8) piece.moved = !castling.includes(side === 'w' ? 'K' : 'k');
          if (x === 1) piece.moved = !castling.includes(side === 'w' ? 'Q' : 'q');
        }
        x++;
      }
    });
    state.turn = turn || 'w';
    state.ep = ep && ep !== '-' ? key('abcdefgh'.indexOf(ep[0]) + 1, Number(ep[1])) : null;
    state.halfmove = Number(half) || 0;
  }

  /*
   * Move object: { piece, from, to, capture, capSq, kind, promo, rook, rookTo }
   * kind: 'normal' | 'double' | 'ep' | 'castle'
   */
  function pseudoMoves(piece, attacksOnly = false) {
    const moves = [];
    const side = sideOf(piece);
    const from = key(piece.x, piece.y);
    const push = (x, y, extra = {}) => {
      const to = key(x, y);
      const capture = extra.capture !== undefined ? extra.capture : state.board.get(to) || null;
      moves.push({ piece, from, to, capture, capSq: capture ? key(capture.x, capture.y) : null, kind: 'normal', promo: null, ...extra });
    };
    const kind = kindOf(piece);

    if (kind === 'pawn') {
      const dir = side === 'w' ? 1 : -1;
      const lastRank = side === 'w' ? 8 : 1;
      const addPawn = (x, y, extra = {}) => {
        if (y === lastRank) PROMOTIONS.forEach(promo => push(x, y, { ...extra, promo }));
        else push(x, y, extra);
      };
      for (const dx of [-1, 1]) {
        const x = piece.x + dx, y = piece.y + dir;
        if (!inside(x, y)) continue;
        const target = state.board.get(key(x, y));
        if (attacksOnly) { moves.push({ to: key(x, y) }); continue; }
        if (target && sideOf(target) !== side) addPawn(x, y);
        else if (!target && state.ep === key(x, y)) {
          const victim = state.board.get(key(x, piece.y));
          if (victim && kindOf(victim) === 'pawn' && sideOf(victim) !== side) {
            push(x, y, { kind: 'ep', capture: victim });
          }
        }
      }
      if (attacksOnly) return moves;
      const oneY = piece.y + dir;
      if (inside(piece.x, oneY) && !state.board.has(key(piece.x, oneY))) {
        addPawn(piece.x, oneY);
        const twoY = piece.y + dir * 2;
        const startRank = side === 'w' ? 2 : 7;
        if (piece.y === startRank && !state.board.has(key(piece.x, twoY))) {
          push(piece.x, twoY, { kind: 'double' });
        }
      }
      return moves;
    }

    if (kind === 'knight' || kind === 'king') {
      const steps = kind === 'knight' ? KNIGHT_STEPS : [...DIAGONALS, ...ORTHOGONALS];
      for (const [dx, dy] of steps) {
        const x = piece.x + dx, y = piece.y + dy;
        if (!inside(x, y)) continue;
        const target = state.board.get(key(x, y));
        if (!target || sideOf(target) !== side) push(x, y);
      }
      if (kind === 'king' && !attacksOnly) addCastling(piece, moves, push);
      return moves;
    }

    const dirs = kind === 'bishop' ? DIAGONALS : kind === 'rook' ? ORTHOGONALS : [...DIAGONALS, ...ORTHOGONALS];
    for (const [dx, dy] of dirs) {
      let x = piece.x + dx, y = piece.y + dy;
      while (inside(x, y)) {
        const target = state.board.get(key(x, y));
        if (!target) push(x, y);
        else {
          if (sideOf(target) !== side) push(x, y);
          break;
        }
        x += dx; y += dy;
      }
    }
    return moves;
  }

  function addCastling(king, moves, push) {
    if (king.moved) return;
    const side = sideOf(king);
    const y = side === 'w' ? 1 : 8;
    if (king.x !== 5 || king.y !== y) return;
    const opp = enemy(side);
    if (isAttacked(key(5, y), opp)) return;
    for (const [rookX, between, passes, destX] of [[8, [6, 7], [6, 7], 7], [1, [2, 3, 4], [4, 3], 3]]) {
      const rook = state.board.get(key(rookX, y));
      if (!rook || rook.moved || rook.type !== `${side}_rook`) continue;
      if (between.some(x => state.board.has(key(x, y)))) continue;
      if (passes.some(x => isAttacked(key(x, y), opp))) continue; // includes destination square
      const rookTo = key(destX === 7 ? 6 : 4, y);
      push(destX, y, { kind: 'castle', rook, rookTo });
    }
  }

  function isAttacked(square, bySide) {
    for (const piece of state.board.values()) {
      if (sideOf(piece) !== bySide) continue;
      if (pseudoMoves(piece, true).some(m => m.to === square)) return true;
    }
    return false;
  }

  function isInCheck(side) {
    const king = state.pieces.find(p => p.type === `${side}_king` && state.board.get(key(p.x, p.y)) === p);
    return king ? isAttacked(key(king.x, king.y), enemy(side)) : false;
  }

  /* Applies a move to the engine state and returns a function that undoes it. */
  function doMove(m) {
    const { piece } = m;
    const prev = {
      x: piece.x, y: piece.y, moved: piece.moved, type: piece.type, ep: state.ep, turn: state.turn,
      rookMoved: m.rook ? m.rook.moved : null,
      rookFrom: m.rook ? { x: m.rook.x, y: m.rook.y } : null
    };
    state.board.delete(m.from);
    if (m.capture) {
      state.board.delete(m.capSq);
      state.pieces.splice(state.pieces.indexOf(m.capture), 1);
    }
    const [tx, ty] = m.to.split('_').map(Number);
    piece.x = tx; piece.y = ty; piece.moved = true;
    if (m.promo) piece.type = `${sideOf(piece)}_${m.promo}`;
    state.board.set(m.to, piece);
    if (m.rook) {
      state.board.delete(key(prev.rookFrom.x, prev.rookFrom.y));
      const [rx, ry] = m.rookTo.split('_').map(Number);
      m.rook.x = rx; m.rook.y = ry; m.rook.moved = true;
      state.board.set(m.rookTo, m.rook);
    }
    state.ep = m.kind === 'double' ? key(prev.x, (prev.y + ty) / 2) : null;
    state.turn = enemy(state.turn);

    return () => {
      state.turn = prev.turn;
      state.ep = prev.ep;
      if (m.rook) {
        state.board.delete(m.rookTo);
        m.rook.x = prev.rookFrom.x; m.rook.y = prev.rookFrom.y; m.rook.moved = prev.rookMoved;
        state.board.set(key(prev.rookFrom.x, prev.rookFrom.y), m.rook);
      }
      state.board.delete(m.to);
      piece.x = prev.x; piece.y = prev.y; piece.moved = prev.moved; piece.type = prev.type;
      state.board.set(m.from, piece);
      if (m.capture) {
        state.pieces.push(m.capture);
        state.board.set(m.capSq, m.capture);
      }
    };
  }

  function legalMoves(side) {
    const result = [];
    for (const piece of [...state.board.values()]) {
      if (sideOf(piece) !== side) continue;
      for (const m of pseudoMoves(piece)) {
        const undo = doMove(m);
        const safe = !isInCheck(side);
        undo();
        if (safe) result.push(m);
      }
    }
    return result;
  }

  function insufficientMaterial() {
    const rest = state.pieces.filter(p => kindOf(p) !== 'king');
    if (rest.length === 0) return true;
    if (rest.some(p => ['pawn', 'rook', 'queen'].includes(kindOf(p)))) return false;
    if (rest.length === 1) return true; // king + single minor piece
    // Only bishops left, all on the same colour squares.
    if (rest.every(p => kindOf(p) === 'bishop')) {
      return new Set(rest.map(p => (p.x + p.y) % 2)).size === 1;
    }
    return false;
  }

  function positionKey(moves) {
    const cells = [];
    for (const [sq, p] of state.board) cells.push(`${sq}:${p.type}`);
    cells.sort();
    const rights = state.pieces
      .filter(p => !p.moved && (kindOf(p) === 'king' || kindOf(p) === 'rook'))
      .map(p => p.id).sort();
    const ep = moves.some(m => m.kind === 'ep') ? state.ep : '-';
    return `${cells.join(',')}|${state.turn}|${rights.join(',')}|${ep}`;
  }

  /* Evaluates the position for the side to move and records the result. */
  function evaluate() {
    const moves = legalMoves(state.turn);
    const inCheck = isInCheck(state.turn);
    const name = state.turn === 'w' ? 'White' : 'Black';
    const other = state.turn === 'w' ? 'Black' : 'White';
    state.result = null;
    if (moves.length === 0) {
      state.result = inCheck
        ? { type: 'checkmate', winner: enemy(state.turn), text: `Checkmate! ${other} wins` }
        : { type: 'stalemate', text: 'Stalemate — draw' };
    } else if (insufficientMaterial()) {
      state.result = { type: 'draw', text: 'Draw — insufficient material' };
    } else if (state.halfmove >= 100) {
      state.result = { type: 'draw', text: 'Draw — fifty-move rule' };
    } else {
      const k = positionKey(moves);
      const count = (state.repetitions.get(k) || 0) + 1;
      state.repetitions.set(k, count);
      if (count >= 3) state.result = { type: 'draw', text: 'Draw — threefold repetition' };
    }
    return { moves, inCheck, name };
  }

  /* Plays a move and updates the draw counters. Returns evaluation of the new position. */
  function playMove(m) {
    const resetsClock = kindOf(m.piece) === 'pawn' || m.capture;
    doMove(m);
    state.halfmove = resetsClock ? 0 : state.halfmove + 1;
    return evaluate();
  }

  function perft(depth) {
    if (depth === 0) return 1;
    let total = 0;
    for (const m of legalMoves(state.turn)) {
      const undo = doMove(m);
      total += depth === 1 ? 1 : perft(depth - 1);
      undo();
    }
    return total;
  }


  /* ------------------------------------------------------------------ */
  /* Computer opponent: negamax + alpha-beta, quiescence, piece-square   */
  /* ------------------------------------------------------------------ */

  const VALUE = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };
  const MATE = 100000;
  // Tables are written from White's point of view, rank 8 at the top.
  const PST = {
    pawn: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
           0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    knight: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
             -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    bishop: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
             -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    rook: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
           -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    queen: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
            0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    king: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
           -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
           20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
  };
  const LEVELS = {
    easy: { depth: 1, noise: 120 },
    medium: { depth: 2, noise: 15 },
    hard: { depth: 3, noise: 0 }
  };

  // Static evaluation in centipawns from the side-to-move's point of view.
  function staticEval() {
    let score = 0;
    for (const p of state.pieces) {
      const kind = kindOf(p);
      const white = sideOf(p) === 'w';
      const row = white ? 8 - p.y : p.y - 1;
      const v = VALUE[kind] + PST[kind][row * 8 + p.x - 1];
      score += white ? v : -v;
    }
    return state.turn === 'w' ? score : -score;
  }

  function orderMoves(moves) {
    const rank = m => (m.capture ? 10 * VALUE[kindOf(m.capture)] - VALUE[kindOf(m.piece)] : 0) + (m.promo ? VALUE[m.promo] : 0);
    return moves.map(m => [rank(m), m]).sort((a, b) => b[0] - a[0]).map(pair => pair[1]);
  }

  // Searches captures and promotions only, so evaluations aren't taken mid-exchange.
  function quiesce(alpha, beta, depth) {
    const stand = staticEval();
    if (depth === 0 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of orderMoves(legalMoves(state.turn).filter(m => m.capture || m.promo))) {
      const undo = doMove(m);
      const score = -quiesce(-beta, -alpha, depth - 1);
      undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function search(depth, alpha, beta, ply) {
    const moves = legalMoves(state.turn);
    if (moves.length === 0) return isInCheck(state.turn) ? -(MATE - ply) : 0;
    if (depth === 0) return quiesce(alpha, beta, 4);
    for (const m of orderMoves(moves)) {
      const undo = doMove(m);
      const score = -search(depth - 1, -beta, -alpha, ply + 1);
      undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  /* Picks a move for the side to move. level: 'easy' | 'medium' | 'hard'. Returns a move or null. */
  function chooseMove(level = 'medium') {
    const { depth, noise } = LEVELS[level] || LEVELS.medium;
    const moves = orderMoves(legalMoves(state.turn));
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
      const undo = doMove(m);
      // With noise we need exact scores for every move, so no root pruning.
      const alpha = noise ? -Infinity : Math.max(bestScore, -Infinity);
      const score = -search(depth - 1, -Infinity, noise ? Infinity : -alpha, 1) + (noise ? (Math.random() - 0.5) * 2 * noise : 0);
      undo();
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  // Hook for tests running outside a browser.
  if (typeof globalThis.__CHESS_TEST__ !== 'undefined') {
    Object.assign(globalThis.__CHESS_TEST__, { perft, setupStandard, setupFromFen, legalMoves, playMove, state, isInCheck, chooseMove });
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  if (typeof document === 'undefined') return;
  const squares = [...document.querySelectorAll('.gamecell')];
  if (squares.length !== 64) {
    console.error(`Chess setup expected 64 squares, found ${squares.length}.`);
    return;
  }
  const turnElement = document.getElementById('turn');
  const ui = { selected: null, targets: new Map(), lastMove: null, status: '', pendingPromotion: null, thinking: false, cpuTimer: null, gameId: 0 };
  const modeSelect = document.getElementById('mode');
  const levelSelect = document.getElementById('level');
  // mode: 'two' (two players), 'cpu-w' (human plays White), 'cpu-b' (human plays Black)
  const cpuSide = () => (modeSelect?.value === 'cpu-w' ? 'b' : modeSelect?.value === 'cpu-b' ? 'w' : null);

  function statusText(info) {
    if (state.result) return state.result.text;
    const text = `It's ${info.name}'s Turn`;
    return info.inCheck ? `${text} — Check!` : text;
  }

  function render() {
    const checkedKing = !state.result || state.result.type === 'checkmate'
      ? state.pieces.find(p => p.type === `${state.turn}_king`) : null;
    const showCheck = checkedKing && isInCheck(state.turn);
    for (const square of squares) {
      const id = square.id;
      const piece = state.board.get(id);
      square.textContent = piece ? symbols[piece.type] : '';
      square.setAttribute('chess', piece ? piece.id : 'null');
      square.classList.remove('green', 'shake-little', 'neongreen_txt', 'selected-square', 'last-move', 'in-check');
      if (ui.targets.has(id)) square.classList.add('green', 'shake-little', 'neongreen_txt');
      if (ui.selected === id) square.classList.add('selected-square');
      if (ui.lastMove && (ui.lastMove.from === id || ui.lastMove.to === id)) square.classList.add('last-move');
      if (showCheck && id === key(checkedKing.x, checkedKing.y)) square.classList.add('in-check');
    }
    if (turnElement) turnElement.textContent = ui.status;
  }

  function clearSelection() {
    ui.selected = null;
    ui.targets = new Map();
  }

  function select(square, piece) {
    ui.selected = square;
    ui.targets = new Map();
    for (const m of legalMoves(sideOf(piece))) {
      if (m.from !== square) continue;
      if (!ui.targets.has(m.to)) ui.targets.set(m.to, []);
      ui.targets.get(m.to).push(m); // promotions give several moves per target
    }
  }

  function finishMove(m) {
    ui.lastMove = { from: m.from, to: m.to };
    clearSelection();
    ui.status = statusText(playMove(m));
    render();
    maybeCpuMove();
  }

  function maybeCpuMove() {
    if (state.result || state.turn !== cpuSide()) return;
    ui.thinking = true;
    ui.status = 'Computer is thinking…';
    render();
    const game = ui.gameId;
    // Let the browser paint the status before the (blocking) search starts.
    ui.cpuTimer = setTimeout(() => {
      ui.cpuTimer = null;
      if (game !== ui.gameId) return;
      const m = chooseMove(levelSelect?.value || 'medium');
      ui.thinking = false;
      if (m) finishMove(m);
    }, 50);
  }

  function askPromotion(moves) {
    const side = sideOf(moves[0].piece);
    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay';
    const box = document.createElement('div');
    box.className = 'promotion-box';
    const title = document.createElement('div');
    title.textContent = 'Promote to:';
    box.appendChild(title);
    ui.pendingPromotion = moves;
    for (const kind of PROMOTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'promotion-choice';
      button.textContent = symbols[`${side}_${kind}`];
      button.title = kind;
      button.addEventListener('click', () => {
        overlay.remove();
        ui.pendingPromotion = null;
        finishMove(moves.find(m => m.promo === kind));
      });
      box.appendChild(button);
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function onSquareClick(square) {
    if (state.result || ui.pendingPromotion || ui.thinking || state.turn === cpuSide()) return;
    const id = square.id;
    const piece = state.board.get(id);
    const ownPiece = piece && sideOf(piece) === state.turn;

    if (ui.selected && ui.targets.has(id)) {
      const moves = ui.targets.get(id);
      if (moves[0].promo) askPromotion(moves);
      else finishMove(moves[0]);
      return;
    }
    if (ui.selected === id) clearSelection();
    else if (ownPiece) select(id, piece);
    else clearSelection();
    render();
  }

  function newGame() {
    document.querySelector('.promotion-overlay')?.remove();
    ui.gameId++;
    clearTimeout(ui.cpuTimer);
    ui.thinking = false;
    ui.pendingPromotion = null;
    ui.lastMove = null;
    clearSelection();
    setupStandard();
    ui.status = statusText(evaluate());
    render();
    maybeCpuMove();
  }

  squares.forEach(square => square.addEventListener('click', () => onSquareClick(square)));
  document.getElementById('newgame')?.addEventListener('click', newGame);
  modeSelect?.addEventListener('change', newGame);
  newGame();
})();
