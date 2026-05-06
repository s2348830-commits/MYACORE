const mongoose = require('mongoose');

const islandSchema = new mongoose.Schema({
    islandName: { type: String, default: 'Tomodachi Island' },
    
    // 三層経済のうち「島の貯金（共有財産）」
    islandFund: { type: Number, default: 0 },
    
    // 施設レベル（リスク発生確率の軽減に使用）
    facilities: {
        policeStation: { level: { type: Number, default: 0 } }, // 盗難発生率低下
        hospital:      { level: { type: Number, default: 0 } }, // 感染症発生率低下・治療費免除
        fireStation:   { level: { type: Number, default: 0 } }  // 大火事発生率低下・被害免除
    },
    
    // 発生中のグローバルイベント
    activeEvents: [{
        eventType: String, // 'festival', 'market', etc.
        expiresAt: Date
    }]
});

module.exports = mongoose.model('Island', islandSchema);