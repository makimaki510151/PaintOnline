// server.js (8人・ロビー対応版)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// GitHub Pagesなど、異なるドメインからの接続を許可するためにCORSを設定
const io = new Server(server, {
    cors: {
        origin: "*", // すべてのオリジンからの接続を許可
        methods: ["GET", "POST"]
    }
});

const PORT = 8000;

// クライアントに静的ファイル（index.html, script.js, style.css）を提供
// 参加者がサーバーのURLにアクセスしたときにコンテンツを提供するために使用
app.use(express.static(path.join(__dirname)));

// --- ゲーム設定 ---
const WIDTH = 800;
const HEIGHT = 600;
const PIXEL_SIZE = 20;
const GAME_DURATION = 60000; 
const MAX_PLAYERS = 8;
const PLAYER_COLORS = [
    '#e74c3c', // 1: 赤
    '#3498db', // 2: 青
    '#2ecc71', // 3: 緑
    '#f1c40f', // 4: 黄
    '#9b59b6', // 5: 紫
    '#e67e22', // 6: オレンジ
    '#1abc9c', // 7: ターコイズ
    '#95a5a6'  // 8: 灰色
];
const INITIAL_POSITIONS = [ // 8人の初期位置
    { x: WIDTH * 0.2, y: HEIGHT * 0.2 },
    { x: WIDTH * 0.8, y: HEIGHT * 0.2 },
    { x: WIDTH * 0.2, y: HEIGHT * 0.8 },
    { x: WIDTH * 0.8, y: HEIGHT * 0.8 },
    { x: WIDTH * 0.5, y: HEIGHT * 0.1 },
    { x: WIDTH * 0.5, y: HEIGHT * 0.9 },
    { x: WIDTH * 0.1, y: HEIGHT * 0.5 },
    { x: WIDTH * 0.9, y: HEIGHT * 0.5 }
];

// --- サーバー側のゲーム状態 ---
let players = {}; // { socketId: { id, x, y, color, mapValue, score, isHost, socketId } }
let gameMap = [];
let gameRunning = false;
let gameStartTime = 0;
let hostId = null; 
let timerInterval = null;

function initializeMap() {
    const rows = HEIGHT / PIXEL_SIZE;
    const cols = WIDTH / PIXEL_SIZE;
    gameMap = [];
    for (let i = 0; i < rows; i++) {
        gameMap[i] = new Array(cols).fill(0);
    }
}

function startGame() {
    const activePlayers = Object.values(players);
    if (gameRunning || activePlayers.length < 1) return;

    initializeMap();
    gameRunning = true;
    gameStartTime = Date.now();
    
    // プレイヤーに初期位置とマップの値を割り当て
    activePlayers.forEach((player, index) => {
        const pos = INITIAL_POSITIONS[index % INITIAL_POSITIONS.length];
        player.x = pos.x;
        player.y = pos.y;
        player.mapValue = index + 1; // 1から始まるマップ値
        player.score = 0;
    });

    // ゲーム開始を全クライアントに通知
    io.emit('gameStart', { 
        players: activePlayers,
        mapData: gameMap, 
        startTime: gameStartTime
    });
    console.log('Game Started!');
    
    // タイマー
    timerInterval = setInterval(() => {
        const elapsedTime = Date.now() - gameStartTime;
        const remainingTime = Math.max(0, GAME_DURATION - elapsedTime);
        
        io.emit('timerUpdate', remainingTime);

        if (remainingTime <= 0) {
            clearInterval(timerInterval);
            endGame();
        }
    }, 1000);
}

function endGame() {
    gameRunning = false;
    clearInterval(timerInterval);
    
    const finalScores = calculateScore();
    
    io.emit('gameEnd', { finalScores });
    console.log('Game Ended.');
}

function calculateScore() {
    const scores = {}; // { mapValue: score }
    const activeMapValues = Object.values(players).map(p => p.mapValue);
    
    activeMapValues.forEach(value => {
        scores[value] = 0;
    });

    gameMap.forEach(row => {
        row.forEach(value => {
            if (value > 0 && scores[value] !== undefined) {
                scores[value]++;
            }
        });
    });

    // プレイヤーオブジェクトにスコアを反映
    Object.values(players).forEach(player => {
        player.score = scores[player.mapValue] || 0;
    });
    
    return scores;
}

function updatePlayerList() {
    const playerList = Object.values(players).map(p => ({
        id: p.id,
        color: p.color,
        isHost: p.isHost,
        mapValue: p.mapValue,
        socketId: p.socketId
    }));
    io.emit('playerListUpdate', { 
        players: playerList, 
        hostId: hostId,
        availableColors: getAvailableColors()
    });
}

function getAvailableColors() {
    const takenColors = Object.values(players).map(p => p.color);
    // PLAYER_COLORSのうち、takenColorsに含まれていない色
    return PLAYER_COLORS.filter(color => !takenColors.includes(color));
}

// 接続処理
io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);
    
    if (Object.keys(players).length >= MAX_PLAYERS) {
        socket.emit('serverFull', '満室です。');
        socket.disconnect(true);
        return;
    }

    // 最初の接続者がホストになる
    const isHost = Object.keys(players).length === 0;
    if (isHost) {
        hostId = socket.id;
    }

    // 利用可能な最初の色を割り当て
    const availableColor = getAvailableColors()[0] || PLAYER_COLORS[0];
    
    const newPlayer = {
        id: Object.keys(players).length + 1, // 暫定ID (P1, P2, ...)
        x: 0, 
        y: 0,
        color: availableColor, // ロビーでの初期色
        mapValue: 0, // ゲーム開始時に割り当て
        score: 0,
        isHost: isHost,
        socketId: socket.id
    };
    players[socket.id] = newPlayer;

    socket.emit('playerAssigned', newPlayer);
    updatePlayerList();
    
    // ロビーでの色選択
    socket.on('selectColor', (selectedColor) => {
        if (gameRunning) return;

        const available = getAvailableColors();
        const currentPlayer = players[socket.id];

        // 選択された色が現在利用可能か
        if (available.includes(selectedColor)) {
            // 現在の色を解放する
            currentPlayer.color = selectedColor;
            
            updatePlayerList();
        } else if (currentPlayer.color === selectedColor) {
            // 既に選択している色を再度選択した場合は何もしない
            return;
        } else {
            // 既に使われている色
            socket.emit('colorSelectionFailed', 'その色は既に他のプレイヤーに使用されています。');
        }
    });

    // クライアントからの移動情報を受信
    socket.on('playerMove', (data) => {
        if (!gameRunning) return;

        const player = players[socket.id];
        if (!player) return;

        // サーバー側で座標を更新
        player.x = Math.max(0, Math.min(WIDTH, data.x));
        player.y = Math.max(0, Math.min(HEIGHT, data.y));
        
        // サーバー側でマップを更新 (塗りつぶし)
        const mapX = Math.floor(player.x / PIXEL_SIZE);
        const mapY = Math.floor(player.y / PIXEL_SIZE);
        
        let mapUpdate = null;
        if (mapY >= 0 && mapY < gameMap.length && mapX >= 0 && mapX < gameMap[0].length) {
            const oldValue = gameMap[mapY][mapX];
            if (oldValue !== player.mapValue) {
                gameMap[mapY][mapX] = player.mapValue; 
                mapUpdate = { mapY, mapX, value: player.mapValue, color: player.color };
            }
        }
        
        // 全員に新しい状態をブロードキャスト
        io.emit('gameStateUpdate', { 
            players: players, 
            mapUpdate: mapUpdate 
        });

        // スコア計算とブロードキャスト
        const scores = calculateScore();
        io.emit('scoreUpdate', scores);
    });

    // ゲーム開始要求
    socket.on('requestStartGame', () => {
        if (socket.id === hostId) {
            startGame();
        }
    });

    // 切断処理
    socket.on('disconnect', () => {
        console.log('User disconnected: ' + socket.id);
        delete players[socket.id];
        
        // ホストが切断した場合、次の接続者をホストに設定
        if (socket.id === hostId) {
            const playerIds = Object.keys(players);
            hostId = playerIds[0] || null;
            if (hostId) {
                players[hostId].isHost = true;
                // 新しいホストにホスト権限を通知
                io.to(hostId).emit('isHost', true);
            }
        }

        if (gameRunning) {
            clearInterval(timerInterval);
            gameRunning = false;
            io.emit('gameAborted', 'プレイヤーが切断したため、ゲームは中断されました。');
        }
        
        updatePlayerList();
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`【重要】参加者には、このサーバーの公開URL（例: ngrok-url.app:8000 など）を伝えてください。`);
});