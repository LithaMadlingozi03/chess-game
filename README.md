# Chess

A browser-based chess game built with HTML, CSS and JavaScript. It includes a computer opponent with multiple difficulty levels and requires no build step or project dependencies.

Live Demo: https://lithamadlingozi03.github.io/chess-game/

## Features

- Standard chess piece movement, legal move validation, check and pinned-piece handling
- Castling, en passant and pawn promotion, with a choice of queen, rook, bishop or knight
- Checkmate, stalemate, insufficient material, fifty-move rule and threefold repetition detection
- Highlights for legal moves, the last move and a king in check
- Play against the computer as White or Black at Easy, Medium or Hard difficulty
- Two-player mode on one screen
- New game button

## Computer Opponent

The computer opponent uses negamax search, alpha-beta pruning, capture-only quiescence search and piece-square tables.

- **Easy:** Searches one move ahead, with some randomness.
- **Medium:** Searches two moves ahead.
- **Hard:** Searches three moves ahead.

The computer runs on the browser's main thread, so the page may briefly pause while it calculates a move at higher difficulty levels. The search does not use an opening book or account for repetition draws.

## Run the Game

The simplest option is to open `index.html` in a browser.

Alternatively, from the project folder, run:

```bash
npx serve .
```

Then open the local URL shown in the terminal.

## Tests

The chess engine includes automated tests using *perft* (performance testing of legal move generation) reference positions.

The tests cover:

- Legal move counts for the standard starting position, Kiwipete and reference positions 3–5
- Checkmate detection using Fool's Mate
- The computer finding mate in one at each difficulty level
- The computer capturing an undefended queen
- The computer playing legal moves over a sequence of turns

To run the tests, install Node.js and execute:

```bash
node tests/perft.test.js
```

## Project Layout

| File | Purpose |
| --- | --- |
| `index.html` | Chessboard markup and game controls |
| `style.css` | Board styling, animations and visual highlights |
| `script.js` | Chess engine, move validation, computer opponent and interface |
| `tests/perft.test.js` | Automated chess engine tests |
| `IMPROVEMENTS.md` | Development notes and known limitations |
| `.github/workflows/pages.yml` | Automated testing and GitHub Pages deployment |

## Publishing with GitHub Pages

The GitHub Actions workflow in `.github/workflows/pages.yml` runs the automated tests and deploys the game when changes are pushed to the `main` branch.

In your repository, go to **Settings → Pages** and set the deployment source to **GitHub Actions**.

After your first successful deployment, add your live website URL near the top of this README.

## AI Assistance

The chess engine and rules in `script.js` were rewritten with assistance from Claude (Anthropic). The project was then tested using the automated tests described above.
