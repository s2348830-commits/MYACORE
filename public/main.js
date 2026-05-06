const socket = io();
let myId = null;
let playerData = null;
const otherPlayers = {}; 

let scene, camera, renderer;
let groundMesh;
let myPlayerGroup = null; 
let myTargetPosition = new THREE.Vector3(); 
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const textureLoader = new THREE.TextureLoader();
const shadowTexture = textureLoader.load('image/player/shadow.png');

const CAMERA_OFFSET = new THREE.Vector3(15, 20, 15);

// エフェクト管理用配列
const activeEffects = [];

document.getElementById('authorize-btn').addEventListener('click', () => {
    const username = document.getElementById('username-input').value || '匿名ユーザー';
    const mockDiscordId = 'discord_' + Math.floor(Math.random() * 1000000); 
    
    socket.emit('joinGame', { discordId: mockDiscordId, username: username });
    
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';
    
    initThreeJS();
});

function initThreeJS() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#202225'); 

    const aspect = window.innerWidth / window.innerHeight;
    const d = 10; 
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    
    camera.position.copy(CAMERA_OFFSET);
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshBasicMaterial({ color: '#2f3136', visible: false }); 
    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    scene.add(groundMesh);

    const gridHelper = new THREE.GridHelper(100, 50, '#5865F2', '#36393f');
    scene.add(gridHelper);

    window.addEventListener('resize', onWindowResize, false);
    container.addEventListener('pointerdown', onPointerDown, false);

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

function createPlayerMesh(imagePath) {
    const group = new THREE.Group();

    const playerTexture = textureLoader.load(imagePath);
    const spriteMaterial = new THREE.SpriteMaterial({ map: playerTexture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(3, 3, 1);
    sprite.position.y = 1.5; 
    group.add(sprite);

    const shadowGeo = new THREE.PlaneGeometry(2, 2);
    const shadowMat = new THREE.MeshBasicMaterial({ 
        map: shadowTexture, 
        transparent: true, 
        opacity: 0.5,
        depthWrite: false 
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01; 
    group.add(shadowMesh);

    return group;
}

// ==========================================
// エフェクト（絵文字）生成関数 (CanvasTexture使用)
// ==========================================
function createFloatingEffect(targetGroup, effectType) {
    let emoji = '💬';
    if (effectType === 'heart') emoji = '❤️';
    if (effectType === 'friend') emoji = '🤝';

    // Canvasでテキストを描画してテクスチャ化
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.font = "64px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(emoji, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    
    // キャラクターの少し上に配置
    sprite.position.y = 3.5;
    sprite.scale.set(1.5, 1.5, 1);
    
    targetGroup.add(sprite);

    // アニメーション用に配列に追加
    activeEffects.push({
        sprite: sprite,
        group: targetGroup,
        life: 1.0 // 1.0 から 0 に減らす
    });
}

function onPointerDown(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(groundMesh);

    if (intersects.length > 0) {
        const point = intersects[0].point;
        myTargetPosition.set(point.x, 0, point.z);
        socket.emit('playerMove', { position: { x: point.x, z: point.z } });
    }
}

function animate() {
    requestAnimationFrame(animate);

    if (myPlayerGroup) {
        myPlayerGroup.position.lerp(myTargetPosition, 0.1);
        const targetCameraPos = myPlayerGroup.position.clone().add(CAMERA_OFFSET);
        camera.position.lerp(targetCameraPos, 0.1);
    }

    for (let id in otherPlayers) {
        const other = otherPlayers[id];
        if (other.targetPosition) {
            other.group.position.lerp(other.targetPosition, 0.1);
        }
    }

    // エフェクトのアニメーション処理 (上に浮かびながらフェードアウト)
    for (let i = activeEffects.length - 1; i >= 0; i--) {
        const effect = activeEffects[i];
        effect.life -= 0.02; // 寿命を減らす
        effect.sprite.position.y += 0.02; // 上へ移動
        effect.sprite.material.opacity = effect.life; // 透明度を下げる

        if (effect.life <= 0) {
            effect.group.remove(effect.sprite);
            effect.sprite.material.dispose();
            effect.sprite.material.map.dispose();
            activeEffects.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

socket.on('initData', (data) => {
    playerData = data.player;
    myId = socket.id;

    document.getElementById('ui-wallet').innerText = playerData.economy.wallet;
    document.getElementById('ui-satisfaction').innerText = playerData.satisfaction;
    document.getElementById('ui-status').innerText = playerData.statusEffect;

    myPlayerGroup = createPlayerMesh(playerData.appearance);
    myPlayerGroup.position.set(playerData.lastPosition.x, 0, playerData.lastPosition.z);
    myTargetPosition.copy(myPlayerGroup.position);
    scene.add(myPlayerGroup);
});

socket.on('playerMoved', (data) => {
    if (!otherPlayers[data.id]) {
        const group = createPlayerMesh('image/player/id_1/base.png');
        group.position.set(data.position.x, 0, data.position.z);
        scene.add(group);
        
        otherPlayers[data.id] = {
            group: group,
            targetPosition: new THREE.Vector3(data.position.x, 0, data.position.z)
        };
    } else {
        otherPlayers[data.id].targetPosition.set(data.position.x, 0, data.position.z);
    }
});

// ==========================================
// サーバーからのエフェクト再生命令を受信
// ==========================================
socket.on('playEffect', (data) => {
    let targetGroup = null;
    if (data.targetId === myId) {
        targetGroup = myPlayerGroup;
    } else if (otherPlayers[data.targetId]) {
        targetGroup = otherPlayers[data.targetId].group;
    }

    if (targetGroup) {
        createFloatingEffect(targetGroup, data.effectType);
    }
});

socket.on('globalNews', (news) => {
    const ticker = document.getElementById('news-content');
    ticker.innerText = news.message;
    
    if (news.type === 'relationship') {
        ticker.style.color = '#F47FFF'; // 恋人・友達発展はピンク色
    } else if (news.type === 'disaster_fire' || news.type === 'incident') {
        ticker.style.color = '#ed4245'; 
    } else {
        ticker.style.color = '#fff';
    }
});

socket.on('playerLeft', (data) => {
    if (otherPlayers[data.id]) {
        scene.remove(otherPlayers[data.id].group);
        delete otherPlayers[data.id];
    }
});