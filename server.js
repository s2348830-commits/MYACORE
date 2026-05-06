require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const Player = require('./models/Player');
const Island = require('./models/Island');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public')); // 第3段階で追加したクライアント配信

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// オンラインプレイヤーの管理 (座標も保持するように拡張)
const connectedPlayers = new Map(); // socket.id -> { discordId, username, position: {x, z} }
// 接触イベントのクールダウン管理 (discordId1_discordId2 -> 最終接触時刻)
const interactionCooldowns = new Map();

app.get('/keepalive', (req, res) => {
    const time = new Date().toISOString();
    console.log(`[KeepAlive] Ping at ${time}`);
    res.status(200).json({ status: 'active', timestamp: time });
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tomodachi-web';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// ==========================================
// 接触判定ロジック (距離計算とイベント発火)
// ==========================================
async function checkProximity(triggerSocketId) {
    const triggerPlayer = connectedPlayers.get(triggerSocketId);
    if (!triggerPlayer || !triggerPlayer.position) return;

    const INTERACTION_DISTANCE = 3.0; // 接触とみなす距離

    for (const [otherSocketId, otherPlayer] of connectedPlayers.entries()) {
        if (triggerSocketId === otherSocketId || !otherPlayer.position) continue;

        const dx = triggerPlayer.position.x - otherPlayer.position.x;
        const dz = triggerPlayer.position.z - otherPlayer.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < INTERACTION_DISTANCE) {
            // IDをソートしてペアの一意なキーを作成
            const pairKey = [triggerPlayer.discordId, otherPlayer.discordId].sort().join('_');
            const now = Date.now();
            const lastInteraction = interactionCooldowns.get(pairKey) || 0;

            // 60秒に1回だけイベント判定を行う (連発防止)
            if (now - lastInteraction > 60000) {
                interactionCooldowns.set(pairKey, now);
                await processInteraction(triggerSocketId, triggerPlayer, otherSocketId, otherPlayer);
            }
        }
    }
}

async function processInteraction(socketId1, p1Data, socketId2, p2Data) {
    try {
        const p1 = await Player.findOne({ discordId: p1Data.discordId });
        const p2 = await Player.findOne({ discordId: p2Data.discordId });
        if (!p1 || !p2) return;

        // p1から見たp2の関係性を探す
        let rel1 = p1.relationships.find(r => r.targetDiscordId === p2Data.discordId);
        if (!rel1) {
            rel1 = { targetDiscordId: p2Data.discordId, relationType: 'stranger', intimacy: 0 };
            p1.relationships.push(rel1);
        }

        // 確率で親密度アップ＆関係性発展
        if (Math.random() < 0.7) { // 70%の確率でイベント発生
            rel1.intimacy += 10;
            p1.satisfaction = Math.min(100, p1.satisfaction + 5); // 満足度も少し上がる

            let effectType = 'chat'; // デフォルトは💬
            let newsMsg = null;

            if (rel1.intimacy >= 100 && rel1.relationType !== 'lover') {
                rel1.relationType = 'lover';
                effectType = 'heart'; // ❤️
                newsMsg = `💕 【ニュース】${p1.username}さんと${p2.username}さんが恋人に発展しました！`;
            } else if (rel1.intimacy >= 50 && rel1.relationType === 'stranger') {
                rel1.relationType = 'friend';
                effectType = 'friend'; // 🤝
                newsMsg = `🤝 【ニュース】${p1.username}さんと${p2.username}さんが友達になりました！`;
            }

            await p1.save();

            // クライアントへエフェクト表示の命令を送信
            io.emit('playEffect', { targetId: socketId1, effectType: effectType });
            io.emit('playEffect', { targetId: socketId2, effectType: effectType });

            // 重大な関係性変化があったらニュース配信
            if (newsMsg) {
                io.emit('globalNews', { type: 'relationship', message: newsMsg });
            }
        }
    } catch (err) {
        console.error("Interaction Error:", err);
    }
}

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('joinGame', async ({ discordId, username }) => {
        let player = await Player.findOne({ discordId });
        if (!player) {
            player = new Player({ discordId, username });
            await player.save();
        }
        
        let island = await Island.findOne({ islandName: 'Tomodachi Island' });
        if (!island) {
            island = new Island();
            await island.save();
        }

        // 初期座標をセット
        connectedPlayers.set(socket.id, { 
            discordId, 
            username, 
            position: { x: player.lastPosition.x, z: player.lastPosition.z } 
        });

        socket.emit('initData', { player, island });
        io.emit('globalNews', { type: 'login', message: `${username}さんが島にやってきました！` });
    });

    socket.on('playerMove', (data) => {
        const playerInfo = connectedPlayers.get(socket.id);
        if (playerInfo) {
            playerInfo.position = data.position; // サーバー側の座標を更新
        }
        
        socket.broadcast.emit('playerMoved', { id: socket.id, position: data.position });
        
        // 移動するたびに周囲のプレイヤーとの接触を判定
        checkProximity(socket.id);
    });

    socket.on('disconnect', async () => {
        const playerInfo = connectedPlayers.get(socket.id);
        if (playerInfo) {
            // ログアウト時に最終座標をDBに保存
            await Player.updateOne(
                { discordId: playerInfo.discordId },
                { $set: { "lastPosition.x": playerInfo.position.x, "lastPosition.z": playerInfo.position.z } }
            );
        }
        connectedPlayers.delete(socket.id);
        io.emit('playerLeft', { id: socket.id });
    });
});

// 第2段階のリスク判定エンジン (変更なし・省略せず記載)
async function gameLoop() {
    try {
        const island = await Island.findOne({ islandName: 'Tomodachi Island' });
        if (!island) return;

        const { policeStation, hospital, fireStation } = island.facilities;
        const onlineDiscordIds = Array.from(connectedPlayers.values()).map(p => p.discordId);
        
        const players = await Player.find({ discordId: { $in: onlineDiscordIds } });
        if (players.length === 0) return;

        const fireChance = Math.max(0.001, 0.02 - (fireStation.level * 0.005));
        if (Math.random() < fireChance) {
            io.emit('globalNews', { type: 'disaster_fire', message: '⚠️【速報】島で大火事が発生しました！' });
            for (let p of players) {
                if (fireStation.level === 0) {
                    const damage = Math.floor(Math.random() * 500);
                    p.economy.wallet = Math.max(0, p.economy.wallet - damage);
                    p.satisfaction = Math.max(0, p.satisfaction - 30);
                } else {
                    p.satisfaction = Math.max(0, p.satisfaction - 10);
                }
                await p.save();
            }
            return;
        }

        for (let p of players) {
            let newsMessage = null;

            if (p.satisfaction < 20 && p.statusEffect === 'normal') {
                if (Math.random() < 0.2) {
                    p.statusEffect = 'depressed';
                    newsMessage = `🌧️ ${p.username}さんが鬱状態になってしまったようです...`;
                }
            }

            if (p.economy.wallet >= 1000) {
                const theftChance = Math.max(0.01, 0.10 - (policeStation.level * 0.02));
                if (Math.random() < theftChance) {
                    const stolenAmount = Math.floor(p.economy.wallet * 0.3);
                    p.economy.wallet -= stolenAmount;
                    p.satisfaction = Math.max(0, p.satisfaction - 20);
                    newsMessage = `🦹 【事件】${p.username}さんがスリに遭い、財布の中身を奪われました！`;
                }
            }

            if (p.statusEffect !== 'sick') {
                const sickChance = Math.max(0.005, 0.05 - (hospital.level * 0.01));
                if (Math.random() < sickChance) {
                    p.statusEffect = 'sick';
                    p.satisfaction = Math.max(0, p.satisfaction - 40);
                    
                    if (hospital.level === 0) {
                        p.economy.wallet = Math.max(0, p.economy.wallet - 800);
                        newsMessage = `🦠 【感染】${p.username}さんが不明の病原菌に感染。高額な治療費がかかりました...`;
                    } else {
                        newsMessage = `🏥 【感染】${p.username}さんが病原菌に感染しましたが、病院のおかげで治療費は免除されました。`;
                    }
                }
            }

            await p.save();

            if (newsMessage) {
                io.emit('globalNews', { type: 'incident', message: newsMessage });
            }
        }
    } catch (error) {
        console.error("Game Loop Error:", error);
    }
}

setInterval(gameLoop, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});