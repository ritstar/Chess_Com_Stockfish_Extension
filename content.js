// Content script
console.log("Chess Analyzer Content Script Loaded");

let engineWorker = null;
let isAutoAnalysisOn = false;
let playerColor = 'w'; // Default
let lastFen = "";
let analysisDebounce = null;

// Inject UI on load
injectControlPanel();

// Listen for messages from popup (still suported, but UI is primary now)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getBestMove") {
        playerColor = request.playerColor || 'w';
        triggerAnalysis().then(res => sendResponse(res));
        return true;
    }
});

function injectControlPanel() {
    if (document.getElementById('stockfish-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'stockfish-panel';
    panel.innerHTML = `
        <div style="font-weight:bold; margin-bottom:5px; color:#81b64c;">Stockfish Analyzer</div>
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
            <button id="sf-toggle-auto" style="padding:5px; cursor:pointer; flex:1; margin-right:5px;">Auto: OFF</button>
            <button id="sf-flip" style="padding:5px; cursor:pointer;" title="Flip Board Side">Flip Side</button>
        </div>
        <div id="sf-status" style="font-size:12px; margin-bottom:5px; color:#ccc;">Ready</div>
        <div id="sf-best-move" style="font-size:16px; font-weight:bold; color:#fff;">-</div>
    `;

    // Style the panel
    Object.assign(panel.style, {
        position: 'fixed',
        top: '10px',
        right: '10px',
        zIndex: '9999',
        backgroundColor: '#262522',
        color: '#eee',
        padding: '10px',
        borderRadius: '8px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        fontFamily: 'Segoe UI, sans-serif',
        width: '180px'
    });

    document.body.appendChild(panel);

    // Event Listeners
    document.getElementById('sf-toggle-auto').addEventListener('click', toggleAutoAnalysis);
    document.getElementById('sf-flip').addEventListener('click', () => {
        playerColor = playerColor === 'w' ? 'b' : 'w';
        updateStatus(`Playing as: ${playerColor === 'w' ? 'White' : 'Black'}`);
        // Optionally re-analyze
        if (isAutoAnalysisOn) triggerAnalysis();
    });
}

function toggleAutoAnalysis() {
    isAutoAnalysisOn = !isAutoAnalysisOn;
    const btn = document.getElementById('sf-toggle-auto');
    btn.textContent = isAutoAnalysisOn ? "Auto: ON" : "Auto: OFF";
    btn.style.backgroundColor = isAutoAnalysisOn ? "#81b64c" : "";
    btn.style.color = isAutoAnalysisOn ? "white" : "";

    if (isAutoAnalysisOn) {
        startBoardObserver();
        triggerAnalysis();
    } else {
        stopBoardObserver();
    }
}

function updateStatus(msg) {
    const el = document.getElementById('sf-status');
    if (el) el.textContent = msg;
}

function displayBestMove(move, evaluation) {
    const el = document.getElementById('sf-best-move');
    if (el) el.textContent = `${move} (${evaluation})`;

    if (move) {
        drawArrow(move);
    }
}

async function triggerAnalysis() {
    updateStatus('Extracting board...');
    try {
        const fen = extractFEN(playerColor);
        if (!fen) {
            updateStatus('Board not found');
            return;
        }

        // Avoid re-analyzing same position
        // if (fen === lastFen) return; 
        lastFen = fen;

        updateStatus('Calculating...');
        const result = await runStockfish(fen);
        displayBestMove(result.move, result.eval);
        updateStatus('Complete');
        return result;

    } catch (e) {
        console.error(e);
        updateStatus('Error: ' + e.message);
        return { error: e.message };
    }
}

// --- Board Observation ---
let observer = null;
function startBoardObserver() {
    const board = document.querySelector('chess-board, #board-layout-chessboard, .board');
    if (!board) return;

    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
        // Debounce analysis
        if (analysisDebounce) clearTimeout(analysisDebounce);
        analysisDebounce = setTimeout(() => {
            // Simple check: has turn changed? FEN extraction will capture state
            triggerAnalysis();
        }, 500);
    });

    observer.observe(board, { childList: true, subtree: true, attributes: true });
}

function stopBoardObserver() {
    if (observer) observer.disconnect();
    observer = null;
}

// --- Visual Overlay (Arrows) ---
function drawArrow(move) {
    // move string e.g. "e2e4"
    if (!move || move.length < 4) return;

    const board = document.querySelector('chess-board, #board-layout-chessboard, .board');
    if (!board) return;

    // Remove existing arrows
    const existing = document.getElementById('sf-arrow-overlay');
    if (existing) existing.remove();

    // Create SVG overlay
    const rect = board.getBoundingClientRect();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = 'sf-arrow-overlay';
    Object.assign(svg.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none', // Click through
        zIndex: '1000'
    });

    // We assume board is relative container, if not we usually need to append TO the board
    // Chess.com boards are usually custom elements, appending children works often.
    if (getComputedStyle(board).position === 'static') {
        board.style.position = 'relative';
    }
    board.appendChild(svg);

    // Calculate coords
    const from = move.substring(0, 2);
    const to = move.substring(2, 4);

    const squareSize = rect.width / 8;

    // Check orientation
    // We can guess orientation by checking a known square class or just user setting
    // But since we extract board relative to playerColor in FEN, visual coords depend on board DOM orientation
    // Usually chess.com puts "flipped" class on board if black
    const isFlipped = board.classList.contains('flipped');

    const getCoords = (sq) => {
        const file = sq.charCodeAt(0) - 97; // 'a'->0
        const rank = parseInt(sq[1]) - 1; // '1'->0

        let x, y;
        if (!isFlipped) {
            // White bottom
            x = file * squareSize + squareSize / 2;
            y = (7 - rank) * squareSize + squareSize / 2;
        } else {
            // Black bottom (flipped)
            x = (7 - file) * squareSize + squareSize / 2;
            y = rank * squareSize + squareSize / 2;
        }
        return { x, y };
    };

    const start = getCoords(from);
    const end = getCoords(to);

    // Draw Line
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute("stroke", "#81b64c"); // Green
    line.setAttribute("stroke-width", squareSize * 0.15);
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", "0.7");

    // Draw Arrowhead (Circle at end for simplicity or actual triangle)
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", end.x);
    circle.setAttribute("cy", end.y);
    circle.setAttribute("r", squareSize * 0.15);
    circle.setAttribute("fill", "#81b64c");
    circle.setAttribute("opacity", "0.7");

    svg.appendChild(line);
    svg.appendChild(circle);

    // Auto-remove after 3s? Or keep until next move. Kepp for now.
}


// --- Logic (Unchanged but ensuring extractFEN is robust) ---
function extractFEN(playerColor) {
    // 1. Find the board
    const board = document.querySelector('chess-board, #board-layout-chessboard, .board');
    if (!board) return null;

    // 2. Initialize 8x8 board
    const boardState = Array(8).fill(null).map(() => Array(8).fill(null));

    // 3. Find pieces
    // Chess.com pieces usually have classes like "piece wp square-11" (1-8, 1-8 coordinates)
    const pieces = board.querySelectorAll('.piece');

    pieces.forEach(piece => {
        let classes = piece.className;
        // SVG pieces might be different, but usually they have classes.
        // Example: "piece wp square-52" (e2)

        // Parse piece type
        const typeMatch = classes.match(/\b([wb][prnbqk])\b/);
        if (!typeMatch) return;
        const type = typeMatch[1]; // e.g. "wp"

        // Parse position
        // Chess.com uses square-xy where x is file (1-8), y is rank (1-8)
        const posMatch = classes.match(/square-(\d)(\d)/);
        if (!posMatch) return;

        const file = parseInt(posMatch[1]) - 1; // 0-7
        const rank = parseInt(posMatch[2]) - 1; // 0-7

        // Map rank (1-8) to array index (7-0) (Standard FEN starts at rank 8)
        const arrayRow = 7 - rank;
        const arrayCol = file;

        boardState[arrayRow][arrayCol] = type;
    });

    // 4. Construct FEN string
    let fen = "";
    for (let r = 0; r < 8; r++) {
        let emptyCount = 0;
        for (let c = 0; c < 8; c++) {
            const piece = boardState[r][c];
            if (piece) {
                if (emptyCount > 0) {
                    fen += emptyCount;
                    emptyCount = 0;
                }
                const color = piece[0];
                const role = piece[1].toUpperCase();
                fen += (color === 'w') ? role : role.toLowerCase();
            } else {
                emptyCount++;
            }
        }
        if (emptyCount > 0) fen += emptyCount;
        if (r < 7) fen += "/";
    }

    // 5. Add active color
    // If auto-detect, we can try to infer whose turn it is?
    // Hard to infer without history. 
    // For now we trust the "playerColor" setting or default.
    // However, if we are predicting "Next Move", it usually implies "My Turn".
    // Or if "Auto-Play", we want to predict whenever the board state implies it's our turn.
    // Stockfish expects the side to move to be in FEN.

    fen += ` ${playerColor} `;

    // 6. Castling/En Passant/Half/Full move
    fen += "KQkq - 0 1";

    return fen;
}

// ... runStockfish (Blob URL version already implemented, keeping it) ...
async function runStockfish(fen) {
    return new Promise(async (resolve, reject) => {
        try {
            const scriptUrl = chrome.runtime.getURL('lib/stockfish.js');
            const response = await fetch(scriptUrl);
            const scriptContent = await response.text();

            const blob = new Blob([scriptContent], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            const worker = new Worker(workerUrl);

            let bestMoveFound = false;

            worker.onmessage = function (e) {
                const msg = e.data;
                if (msg.startsWith('bestmove')) {
                    const move = msg.split(' ')[1];
                    resolve({ move: move, eval: "N/A" });
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    bestMoveFound = true;
                }
            };

            worker.onerror = function (e) {
                reject(new Error("Stockfish worker error: " + e.message));
                URL.revokeObjectURL(workerUrl);
            };

            worker.postMessage('uci');
            worker.postMessage('position fen ' + fen);
            worker.postMessage('go depth 15');

            setTimeout(() => {
                if (!bestMoveFound) {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(new Error("Analysis timed out"));
                }
            }, 10000);

        } catch (err) {
            reject(err);
        }
    });
}
