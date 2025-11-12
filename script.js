// script.js (GitHub Pages向け最終調整版)

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素 ---
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const lobbyScreen = document.getElementById('lobbyScreen');
    const gameScreen = document.getElementById('gameScreen');
    const startButton = document.getElementById('startButton');
    const lobbyStatus = document.getElementById('lobby-status');
    const timerDisplay = document.getElementById('timer');
    const scoreP1Display = document.getElementById('scoreP1');
    const scoreP2Display = document.getElementById('scoreP2');
    const scoreGaugeP1 = document.getElementById('scoreGaugeP1');
    const scoreGaugeP2 = document.getElementById('scoreGaugeP2');
    const victoryScreen = document.getElementById('victoryScreen');
    const finalScoreP1Display = document.getElementById('finalScoreP1');
    const finalScoreP2Display = document.getElementById('finalScoreP2');
    const restartButton = document.getElementById('restartButton');
    const colorPalette = document.getElementById('colorPalette');
    const currentColorDisplay = document.getElementById('currentColor');
    const playerListElement = document.getElementById('playerList');
    const playerCountElement = document.getElementById('playerCount');
    const serverIpInput = document.getElementById('serverIp');
    const connectButton = document.getElementById('connectButton');
    
    // --- ゲーム設定 ---
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const PIXEL_SIZE = 20; 
    const MOVE_SPEED = 6;
    const INITIAL_COLOR = '#ffffff'; 
    const PLAYER_COLORS = [
        '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', 
        '#9b59b6', '#e67e22', '#1abc9c', '#95a5a6'
    ];

    // --- クライアント側の状態 ---
    let socket = null;
    let myPlayer = null; 
    let allPlayers = {}; // { id: { ... } }
    let gamepads = [];
    let gameRunning = false;
    let animationFrameId = null; 
    let gameMap = [];
    let mapColors = {}; // { mapValue: color }
    
    // --- 初期化 ---
    function initializeMap() {
        const rows = HEIGHT / PIXEL_SIZE;
        const cols = WIDTH / PIXEL_SIZE;
        gameMap = [];
        for (let i = 0; i < rows; i++) {
            gameMap[i] = new Array(cols).fill(0);
        }
        ctx.fillStyle = INITIAL_COLOR;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    
    // --- UI/ロビーの操作 (関数本体は省略、変更なし) ---
    function createColorPalette() {
        colorPalette.innerHTML = '';
        PLAYER_COLORS.forEach(color => {
            const option = document.createElement('div');
            option.className = 'color-option';
            option.style.backgroundColor = color;
            option.dataset.color = color;
            option.addEventListener('click', () => {
                if (socket && socket.connected && !option.classList.contains('taken')) {
                    socket.emit('selectColor', color);
                }
            });
            colorPalette.appendChild(option);
        });
    }

    function updateLobby(playersData, hostId, availableColors) {
        playerCountElement.textContent = playersData.length;
        playerListElement.innerHTML = '';

        const colorOptions = colorPalette.querySelectorAll('.color-option');
        
        // 1. パレットの状態を更新
        colorOptions.forEach(opt => {
            opt.classList.remove('taken', 'selected');
            opt.style.opacity = '1';
            
            const color = opt.dataset.color;
            if (!availableColors.includes(color)) {
                opt.classList.add('taken');
                opt.style.opacity = '0.3';
            }
        });
        
        // 2. 参加者リストとマップカラーを更新
        mapColors = {};
        playersData.forEach(p => {
            // 参加者リストの作成
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <span class="player-color-indicator" style="background-color: ${p.color};"></span>
                    ${p.isHost ? '👑' : ''} P${p.id} ${p.isHost ? '(ホスト)' : ''}
                </div>
            `;
            playerListElement.appendChild(listItem);

            // 自分の色をパレットに反映
            if (myPlayer && p.socketId === socket.id) {
                myPlayer.color = p.color; // サーバーからの最終確定色に更新
                myPlayer.isHost = p.isHost;
                currentColorDisplay.textContent = p.color;
                const myColorOption = colorPalette.querySelector(`[data-color="${p.color}"]`);
                if (myColorOption) {
                    myColorOption.classList.add('selected');
                }
            }

            // 8人分のmapColorをマッピング
            mapColors[p.mapValue] = p.color;
        });
        
        // 3. ホストにのみスタートボタンの操作権限
        if (myPlayer && myPlayer.isHost) { 
            startButton.disabled = playersData.length < 1; 
            startButton.style.display = 'inline-block';
            lobbyStatus.textContent = `${playersData.length}人が待機中。準備ができたらスタートを押してください。`;
        } else {
            startButton.disabled = true;
            startButton.style.display = 'none';
            lobbyStatus.textContent = `ホストの開始を待っています。(${playersData.length}人)`;
        }
    }
    
    // --- 描画関数 (関数本体は省略、変更なし) ---
    function drawMap() { /* ... */ }
    function drawPlayers() { /* ... */ }

    function gameLoop() {
        if (!gameRunning) {
            cancelAnimationFrame(animationFrameId);
            return;
        }
        
        if (myPlayer && socket && socket.connected) {
            handleInput();
        }
        
        drawMap(); 
        drawPlayers();

        animationFrameId = requestAnimationFrame(gameLoop);
    }
    
    // --- ゲームパッドの処理 (関数本体は省略、変更なし) ---
    function handleInput() { /* ... */ }

    // --- 接続ロジック (★ここを修正★) ---
    connectButton.addEventListener('click', () => {
        const serverUrl = serverIpInput.value.trim();
        if (!serverUrl) {
            alert('サーバーIPまたはURLを入力してください。');
            return;
        }

        if (socket && socket.connected) {
            socket.disconnect();
        }

        // ★ io()が未定義でも実行を試みるように変更。
        // ★ これによりReferenceErrorを回避し、接続エラーとして処理できます。
        
        try {
            lobbyStatus.textContent = '接続中...';
            // http:// または https:// がなければ自動で http:// を付加
            const protocol = serverUrl.startsWith('https://') ? '' : serverUrl.startsWith('http://') ? '' : 'http://';
            
            // 入力された絶対URLに対して接続を試みる
            socket = io(`${protocol}${serverUrl}`, {
                transports: ['websocket', 'polling'],
                forceNew: true 
            });
            setupSocketEvents(socket);
        } catch (error) {
            // io is not defined のエラーはここでキャッチされます。
            lobbyStatus.textContent = '接続に失敗しました。Socket.IOライブラリが読み込まれていません。';
            console.error('Connection error:', error);
        }
    });

    // --- Socket.IO イベントハンドラ設定 (関数本体は省略、変更なし) ---
    function setupSocketEvents(socket) {
        
        socket.on('connect', () => {
            lobbyStatus.textContent = '接続済み。色を選択してください。';
            connectButton.disabled = true;
            serverIpInput.disabled = true;
        });
        
        socket.on('disconnect', () => {
            lobbyStatus.textContent = 'サーバーから切断されました。IPを入力して再接続してください。';
            gameRunning = false;
            connectButton.disabled = false;
            serverIpInput.disabled = false;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            myPlayer = null;
            allPlayers = {};
            startButton.disabled = true;
            lobbyScreen.classList.add('show');
            gameScreen.style.display = 'none';
        });

        socket.on('serverFull', (message) => { /* ... */ });
        socket.on('playerAssigned', (playerData) => { /* ... */ });
        socket.on('isHost', (isHost) => { /* ... */ });
        socket.on('playerListUpdate', (data) => { /* ... */ });
        socket.on('gameStart', (data) => { /* ... */ });
        socket.on('gameStateUpdate', (data) => { /* ... */ });
        socket.on('scoreUpdate', (scores) => { /* ... */ });
        socket.on('timerUpdate', (remainingTime) => { /* ... */ });
        socket.on('gameEnd', ({ finalScores }) => { /* ... */ });
        socket.on('gameAborted', (message) => { /* ... */ });
    }

    // --- イベントリスナー (関数本体は省略、変更なし) ---
    startButton.addEventListener('click', () => {
        if (myPlayer && myPlayer.isHost) {
            socket.emit('requestStartGame');
        }
    });

    restartButton.addEventListener('click', () => {
        victoryScreen.classList.remove('show');
        if (myPlayer && myPlayer.isHost) {
            socket.emit('requestStartGame');
        } else {
            lobbyScreen.classList.add('show');
            gameScreen.style.display = 'none';
        }
    });
    
    // 初回実行
    createColorPalette();
});