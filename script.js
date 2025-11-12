// script.js
class OnlinePVPGame {
    constructor() {
        // --- 接続・状態管理 ---
        this.socket = null;
        this.playerId = null;
        this.isHost = false;
        this.currentScreen = 'title';

        // --- ゲーム定数 ---
        this.WIDTH = 800;
        this.HEIGHT = 600;
        this.PIXEL_SIZE = 20; // 塗りの粒度/ブラシサイズ
        this.MOVE_SPEED = 6;
        this.AVAILABLE_COLORS = [
            '#E74C3C', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6', '#1ABC9C', '#F39C12', '#2C3E50'
        ];
        
        // --- ゲームインスタンス変数 ---
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.gameRunning = false;
        this.gameTimer = 0;
        this.animationFrameId = null;

        // サーバーから受け取る状態
        this.players = {}; 
        this.playerUnits = {}; // DOMのユニット要素
        this.territoryMap = null; 

        // --- DOM要素 ---
        this.timerDisplay = document.getElementById('timer');
        this.statusMessage = document.getElementById('status-message');
        this.scoreGaugeContainer = document.getElementById('score-gauge-container');
        this.scoreBoardList = document.getElementById('score-board-list');
        this.victoryScreen = document.getElementById('clear-screen');
        this.victoryMessage = document.getElementById('victoryMessage');
        this.finalScoreList = document.getElementById('final-score-list');
        this.restartButton = document.getElementById('restartButton');
        this.startButton = document.getElementById('start-game-button');
        
        // --- 入力制御 ---
        this.lastMoveTime = 0;
        this.moveDelay = 15; 
        this.keyStates = { 'w': false, 'a': false, 's': false, 'd': false, 'up': false, 'down': false, 'left': false, 'right': false };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.showScreen('title');
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.WIDTH, this.HEIGHT);
        this.startGamepadPolling();
    }

    setupEventListeners() {
        // ... (接続/ロビー関連は前回と同じ) ...
        document.getElementById('create-room-button').addEventListener('click', () => this.showConnectionModal('host'));
        document.getElementById('join-room-button').addEventListener('click', () => this.showConnectionModal('guest'));
        document.getElementById('connect-submit').addEventListener('click', () => this.connectToServer());
        document.getElementById('connection-cancel').addEventListener('click', () => this.hideConnectionModal());
        document.getElementById('lobby-disconnect-button').addEventListener('click', () => this.disconnectServer());
        document.getElementById('start-game-button').addEventListener('click', () => this.sendStartGameRequest());
        this.restartButton.addEventListener('click', () => this.disconnectServer());
        document.getElementById('back-to-title').addEventListener('click', () => this.disconnectServer());

        // --- キーボード入力 (修正: KeyDown/KeyUpで状態管理し、requestAnimationFrameで送信) ---
        window.addEventListener('keydown', (e) => this.handleKeyChange(e.key, true));
        window.addEventListener('keyup', (e) => this.handleKeyChange(e.key, false));

        // --- ロビー色選択 ---
        document.getElementById('color-picker').addEventListener('click', (e) => {
            if (e.target.classList.contains('color-option')) {
                const color = e.target.dataset.color;
                this.selectColor(color);
            }
        });
    }

    // キーボードの状態を更新する
    handleKeyChange(key, isPressed) {
        key = key.toLowerCase();
        switch (key) {
            case 'w': case 'arrowup':    this.keyStates['w'] = isPressed; break;
            case 's': case 'arrowdown':  this.keyStates['s'] = isPressed; break;
            case 'a': case 'arrowleft':  this.keyStates['a'] = isPressed; break;
            case 'd': case 'arrowright': this.keyStates['d'] = isPressed; break;
        }
    }


    // --- 画面遷移/モーダル処理 (前回と同じ) ---
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
        
        if (screenName === 'game') {
            this.gameRunning = true;
            if (!this.animationFrameId) {
                 this.animationFrameId = requestAnimationFrame((timestamp) => this.gameLoop(timestamp));
            }
        } else {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        }
    }
    
    showConnectionModal(type) {
        // ... (前回と同じ) ...
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

    // --- 接続処理 (前回と同じ) ---
    connectToServer() {
        const address = document.getElementById('server-address').value.trim();
        const parts = address.split(':');
        let ip = parts[0];
        let port = parts.length === 2 ? parts[1] : (ip !== 'localhost' && ip !== '127.0.0.1' ? '443' : '80');
        
        const isSecureHost = ip !== 'localhost' && ip !== '127.0.0.1' && ip.includes('.');
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

    // --- サーバーメッセージ処理 (前回と同じ) ---
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
                this.initializeGameUnits();
                this.showScreen('game');
                break;

            case 'GAME_STATE_UPDATE':
                this.players = data.players;
                this.territoryMap = data.territoryMap;
                this.gameTimer = data.duration;
                break;
                
            case 'GAME_END':
                this.players = data.players;
                this.territoryMap = data.territoryMap;
                this.gameTimer = 0;
                this.endGame(data.winnerId);
                break;

            case 'ERROR':
                alert(`エラー: ${data.message}`);
                // エラー時はタイトルに戻る
                if (this.currentScreen !== 'title') {
                    this.disconnectServer();
                }
                break;
        }
    }
    
    // --- ロビー処理 (前回と同じだが色数を8色に) ---
    updateLobbyStatus(playersData) {
        const playerList = document.getElementById('lobby-player-list');
        const playerCount = Object.keys(playersData).length;
        
        this.updateColorPicker(playersData); // 色選択UIを更新

        playerList.innerHTML = `<h4>参加プレイヤー (${playerCount} / 8人):</h4>`;
        
        // スコア順にソートして表示
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
            this.socket.send(JSON.stringify({ type: 'SELECT_COLOR', color: color }));
        }
    }
    
    updateColorPicker(playersData) {
        const colorPicker = document.getElementById('color-picker');
        
        if (!this.colorPickerInitialized) {
            colorPicker.innerHTML = '';
            this.AVAILABLE_COLORS.forEach(color => {
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
        // 既存のユニットを削除
        Object.values(this.playerUnits).forEach(unit => unit.remove());
        this.playerUnits = {};
        
        const playerKeys = Object.keys(this.players); 
        const wrapper = document.querySelector('.game-board-wrapper');
        
        playerKeys.forEach((id) => {
            const player = this.players[id];
            
            let unitElement = document.createElement('div');
            unitElement.id = `unit-${id}`;
            unitElement.className = 'player-unit';
            wrapper.appendChild(unitElement);
            
            unitElement.style.display = 'block';
            unitElement.style.backgroundColor = player.color;
            unitElement.style.width = `${this.PIXEL_SIZE}px`;
            unitElement.style.height = `${this.PIXEL_SIZE}px`;
            
            // 自分のユニットに視覚的な印をつける
            unitElement.style.border = (id === this.playerId) ? '3px solid gold' : 'none'; 
            
            this.playerUnits[id] = unitElement;
        });
    }


    // --- メインゲームループ/描画 ---
    gameLoop(timestamp) {
        if (!this.gameRunning) return;
        
        this.handlePlayerInput(); // 入力状態をサーバーに送信
        this.drawGame();
        this.updateDOM();
        
        this.animationFrameId = requestAnimationFrame((ts) => this.gameLoop(ts));
    }

    drawGame() {
        if (!this.territoryMap) return;

        // 1. マップ（Canvas）の描画
        const cellCountX = this.WIDTH / this.PIXEL_SIZE;
        const cellCountY = this.HEIGHT / this.PIXEL_SIZE;

        for (let y = 0; y < cellCountY; y++) {
            for (let x = 0; x < cellCountX; x++) {
                const mapKey = `${x},${y}`;
                const color = this.territoryMap[mapKey];
                
                // 塗りつぶされていない部分は白で描画
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
        
        // --- スコア/ゲージ/ボード更新 ---
        this.updateScoreDisplay();
        
        // --- ステータスメッセージ ---
        this.statusMessage.textContent = this.gameRunning ? 
            `操作: WASD/GamePad | Your ID: ${this.playerId}` : 
            'ゲーム終了！';
    }
    
    updateScoreDisplay() {
        const activePlayers = Object.values(this.players);
        
        // スコアリストをスコア降順でソート
        activePlayers.sort((a, b) => b.score - a.score);
        
        // 1. スコアボード (リスト表示)
        this.scoreBoardList.innerHTML = '';
        activePlayers.forEach(p => {
            const item = document.createElement('p');
            item.className = 'player-score-item';
            item.style.color = p.color;
            item.textContent = `${p.id}: ${p.score}`;
            this.scoreBoardList.appendChild(item);
        });

        // 2. スコアゲージ (動的な多色表示)
        this.scoreGaugeContainer.innerHTML = '';
        let totalScore = activePlayers.reduce((sum, p) => sum + p.score, 0);
        let totalCells = (this.WIDTH / this.PIXEL_SIZE) * (this.HEIGHT / this.PIXEL_SIZE);
        
        // 未塗りつぶし領域のスコアを計算 (合計塗りつぶしセル数 / 全セル数)
        const totalPaintedCells = Object.keys(this.territoryMap || {}).length;
        const unpaintedScore = Math.max(0, totalCells - totalPaintedCells);

        // 塗りつぶされた領域がない場合、ゲージは表示しない (またはデフォルト表示)
        if (totalPaintedCells === 0) {
            this.scoreGaugeContainer.style.background = '#eee'; // 全体が未塗りつぶし
            return;
        }
        
        // ゲージセグメントの挿入 (スコアが高い順)
        activePlayers.forEach(p => {
            if (p.score > 0) {
                const widthPercent = (p.score / totalPaintedCells) * 100;
                const segment = document.createElement('div');
                segment.className = 'player-gauge-segment';
                segment.style.width = `${widthPercent}%`;
                segment.style.backgroundColor = p.color;
                this.scoreGaugeContainer.appendChild(segment);
            }
        });
    }

    endGame(winnerId) {
        this.gameRunning = false;
        
        // 最終スコアリストの作成
        this.finalScoreList.innerHTML = '';
        const finalPlayers = Object.values(this.players);
        finalPlayers.sort((a, b) => b.score - a.score); // スコア降順
        
        finalPlayers.forEach((p, index) => {
            const rank = index + 1;
            const item = document.createElement('p');
            item.style.color = p.color;
            item.style.fontWeight = 'bold';
            item.innerHTML = `**#${rank}** - ${p.id}: ${p.score}pt`;
            this.finalScoreList.appendChild(item);
        });
        
        let winnerMessage = '';
        if (winnerId === 'DRAW') {
            winnerMessage = 'DRAW!';
        } else {
            const winner = finalPlayers.find(p => p.id === winnerId);
            winnerMessage = `${winnerId} WIN!`;
            this.finalScoreList.querySelector('p').style.fontSize = '1.4em';
        }
        
        this.victoryMessage.textContent = winnerMessage;
        
        this.victoryScreen.classList.add('active');
        this.victoryScreen.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        this.restartButton.focus();
    }


    // --- 入力/操作 ---
    handlePlayerInput() {
        if (this.currentScreen !== 'game' || !this.gameRunning) return;
        
        const now = performance.now();
        if (now - this.lastMoveTime < this.moveDelay) return;
        this.lastMoveTime = now;
        
        let dx = 0, dy = 0;
        
        // 1. キーボード入力
        if (this.keyStates['w'] || this.keyStates['up']) dy = -this.MOVE_SPEED;
        if (this.keyStates['s'] || this.keyStates['down']) dy = this.MOVE_SPEED;
        if (this.keyStates['a'] || this.keyStates['left']) dx = -this.MOVE_SPEED;
        if (this.keyStates['d'] || this.keyStates['right']) dx = this.MOVE_SPEED;
        
        // 2. ゲームパッド入力
        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[0]; // 常に最初のゲームパッドを使用
        
        if (gamepad) {
            const moveThreshold = 0.3; 
            
            // スティック
            const axisX = gamepad.axes[0] || 0;
            const axisY = gamepad.axes[1] || 0;

            if (Math.abs(axisX) > moveThreshold) dx = Math.round(axisX * this.MOVE_SPEED * 2); 
            if (Math.abs(axisY) > moveThreshold) dy = Math.round(axisY * this.MOVE_SPEED * 2);

            // 十字キー (十字キーが押されている場合はスティックより優先)
            if (gamepad.buttons[12]?.pressed) dy = -this.MOVE_SPEED;
            else if (gamepad.buttons[13]?.pressed) dy = this.MOVE_SPEED;
            else if (gamepad.buttons[14]?.pressed) dx = -this.MOVE_SPEED;
            else if (gamepad.buttons[15]?.pressed) dx = this.MOVE_SPEED;
        }

        if (dx !== 0 || dy !== 0) {
            this.requestMove(dx, dy);
        }
    }
    
    requestMove(dx, dy) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN && this.playerId) {
            this.socket.send(JSON.stringify({
                type: 'MOVE',
                dx: dx,
                dy: dy
            }));
        }
    }
    
    // --- ゲームパッドポーリング (前回と同じ) ---
    startGamepadPolling() {
        // requestAnimationFrame内でゲームパッド入力を処理するため、ポーリングは不要
        // gamepadconnected/disconnectedイベントの処理のみ残す
        window.addEventListener("gamepadconnected", () => this.updateGamepadStatus());
        window.addEventListener("gamepaddisconnected", () => this.updateGamepadStatus());
        this.updateGamepadStatus();
    }

    updateGamepadStatus() {
        // ステータス表示はシンプルにする
        const gamepads = navigator.getGamepads();
        let connectedCount = 0;
        for (const gp of gamepads) {
            if (gp) connectedCount++;
        }
        
        document.getElementById('status-message').style.color = connectedCount > 0 ? '#2ecc71' : '#f1c40f';
        document.getElementById('status-message').textContent = connectedCount > 0 ? 
            `WASD/ゲームパッド (${connectedCount}台) で操作 | Your ID: ${this.playerId}` : 
            'WASDまたはゲームパッドを接続してください';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.game = new OnlinePVPGame();
});