// script.js (8人・ロビー対応版)
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
    let allPlayers = {}; // { socketId: { ... } }
    let gamepads = [];
    let gameRunning = false;
    let animationFrameId = null; 
    let mapColors = {}; // { mapValue: color }
    
    // --- 初期化 ---
    function initializeMap() {
        const rows = HEIGHT / PIXEL_SIZE;
        const cols = WIDTH / PIXEL_SIZE;
        let map = [];
        for (let i = 0; i < rows; i++) {
            map[i] = new Array(cols).fill(0);
        }
        ctx.fillStyle = INITIAL_COLOR;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        return map;
    }

    // --- 接続ロジック ---
    connectButton.addEventListener('click', () => {
        const serverUrl = serverIpInput.value.trim();
        if (!serverUrl) {
            alert('サーバーIPまたはURLを入力してください。');
            return;
        }

        // 既存の接続があれば切断
        if (socket) {
            socket.disconnect();
        }

        // Socket.IO接続を確立
        try {
            lobbyStatus.textContent = '接続中...';
            socket = io(`http://${serverUrl}`, {
                transports: ['websocket', 'polling'],
                forceNew: true // 新しい接続を強制
            });
            setupSocketEvents(socket);
        } catch (error) {
            lobbyStatus.textContent = '接続に失敗しました。';
            console.error('Connection error:', error);
        }
    });

    // --- UI/ロビーの操作 ---

    function createColorPalette() {
        colorPalette.innerHTML = '';
        PLAYER_COLORS.forEach(color => {
            const option = document.createElement('div');
            option.className = 'color-option';
            option.style.backgroundColor = color;
            option.dataset.color = color;
            option.addEventListener('click', () => {
                if (option.classList.contains('taken')) return;
                socket.emit('selectColor', color);
            });
            colorPalette.appendChild(option);
        });
    }

    function updateLobby(playersData, hostId, availableColors) {
        playerCountElement.textContent = playersData.length;
        playerListElement.innerHTML = '';

        const colorOptions = colorPalette.querySelectorAll('.color-option');
        colorOptions.forEach(opt => {
            opt.classList.remove('taken', 'selected');
            opt.style.opacity = '1';
            
            const color = opt.dataset.color;
            if (!availableColors.includes(color)) {
                opt.classList.add('taken');
                opt.style.opacity = '0.3';
            }
        });
        
        playersData.forEach(p => {
            // 参加者リストの更新
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <span class="player-color-indicator" style="background-color: ${p.color};"></span>
                    ${p.isHost ? '👑' : ''} P${p.id} ${p.isHost ? '(ホスト)' : ''}
                </div>
            `;
            playerListElement.appendChild(listItem);

            // 自分の色をパレットに反映
            if (myPlayer && p.id === myPlayer.id) {
                currentColorDisplay.textContent = p.color;
                const myColorOption = colorPalette.querySelector(`[data-color="${p.color}"]`);
                if (myColorOption) {
                    myColorOption.classList.add('selected');
                }
            }

            // 8人分のmapColorをマッピング
            mapColors[p.mapValue] = p.color;
        });
        
        // ホストにのみスタートボタンの操作権限
        if (myPlayer && myPlayer.isHost) {
            startButton.disabled = playersData.length < 1; // 1人でも開始可能
            startButton.style.display = 'inline-block';
            lobbyStatus.textContent = `${playersData.length}人が待機中。準備ができたらスタートを押してください。`;
        } else {
            startButton.disabled = true;
            startButton.style.display = 'none';
            lobbyStatus.textContent = `ホストの開始を待っています。(${playersData.length}人)`;
        }
    }
    
    // --- 描画関数 ---
    
    function drawMap() {
        const rows = HEIGHT / PIXEL_SIZE;
        const cols = WIDTH / PIXEL_SIZE;

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const mapValue = gameMap[y][x];
                let color = INITIAL_COLOR;

                if (mapValue > 0) {
                    color = mapColors[mapValue] || INITIAL_COLOR;
                }

                ctx.fillStyle = color;
                ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
            }
        }
    }
    
    function drawPlayers() {
        // 全プレイヤーの情報を描画
        const playersArray = Object.values(allPlayers);

        playersArray.forEach(player => {
            // Canvasに描画
            ctx.beginPath();
            ctx.arc(player.x, player.y, PIXEL_SIZE / 2, 0, Math.PI * 2); 
            ctx.fillStyle = player.color;
            ctx.fill();
            
            // プレイヤーIDを表示 (デバッグ用)
            ctx.fillStyle = 'white';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`P${player.id}`, player.x, player.y + 4);
        });
    }

    function gameLoop() {
        if (!gameRunning) {
            cancelAnimationFrame(animationFrameId);
            return;
        }
        
        // 1. 入力処理
        if (myPlayer) {
            handleInput();
        }
        
        // 2. 描画
        drawMap(); 
        drawPlayers();

        animationFrameId = requestAnimationFrame(gameLoop);
    }
    
    // --- ゲームパッドの処理 ---
    function handleInput() {
        gamepads = navigator.getGamepads().filter(g => g !== null);
        const myGamepad = gamepads[0]; // 誰でも最初のコントローラーを使う

        if (!myGamepad) return;

        const [axisX, axisY] = [myGamepad.axes[0], myGamepad.axes[1]];
        let moveX = 0;
        let moveY = 0;
        const deadzone = 0.15;

        if (Math.abs(axisX) > deadzone) { moveX = axisX * MOVE_SPEED; }
        if (Math.abs(axisY) > deadzone) { moveY = axisY * MOVE_SPEED; }
        
        if (moveX !== 0 || moveY !== 0) {
            // クライアント側で移動を予測し、サーバーに送信
            myPlayer.x = Math.max(0, Math.min(WIDTH, myPlayer.x + moveX));
            myPlayer.y = Math.max(0, Math.min(HEIGHT, myPlayer.y + moveY));
            
            socket.emit('playerMove', { x: myPlayer.x, y: myPlayer.y });
        }
    }

    // --- Socket.IO イベントハンドラ設定 ---
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

        socket.on('serverFull', (message) => {
            lobbyStatus.textContent = message;
            alert(message);
        });

        // 自分のプレイヤー情報を受信
        socket.on('playerAssigned', (playerData) => {
            myPlayer = playerData;
            myPlayer.isHost = playerData.isHost;
            lobbyStatus.textContent = `P${myPlayer.id}として接続しました。${myPlayer.isHost ? 'あなたはホストです。' : ''}`;
        });
        
        // ホスト権限の更新
        socket.on('isHost', (isHost) => {
            if (myPlayer) {
                myPlayer.isHost = isHost;
            }
        });

        // 全プレイヤー情報とロビー状態の更新
        socket.on('playerListUpdate', (data) => {
            // allPlayersはサーバーの状態をミラーリング
            allPlayers = {};
            data.players.forEach(p => {
                allPlayers[p.id] = p; // IDベースで保存
            });
            updateLobby(data.players, data.hostId, data.availableColors);
        });
        
        // 自分の色の更新
        socket.on('colorUpdated', (newColor) => {
            if (myPlayer) {
                myPlayer.color = newColor;
                currentColorDisplay.textContent = newColor;
            }
        });

        // ゲーム開始通知
        socket.on('gameStart', (data) => {
            gameMap = initializeMap(); // ローカルマップをリセット
            gameRunning = true;
            
            // サーバーの初期状態を反映
            Object.values(data.players).forEach(p => {
                allPlayers[p.id] = p;
                if(p.socketId === socket.id) {
                    myPlayer.x = p.x;
                    myPlayer.y = p.y;
                }
            });

            lobbyScreen.classList.remove('show');
            gameScreen.style.display = 'block';
            victoryScreen.classList.remove('show');
            
            gameLoop();
        });
        
        // サーバーからの状態更新
        socket.on('gameStateUpdate', (data) => {
            // プレイヤーの位置を更新
            Object.values(data.players).forEach(p => {
                allPlayers[p.id] = p;
                if (p.socketId === socket.id) {
                    // 自分の位置をサーバーに同期
                    myPlayer.x = p.x;
                    myPlayer.y = p.y;
                }
            });
            
            // マップの部分更新
            const mapUpdate = data.mapUpdate;
            if (mapUpdate) {
                const { mapY, mapX, value } = mapUpdate;
                if (gameMap[mapY] && gameMap[mapY][mapX] !== undefined) {
                    gameMap[mapY][mapX] = value;
                }
            }
        });

        // スコアの更新 (8人用スコアオブジェクトが届く)
        socket.on('scoreUpdate', (scores) => {
            // P1とP2のスコア表示を更新 (簡易表示)
            const p1Score = scores[1] || 0;
            const p2Score = scores[2] || 0;

            scoreP1Display.textContent = p1Score;
            scoreP2Display.textContent = p2Score;
            
            // スコアゲージの更新 (P1 vs P2 の比較のみ)
            const totalPaintedTiles = p1Score + p2Score;
            let p1Width = totalPaintedTiles > 0 ? (p1Score / totalPaintedTiles) * 100 : 50;
            scoreGaugeP1.style.width = `${p1Width}%`;
            scoreGaugeP2.style.width = `${100 - p1Width}%`;
            
            // TODO: 8人用スコアボードの更新
        });
        
        // タイマーの更新
        socket.on('timerUpdate', (remainingTime) => {
            timerDisplay.textContent = `残り時間: ${(remainingTime / 1000).toFixed(2)}秒`;
        });

        // ゲーム終了通知
        socket.on('gameEnd', ({ finalScores }) => {
            gameRunning = false;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            timerDisplay.textContent = '試合終了！';
            
            // スコアが高い順にソート
            const sortedScores = Object.entries(finalScores)
                .map(([mapValue, score]) => ({ mapValue: parseInt(mapValue), score }))
                .sort((a, b) => b.score - a.score);

            let winnerMessage = '';
            let winnerClass = ''; 
            
            if (sortedScores.length > 0 && sortedScores[0].score > 0) {
                const winnerId = sortedScores[0].mapValue;
                const winnerPlayer = Object.values(allPlayers).find(p => p.mapValue === winnerId);
                winnerMessage = `P${winnerId} WIN!`;
                winnerClass = `p${winnerId === 1 ? '1' : winnerId === 2 ? '2' : ''}-win`; // P1, P2のみ色を適用
            } else {
                winnerMessage = 'DRAW!';
            }
            
            // 簡易スコアボードの更新
            finalScoreP1Display.textContent = finalScores[1] || 0;
            finalScoreP2Display.textContent = finalScores[2] || 0;

            victoryMessage.textContent = winnerMessage;
            victoryScreen.className = 'victory-screen show';
            if (winnerClass) {
                victoryScreen.classList.add(winnerClass);
            }
            
            lobbyScreen.classList.add('show');
            gameScreen.style.display = 'none';
        });

        // ゲーム強制終了通知
        socket.on('gameAborted', (message) => {
            alert(message);
            gameRunning = false;
            lobbyScreen.classList.add('show');
            gameScreen.style.display = 'none';
            // 再接続処理を促す
        });
    }

    // --- イベントリスナー ---
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
            // ホストではない場合、ロビーに戻る
            lobbyScreen.classList.add('show');
            gameScreen.style.display = 'none';
            // P1の開始を待つメッセージを表示
        }
    });
    
    // 初回実行
    createColorPalette();
    // IP入力欄に接続を促す
    lobbyStatus.textContent = 'IP/URLを入力して「接続」を押してください。';
});