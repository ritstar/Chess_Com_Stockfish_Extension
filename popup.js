document.addEventListener('DOMContentLoaded', () => {
  const btnWhite = document.getElementById('btn-white');
  const btnBlack = document.getElementById('btn-black');
  const btnAnalyze = document.getElementById('btn-analyze');
  const resultsArea = document.getElementById('results-area');
  const bestMoveText = document.getElementById('best-move-text');
  const evalText = document.getElementById('eval-text');
  const statusMsg = document.getElementById('status-message');

  let playerColor = 'w'; // 'w' or 'b'

  // Toggle Player Color
  btnWhite.addEventListener('click', () => setPlayerColor('w'));
  btnBlack.addEventListener('click', () => setPlayerColor('b'));

  function setPlayerColor(color) {
    playerColor = color;
    if (color === 'w') {
      btnWhite.classList.add('active');
      btnBlack.classList.remove('active');
    } else {
      btnBlack.classList.add('active');
      btnWhite.classList.remove('active');
    }
  }

  // Analyze Button Click
  btnAnalyze.addEventListener('click', async () => {
    // Reset UI
    resultsArea.style.display = 'block';
    bestMoveText.textContent = 'Calculating...';
    evalText.textContent = '...';
    statusMsg.textContent = 'Starting analysis...';
    btnAnalyze.disabled = true;

    // Get Active Tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
        statusMsg.textContent = "No active tab found.";
        btnAnalyze.disabled = false;
        return;
    }

    // Send message to Content Script
    try {
        const response = await chrome.tabs.sendMessage(tab.id, { 
            action: "getBestMove", 
            playerColor: playerColor 
        });

        if (response && response.bestMove) {
            bestMoveText.textContent = response.bestMove;
            evalText.textContent = response.evaluation || 'N/A';
            statusMsg.textContent = 'Analysis complete.';
        } else if (response && response.error) {
            statusMsg.textContent = `Error: ${response.error}`;
            bestMoveText.textContent = '-';
        } else {
            statusMsg.textContent = 'No response from content script.';
            bestMoveText.textContent = '-';
        }
    } catch (err) {
        console.error(err);
        statusMsg.textContent = 'Could not communicate with page. Refresh?';
        bestMoveText.textContent = '-';
    } finally {
        btnAnalyze.disabled = false;
    }
  });
});
