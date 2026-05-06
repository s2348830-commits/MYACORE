const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true }, // Discord連携のキー
    username: { type: String, required: true },
    
    // キャラクタービジュアル・設定
    appearance: { type: String, default: 'image/player/id_1/base.png' },
    personality: { type: String, enum: ['introvert', 'extrovert', 'cool', 'natural'], default: 'natural' },
    phrase: { type: String, default: 'よろしくね' },
    favoriteFood: { type: String, default: 'apple' },
    dislikedFood: { type: String, default: 'green_pepper' },
    
    // 感情・状態
    satisfaction: { type: Number, default: 50, min: 0, max: 100 }, // 0で鬱状態リスク
    statusEffect: { type: String, enum: ['normal', 'depressed', 'sick'], default: 'normal' },
    
    // 三層経済のうち「個人の財布」と「銀行」
    economy: {
        wallet: { type: Number, default: 1000 }, // 盗難リスクあり
        bank: { type: Number, default: 0 }       // 安全
    },
    
    // 人間関係（接触イベントで変動）
    relationships: [{
        targetDiscordId: String,
        relationType: { type: String, enum: ['stranger', 'acquaintance', 'friend', 'lover'], default: 'stranger' },
        intimacy: { type: Number, default: 0 } // 親密度
    }],
    
    // 3D空間の現在座標（再ログイン時の復帰用）
    lastPosition: {
        x: { type: Number, default: 0 },
        z: { type: Number, default: 0 } // Y軸は固定のためXZのみ保持
    }
});

module.exports = mongoose.model('Player', playerSchema);