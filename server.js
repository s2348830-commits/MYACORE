require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS設定（クライアントのURLが決まれば制限します）
app.use(cors({ origin: '*' }));
app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// ==========================================
// Render Sleep回避用エンドポイント (cron-job用)
// ==========================================
app.get('/keepalive', (req, res) => {
    const time = new Date().toISOString();
    console.log(`[KeepAlive] Ping received at ${time}`);
    res.status(200).json({ status: 'active', timestamp: time });
});

// ==========================================
// データベース接続 (MongoDB)
// ==========================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tomodachi-web';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// ==========================================
// Socket.io リアルタイム通信基盤
// ==========================================
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // 第4段階で実装: プレイヤーの移動、接触判定、イベント発火
    socket.on('playerMove', (data) => {
        // 全クライアントへ座標をブロードキャスト（Lerp補間用）
        socket.broadcast.emit('playerMoved', { id: socket.id, position: data.position });
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        io.emit('playerLeft', { id: socket.id });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});