// ==========================================
// 初期設定とグローバル変数
// ==========================================
const socket = io();
let myId = null;
let playerData = null;
const otherPlayers = {}; // 他のプレイヤーの3Dオブジェクトを管理

// Three.js関連
let scene, camera, renderer;
let groundMesh;
let myPlayerGroup = null; // 自分のキャラクター（スプライト＋影）
let myTargetPosition = new THREE.Vector3(); // Raycasterでクリックした目標座標
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// 画像テクスチャのロード
const textureLoader = new THREE.TextureLoader();
const shadowTexture = textureLoader.load('image/player/shadow.png');

// カメラのオフセット（クォータービュー用）
const CAMERA_OFFSET = new THREE.Vector3(15, 20, 15);

// ==========================================
// ログイン処理
// ==========================================
document.getElementById('authorize-btn').addEventListener('click', () => {
    const username = document.getElementById('username-input').value || '匿名ユーザー';
    // ※Discord連携までは、ランダムなIDを擬似DiscordIDとして使用
    const mockDiscordId = 'discord_' + Math.floor(Math.random() * 1000000); 
    
    socket.emit('joinGame', { discordId: mockDiscordId, username: username });
    
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';
    
    initThreeJS();
});

// ==========================================
// Three.js 初期化 (クォータービュー)
// ==========================================
function initThreeJS() {
    const container = document.getElementById('canvas-container');
    
    // シーン
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#202225'); // Discord風のダークな背景

    // カメラ (クォータービュー/固定斜め上俯瞰)
    // OrthographicCameraを使用するとパース（遠近感）が消え、完全な2Dアイソメトリックになります
    const aspect = window.innerWidth / window.innerHeight;
    const d = 10; // 描画範囲のスケール
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    
    // カメラの初期位置と角度
    camera.position.copy(CAMERA_OFFSET);
    camera.lookAt(scene.position);

    // レンダラー
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // 光源
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    // 地面 (Raycasterの判定用)
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshBasicMaterial({ color: '#2f3136', visible: false }); // 見えない判定用の床
    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    scene.add(groundMesh);

    // 地面のグリッド（視覚的な補助）
    const gridHelper = new THREE.GridHelper(100, 50, '#5865F2', '#36393f');
    scene.add(gridHelper);

    // リサイズ対応
    window.addEventListener('resize', onWindowResize, false);
    
    // マウスクリック（タップ）イベントによる移動指示
    container.addEventListener('pointerdown', onPointerDown, false);

    // アニメーションループ開始
    animate();
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const d = 10;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================
// キャラクター作成・描画ロジック (2Dビルボード＋影)
// ==========================================
function createPlayerMesh(imagePath) {
    const group = new THREE.Group();

    // 1. キャラクターのビルボード (Sprite)
    // Spriteは常にカメラの方を向くため、Y軸固定の2D表現に最適です
    const playerTexture = textureLoader.load(imagePath);
    const spriteMaterial = new THREE.SpriteMaterial({ map: playerTexture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(3, 3, 1);
    sprite.position.y = 1.5; // 地面から少し浮かす（足元を基準にするため）
    group.add(sprite);

    // 2. 足元の透過の丸い影
    const shadowGeo = new THREE.PlaneGeometry(2, 2);
    const shadowMat = new THREE.MeshBasicMaterial({ 
        map: shadowTexture, 
        transparent: true, 
        opacity: 0.5,
        depthWrite: false 
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01; // Zファイティング（地面とのちらつき）防止
    group.add(shadowMesh);

    return group;
}

// ==========================================
// 移動処理 (Raycaster & Lerp)
// ==========================================
function onPointerDown(event) {
    // クリックした画面座標を -1 から 1 の範囲に変換
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Raycasterで地面(groundMesh)との交差判定
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(groundMesh);

    if (intersects.length > 0) {
        // 交差したポイント（地面の座標）を目標地点に設定
        const point = intersects[0].point;
        myTargetPosition.set(point.x, 0, point.z);
        
        // サーバーへ移動を通知
        socket.emit('playerMove', { position: { x: point.x, z: point.z } });
    }
}

// ==========================================
// アニメーションループ (毎フレーム実行)
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    if (myPlayerGroup) {
        // 自分のキャラクターを目標座標へスムーズに移動 (Lerp補間)
        myPlayerGroup.position.lerp(myTargetPosition, 0.1);

        // カメラを自分のキャラクターにスムーズに追従させる
        const targetCameraPos = myPlayerGroup.position.clone().add(CAMERA_OFFSET);
        camera.position.lerp(targetCameraPos, 0.1);
    }

    // 他のプレイヤーもサーバーからの目標座標に向けてLerp補間
    for (let id in otherPlayers) {
        const other = otherPlayers[id];
        if (other.targetPosition) {
            other.group.position.lerp(other.targetPosition, 0.1);
        }
    }

    renderer.render(scene, camera);
}

// ==========================================
// Socket.io 通信制御
// ==========================================

// ログイン完了＆初期データ受信
socket.on('initData', (data) => {
    playerData = data.player;
    myId = socket.id;

    // UIの更新
    document.getElementById('ui-wallet').innerText = playerData.economy.wallet;
    document.getElementById('ui-satisfaction').innerText = playerData.satisfaction;
    document.getElementById('ui-status').innerText = playerData.statusEffect;

    // 自分のキャラクターを生成
    myPlayerGroup = createPlayerMesh(playerData.appearance);
    
    // 前回ログアウト時の位置に復帰
    myPlayerGroup.position.set(playerData.lastPosition.x, 0, playerData.lastPosition.z);
    myTargetPosition.copy(myPlayerGroup.position);
    scene.add(myPlayerGroup);
});

// 他のプレイヤーが移動した
socket.on('playerMoved', (data) => {
    // まだ描画されていないプレイヤーなら生成する
    if (!otherPlayers[data.id]) {
        // ※今回は一旦全員同じ基本画像を使用
        const group = createPlayerMesh('image/player/id_1/base.png');
        group.position.set(data.position.x, 0, data.position.z);
        scene.add(group);
        
        otherPlayers[data.id] = {
            group: group,
            targetPosition: new THREE.Vector3(data.position.x, 0, data.position.z)
        };
    } else {
        // 既存プレイヤーなら目標座標を更新（animate関数で自動的にLerp移動する）
        otherPlayers[data.id].targetPosition.set(data.position.x, 0, data.position.z);
    }
});

// ニュースの受信 (第2段階のサーバー通知をここでキャッチ)
socket.on('globalNews', (news) => {
    const ticker = document.getElementById('news-content');
    ticker.innerText = news.message;
    
    // ニュースの色を変える（火事は赤など）
    if (news.type === 'disaster_fire' || news.type === 'incident') {
        ticker.style.color = '#ed4245'; // Discordの赤色
    } else {
        ticker.style.color = '#fff';
    }
});

// プレイヤーが切断した
socket.on('playerLeft', (data) => {
    if (otherPlayers[data.id]) {
        scene.remove(otherPlayers[data.id].group);
        delete otherPlayers[data.id];
    }
});