require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

// モデルのインポート (第1段階で作成したファイル)
const Player = require('./models/Player');
const Island = require('./models/Island');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// オンラインプレイヤーの管理 (socket.id -> discordId)
const connectedPlayers = new Map();

// ==========================================
// 1. Render Sleep回避用エンドポイント
// ==========================================
app.get('/keepalive', (req, res) => {
    const time = new Date().toISOString();
    console.log(`[KeepAlive] Ping at ${time}`);
    res.status(200).json({ status: 'active', timestamp: time });
});

// ==========================================
// 2. データベース接続
// ==========================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tomodachi-web';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// ==========================================
// 3. Socket.io 通信とプレイヤー管理
// ==========================================
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // クライアントからのログイン・認証（仮実装）
    socket.on('joinGame', async ({ discordId, username }) => {
        connectedPlayers.set(socket.id, discordId);
        
        let player = await Player.findOne({ discordId });
        if (!player) {
            player = new Player({ discordId, username });
            await player.save();
        }
        
        // 島データ初期化チェック
        let island = await Island.findOne({ islandName: 'Tomodachi Island' });
        if (!island) {
            island = new Island();
            await island.save();
        }

        socket.emit('initData', { player, island });
        io.emit('globalNews', { type: 'login', message: `${username}さんが島にやってきました！` });
    });

    socket.on('playerMove', (data) => {
        socket.broadcast.emit('playerMoved', { id: socket.id, position: data.position });
    });

    socket.on('disconnect', () => {
        connectedPlayers.delete(socket.id);
        io.emit('playerLeft', { id: socket.id });
    });
});

// ==========================================
// 4. リスク判定エンジン (ゲームループ)
// ==========================================
async function gameLoop() {
    try {
        // 島データを取得
        const island = await Island.findOne({ islandName: 'Tomodachi Island' });
        if (!island) return;

        const { policeStation, hospital, fireStation } = island.facilities;
        const onlineDiscordIds = Array.from(connectedPlayers.values());
        
        // 現在オンラインのプレイヤーデータを取得
        const players = await Player.find({ discordId: { $in: onlineDiscordIds } });
        if (players.length === 0) return; // 誰もいなければスキップ

        // --- A. 特大イベント: 大火事判定 (島全体) ---
        // 発生確率: 2% - (消防署レベル × 0.5%)。最低でも0.1%の確率は残る
        const fireChance = Math.max(0.001, 0.02 - (fireStation.level * 0.005));
        if (Math.random() < fireChance) {
            io.emit('globalNews', { type: 'disaster_fire', message: '⚠️【速報】島で大火事が発生しました！' });
            
            for (let p of players) {
                if (fireStation.level === 0) {
                    // 消防署がない場合、財布からランダムで修繕費が引かれ、満足度が大幅低下
                    const damage = Math.floor(Math.random() * 500);
                    p.economy.wallet = Math.max(0, p.economy.wallet - damage);
                    p.satisfaction = Math.max(0, p.satisfaction - 30);
                } else {
                    // 消防署があれば被害免除、ただし満足度は少し下がる
                    p.satisfaction = Math.max(0, p.satisfaction - 10);
                }
                await p.save();
            }
            return; // 大火事のターンは個別のイベント判定をスキップ
        }

        // --- B. 個人イベント (盗難・病原菌・鬱リスク) ---
        for (let p of players) {
            let newsMessage = null;

            // ① 鬱状態リスク判定 (満足度が20未満で発生)
            if (p.satisfaction < 20 && p.statusEffect === 'normal') {
                if (Math.random() < 0.2) { // 20%の確率で発症
                    p.statusEffect = 'depressed';
                    newsMessage = `🌧️ ${p.username}さんが鬱状態になってしまったようです...`;
                }
            }

            // ② 盗難リスク判定 (財布に1000以上ある場合)
            if (p.economy.wallet >= 1000) {
                // 発生確率: 10% - (警察署レベル × 2%)
                const theftChance = Math.max(0.01, 0.10 - (policeStation.level * 0.02));
                if (Math.random() < theftChance) {
                    const stolenAmount = Math.floor(p.economy.wallet * 0.3); // 所持金の30%を盗まれる
                    p.economy.wallet -= stolenAmount;
                    p.satisfaction = Math.max(0, p.satisfaction - 20);
                    newsMessage = `🦹 【事件】${p.username}さんがスリに遭い、財布の中身を奪われました！`;
                }
            }

            // ③ 不明の病原菌感染リスク
            if (p.statusEffect !== 'sick') {
                // 発生確率: 5% - (病院レベル × 1%)
                const sickChance = Math.max(0.005, 0.05 - (hospital.level * 0.01));
                if (Math.random() < sickChance) {
                    p.statusEffect = 'sick';
                    p.satisfaction = Math.max(0, p.satisfaction - 40);
                    
                    if (hospital.level === 0) {
                        // 病院がない場合、高額な治療費が財布から引かれる
                        p.economy.wallet = Math.max(0, p.economy.wallet - 800);
                        newsMessage = `🦠 【感染】${p.username}さんが不明の病原菌に感染。高額な治療費がかかりました...`;
                    } else {
                        // 病院がある場合は治療費免除
                        newsMessage = `🏥 【感染】${p.username}さんが病原菌に感染しましたが、病院のおかげで治療費は免除されました。`;
                    }
                }
            }

            // データの保存
            await p.save();

            // イベントが発生した場合、全ユーザーの画面にニュースをリアルタイム通知
            if (newsMessage) {
                io.emit('globalNews', { type: 'incident', message: newsMessage });
            }
        }

    } catch (error) {
        console.error("Game Loop Execution Error:", error);
    }
}

// テストプレイ用に「15秒に1回」の頻度でリスク判定を実行します。
// ※本番環境では 60000(1分) ～ 300000(5分) などに調整してください。
setInterval(gameLoop, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});