# Chess.com Stockfish Analyzer

A Chrome Extension that integrates the Stockfish chess engine directly into Chess.com for real-time analysis, best move suggestions, and visual board overlays.

## Features

- **Real-time Analysis**: Uses the powerful Stockfish engine (v10 WASM) to analyze board positions.
- **Visual Overlays**: Draws arrows on the board to indicate the best move.
- **In-Page Control Panel**: A persistent "Always On" UI panel for easy access without opening the extension toolbar.
- **Auto-Play Mode**: Automatically detects opponent moves and calculates the best response instantly.
- **Manual Mode**: Analyze on demand with a single click.
- **Side Flipping**: Easily switch analysis between White and Black.

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the `Chess_Com_Stockfish_Extension` directory.

## Usage

1. Go to any live game or analysis board on [Chess.com](https://www.chess.com).
2. The **Stockfish Analyzer** panel will appear in the top-right corner of the page.
    - **Auto: OFF/ON**: Toggle automatic analysis. When ON, the engine runs every time a move is made.
    - **Flip Side**: Switch between analyzing for White or Black.
3. The best move will be displayed in the panel, and a green arrow will be drawn on the board.
4. Alternatively, you can click the extension icon in the toolbar for a simple popup interface.

## Disclaimer

**Use at your own risk.** Using computer assistance during rated games on Chess.com is a violation of their Fair Play Policy and will likely result in a ban. This tool is intended for educational purposes and analysis of unrated/bot games only.

## Credits

- **Stockfish**: [Stockfish Chess Engine](https://stockfishchess.org/)
- **Stockfish.js**: [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js)
