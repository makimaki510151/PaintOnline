// script.js
class OnlinePVPGame {
    constructor() {
        // --- 接続・状態管理 ---
        this.socket = null;
        this.playerId = null;
        this.isHost = false;
        this.currentScreen = 'title';

        // --- ゲーム定数 (サーバーと同期) ---
        this.WIDTH = 800;
        this.HEIGHT = 600;
        this.PIXEL_SIZE = 20; // 塗りの粒度/ブラシサイズ
        this.MOVE_SPEED = 6;
        this.GAME_DURATION = 60000;
        
        // --- ゲームインスタンス変数 ---
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.gameRunning = false;
        this.gameTimer = 0;
        this.lastGameUpdateTime = 0;
        this.animationFrameId = null;

        // サーバーから受け取る全プレイヤーの状態 (自分自身も含む)
        this.players = {}; 
        this.playerUnits = {}; // DOMのユニット要素

        // 塗りつぶしマップ (サーバーから受け取ったものを描画)
        this.territoryMap = null; 

        // --- DOM要素 ---
        this.timerDisplay = document.getElementById('timer');
        this.statusMessage = document.getElementById('status-message');
        this.scoreP1Display = document.getElementById('scoreP1');
        this.scoreP2Display = document.getElementById('scoreP2');
        this.scoreGaugeP1 = document.getElementById('scoreGaugeP1');
        this.scoreGaugeP2 = document.getElementById('scoreGaugeP2');
        this.victoryScreen = document.getElementById('clear-screen');
        this.victoryMessage = document.getElementById('victoryMessage');
        this.finalScoreP1Display = document.getElementById('finalScoreP1');
        this.finalScoreP2Display = document.getElementById('finalScoreP2');
        this.restartButton = document.getElementById('restartButton');
        this.startButton = document.getElementById('start-game-button');
        
        // --- 入力制御 ---
        this.lastMoveTime = 0;
        this.moveDelay = 15; // サーバー側が受け付ける頻度と合わせる

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.showScreen('title');
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.WIDTH, this.HEIGHT);
        this.updateGamepadStatus();
        this.startGamepadPolling();
    }

    setupEventListeners() {
        // --- 接続/ロビー関連 ---
        document.getElementById('create-room-button').addEventListener('click', () => this.showConnectionModal('host'));
        document.getElementById('join-room-button').addEventListener('click', () => this.showConnectionModal('guest'));
        document.getElementById('connect-submit').addEventListener('click', () => this.connectToServer());
        document.getElementById('connection-cancel').addEventListener('click', () => this.hideConnectionModal());
        document.getElementById('lobby-disconnect-button').addEventListener('click', () => this.disconnectServer());
        document.getElementById('start-game-button').addEventListener('click', () => this.sendStartGameRequest());
        this.restartButton.addEventListener('click', () => this.disconnectServer());
        document.getElementById('back-to-title').addEventListener('click', () => this.disconnectServer());

        // --- ゲームパッド/キーボード ---
        window.addEventListener("gamepadconnected", () => this.updateGamepadStatus());
        window.addEventListener("gamepaddisconnected", () => this.updateGamepadStatus());
        window.addEventListener('keydown', (e) => this.handleKeyboardInput(e));

        // --- ロビー色選択 ---
        document.getElementById('color-picker').addEventListener('click', (e) => {
            if (e.target.classList.contains('color-option')) {
                const color = e.target.dataset.color;
                this.selectColor(color);
            }
        });
    }

    // --- 画面遷移/モーダル処理 (前回と同じロジックを使用) ---
    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(`${screenName}-screen`).classList.add('active');
        this.currentScreen = screenName;
        
        if (screenName === 'lobby') {
             this.colorPickerInitialized = false; 
             this.updateLobbyStatus(this.players); 
        }
        
        // ゲーム画面に入る際にアニメーション開始
        if (screenName === 'game') {
            this.gameRunning = true;
            this.animationFrameId = requestAnimationFrame((timestamp) => this.gameLoop(timestamp));
        } else {
            // ゲーム画面から離れる際にアニメーション停止
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        }
    }
    
    showConnectionModal(type) {
        this.isHost = (type === 'host');
        document.getElementById('connection-title').textContent = this.isHost ? '部屋を作成 (ホスト)' : '部屋に参加 (ゲスト)';
        document.getElementById('connect-submit').textContent = this.isHost ? '部屋を作成' : '接続して参加';
        document.getElementById('server-address').value = this.isHost ? (document.getElementById('server-address').value || 'localhost:8080') : document.getElementById('server-address').value;
        document.getElementById('title-screen').classList.remove('active');
        document.getElementById('connection-modal').classList.add('active');
        document.getElementById('server-address').focus();
    }
    
    hideConnectionModal() {
        document.getElementById('connection-modal').classList.remove('active');
        document.getElementById('title-screen').classList.add('active');
    }

    // --- 接続処理 ---
    connectToServer() {
        const address = document.getElementById('server-address').value.trim();
        const parts = address.split(':');
        let ip = parts[0];
        let port = parts.length === 2 ? parts[1] : (ip !== 'localhost' && ip !== '127.0.0.1' ? '443' : '80');
        
        const isSecureHost = ip !== 'localhost' && ip !== '127.0.0.1';
        const protocol = isSecureHost ? 'wss' : 'ws'; 
        
        let url;
        if (isSecureHost && (port === '443' || parts.length === 1)) {
            url = `${protocol}://${ip}`;
        } else if (!isSecureHost && (port === '80' || parts.length === 1)) {
            url = `${protocol}://${ip}`;
        } else {
            url = `${protocol}://${ip}:${port}`;
        }

        if (this.socket) this.socket.close();
        this.socket = new WebSocket(url);
        
        this.socket.onopen = () => {
            this.hideConnectionModal();
            document.getElementById('connection-status').textContent = '接続中...';
            document.getElementById('connection-status').style.color = '#FF9800';
            this.socket.send(JSON.stringify({ type: this.isHost ? 'CREATE_ROOM' : 'JOIN_ROOM' }));
        };

        this.socket.onmessage = (event) => this.handleServerMessage(JSON.parse(event.data));

        this.socket.onerror = (e) => {
            console.error('WebSocketエラー:', e);
            document.getElementById('connection-status').textContent = '接続失敗';
            document.getElementById('connection-status').style.color = '#e74c3c';
            this.socket = null;
            alert('接続失敗。アドレスとサーバー状態を確認してください。');
            this.showScreen('title');
        };

        this.socket.onclose = () => {
            console.log('サーバーとの接続が切れました。');
            this.socket = null;
            if (this.currentScreen === 'game' || this.currentScreen === 'lobby') {
                 alert('サーバーとの接続が切れました。タイトルに戻ります。');
            }
            this.showScreen('title');
        };
    }
    
    disconnectServer() {
        if (this.socket) {
            this.socket.close();
        }
        this.showScreen('title');
    }
    
    sendStartGameRequest() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN && this.isHost) {
            this.socket.send(JSON.stringify({ type: 'START_GAME' }));
            this.startButton.disabled = true;
            document.getElementById('lobby-message').textContent = "ゲーム開始要求を送信しました。";
        }
    }

    // --- サーバーメッセージ処理 ---
    handleServerMessage(data) {
        switch (data.type) {
            case 'ROOM_READY':
                this.playerId = data.yourId;
                this.players = data.players;
                this.showScreen('lobby');
                this.updateLobbyStatus(data.players);
                break;
            
            case 'LOBBY_UPDATE':
                this.players = data.players;
                this.updateLobbyStatus(data.players);
                break;

            case 'GAME_START':
                this.players = data.players;
                this.territoryMap = data.territoryMap;
                this.gameTimer = data.duration;
                this.lastGameUpdateTime = performance.now(); // タイマー同期用の基準時刻
                this.initializeGameUnits();
                this.showScreen('game');
                break;

            case 'GAME_STATE_UPDATE':
                this.players = data.players;
                this.territoryMap = data.territoryMap;
                this.gameTimer = data.duration;
                this.lastGameUpdateTime = performance.now();
                break;
                
            case 'GAME_END':
                this.players = data.players;
                this.territoryMap = data.territoryMap;
                this.gameTimer = 0;
                this.endGame(data.winnerId);
                break;

            case 'ERROR':
                alert(`エラー: ${data.message}`);
                this.disconnectServer();
                break;
        }
    }
    
    // --- ロビー処理 (前回と同じロジックを使用) ---
    updateLobbyStatus(playersData) {
        const playerList = document.getElementById('lobby-player-list');
        const playerCount = Object.keys(playersData).length;
        
        this.updateColorPicker(playersData); // 色選択UIを更新

        playerList.innerHTML = `<h4>参加プレイヤー (${playerCount}人):</h4>`;
        Object.keys(playersData).sort().forEach(id => {
            const isMe = id === this.playerId;
            const playerDiv = document.createElement('p');
            const playerColor = playersData[id]?.color || '#FFFFFF'; 

            playerDiv.style.color = playerColor;
            playerDiv.style.fontWeight = 'bold';
            playerDiv.textContent = `▶︎ ${id} ${isMe ? '(あなた)' : ''} [Color: ${playerColor}]`;
            playerList.appendChild(playerDiv);
        });

        const lobbyMessage = document.getElementById('lobby-message');
        if (this.isHost) {
            if (playerCount >= 2) {
                this.startButton.style.display = 'block';
                this.startButton.disabled = false;
                lobbyMessage.textContent = "準備完了！[ゲーム開始] を押してください。";
            } else {
                this.startButton.style.display = 'none';
                lobbyMessage.textContent = "他のプレイヤー (2人目) の参加を待っています...";
            }
        } else {
            this.startButton.style.display = 'none';
            lobbyMessage.textContent = "ホストの操作を待っています...";
        }
    }
    
    selectColor(color) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'SELECT_COLOR',
                color: color
            }));
            // サーバーからの LOBBY_UPDATE で確定した色が反映される
        }
    }
    
    updateColorPicker(playersData) {
        // ... (前回と同じ AVAILABLE_COLORSとロジックをここで実行) ...
        const AVAILABLE_COLORS = ['#E74C3C', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6', '#1ABC9C'];
        const colorPicker = document.getElementById('color-picker');
        
        if (!this.colorPickerInitialized) {
            colorPicker.innerHTML = '';
            AVAILABLE_COLORS.forEach(color => {
                const button = document.createElement('div');
                button.className = 'color-option';
                button.dataset.color = color;
                button.style.backgroundColor = color;
                colorPicker.appendChild(button);
            });
            this.colorPickerInitialized = true;
        }

        const myColor = playersData[this.playerId] ? playersData[this.playerId].color.toUpperCase() : null;
        
        colorPicker.querySelectorAll('.color-option').forEach(button => {
            const color = button.dataset.color.toUpperCase();
            button.classList.remove('selected', 'taken');
            
            if (color === myColor) {
                button.classList.add('selected');
            }
            
            const otherPlayerTaken = Object.keys(playersData).some(id => 
                id !== this.playerId && playersData[id].color.toUpperCase() === color
            );
            
            if (otherPlayerTaken) {
                button.classList.add('taken');
            }
        });
    }

    // --- ゲームユニットの初期化/同期 ---
    initializeGameUnits() {
        this.playerUnits = {};
        const playerKeys = Object.keys(this.players).sort(); 
        
        playerKeys.forEach((id, index) => {
            const player = this.players[id];
            
            // P1/P2ユニットのDOMを再利用するか、新しく作る
            const unitId = `player${index + 1}-unit`; 
            let unitElement = document.getElementById(unitId);
            
            if (!unitElement) {
                 unitElement = document.createElement('div');
                 unitElement.id = unitId;
                 unitElement.className = 'player-unit';
                 document.querySelector('.game-board-wrapper').appendChild(unitElement);
            }
            
            unitElement.style.display = 'block';
            unitElement.style.backgroundColor = player.color;
            unitElement.style.width = `${this.PIXEL_SIZE}px`;
            unitElement.style.height = `${this.PIXEL_SIZE}px`;
            
            // 自分のユニットに視覚的な印をつける
            unitElement.style.border = (id === this.playerId) ? '3px solid gold' : 'none'; 
            
            this.playerUnits[id] = unitElement;
        });

        // 不要なユニットDOMを非表示にする（例：3P以上対応の場合）
        for (let i = playerKeys.length + 1; i <= 6; i++) {
             const unit = document.getElementById(`player${i}-unit`);
             if (unit) unit.style.display = 'none';
        }
    }


    // --- メインゲームループ/描画 ---
    gameLoop(timestamp) {
        if (!this.gameRunning) return;
        
        this.drawGame();
        this.updateDOM();
        
        this.animationFrameId = requestAnimationFrame((ts) => this.gameLoop(ts));
    }

    drawGame() {
        if (!this.territoryMap) return;

        // 1. マップ（Canvas）の描画
        for (let y = 0; y < this.HEIGHT / this.PIXEL_SIZE; y++) {
            for (let x = 0; x < this.WIDTH / this.PIXEL_SIZE; x++) {
                const mapKey = `${x},${y}`;
                const color = this.territoryMap[mapKey];
                
                this.ctx.fillStyle = color || '#ffffff';
                this.ctx.fillRect(
                    x * this.PIXEL_SIZE, 
                    y * this.PIXEL_SIZE, 
                    this.PIXEL_SIZE, 
                    this.PIXEL_SIZE
                );
            }
        }
        
        // 2. プレイヤーユニットのDOM位置更新
        Object.keys(this.players).forEach(id => {
            const p = this.players[id];
            const unit = this.playerUnits[id];
            if (unit && p) {
                // サーバーから送られてきた座標をDOMに反映
                unit.style.transform = `translate(${p.x}px, ${p.y}px)`;
                unit.style.display = p.isDead ? 'none' : 'block';
            }
        });
    }

    updateDOM() {
        // --- タイマー更新 ---
        const remainingTime = Math.max(0, this.gameTimer);
        const seconds = (remainingTime / 1000).toFixed(2);
        this.timerDisplay.textContent = `残り時間: ${seconds}秒`;
        
        // --- スコア/ゲージ更新 ---
        const scores = this.calculateScores();
        
        this.scoreP1Display.textContent = scores.player1.score;
        this.scoreP2Display.textContent = scores.player2.score;

        const totalScore = scores.player1.score + scores.player2.score;
        const p1Width = totalScore > 0 ? (scores.player1.score / totalScore) * 100 : 50;
        const p2Width = totalScore > 0 ? (scores.player2.score / totalScore) * 100 : 50;

        this.scoreGaugeP1.style.width = `${p1Width}%`;
        this.scoreGaugeP2.style.width = `${p2Width}%`;
        
        // --- ステータスメッセージ ---
        this.statusMessage.textContent = this.gameRunning ? 
            `${this.players[this.playerId]?.isDead ? '💀 敗退' : '走行中'}` : 
            'ゲーム終了！';
    }
    
    calculateScores() {
        // プレイヤーIDの並び順に基づいてスコアを計算
        const playerKeys = Object.keys(this.players).sort();
        
        const scores = {
            player1: { id: playerKeys[0], color: this.players[playerKeys[0]]?.color, score: 0 },
            player2: { id: playerKeys[1], color: this.players[playerKeys[1]]?.color, score: 0 },
        };
        
        // スコア計算はクライアントでなくサーバーが厳密に行うべきだが、
        // クライアントの表示用として、サーバーから受け取ったマップに基づき計算
        for (const color of Object.values(this.territoryMap || {})) {
            if (color === scores.player1.color) {
                scores.player1.score++;
            } else if (color === scores.player2.color) {
                scores.player2.score++;
            }
        }
        
        // スコア表示の対応付け (P1/P2表示に合わせる)
        const p1ScoreElem = this.scoreP1Display.closest('.player-score');
        const p2ScoreElem = this.scoreP2Display.closest('.player-score');
        
        if (playerKeys.length >= 1) {
             p1ScoreElem.style.color = scores.player1.color;
             this.scoreGaugeP1.style.backgroundColor = scores.player1.color;
        }
        if (playerKeys.length >= 2) {
             p2ScoreElem.style.color = scores.player2.color;
             this.scoreGaugeP2.style.backgroundColor = scores.player2.color;
        }

        return scores;
    }

    endGame(winnerId) {
        this.gameRunning = false;
        
        const scores = this.calculateScores();
        const p1Score = scores.player1.score;
        const p2Score = scores.player2.score;
        
        let winnerMessage = '';
        if (p1Score > p2Score) {
            winnerMessage = `${scores.player1.id} WIN!`;
        } else if (p2Score > p1Score) {
            winnerMessage = `${scores.player2.id} WIN!`;
        } else {
            winnerMessage = 'DRAW!';
        }
        
        this.statusMessage.textContent = `試合終了！ ${winnerMessage}`;
        this.victoryMessage.textContent = winnerMessage;
        this.finalScoreP1Display.textContent = p1Score;
        this.finalScoreP2Display.textContent = p2Score;
        
        this.victoryScreen.classList.add('active');
        this.victoryScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        this.restartButton.focus();
    }


    // --- 入力/操作 ---
    handleKeyboardInput(event) {
        if (this.currentScreen !== 'game' || !this.gameRunning) return;

        let dx = 0, dy = 0;
        switch (event.code) {
            case 'KeyW': case 'ArrowUp':    dy = -this.MOVE_SPEED; break;
            case 'KeyS': case 'ArrowDown':  dy = this.MOVE_SPEED;  break;
            case 'KeyA': case 'ArrowLeft':  dx = -this.MOVE_SPEED; break;
            case 'KeyD': case 'ArrowRight': dx = this.MOVE_SPEED;  break;
            default: return;
        }
        event.preventDefault(); 
        
        const now = performance.now();
        if (now - this.lastMoveTime < this.moveDelay) return;
        this.lastMoveTime = now;

        this.requestMove(dx, dy);
    }
    
    requestMove(dx, dy) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN && this.playerId) {
            this.socket.send(JSON.stringify({
                type: 'MOVE',
                dx: dx,
                dy: dy
            }));
            // クライアント側では位置を更新せず、サーバーからの応答を待つ
        }
    }
    
    // --- ゲームパッド処理 (前回と同じロジックを使用) ---
    startGamepadPolling() {
        if (this.gamepadInterval) return;
        this.gamepadInterval = setInterval(() => {
            this.pollGamepads();
        }, 1000 / 60); 
    }

    updateGamepadStatus() {
        const gamepads = navigator.getGamepads();
        let connectedCount = 0;
        
        if (gamepads[0]) connectedCount++;
        if (gamepads[1]) connectedCount++; 

        document.getElementById('status-message').textContent = connectedCount > 0 ? 
            `${connectedCount}台のコントローラーが接続済み` : 
            'コントローラーを接続してください...';
        
        document.getElementById('status-message').style.color = connectedCount > 0 ? '#2ecc71' : '#e74c3c';
        
        if (connectedCount >= 2 && this.currentScreen === 'title') {
             // 接続状態をチェックしているstatus-messageを操作情報表示と統合したため、ここでは特別な処理は不要
        }
    }

    pollGamepads() {
        if (this.currentScreen !== 'game' || !this.gameRunning) return;

        const gamepads = navigator.getGamepads();
        const now = performance.now();

        // P1（Gamepad 0）の入力処理
        if (gamepads[0]) {
             this.handleGamepadInput(gamepads[0], now);
        }
        // P2（Gamepad 1）の入力処理 (現在は1人しか操作できないため省略。2人目の実装はサーバーのプレイヤーIDと紐付ける必要あり)
        // if (gamepads[1]) {
        //     this.handleGamepadInput(gamepads[1], now);
        // }
    }

    handleGamepadInput(gamepad, now) {
        if (!gamepad) return;
        if (now - this.lastMoveTime < this.moveDelay) return;
        
        const MOVE_SPEED = this.MOVE_SPEED;
        const moveThreshold = 0.3; // スティックの遊び

        let dx = 0, dy = 0;

        // 十字キー
        if (gamepad.buttons[12]?.pressed) dy = -MOVE_SPEED;
        else if (gamepad.buttons[13]?.pressed) dy = MOVE_SPEED;
        else if (gamepad.buttons[14]?.pressed) dx = -MOVE_SPEED;
        else if (gamepad.buttons[15]?.pressed) dx = MOVE_SPEED;
        
        // 左スティック
        const axisX = gamepad.axes[0] || 0;
        const axisY = gamepad.axes[1] || 0;

        if (dx === 0 && dy === 0) {
            if (Math.abs(axisX) > moveThreshold) dx = Math.round(axisX * MOVE_SPEED * 2); 
            if (Math.abs(axisY) > moveThreshold) dy = Math.round(axisY * MOVE_SPEED * 2);
        }

        if (dx !== 0 || dy !== 0) {
            this.lastMoveTime = now;
            this.requestMove(dx, dy);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.game = new OnlinePVPGame();
});