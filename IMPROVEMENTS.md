# Chess engine — second pass

## Bug fixed
- **Check was almost never detected.** Kings were excluded from capture targets, so rooks, bishops, knights, queens and kings never "attacked" a king square. Only pawns did. Pinned pieces could move and kings could walk into check. Attack detection is now separate from move generation and works for every piece.

## New rules
- Castling (both sides; not out of, through or into check; rights lost when king/rook moves or rook is captured)
- En passant
- Promotion piece choice (queen, rook, bishop, knight)
- Checkmate and stalemate detection
- Draws: insufficient material, fifty-move rule, threefold repetition

## Structure
- Engine is DOM-free and uses make/undo moves on a board map (no more flag-juggling for temporary moves).
- Move objects carry capture square, kind (normal/double/ep/castle) and promotion.
- UI: last-move and king-in-check highlights, New game button.

## Verification
Perft node counts match the published reference values for the start position (depth 4), Kiwipete (3), and the standard positions 3, 4 and 5 (covering castling, en passant, promotion and pins). Fool's mate ends in checkmate. Not yet clicked through in a real browser.

## Third pass: computer opponent
- Added a computer player (Easy / Medium / Hard) and a mode selector (two players, or play White/Black against the computer).
- Known limits: the board doesn't flip when you play Black; search runs on the main thread; no opening book.
