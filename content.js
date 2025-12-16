// Content script
console.log("Chess Analyzer Content Script Loaded");

let engineWorker = null;
let isAutoAnalysisOn = false;
let playerColor = 'w'; // Default
let lastFen = "";
let analysisDebounce = null;

let uiShadowRoot = null; // Reference to UI shadow DOM

// Inject UI on load
injectControlPanel();

// Listen for messages from popup (still suported, but UI is primary now)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getBestMove") {
        playerColor = request.playerColor || 'w';
        updatePanelUI(playerColor);
        triggerAnalysis().then(res => sendResponse(res));
        return true;
    }
});

function injectControlPanel() {
    // Check if host exists
    if (document.getElementById('sf-ui-host')) return;

    const host = document.createElement('div');
    host.id = 'sf-ui-host';

    // Position the host container (fixed to screen)
    Object.assign(host.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: '10000',
        pointerEvents: 'none' // Don't block clicks, inner content will enable pointer-events
    });

    document.body.appendChild(host);

    // Attach Shadow DOM
    uiShadowRoot = host.attachShadow({ mode: 'open' });

    // CSS Styles (Inside Shadow DOM, isolated)
    const style = `
        <style>
            .sf-panel {
                pointer-events: auto; /* Enable clicks on the panel */
                width: 220px;
                background: rgba(30, 30, 30, 0.85);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #ececec;
                padding: 15px;
                border-radius: 12px;
                font-family: 'Segoe UI', system-ui, sans-serif;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
                transition: all 0.3s ease;
            }
            .sf-panel:hover {
                opacity: 1;
            }
            .sf-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                font-weight: 600;
                color: #81b64c;
            }
            .sf-badge {
                font-size: 10px;
                background: #444;
                color: #fff;
                padding: 2px 6px;
                border-radius: 4px;
                text-transform: uppercase;
            }
            .sf-controls {
                display: flex;
                gap: 8px;
                margin-bottom: 12px;
            }
            button {
                flex: 1;
                padding: 8px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                transition: background 0.2s;
                background: rgba(255, 255, 255, 0.1);
                color: #ddd;
            }
            button:hover {
                background: rgba(255, 255, 255, 0.2);
                color: #fff;
            }
            button.active {
                background: #81b64c !important;
                color: #fff !important;
                box-shadow: 0 0 10px rgba(129, 182, 76, 0.4);
            }
            .sf-result {
                background: rgba(0, 0, 0, 0.3);
                padding: 10px;
                border-radius: 8px;
                text-align: center;
            }
            .sf-best-move {
                font-size: 24px;
                font-weight: 700;
                color: #fff;
                margin-top: 5px;
                letter-spacing: 1px;
            }
            .sf-status {
                font-size: 11px;
                color: #aaa;
            }
        </style>
    `;

    // HTML Structure
    const html = `
        <div class="sf-panel">
            <div class="sf-header">
                <span>Stockfish Analyzer</span>
                <span id="sf-turn-indicator" class="sf-badge">White to Move</span>
            </div>
            <div class="sf-controls">
                <button id="sf-toggle-auto">Auto-Play: OFF</button>
                <button id="sf-flip">Flip Side</button>
            </div>
            <div class="sf-result">
                <div id="sf-status" class="sf-status">Ready</div>
                <div id="sf-best-move" class="sf-best-move">-</div>
            </div>
        </div>
    `;

    uiShadowRoot.innerHTML = style + html;

    // Event Listeners (Use uiShadowRoot to find elements)
    uiShadowRoot.getElementById('sf-toggle-auto').addEventListener('click', toggleAutoAnalysis);
    uiShadowRoot.getElementById('sf-flip').addEventListener('click', () => {
        playerColor = playerColor === 'w' ? 'b' : 'w';
        updatePanelUI(playerColor);
        if (isAutoAnalysisOn) triggerAnalysis();
    });

    // Initial UI State
    updatePanelUI(playerColor);
}

function updatePanelUI(color) {
    if (!uiShadowRoot) return;
    const badge = uiShadowRoot.getElementById('sf-turn-indicator');
    if (badge) {
        badge.textContent = color === 'w' ? "Playing White" : "Playing Black";
        badge.style.background = color === 'w' ? "#f0f0f0" : "#222";
        badge.style.color = color === 'w' ? "#222" : "#f0f0f0";
    }
}

function toggleAutoAnalysis() {
    isAutoAnalysisOn = !isAutoAnalysisOn;
    if (!uiShadowRoot) return;

    const btn = uiShadowRoot.getElementById('sf-toggle-auto');
    btn.textContent = isAutoAnalysisOn ? "Auto: ON" : "Auto: OFF";
    if (isAutoAnalysisOn) btn.classList.add('active');
    else btn.classList.remove('active');

    if (isAutoAnalysisOn) {
        startBoardObserver();
        triggerAnalysis();
    } else {
        stopBoardObserver();
    }
}

function updateStatus(msg) {
    if (!uiShadowRoot) return;
    const el = uiShadowRoot.getElementById('sf-status');
    if (el) el.textContent = msg;
}

function displayBestMove(move, evaluation) {
    if (!uiShadowRoot) return;
    const el = uiShadowRoot.getElementById('sf-best-move');
    if (el) {
        if (move && move.length === 4) {
            el.textContent = `${move.substring(0, 2)} ➝ ${move.substring(2, 4)}`;
        } else {
            el.textContent = move || '-';
        }
    }

    if (move) {
        drawArrow(move);
    }
}

async function triggerAnalysis() {
    // Turn detection
    if (isAutoAnalysisOn) {
        const turn = detectTurn();

        if (turn && turn !== playerColor) {
            updateStatus(`Opponent's Turn (${turn === 'w' ? 'White' : 'Black'})`);

            // Clear outputs
            if (uiShadowRoot) {
                const existing = uiShadowRoot.getElementById('sf-best-move');
                if (existing) existing.textContent = "Waiting...";
            }

            // Remove arrow from its host
            // We need to look inside the board's shadow host for arrows
            const board = document.querySelector('chess-board, #board-layout-chessboard, .board');
            if (board) {
                const arrowHost = board.querySelector('.sf-arrow-host');
                if (arrowHost && arrowHost.shadowRoot) {
                    arrowHost.shadowRoot.innerHTML = ''; // Clear arrows
                }
            }

            return;
        }
    }

    updateStatus(`Analyzing as ${playerColor === 'w' ? 'White' : 'Black'}...`);
    try {
        const fen = extractFEN(playerColor);
        if (!fen) {
            updateStatus('Board not found');
            return;
        }

        lastFen = fen;

        const result = await runStockfish(fen);
        displayBestMove(result.move, result.eval);
        updateStatus(`Depth 15 • ${result.eval}`);
        return result;

    } catch (e) {
        console.error(e);
        updateStatus('Error: ' + e.message);
        return { error: e.message };
    }
}

// Helper to find color of tool
function getClockColor(clockEl) {
    if (!clockEl) return null;
    const parent = clockEl.closest('.player-component, .player-avatar, .user-tagline-component');
    if (parent) {
        if (parent.classList.contains('white') || parent.querySelector('.white')) return 'w';
        if (parent.classList.contains('black') || parent.querySelector('.black')) return 'b';
        // Try internal avatar or icon
        if (parent.querySelector('.piece.wp, .avatar-white')) return 'w';
        if (parent.querySelector('.piece.bp, .avatar-black')) return 'b';
    }
    // Fallback: check classes on clock itself
    if (clockEl.classList.contains('clock-white')) return 'w';
    if (clockEl.classList.contains('clock-black')) return 'b';
    return null;
}

function detectTurn() {
    // Aggressively find all clocks
    const clocks = document.querySelectorAll('.clock-component');

    for (const clock of clocks) {
        // Check if this clock is active
        // Active usually implies class "clock-active" or "running"
        const isActive = clock.classList.contains('clock-active') ||
            clock.classList.contains('running') ||
            clock.classList.contains('clock-player-turn');

        // Also check for "low time" active state which might be different, but usually includes running

        if (isActive) {
            return getClockColor(clock);
        }
    }

    // Fallback For specific layouts (e.g. side-by-side)
    // Sometimes the active player container has a class
    const activePlayer = document.querySelector('.player-component.active, .player-component.turn');
    if (activePlayer) {
        if (activePlayer.classList.contains('white')) return 'w';
        if (activePlayer.classList.contains('black')) return 'b';
    }

    return null;
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
    if (!move || move.length < 4) return;

    let board = document.querySelector('chess-board, #board-layout-chessboard, .board');
    if (!board) return;

    // Find or create Shadow Host for arrows
    let host = board.querySelector('.sf-arrow-host');
    if (!host) {
        host = document.createElement('div');
        host.className = 'sf-arrow-host';
        Object.assign(host.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '1000'
        });

        // Enable absolute positioning context on board if needed
        if (getComputedStyle(board).position === 'static') {
            board.style.position = 'relative';
        }

        board.appendChild(host);
        host.attachShadow({ mode: 'open' });
    }

    const shadow = host.shadowRoot;
    shadow.innerHTML = ''; // Clear existing

    // SVG Content
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    Object.assign(svg.style, {
        width: '100%',
        height: '100%',
        overflow: 'visible'
    });

    // Arrowhead Marker
    const defs = document.createElementNS(svgNS, "defs");
    const marker = document.createElementNS(svgNS, "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto");

    const polygon = document.createElementNS(svgNS, "polygon");
    polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
    polygon.setAttribute("fill", "#81b64c");
    polygon.setAttribute("fill-opacity", "0.9");

    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Geometry calculations (unchanged logic)
    // Robust orientation check
    const isBoardFlipped = (() => {
        try {
            const sq11 = board.querySelector('.square-11');
            const sq18 = board.querySelector('.square-18');
            if (sq11 && sq18) {
                const r1 = sq11.getBoundingClientRect();
                const r8 = sq18.getBoundingClientRect();
                return r1.top < r8.top;
            }
        } catch (e) { }
        return board.classList.contains('flipped') || board.closest('.flipped') !== null;
    })();

    const getSquareCenter = (sq) => {
        const file = sq.charCodeAt(0) - 97 + 1;
        const rank = parseInt(sq[1]);

        // Use board logic
        const hit = board.querySelector(`.square-${file}${rank}`);
        if (hit) {
            const hitRect = hit.getBoundingClientRect();
            const boardRect = board.getBoundingClientRect();
            return {
                x: (hitRect.left - boardRect.left) + (hitRect.width / 2),
                y: (hitRect.top - boardRect.top) + (hitRect.height / 2)
            };
        }

        const squareWidth = board.clientWidth / 8;
        const squareHeight = board.clientHeight / 8;
        const fIndex = file - 1;
        const rIndex = rank - 1;

        let x, y;
        if (!isBoardFlipped) {
            x = fIndex * squareWidth + (squareWidth / 2);
            y = (7 - rIndex) * squareHeight + (squareHeight / 2);
        } else {
            x = (7 - fIndex) * squareWidth + (squareWidth / 2);
            y = rIndex * squareHeight + (squareHeight / 2);
        }
        return { x, y };
    };

    const from = move.substring(0, 2);
    const to = move.substring(2, 4);
    const p1 = getSquareCenter(from);
    const p2 = getSquareCenter(to);

    // Line
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", p1.x);
    line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x);
    line.setAttribute("y2", p2.y);
    line.setAttribute("stroke", "#81b64c");
    line.setAttribute("stroke-width", Math.max(4, board.getBoundingClientRect().width * 0.015));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", "0.9");
    line.setAttribute("marker-end", "url(#arrowhead)");
    line.style.filter = "drop-shadow(0px 0px 4px rgba(0,0,0,0.5))";

    svg.appendChild(line);
    shadow.appendChild(svg);
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
