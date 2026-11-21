import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';

window.THREE = THREE;
window.GLTFLoader = GLTFLoader;

// ==================== إعدادات عامة ====================
const name = sessionStorage.getItem('mm_name') || 'زائر';
const myColor = sessionStorage.getItem('mm_color') || '#e39aae';
const myGender = sessionStorage.getItem('mm_gender') || 'male';
const museumToken = sessionStorage.getItem('mm_access_token') || '';
const loadingEl = document.getElementById('loading');
const loadingMessage = document.getElementById('loadingMessage');
const sceneReady = { api: false, frame: false, model: false, render: false };
function checkSceneReady() {
  if (sceneReady.api && sceneReady.frame && sceneReady.model && sceneReady.render && !loadingEl.classList.contains('loading-failed')) revealScene();
}
let completeModelLoad = () => {
  sceneReady.model = true;
  checkSceneReady();
};
let loadingWatchdog = 0;

function setLoadingMessage(message, isError = false) {
  loadingMessage.textContent = message;
  loadingMessage.classList.toggle('loading-error', isError);
  if (isError) loadingEl.classList.add('loading-failed');
}
function revealScene(force = false) {
  if (loadingEl.classList.contains('hide') || (!force && loadingEl.classList.contains('loading-failed'))) return;
  loadingEl.classList.add('hide');
  clearTimeout(loadingWatchdog);
  setTimeout(() => { loadingEl.style.display = 'none'; }, 650);
}
loadingWatchdog = setTimeout(() => {
  if (!sceneReady.api || !sceneReady.frame) {
    // محاولة إجبارية لإظهار المشهد في حال تأخر خادم الاستجابة
    revealScene(true);
  } else {
    completeModelLoad();
  }
}, 8000);

// ==================== المشهد والتعامل الذكي مع أجهزة الموبايل وأندرويد 10+ ====================
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 768);
const isAndroid = /Android/i.test(navigator.userAgent);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: !isMobileDevice, // إيقاف التنعيم العنيف على الهواتف لضمان 60fps وسلاسة فائقة
    powerPreference: 'high-performance',
    precision: isMobileDevice ? 'mediump' : 'highp',
    stencil: false,
    depth: true
  });
} catch (e) {
  // التراجع للـ WebGL الافتراضي في حال كانت شريحة الرسوم قديمة
  renderer = new THREE.WebGLRenderer({ antialias: false, precision: 'mediump' });
}

renderer.setSize(innerWidth, innerHeight);
// تحديد دقة الرسم بحد أقصى 1.5 على الهواتف لمنع استهلاك الذاكرة وسخونة المعالج على أندرويد
renderer.setPixelRatio(isMobileDevice ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = !isMobileDevice; // الظلال الناعمة على الكمبيوتر لتحفة بصرية، وأداء فائق السرعة على أندرويد
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060204);
scene.fog = new THREE.FogExp2(0x090204, 0.032); // ضباب رعب دموي داكن خانق

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 180);
camera.position.set(0, 4, 10);
window.camera = camera;
window.scene = scene;
window.renderer = renderer;

// مصباح يدوي خفيف بلا ظلال ديناميكية لتجنب كلفة عالية على متصفحات Android/WebGL.
let flashlight = new THREE.SpotLight(0xffe5c1, 38, 19, Math.PI / 6.5, 0.52, 1.25);
flashlight.position.set(0, 0, -0.12);
flashlight.target.position.set(0, -0.05, -1);
flashlight.castShadow = false;
camera.add(flashlight);
camera.add(flashlight.target);
flashlight.visible = true;

// الضباب أخف قليلاً على الجوال للحفاظ على وضوح اللعب والأداء.
const HORROR_FOG_BASE = isMobileDevice ? 0.013 : 0.019;
scene.fog.density = HORROR_FOG_BASE;
const emergencyLights = [];
let flashlightEnabled = true;
let sanity = 100;
let fearMeter = 0;
let nextWhisperAt = 0;
let nextScareAt = 0;
let ambientAudioStarted = false;
let heartbeatTimerId = null;
let heartbeatAudioContext = null;
let heartbeatGain = null;
let horrorClock = 0;
let lastHorrorSync = 0;
let lastHorrorUiUpdate = 0;
const socket = io({ auth: { museumToken } });
let puzzleState = { stage: 'skulls', keyFound: false, fuseFixed: false, doorOpen: false, riddleOpen: false, riddleTimer: null };
let horrorInteractionTarget = null;
let fearEffectsLastUpdate = 0;
let horrorRafThrottle = 0;
const bloodDrips = [];
const possessedVines = [];
const localCollectedSkulls = new Set();
const horrorSpatialSounds = [];
const sharedChallengeState = { skulls: [], stage: 'skulls', riddleSolved: false, keyFound: false, fuseFixed: false, doorOpen: false };
let lastHorrorStateBroadcast = 0;
let lastFlashlightBroadcast = 0;

// ==================== الصالة (تصميم دهاليز الرعب والدم) ====================
const ROOM_W = 18, ROOM_D = 14, WALL_H = 5;
const HALL_NAMES = [
  'سراديب الموتى 💀',
  'قاعة الدماء 🩸',
  'دهاليز الكوابيس 👁️',
  'قاعة الصرخات 😱',
  'ممر الأرواح المعذبة 👻',
  'المشرحة المظلمة 🪓',
  'قاعة الظلال الدامية 🕯️',
  'غرفة العذاب ⛓️',
  'قاعة الرعب الأبدي 🕸️',
  'هاوية الجحيم 🔥'
];
const HALL_COLORS = [
  0x550a12, 0x42080e, 0x660e18, 0x3b0810, 0x5a0b16,
  0x4c0a14, 0x6e101c, 0x35060d, 0x5e0c17, 0x7a1220
];
const ROOM_CENTERS = Array.from({ length: 10 }, (_, i) => i * 22);
const CONNECTOR_LENGTH = ROOM_CENTERS[1] - ROOM_CENTERS[0] - ROOM_D;
const EXTRA_HALL_CENTERS = ROOM_CENTERS.slice(1);
const WORLD_MIN_Z = -ROOM_D / 2;
const WORLD_MAX_Z = ROOM_CENTERS[ROOM_CENTERS.length - 1] + ROOM_D / 2;

const horrorFloorTex = makeHorrorFloorTexture();
const horrorFloorBump = makeHorrorFloorBump();
const horrorFloorRough = makeHorrorFloorRoughness();
const horrorWallBump = makeHorrorWallBump();
const horrorWallRough = makeHorrorWallRoughness();
horrorWallBump.wrapS = horrorWallBump.wrapT = horrorWallRough.wrapS = horrorWallRough.wrapT = THREE.RepeatWrapping;
const bloodPoolMaterial = new THREE.MeshStandardMaterial({ color: 0x26030a, roughness: 0.24, metalness: 0.28, emissive: 0x170106, emissiveIntensity: 0.14, side: THREE.DoubleSide });
const bloodDripMaterial = new THREE.MeshBasicMaterial({ color: 0xa90f20, transparent: true, opacity: 0.78 });
const bloodPoolGeometry = new THREE.CircleGeometry(1, 20);
const bloodDripGeometry = new THREE.SphereGeometry(1, 6, 5);
const horrorBloodDropPool = [];
const emergencyFixtureGeometry = new THREE.BoxGeometry(.16, .52, .16);
const emergencyRedMaterial = new THREE.MeshStandardMaterial({ color: 0x3a070d, emissive: 0xff1028, emissiveIntensity: 2.0, roughness: .38 });
const emergencyGreenMaterial = new THREE.MeshStandardMaterial({ color: 0x06230d, emissive: 0x65ff7a, emissiveIntensity: 1.9, roughness: .35 });
const progressionGates = [];
const interactivePuzzleProps = [];
let exitDoorGroup = null;
let brokenFloorTrap = null;
let swingingBladeTrap = null;
horrorFloorTex.wrapS = horrorFloorTex.wrapT = horrorFloorBump.wrapS = horrorFloorBump.wrapT = horrorFloorRough.wrapS = horrorFloorRough.wrapT = THREE.RepeatWrapping;
horrorFloorTex.repeat.set(5, 5);
horrorFloorBump.repeat.set(5, 5);
horrorFloorRough.repeat.set(5, 5);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM_W, ROOM_D),
  new THREE.MeshStandardMaterial({
    map: horrorFloorTex,
    bumpMap: horrorFloorBump,
    bumpScale: 0.14,
    roughnessMap: horrorFloorRough,
    roughness: .82,
    metalness: .14
  })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const horrorWallTex = makeHorrorWallTexture();
horrorWallBump.wrapS = horrorWallBump.wrapT = horrorWallRough.wrapS = horrorWallRough.wrapT = THREE.RepeatWrapping;
horrorWallTex.wrapS = horrorWallTex.wrapT = THREE.RepeatWrapping;
horrorWallTex.repeat.set(3, 1.8);
horrorWallBump.repeat.set(3, 1.8);
horrorWallRough.repeat.set(3, 1.8);

const wallMat = new THREE.MeshStandardMaterial({
  map: horrorWallTex,
  bumpMap: horrorWallBump,
  bumpScale: 0.16,
  roughnessMap: horrorWallRough,
  color: 0x907e84,
  roughness: .90,
  metalness: 0.08,
  side: THREE.DoubleSide
});
const cameraBlockers = [];
const mkWall = (w, x, z, ry) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), wallMat);
  m.position.set(x, WALL_H / 2, z); m.rotation.y = ry;
  m.receiveShadow = true; scene.add(m); cameraBlockers.push(m); return m;
};
mkWall(ROOM_W, 0, -ROOM_D / 2, 0);              // الحائط الأمامي
mkWall(ROOM_D, -ROOM_W / 2, 0, Math.PI / 2);    // يمين
mkWall(ROOM_D, ROOM_W / 2, 0, -Math.PI / 2);    // يسار
// فتحة واسعة من الصالة الرئيسية إلى الممر والقاعات الخلفية.
const doorWidth = 3.4, doorSide = (ROOM_W - doorWidth) / 2;
mkWall(doorSide, - (doorWidth + doorSide) / 2, ROOM_D / 2, Math.PI);
mkWall(doorSide, (doorWidth + doorSide) / 2, ROOM_D / 2, Math.PI);
const doorHeader = new THREE.Mesh(new THREE.PlaneGeometry(doorWidth, 1.75), wallMat);
doorHeader.position.set(0, 4.125, ROOM_D / 2); doorHeader.rotation.y = Math.PI; scene.add(doorHeader); cameraBlockers.push(doorHeader);
const doorwayLight = new THREE.PointLight(0xff1224, 75, 12, 1.8);
doorwayLight.position.set(0, 3.2, ROOM_D / 2 + 1); scene.add(doorwayLight);
const doorwaySign = new THREE.Mesh(new THREE.BoxGeometry(2.0, .38, .12),
  new THREE.MeshStandardMaterial({ color: 0x3d080e, emissive: 0x220205, roughness: .5 }));
doorwaySign.position.set(0, 4.05, ROOM_D / 2 - .3); scene.add(doorwaySign);
const doorwaySignTexture = new THREE.CanvasTexture((() => {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#140205'; ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = '#99111c'; ctx.lineWidth = 4; ctx.strokeRect(0, 0, 512, 96);
  ctx.fillStyle = '#ff2b3d'; ctx.font = 'bold 44px Cairo, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('سراديب الموتى 💀  ←', 256, 48); return canvas;
})());
const doorwayLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .3), new THREE.MeshBasicMaterial({ map: doorwaySignTexture }));
doorwayLabel.position.set(0, 4.05, ROOM_D / 2 - .22); scene.add(doorwayLabel);
// سقف القاعة الأولى
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D),
  new THREE.MeshStandardMaterial({ color: 0x0c0709, roughness: 0.98 }));
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = WALL_H; scene.add(ceiling);

// ثلاث قاعات مستقلة متصلة بممرات؛ الأرضيات والفتحات تشكل مسارًا متصلًا.
function addHallWall(width, height, x, y, z, ry) {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
  wall.position.set(x, y, z); wall.rotation.y = ry;
  wall.receiveShadow = true; scene.add(wall); cameraBlockers.push(wall);
  return wall;
}
function addExtraHall(centerZ, hasNorthDoor, hasSouthDoor) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ map: horrorFloorTex, roughness: .85, metalness: .12 }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = centerZ;
  floor.receiveShadow = true; scene.add(floor);
  const opening = 3.4, sideWidth = (ROOM_W - opening) / 2;
  const northZ = centerZ - ROOM_D / 2, southZ = centerZ + ROOM_D / 2;
  const thisHallIndex = ROOM_CENTERS.indexOf(centerZ);
  const hasPreviousHall = thisHallIndex > 0;
  const hasNextHall = thisHallIndex >= 0 && thisHallIndex < ROOM_CENTERS.length - 1;
  hasNorthDoor = hasPreviousHall;
  hasSouthDoor = hasNextHall;
  if (hasNorthDoor) {
    addHallWall(sideWidth, WALL_H, -(opening + sideWidth) / 2, WALL_H / 2, northZ, 0);
    addHallWall(sideWidth, WALL_H, (opening + sideWidth) / 2, WALL_H / 2, northZ, 0);
    addHallWall(opening, 1.75, 0, 4.125, northZ, 0);
  } else addHallWall(ROOM_W, WALL_H, 0, WALL_H / 2, northZ, 0);
  if (hasSouthDoor) {
    addHallWall(sideWidth, WALL_H, -(opening + sideWidth) / 2, WALL_H / 2, southZ, Math.PI);
    addHallWall(sideWidth, WALL_H, (opening + sideWidth) / 2, WALL_H / 2, southZ, Math.PI);
    addHallWall(opening, 1.75, 0, 4.125, southZ, Math.PI);
  } else addHallWall(ROOM_W, WALL_H, 0, WALL_H / 2, southZ, Math.PI);
  addHallWall(ROOM_D, WALL_H, -ROOM_W / 2, WALL_H / 2, centerZ, Math.PI / 2);
  addHallWall(ROOM_D, WALL_H, ROOM_W / 2, WALL_H / 2, centerZ, -Math.PI / 2);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ color: 0x0c0709, roughness: 0.98 }));
  roof.rotation.x = Math.PI / 2; roof.position.set(0, WALL_H, centerZ); scene.add(roof);

  // أضواء طوارئ متناوبة: أخضر مريض وقرمزي، وميضها يُحدّث مركزياً لتقليل الحمل
  const emergencyColor = thisHallIndex % 2 === 0 ? 0xff1028 : 0x69ff82;
  const light = new THREE.PointLight(emergencyColor, isMobileDevice ? 18 : 30, 15, 1.8);
  light.position.set(0, WALL_H - .38, centerZ);
  scene.add(light);
  emergencyLights.push({ light, seed: centerZ * 0.17, baseIntensity: isMobileDevice ? 18 : 30, color: emergencyColor });

  // وحدة إنارة طوارئ مرئية أعلى منتصف كل قاعة، بلون يتناوب بين الأحمر والأخضر المريض.
  const fixture = new THREE.Mesh(emergencyFixtureGeometry, thisHallIndex % 2 === 0 ? emergencyRedMaterial : emergencyGreenMaterial);
  fixture.position.set(0, WALL_H - .22, centerZ);
  fixture.castShadow = false;
  scene.add(fixture);

  // عروق خضراء/قرمزية نابضة على جدارين، عدد قليل من القطع المستطيلة لأداء الهاتف.
  const vineMaterial = new THREE.MeshStandardMaterial({ color: 0x361019, emissive: 0x4a0310, emissiveIntensity: 0.35, roughness: .8 });
  for (let vein = 0; vein < 3; vein++) {
    const vine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.0 + (vein % 2) * 0.5, 0.025), vineMaterial);
    const side = vein % 2 === 0 ? -1 : 1;
    vine.position.set(side * (ROOM_W / 2 - 0.07), 1.6 + vein * 0.75, centerZ - 4.2 + vein * 3.8);
    vine.rotation.z = (vein - 1) * 0.12;
    scene.add(vine);
    possessedVines.push({ mesh: vine, phase: centerZ * .12 + vein, material: vineMaterial });
  }

  // بقع دم داكنة مسطحة قليلة العدد على الأرضية لإثراء الجو مع الحفاظ على الأداء
  for (let stainIndex = 0; stainIndex < 4; stainIndex++) {
    const stain = new THREE.Mesh(bloodPoolGeometry, bloodPoolMaterial);
    stain.rotation.x = -Math.PI / 2;
    stain.rotation.z = stainIndex * 0.73;
    stain.position.set(Math.sin(stainIndex * 8.1 + centerZ) * 6.2, 0.018, centerZ + Math.cos(stainIndex * 4.7) * 5.2);
    const scale = 0.35 + (stainIndex % 3) * 0.18;
    stain.scale.set(scale, scale * (0.55 + (stainIndex % 2) * 0.25), 1);
    stain.renderOrder = 1;
    scene.add(stain);

    // قطرات دم متدلية صغيرة ثابتة من السقف؛ عدد محدود حتى لا تثقل أجهزة الهاتف
    if (stainIndex < 2) {
      const drip = new THREE.Mesh(bloodDripGeometry, bloodDripMaterial);
      drip.scale.set(0.018, 0.15 + stainIndex * 0.035, 0.018);
      drip.position.set(stain.position.x, WALL_H - 0.12, stain.position.z + 0.4);
      drip.userData.baseY = drip.position.y;
      drip.userData.phase = stainIndex * 2.7 + centerZ * .1;
      scene.add(drip);
      bloodDrips.push(drip);
    }
  }
  const hallIdx = ROOM_CENTERS.indexOf(centerZ);
  const hallName = HALL_NAMES[hallIdx] || ('قاعة ' + (hallIdx + 1));
  const hallColor = HALL_COLORS[hallIdx] || 0x550a12;
  const hallSign = new THREE.Mesh(new THREE.BoxGeometry(2.4, .38, .12),
    new THREE.MeshStandardMaterial({ color: hallColor, emissive: 0x220205, roughness: .45 }));
  hallSign.position.set(0, 4.05, centerZ - ROOM_D / 2 + .3); scene.add(hallSign);
  const hallCanvas = document.createElement('canvas'); hallCanvas.width = 512; hallCanvas.height = 96;
  const hallCtx = hallCanvas.getContext('2d');
  hallCtx.fillStyle = '#140205'; hallCtx.fillRect(0, 0, 512, 96);
  hallCtx.strokeStyle = '#99111c'; hallCtx.lineWidth = 4; hallCtx.strokeRect(0, 0, 512, 96);
  hallCtx.fillStyle = '#ff2b3d'; hallCtx.font = 'bold 38px Cairo, sans-serif'; hallCtx.textAlign = 'center'; hallCtx.textBaseline = 'middle';
  hallCtx.fillText(hallName, 256, 48);
  const hallLabel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, .32), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(hallCanvas) }));
  hallLabel.position.set(0, 4.05, centerZ - ROOM_D / 2 + .37); scene.add(hallLabel);
}
for (let i = 1; i < ROOM_CENTERS.length; i++) {
  addExtraHall(ROOM_CENTERS[i], true, i < ROOM_CENTERS.length - 1);
}
ROOM_CENTERS.forEach((center, index) => {
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.0, .36, .12),
    new THREE.MeshStandardMaterial({ color: HALL_COLORS[index] || 0x550a12, emissive: 0x220205 }));
  sign.position.set(0, 4.05, center + ROOM_D / 2 - .35); scene.add(sign);

  const labelCanvas = document.createElement('canvas'); labelCanvas.width = 512; labelCanvas.height = 96;
  const labelCtx = labelCanvas.getContext('2d');
  labelCtx.fillStyle = '#140205'; labelCtx.fillRect(0, 0, 512, 96);
  labelCtx.strokeStyle = '#99111c'; labelCtx.lineWidth = 4; labelCtx.strokeRect(0, 0, 512, 96);
  labelCtx.fillStyle = '#ff2b3d'; labelCtx.font = 'bold 40px Cairo, sans-serif'; labelCtx.textAlign = 'center'; labelCtx.textBaseline = 'middle';
  labelCtx.fillText(HALL_NAMES[index] || ('قاعة ' + (index + 1)), 256, 48);
  const roomLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .28), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(labelCanvas) }));
  roomLabel.position.set(0, 4.05, center + ROOM_D / 2 - .24); scene.add(roomLabel);
});
const corridorMat = new THREE.MeshStandardMaterial({ map: horrorFloorTex, bumpMap: horrorFloorBump, bumpScale: 0.10, roughnessMap: horrorFloorRough, color: 0x44282c, roughness: .86 });
for (let i = 0; i < ROOM_CENTERS.length - 1; i++) {
  const centerZ = (ROOM_CENTERS[i] + ROOM_CENTERS[i + 1]) / 2;
  const corridor = new THREE.Mesh(new THREE.PlaneGeometry(3.4, CONNECTOR_LENGTH), corridorMat);
  corridor.rotation.x = -Math.PI / 2; corridor.position.set(0, .01, centerZ);
  corridor.receiveShadow = true; scene.add(corridor);
  [-1.85, 1.85].forEach(x => addHallWall(CONNECTOR_LENGTH, WALL_H, x, WALL_H / 2, centerZ, x < 0 ? Math.PI / 2 : -Math.PI / 2));
  const color = i % 2 === 0 ? 0xff1028 : 0x65ff7a;
  const baseIntensity = isMobileDevice ? 16 : 27;
  const lamp = new THREE.PointLight(color, baseIntensity, 10, 1.7);
  lamp.position.set(0, 3.2, centerZ); scene.add(lamp);
  emergencyLights.push({ light: lamp, seed: centerZ * 0.31 + i, baseIntensity, color });
}

// ==================== المقاعد (مقاعد البنش) ====================
const benches = []; // {x, z, ry}
const benchWood = new THREE.MeshStandardMaterial({ color: 0x220c10, roughness: .85 });
const benchMetal = new THREE.MeshStandardMaterial({ color: 0x140608, metalness: .8, roughness: .35 });
ROOM_CENTERS.forEach(cz => {
  [
    { x: -5.4, z: cz + 2.5, ry: 0 },
    { x: 5.4, z: cz + 2.5, ry: 0 }
  ].forEach(p => {
    const b = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, .12, .55), benchWood);
    seat.position.y = .5; seat.castShadow = true; b.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, .5, .08), benchWood);
    back.position.set(0, .85, -.26); back.castShadow = true; b.add(back);
    [-.9, .9].forEach(x => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.08, .5, .45), benchMetal);
      leg.position.set(x, .25, 0); leg.castShadow = true; b.add(leg);
    });
    b.position.set(p.x, 0, p.z);
    b.rotation.y = p.ry;
    scene.add(b);
    benches.push(p);
  });
});

// ضوء عام منخفض جداً لإبقاء المناطق البعيدة مظلمة. المصباح اليدوي هو مصدر الرؤية الأساسي.
scene.add(new THREE.AmbientLight(0x17080c, 0.24));
const hemi = new THREE.HemisphereLight(0x37111a, 0x050204, 0.16);
scene.add(hemi);

// إضاءة تعبئة خافتة من الأعلى دون إلغاء الإحساس بالظلام
const dirLight = new THREE.DirectionalLight(0x69212a, 0.18);
dirLight.position.set(-2, 6, 4);
dirLight.castShadow = !isMobileDevice;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

// ==================== البراويز ====================
const spotlights = [];
const frameInfo = document.getElementById('frameInfo');
const textures = []; // للتحميل

let framesByHall = Array.from({ length: ROOM_CENTERS.length }, () => []);

function buildFrames(frames) {
  // إزالة القديم
  for (const s of spotlights) scene.remove(s.target.parent || s.target);
  spotlights.length = 0;
  scene.children.filter(c => c.userData.isFrame).forEach(c => scene.remove(c));
  framesByHall = Array.from({ length: ROOM_CENTERS.length }, () => []);
  const positions = framePositions(frames.length);
  frames.forEach((f, i) => {
    const pos = positions[i];
    const g = new THREE.Group();
    g.position.set(pos.x, 2.1, pos.z);
    g.rotation.y = pos.ry;
    g.userData.isFrame = true;
    g.userData.frameIndex = i;

    // البرواز القوطي المرعب الملطخ بالدماء
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 1.5, .1),
      new THREE.MeshStandardMaterial({
        color: 0x1f0b0f,
        metalness: .85,
        roughness: .32,
        emissive: 0x3b040a,
        emissiveIntensity: 0.28
      })
    );
    frame.castShadow = true; g.add(frame);

    // الصورة
    const imgMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const img = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.3), imgMat);
    img.position.z = .06; g.add(img);

    // لوحة العنوان تحت الصورة منقوشة بالدماء والظلال المرعبة
    if (f.title) {
      const cnv = document.createElement('canvas');
      cnv.width = 512; cnv.height = 96;
      const ctx = cnv.getContext('2d');
      ctx.fillStyle = '#140306';
      roundRect(ctx, 0, 0, 512, 96, 16); ctx.fill();
      ctx.strokeStyle = '#99111c'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = '#ff2b3d';
      ctx.font = '700 40px Cairo, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';
      ctx.fillText(f.title, 256, 50, 480);
      const t = new THREE.CanvasTexture(cnv);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .3),
        new THREE.MeshBasicMaterial({ map: t, transparent: true }));
      plate.position.set(0, -1.05, .05); g.add(plate);
    }

    scene.add(g);

    // سبوت لايت أحمر قرمزي مرعب فوق البرواز
    const spot = new THREE.SpotLight(0xff1828, isMobileDevice ? 30 : 55, 8.5, Math.PI / 4.5, .7, 1.5);
    spot.position.set(pos.x, WALL_H - .3, pos.z + pos.nx * 1.5);
    spot.target.position.set(pos.x, 2.1, pos.z);
    scene.add(spot, spot.target);
    // ربط السبوت لايت بالبرواز مباشرة بدون عمليات بحث متكررة لضمان أقصى سرعة وانعدام التهنيج
    g.userData.spotlight = spot;

    // تحميل سريع وذكي للصور: معالجة سريعة لضمان التوافق مع متصفحات أندرويد كروم
    const loader = new THREE.TextureLoader();
    const loadDelay = Math.min((pos.room || 0) * 80, 1500);
    setTimeout(() => {
      loader.load(f.img, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = isMobileDevice ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
        imgMat.map = tex;
        imgMat.needsUpdate = true;
      }, undefined, () => {
        // في حال فشل تحميل صورة معينة لا يتعطل العرض
        console.warn('Failed to load frame texture:', f.img);
      });
    }, loadDelay);
    textures.push(imgMat);
  });
}

function framePositions(n) {
  const list = [];
  const hallCount = ROOM_CENTERS.length;
  const allSlots = [];

  for (let roomIndex = 0; roomIndex < hallCount; roomIndex++) {
    const cz = ROOM_CENTERS[roomIndex];
    const isFirst = roomIndex === 0;
    const isLast = roomIndex === hallCount - 1;

    // الحائط الأمامي
    if (isFirst) {
      allSlots.push({ x: -4.6, z: cz - ROOM_D / 2 + .2, ry: 0, nx: 0, room: roomIndex });
      allSlots.push({ x: 0,    z: cz - ROOM_D / 2 + .2, ry: 0, nx: 0, room: roomIndex });
      allSlots.push({ x: 4.6,  z: cz - ROOM_D / 2 + .2, ry: 0, nx: 0, room: roomIndex });
    } else {
      allSlots.push({ x: -5.4, z: cz - ROOM_D / 2 + .2, ry: 0, nx: 0, room: roomIndex });
      allSlots.push({ x: 5.4,  z: cz - ROOM_D / 2 + .2, ry: 0, nx: 0, room: roomIndex });
    }

    // الحائط الأيسر (٤ براويز موزعة)
    [-4.5, -1.5, 1.5, 4.5].forEach(offset => {
      allSlots.push({ x: -ROOM_W / 2 + .2, z: cz + offset, ry: Math.PI / 2, nx: 1, room: roomIndex });
    });

    // الحائط الأيمن (٤ براويز موزعة)
    [-4.5, -1.5, 1.5, 4.5].forEach(offset => {
      allSlots.push({ x: ROOM_W / 2 - .2, z: cz + offset, ry: -Math.PI / 2, nx: -1, room: roomIndex });
    });

    // الحائط الخلفي
    if (isLast) {
      allSlots.push({ x: -4.6, z: cz + ROOM_D / 2 - .2, ry: Math.PI, nx: 0, room: roomIndex });
      allSlots.push({ x: 0,    z: cz + ROOM_D / 2 - .2, ry: Math.PI, nx: 0, room: roomIndex });
      allSlots.push({ x: 4.6,  z: cz + ROOM_D / 2 - .2, ry: Math.PI, nx: 0, room: roomIndex });
    } else {
      allSlots.push({ x: -5.4, z: cz + ROOM_D / 2 - .2, ry: Math.PI, nx: 0, room: roomIndex });
      allSlots.push({ x: 5.4,  z: cz + ROOM_D / 2 - .2, ry: Math.PI, nx: 0, room: roomIndex });
    }
  }

  for (let i = 0; i < Math.min(n, allSlots.length); i++) {
    list.push(allSlots[i]);
  }
  list.forEach((position, index) => {
    if (framesByHall[position.room]) framesByHall[position.room].push(index);
  });
  return list;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function makeHorrorFloorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#100b0e'; ctx.fillRect(0, 0, 512, 512);

  // شقوق بلاط حجري داكن
  ctx.strokeStyle = 'rgba(5, 2, 4, 0.9)';
  ctx.lineWidth = 4;
  for (let x = 0; x <= 512; x += 128) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
  }
  for (let y = 0; y <= 512; y += 128) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }

  // برك وبقع دماء متناثرة واقعية (Dark & Fresh Blood Stains)
  for (let i = 0; i < 26; i++) {
    const bx = Math.random() * 512, by = Math.random() * 512;
    const br = 12 + Math.random() * 38;
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    grad.addColorStop(0, 'rgba(150, 10, 20, 0.92)');
    grad.addColorStop(0.5, 'rgba(85, 5, 12, 0.75)');
    grad.addColorStop(1, 'rgba(20, 2, 4, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();

    // رذاذ وقطرات دماء متناثرة
    ctx.fillStyle = 'rgba(170, 15, 25, 0.85)';
    for (let s = 0; s < 10; s++) {
      const sx = bx + (Math.random() - 0.5) * br * 2.4;
      const sy = by + (Math.random() - 0.5) * br * 2.4;
      ctx.beginPath(); ctx.arc(sx, sy, 1.5 + Math.random() * 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // شقوق وخدوش
  ctx.strokeStyle = 'rgba(4, 2, 4, 0.75)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath();
    let cx = Math.random() * 512, cy = Math.random() * 512;
    ctx.moveTo(cx, cy);
    for (let seg = 0; seg < 4; seg++) {
      cx += (Math.random() - 0.5) * 45;
      cy += (Math.random() - 0.5) * 45;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeHorrorFloorBump() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 5;
  for (let x = 0; x <= 512; x += 128) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
  }
  for (let y = 0; y <= 512; y += 128) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#999999' : '#555555';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 3 + Math.random() * 8, 3 + Math.random() * 8);
  }
  return new THREE.CanvasTexture(c);
}

function makeHorrorFloorRoughness() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c5c5c5'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26; i++) {
    const bx = Math.random() * 512, by = Math.random() * 512;
    const br = 12 + Math.random() * 38;
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    grad.addColorStop(0, '#1a1a1a');
    grad.addColorStop(0.6, '#404040');
    grad.addColorStop(1, '#c5c5c5');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

function makeHorrorWallTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1c1518'; ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 25; i++) {
    ctx.fillStyle = `rgba(8, 4, 6, ${0.12 + Math.random() * 0.25})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 70 + Math.random() * 120, 70 + Math.random() * 120);
  }

  // سيلان دماء واقعي نازل من أعلى الحائط (Dripping Blood Streaks)
  for (let i = 0; i < 22; i++) {
    const wx = Math.random() * 512;
    const wy = Math.random() * 160;
    const h = 60 + Math.random() * 280;
    const w = 4 + Math.random() * 13;
    const grad = ctx.createLinearGradient(wx, wy, wx, wy + h);
    grad.addColorStop(0, 'rgba(165, 12, 22, 0.95)');
    grad.addColorStop(0.65, 'rgba(95, 6, 14, 0.7)');
    grad.addColorStop(1, 'rgba(30, 2, 5, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(wx, wy, w, w * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(wx - w / 2, wy, w, h);
    ctx.fillStyle = 'rgba(150, 10, 20, 0.9)';
    ctx.beginPath(); ctx.arc(wx, wy + h, w * 0.85, 0, Math.PI * 2); ctx.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeHorrorWallBump() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#151515'; ctx.lineWidth = 3.5;
  for (let y = 0; y <= 512; y += 42) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    const offset = (y / 42) % 2 === 0 ? 0 : 50;
    for (let x = offset; x <= 512; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 42); ctx.stroke();
    }
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = '#303030';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 4 + Math.random() * 10, 4 + Math.random() * 10);
  }
  return new THREE.CanvasTexture(c);
}

function makeHorrorWallRoughness() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d0d0d0'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 22; i++) {
    const wx = Math.random() * 512, wy = Math.random() * 160;
    const h = 60 + Math.random() * 280, w = 4 + Math.random() * 13;
    ctx.fillStyle = '#222222';
    ctx.fillRect(wx - w / 2, wy, w, h);
    ctx.beginPath(); ctx.arc(wx, wy + h, w * 0.85, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

function buildWorldBloodDecals() {
  // World-space stains are baked into a small fixed set of reusable meshes (mobile-friendly).
  for (const centerZ of ROOM_CENTERS) {
    for (let i = 0; i < 2; i++) {
      const stain = new THREE.Mesh(bloodPoolGeometry, bloodPoolMaterial);
      stain.rotation.x = -Math.PI / 2;
      stain.rotation.z = i * 0.61 + centerZ * 0.01;
      stain.scale.set(0.38 + i * 0.12, 0.24 + i * 0.08, 1);
      stain.position.set((i ? 1 : -1) * (3.2 + (centerZ % 3)), 0.02, centerZ + (i ? -2.5 : 3.5));
      stain.renderOrder = 1;
      scene.add(stain);
    }
  }
}

function addCanvasDecal(parent, text, color = '#cf263b', scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 256);
  ctx.save();
  ctx.translate(256, 128);
  ctx.rotate(-0.10);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.font = '900 88px Cairo, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.fillText(text, 0, 0, 450);
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(1.45 * scale, 0.72 * scale),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  parent.add(decal);
  return decal;
}



function buildPuzzleAndTrapObjects() {
  const makeProp = (kind, id, x, y, z, color = 0x7d1020) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(.72, 1.1, .22), new THREE.MeshStandardMaterial({ color: 0x211015, roughness: .8, metalness: .2, emissive: 0x180307 }));
    body.castShadow = true; g.add(body);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(.42, .20, .035), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .8, roughness: .45 }));
    glow.position.set(0, .18, .13); g.add(glow);
    g.userData = { kind, puzzleId: id, interactionRadius: 2.5 };
    scene.add(g); interactivePuzzleProps.push(g);
    return g;
  };

  const console = makeProp('riddle', 'blood-console', 5.8, 1.15, 150, 0xe51b35);
  addCanvasDecal(console, 'اقرأ الدم', '#ff3045', .55).position.set(0, .18, .17);

  const key = new THREE.Group();
  key.position.set(-5.4, .8, 174);
  const gold = new THREE.MeshStandardMaterial({ color: 0xc49a42, metalness: .8, roughness: .22, emissive: 0x3d2808 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.12, .022, 7, 16), gold); key.add(ring);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .34, 8), gold); shaft.rotation.z = Math.PI / 2; shaft.position.x = .18; key.add(shaft);
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(.08, .04, .035), gold); tooth.position.set(.30, -.07, 0); key.add(tooth);
  key.userData = { kind: 'key', puzzleId: 'rust-key', interactionRadius: 2.3 };
  scene.add(key); interactivePuzzleProps.push(key);
  key.add(new THREE.PointLight(0xffb83f, 5, 2.4, 2));

  const fuseProp = makeProp('fuse', 'fuse-box', 5.8, 1.3, 194, 0x42ff77);
  fuseProp.userData.handles = [];
  [-.16, 0, .16].forEach((x, i) => {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(.055, .28, .04), new THREE.MeshStandardMaterial({ color: i === 1 ? 0x471018 : 0x393033, metalness: .5, emissive: 0x0a0203 }));
    handle.position.set(x, .02, .16);
    fuseProp.add(handle);
    fuseProp.userData.handles.push(handle);
  });

  exitDoorGroup = new THREE.Group();
  exitDoorGroup.position.set(0, 0, 203.5);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x241016, roughness: .85, metalness: .3, emissive: 0x21030a });
  const door = new THREE.Mesh(new THREE.BoxGeometry(3.25, 4.25, .28), doorMat);
  door.position.set(1.62, 2.12, 0); door.castShadow = true; exitDoorGroup.add(door);
  exitDoorGroup.userData = { kind: 'exit', puzzleId: 'exit-door', interactionRadius: 3.2, doorMesh: door, open: false };
  scene.add(exitDoorGroup); interactivePuzzleProps.push(exitDoorGroup); cameraBlockers.push(door);

  brokenFloorTrap = new THREE.Group();
  brokenFloorTrap.position.set(0, .02, 132);
  const warningRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.28, 28), new THREE.MeshBasicMaterial({ color: 0xff1730, side: THREE.DoubleSide, transparent: true, opacity: .7 }));
  warningRing.rotation.x = -Math.PI / 2; brokenFloorTrap.add(warningRing);
  const voidHole = new THREE.Mesh(new THREE.CircleGeometry(.98, 28), new THREE.MeshBasicMaterial({ color: 0x030104, side: THREE.DoubleSide }));
  voidHole.rotation.x = -Math.PI / 2; voidHole.position.y = .005; brokenFloorTrap.add(voidHole);
  brokenFloorTrap.userData = { kind: 'floor-trap', puzzleId: 'floor-collapse', triggered: false, interactionRadius: 1.25 };
  scene.add(brokenFloorTrap);

  swingingBladeTrap = new THREE.Group();
  swingingBladeTrap.position.set(0, WALL_H - .15, 88);
  const pivot = new THREE.Group(); swingingBladeTrap.add(pivot);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 2.5, 6), new THREE.MeshStandardMaterial({ color: 0x5e5052, metalness: .8, roughness: .3 }));
  chain.position.y = -1.25; pivot.add(chain);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb7bdc2, metalness: .94, roughness: .18 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(2.1, .12, .32), bladeMat);
  blade.position.set(0, -2.35, .12); blade.castShadow = true; pivot.add(blade);
  pivot.userData = { baseRotation: 0, triggered: false };
  swingingBladeTrap.userData = { kind: 'blade-trap', puzzleId: 'pendulum', pivot, triggered: false };
  scene.add(swingingBladeTrap); cameraBlockers.push(blade);
}

function buildProgressionGates() {
  const gates = [
    { z: 162, openStages: ['key', 'fuse', 'door', 'escaped'] },
    { z: 184, openStages: ['fuse', 'door', 'escaped'] },
    { z: 202, openStages: ['door', 'escaped'] }
  ];
  gates.forEach(({ z, openStages }, index) => {
    const gate = new THREE.Group();
    gate.position.set(0, 0, z);
    const material = new THREE.MeshStandardMaterial({ color: 0x35070f, emissive: 0x9d071b, emissiveIntensity: .75, transparent: true, opacity: .72, metalness: .45, roughness: .4 });
    const bars = [];
    for (let i = 0; i < 7; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(.08, 2.9, .08), material);
      bar.position.set(-1.35 + i * .45, 1.45, 0);
      gate.add(bar); bars.push(bar);
    }
    gate.userData = { kind: 'progression-gate', openStages, bars, index };
    scene.add(gate);
    progressionGates.push(gate);
  });
}

function syncQuestUI() {
  const skullCount = sharedChallengeState.skulls.filter(Boolean).length;
  const skullCountEl = document.getElementById('skullsCount');
  if (skullCountEl) skullCountEl.textContent = `${skullCount} / ${TOTAL_SKULLS}`;
  const stageNames = { skulls: 'المرحلة 1 · اجمع الجماجم', riddle: 'المرحلة 2 · حل اللغز الدموي', key: 'المرحلة 3 · اعثر على المفتاح', fuse: 'المرحلة 4 · أصلح صندوق الكهرباء', door: 'المرحلة 5 · افتح بوابة الخروج', escaped: 'اكتمل التحدي · تم الهروب!' };
  const sub = document.getElementById('questSubProgress');
  if (sub) sub.textContent = stageNames[sharedChallengeState.stage] || stageNames.skulls;
  const steps = {
    stepSkulls: skullCount >= TOTAL_SKULLS,
    stepRiddle: sharedChallengeState.riddleSolved,
    stepKey: sharedChallengeState.keyFound,
    stepFuse: sharedChallengeState.fuseFixed,
    stepDoor: sharedChallengeState.doorOpen
  };
  Object.entries(steps).forEach(([id, done]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('done', done);
  });
  const questBox = document.getElementById('questBox');
  if (questBox) { questBox.classList.remove('updated'); void questBox.offsetWidth; questBox.classList.add('updated'); }
}

function handleChallengeState(state) {
  if (!state || !Array.isArray(state.skulls)) return;
  if (state.reset) {
    localCollectedSkulls.clear();
    document.getElementById('victoryBanner')?.classList.remove('show');
  }
  sharedChallengeState.skulls = state.skulls.slice(0, TOTAL_SKULLS).map(Boolean);
  sharedChallengeState.stage = state.stage || 'skulls';
  sharedChallengeState.riddleSolved = Boolean(state.riddleSolved);
  sharedChallengeState.keyFound = Boolean(state.keyFound);
  sharedChallengeState.fuseFixed = Boolean(state.fuseFixed);
  sharedChallengeState.doorOpen = Boolean(state.doorOpen);
  collectedSkullsCount = sharedChallengeState.skulls.filter(Boolean).length;
  cursedSkulls.forEach(sk => {
    const collected = Boolean(sharedChallengeState.skulls[sk.userData.index]);
    sk.userData.collected = collected;
    sk.visible = !collected;
    if (collected) scene.remove(sk);
    else if (!sk.parent) scene.add(sk);
  });
  interactivePuzzleProps.forEach(prop => {
    const kind = prop.userData.kind;
    if (kind === 'key') prop.visible = !sharedChallengeState.keyFound;
    if (kind === 'fuse') prop.visible = true;
    if (kind === 'fuse' && sharedChallengeState.fuseFixed) {
      prop.userData.handles?.forEach((handle, index) => {
        handle.rotation.z = index === 1 ? -0.65 : 0;
        handle.material.color.setHex(0x4b9a50);
        if (handle.material.emissive) handle.material.emissive.setHex(0x16451a);
      });
    }
  });
  if (exitDoorGroup) {
    exitDoorGroup.userData.open = sharedChallengeState.doorOpen;
    exitDoorGroup.rotation.y = sharedChallengeState.doorOpen ? -Math.PI * 0.44 : 0;
  }
  progressionGates.forEach(gate => {
    const open = gate.userData.openStages.includes(sharedChallengeState.stage);
    gate.userData.open = open;
    gate.visible = !open;
  });
  if (sharedChallengeState.stage === 'escaped') document.getElementById('victoryBanner')?.classList.add('show');
  syncQuestUI();
}

socket.on('horror-challenge-state', handleChallengeState);
socket.emit('game-state-request');

function openRiddleDialog() {
  if (sharedChallengeState.stage !== 'riddle') { showToast('اجمع الجماجم الخمس أولاً لفتح اللغز.'); return; }
  const currentPlayer = avatars.get(socket.id);
  if (!currentPlayer || Math.hypot(currentPlayer.group.position.x - 5.8, currentPlayer.group.position.z - 150) > 3.4) return;
  puzzleState.riddleOpen = true;
  const dialog = document.getElementById('riddleDialog');
  const text = document.getElementById('riddleText');
  const answer = document.getElementById('riddleAnswer');
  if (text) text.textContent = 'أنا أسكن صدور الأحياء، وإذا توقفتُ سكن الجسد. ما أنا؟';
  if (answer) { answer.value = ''; setTimeout(() => answer.focus(), 50); }
  if (dialog) dialog.classList.add('open');
  let seconds = 30;
  const timerEl = document.getElementById('riddleSeconds');
  if (timerEl) timerEl.textContent = seconds;
  clearInterval(puzzleState.riddleTimer);
  puzzleState.riddleTimer = setInterval(() => {
    seconds--;
    if (timerEl) timerEl.textContent = seconds;
    if (seconds <= 0) {
      clearInterval(puzzleState.riddleTimer);
      puzzleState.riddleOpen = false;
      dialog?.classList.remove('open');
      triggerJumpScare({ type: 'burst', intensity: .35, message: 'انتهى الوقت... سمعتك الظلال!' });
    }
  }, 1000);
}

function closeRiddleDialog() {
  puzzleState.riddleOpen = false;
  clearInterval(puzzleState.riddleTimer);
  document.getElementById('riddleDialog')?.classList.remove('open');
}

function submitRiddle() {
  if (!puzzleState.riddleOpen) return;
  const answer = document.getElementById('riddleAnswer')?.value || '';
  const a = avatars.get(socket.id);
  socket.emit('horror-challenge-action', { type: 'solve-riddle', answer, x: a?.group.position.x, z: a?.group.position.z });
  if (answer.trim().replace(/[ًٌٍَُِّْـ]/g, '').toLowerCase() !== 'قلب') {
    showToast('إجابة خاطئة... حاول قبل انتهاء الوقت!');
    triggerJumpScare({ type: 'whisper', intensity: .24, message: 'اللغز يرفضك...' });
    document.getElementById('riddleAnswer')?.select();
  } else {
    closeRiddleDialog();
    playSkullCollectSound();
    showToast('صحيح! سُمعت نقرة قفل في مكان بعيد...');
  }
}

document.getElementById('riddleSubmit')?.addEventListener('click', submitRiddle);
document.getElementById('riddleClose')?.addEventListener('click', closeRiddleDialog);
document.getElementById('riddleAnswer')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitRiddle(); });

function completeChallengeAction(prop) {
  const a = avatars.get(socket.id);
  if (!a || !prop) return;
  const type = prop.userData.kind;
  if (type === 'riddle') { openRiddleDialog(); return; }
  if (type === 'key' && sharedChallengeState.stage !== 'key') { showToast('المفتاح محجوب باللعنة؛ حل اللغز أولاً.'); return; }
  if (type === 'fuse' && sharedChallengeState.stage !== 'fuse') { showToast('صندوق الكهرباء لن يستجيب قبل العثور على المفتاح.'); return; }
  if (type === 'exit' && sharedChallengeState.stage !== 'door') { showToast('البوابة ما زالت مغلقة؛ أصلح الكهرباء أولاً.'); return; }
  const propPositions = { key: { x: -5.4, z: 174 }, fuse: { x: 5.8, z: 194 }, exit: { x: 1.62, z: 203.5 } };
  const target = propPositions[type];
  if (!target || Math.hypot(a.group.position.x - target.x, a.group.position.z - target.z) > 3.2) return;
  const eventType = type === 'key' ? 'find-key' : type === 'fuse' ? 'repair-fuse' : type === 'exit' ? 'open-exit' : null;
  if (!eventType) return;
  socket.emit('horror-challenge-action', { type: eventType, x: a.group.position.x, z: a.group.position.z });
  showToast(type === 'key' ? 'التقط المفتاح الصدئ...' : type === 'fuse' ? 'تُصلح صندوق الكهرباء...' : 'البوابة تتحرك...');
  playSkullCollectSound();
}

buildWorldBloodDecals();
buildPuzzleAndTrapObjects();
buildProgressionGates();
const avatars = new Map();
window.avatars = avatars; // id -> {group, model, mixer, animationActions, ...}
const gltfLoader = new GLTFLoader();
window.gltfLoader = gltfLoader;
const avatarModelLoads = new Map();
const externalAnimationLoads = new Map();
let resolveLocalAvatarReady;
let localAvatarReadySettled = false;
let setMuseumPasswordGate = false;
const localAvatarReady = new Promise(resolve => {
  resolveLocalAvatarReady = avatar => {
    if (localAvatarReadySettled) return;
    localAvatarReadySettled = true;
    resolve(avatar);
  };
});
let characterModelPath = '';
let characterModelMalePath = '';
let characterModelFemalePath = '';
let characterAnimationPaths = [];

function getAvatarTargetModelPath(avatar) {
  if (!avatar) return '';
  if (avatar.female) {
    // نعتمد الشخصية الأنثوية الثابتة المرفقة كي لا يتغير المجسم مع رفع نموذج من نوع آخر.
    return '/models/Michelle.glb';
  }
  return characterModelMalePath || characterModelPath || '';
}

function getAvatarModel(path) {
  if (!avatarModelLoads.has(path)) avatarModelLoads.set(path, gltfLoader.loadAsync(getModelAssetUrl(path)));
  return avatarModelLoads.get(path);
}

function getExternalAnimation(path) {
  if (!externalAnimationLoads.has(path)) externalAnimationLoads.set(path, gltfLoader.loadAsync(getModelAssetUrl(path)));
  return externalAnimationLoads.get(path);
}

function getModelAssetUrl(path) {
  if (/\.gltf(?:$|[?#])/i.test(path)) {
    const cleanPath = path.split(/[?#]/)[0];
    const query = path.includes('?') ? '?' + path.split('?').slice(1).join('?') : '';
    return cleanPath.slice(0, cleanPath.lastIndexOf('/') + 1) + encodeURIComponent(cleanPath.split('/').pop()) + query;
  }
  return path;
}

function chooseAnimation(avatar, state) {
  if (!avatar.animationActions || !avatar.animationActions.size) return;
  const requestedState = state === 'run' && !avatar.animationActions.has('run') ? 'walk' : state;
  const action = avatar.animationActions.get(requestedState) || avatar.animationActions.get('idle') || avatar.animationActions.values().next().value;
  if (!action || avatar.activeAnimation === action) return;

  // تنعيم كينماتيكي متقدم (Cross-fade 0.22s) لمنع أي قفزات مفاجئة بين الحركات
  if (avatar.activeAnimation?.isRunning()) {
    avatar.activeAnimation.fadeOut(0.22);
  }
  action.reset();
  const isOneShot = state === 'jump' || state === 'salute';
  action.setLoop(isOneShot ? THREE.LoopOnce : THREE.LoopRepeat, isOneShot ? 1 : Infinity);
  action.clampWhenFinished = isOneShot;
  action.fadeIn(0.22).play();
  avatar.activeAnimation = action;
}

function isWalkablePosition(x, z) {
  if (x < -ROOM_W / 2 + .55 || x > ROOM_W / 2 - .55 || z < WORLD_MIN_Z + .55 || z > WORLD_MAX_Z - .55) return false;

  // بعد جمع الجماجم تظهر حواجز تمنع تجاوز مراحل اللغز قبل إكمالها.
  const stageLimit = { skulls: 160, riddle: 160, key: 182, fuse: 200, door: 207, escaped: 214 }[sharedChallengeState.stage];
  if (stageLimit !== undefined && z > stageLimit && z < 210) return false;

  const inHall = ROOM_CENTERS.some(center => Math.abs(z - center) <= ROOM_D / 2);
  if (inHall) return true;
  const inCorridor = ROOM_CENTERS.slice(0, -1).some((center, index) =>
    z >= center + ROOM_D / 2 - .15 && z <= ROOM_CENTERS[index + 1] - ROOM_D / 2 + .15);
  return inCorridor && Math.abs(x) <= 1.6;
}

async function loadAvatarModel(avatar, force = false) {
  if (avatar.modelLoading || (avatar.modelLoaded && !force)) return;
  const requestedModelPath = getAvatarTargetModelPath(avatar);
  const requestedAnimationPaths = [...characterAnimationPaths];
  const modelChanged = avatar.modelPath !== requestedModelPath;

  if (!requestedModelPath) {
    // تم حذف أو عدم وجود مجسم مخصص: استخدام الشخصية الافتراضية
    if (avatar.model) {
      avatar.group.remove(avatar.model);
      avatar.model = null;
    }
    avatar.modelLoaded = false;
    avatar.modelPath = '';
    if (avatar.fallbackVisual) {
      avatar.fallbackVisual.visible = true;
      avatar.fallbackVisual.traverse(child => { if (child.isMesh) child.visible = true; });
    }
    return;
  }

  if (!modelChanged && avatar.animationSetKey === JSON.stringify(requestedAnimationPaths)) return;
  avatar.modelLoading = true;
  avatar.requestedModelPath = requestedModelPath;
  try {
    const gltf = modelChanged || !avatar.model ? await Promise.race([
      getAvatarModel(requestedModelPath),
      new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة تحميل المجسم')), 12000))
    ]) : { scene: avatar.model.children[0], animations: [] };
    if (!avatars.has(avatar.id)) return;
    const currentTarget = getAvatarTargetModelPath(avatar);
    if (requestedModelPath !== currentTarget) return;

    const model = modelChanged || !avatar.model ? cloneSkinnedModel(gltf.scene) : avatar.model.children[0];
    model.name = 'museum-character-glb';
    model.traverse(part => {
      if (!part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;

      // ضبط خامات واقعية ناعمة للبشرة والملابس والشعر لمنع اللمعان البلاستيكي أو المعدني
      if (part.material) {
        const fixMat = m => {
          if (!m) return;
          const matName = (m.name || '').toLowerCase();
          if (matName.includes('skin')) {
            m.metalness = 0.02;
            m.roughness = 0.62;
            if (m.color) m.color.setHex(0xd49b80); // لون بشرة طبيعي دافئ
          } else if (matName.includes('hair')) {
            m.metalness = 0.05;
            m.roughness = 0.72;
            if (m.color) m.color.setHex(0x181412); // شعر طبيعي ناعم
          } else if (matName.includes('shirt')) {
            m.metalness = 0.04;
            m.roughness = 0.78;
            if (m.color) m.color.setHex(0x223c58); // تيشيرت كحلي أنيق
          } else if (matName.includes('pants')) {
            m.metalness = 0.04;
            m.roughness = 0.82;
            if (m.color) m.color.setHex(0x222830);
          } else {
            m.metalness = Math.min(m.metalness || 0, 0.08);
            m.roughness = Math.max(m.roughness || 0.6, 0.6);
          }
          m.needsUpdate = true;
        };
        if (Array.isArray(part.material)) part.material.forEach(fixMat);
        else fixMat(part.material);
      }
    });

    if (modelChanged || !avatar.model) {
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = size.y > .001 ? 1.82 / size.y : 1;
      const fit = new THREE.Group();
      fit.scale.setScalar(scale);
      fit.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      fit.add(model);
      if (avatar.mixer) avatar.mixer.stopAllAction();
      if (avatar.model) avatar.group.remove(avatar.model);
      avatar.group.add(fit);
      avatar.model = fit;
      avatar.modelPath = requestedModelPath;

      // حذف وإخفاء مجسم اللعبة الافتراضي بالكامل واستخدام المجسم المرفوع فقط
      if (avatar.fallbackVisual) {
        avatar.fallbackVisual.visible = false;
        avatar.fallbackVisual.traverse(child => {
          if (child.isMesh) child.visible = false;
        });
      }
    }

    if (avatar.mixer) avatar.mixer.stopAllAction();
    avatar.mixer = new THREE.AnimationMixer(model);
    avatar.animationActions = new Map();
    avatar.mixer.addEventListener('finished', event => {
      if (event.action !== avatar.animationActions.get('jump')) return;
      if (avatar.id === socket.id) {
        myAction = null;
        socket.emit('action', { action: null });
      } else avatar.action = null;
      chooseAnimation(avatar, 'idle');
    });

    const registerAnimation = (clip, label = clip.name) => {
      const action = avatar.mixer.clipAction(clip);
      const normalized = `${label} ${clip.name}`.toLowerCase();
      if (/idle|stand|rest|breath/i.test(normalized)) avatar.animationActions.set('idle', action);
      else if (/walk|walking|locomotion/i.test(normalized)) avatar.animationActions.set('walk', action);
      else if (/run|sprint/i.test(normalized)) avatar.animationActions.set('run', action);
      else if (/jump|hop/i.test(normalized)) avatar.animationActions.set('jump', action);
      else if (/dance/i.test(normalized)) avatar.animationActions.set('dance', action);
      else if (/sit/i.test(normalized)) avatar.animationActions.set('sit', action);
      else if (/clap|clapping/i.test(normalized)) avatar.animationActions.set('clap', action);
      else if (/wave|waving/i.test(normalized)) avatar.animationActions.set('wave', action);
      else if (/salute/i.test(normalized)) avatar.animationActions.set('salute', action);
      else if (/cheer/i.test(normalized)) avatar.animationActions.set('cheer', action);
      else if (/kiss/i.test(normalized)) avatar.animationActions.set('kiss', action);
      else if (/laugh/i.test(normalized)) avatar.animationActions.set('laugh', action);
      else if (/cry/i.test(normalized)) avatar.animationActions.set('cry', action);
      else if (/attack|slash|punch/i.test(normalized)) {
        // حركات حماسية إضافية متوفرة في المجسم نربطها بالحركات التعبيرية إذا لم تكن موجودة
        if (!avatar.animationActions.has('salute')) avatar.animationActions.set('salute', action);
      }
    };
    (gltf.animations || []).forEach(registerAnimation);

    const externalClips = await Promise.all(requestedAnimationPaths.map(async animationPath => {
      const animationGltf = await Promise.race([
        getExternalAnimation(animationPath),
        new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة تحميل الحركة')), 10000))
      ]);
      const label = animationPath.split('/').pop().replace(/\.(?:glb|gltf)$/i, '');
      return (animationGltf.animations || []).map(clip => ({ clip, label }));
    }));
    externalClips.forEach(clips => clips.forEach(({ clip, label }) => registerAnimation(clip, label)));
    if (!avatar.animationActions.has('idle') && gltf.animations?.length) {
      avatar.animationActions.set('idle', avatar.mixer.clipAction(gltf.animations[0]));
    }

    // إنشاء حركة تلويح طبيعية باليد اليمنى للمجسم المرفوع إذا لم تكن مضمنة
    if (!avatar.animationActions.has('wave')) {
      let upperArmRName = null, lowerArmRName = null;
      model.traverse(o => {
        if (o.isBone) {
          if (/upperarm[._ ]?r|right.*upperarm/i.test(o.name)) upperArmRName = o.name;
          if (/lowerarm[._ ]?r|right.*lowerarm|forearm[._ ]?r/i.test(o.name)) lowerArmRName = o.name;
        }
      });
      if (upperArmRName) {
        // زوايا كينماتيكية ترفع الذراع اليمنى للأعلى ولليمين مع ثني الكوع والتلويح يمنة ويسرة
        const times = [0, 0.35, 0.7, 1.05, 1.4];
        const qUpper = new THREE.Quaternion(-0.48, 0.18, 0.42, 0.73).normalize();
        const qLower1 = new THREE.Quaternion(0.48, 0.15, 0.10, 0.85).normalize();
        const qLower2 = new THREE.Quaternion(0.48, -0.18, -0.08, 0.85).normalize();
        const tracks = [
          new THREE.QuaternionKeyframeTrack(`${upperArmRName}.quaternion`, [0, 1.4], [
            qUpper.x, qUpper.y, qUpper.z, qUpper.w,
            qUpper.x, qUpper.y, qUpper.z, qUpper.w
          ])
        ];
        if (lowerArmRName) {
          const lowerVals = [
            qLower1.x, qLower1.y, qLower1.z, qLower1.w,
            qLower2.x, qLower2.y, qLower2.z, qLower2.w,
            qLower1.x, qLower1.y, qLower1.z, qLower1.w,
            qLower2.x, qLower2.y, qLower2.z, qLower2.w,
            qLower1.x, qLower1.y, qLower1.z, qLower1.w
          ];
          tracks.push(new THREE.QuaternionKeyframeTrack(`${lowerArmRName}.quaternion`, times, lowerVals));
        }
        const waveClip = new THREE.AnimationClip('wave', 1.4, tracks);
        avatar.animationActions.set('wave', avatar.mixer.clipAction(waveClip));
      }
    }
    // البحث عن العظام الرئيسية للتحكم في الحركات التعبيرية إذا لم تكن مضمنة في GLB
    const bones = {};
    model.traverse(obj => {
      if (obj.isBone) {
        const bn = obj.name.toLowerCase();
        if (/r.*arm|right.*arm|r.*shoulder|rightarm|arm.*r/i.test(bn) && !/fore|hand|lower/i.test(bn)) bones.rightArm = obj;
        else if (/l.*arm|left.*arm|l.*shoulder|leftarm|arm.*l/i.test(bn) && !/fore|hand|lower/i.test(bn)) bones.leftArm = obj;
        else if (/r.*forearm|right.*forearm|r.*elbow|forearm.*r|r.*hand/i.test(bn)) bones.rightForearm = obj;
        else if (/l.*forearm|left.*forearm|l.*elbow|forearm.*l|l.*hand/i.test(bn)) bones.leftForearm = obj;
        else if (/head|neck/i.test(bn) && !/shoulder/i.test(bn)) bones.head = obj;
        else if (/spine|torso|chest/i.test(bn)) bones.chest = obj;
      }
    });
    avatar.modelBones = bones;
    avatar.modelLoaded = true;
    avatar.animationSetKey = JSON.stringify(requestedAnimationPaths);
    chooseAnimation(avatar, 'idle');

    // التأكد من إخفاء مجسم اللعبة الافتراضي تماماً
    if (avatar.fallbackVisual) {
      avatar.fallbackVisual.visible = false;
      avatar.fallbackVisual.traverse(child => { if (child.isMesh) child.visible = false; });
    }
  } catch (error) {
    if (modelChanged) avatarModelLoads.delete(requestedModelPath);
    console.warn('تعذر تحميل مجسم GLB؛ سيستمر استخدام الشخصية الافتراضية.', error);
  } finally {
    avatar.modelLoading = false;
    const latestTarget = getAvatarTargetModelPath(avatar);
    if (latestTarget && (latestTarget !== requestedModelPath || JSON.stringify(characterAnimationPaths) !== JSON.stringify(requestedAnimationPaths))) {
      loadAvatarModel(avatar, true);
    }
  }
}

function createAvatar(id, nm, color, isMe, gender = 'male') {
  const g = new THREE.Group();
  const female = gender === 'female';
  const legPivots = [];
  const armPivots = [];
  const hairStrands = [];
  let skirtMesh = null, bodyMesh = null, headPivot = null, hairMat = null;
  const armRestZ = [];
  
  const mat = new THREE.MeshStandardMaterial({
    color: female ? 0x941832 : new THREE.Color(color), // فستان قرمزي ياقوتي أنيق للبنت
    roughness: .58,
    metalness: .12
  });
  const skin = new THREE.MeshStandardMaterial({
    color: female ? 0xffdfd0 : 0xf2cbba, // بشرة دافئة نقية ومتألقة
    roughness: .55,
    metalness: .02
  });

  // ---- الرقبة ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(female ? .058 : .082, female ? .075 : .105, female ? .16 : .20, 16), skin);
  neck.position.set(0, female ? 1.40 : 1.44, 0);
  neck.castShadow = true; g.add(neck);

  // ---- الجسم (رجل: ملابس كاجوال واقعية / أنثى: فستان قرمزي أنيق بنسب أنثوية متناسقة) ----
  if (female) {
    const dressMat = new THREE.MeshStandardMaterial({
      color: 0xc42042, // فستان قرمزي ياقوتي ملكي زاهٍ
      roughness: .54,
      metalness: .06,
      side: THREE.DoubleSide
    });

    // فستان أنثوي انسيابي منحوت كقطعة واحدة مستمرة (LatheGeometry) بدون أي فواصل أو حواف مشوهة
    const dressCurve = [
      new THREE.Vector2(0.058, 1.34), // ياقة العنق الناعمة
      new THREE.Vector2(0.135, 1.25), // الكتف والصدر العلوي
      new THREE.Vector2(0.155, 1.15), // الصدر
      new THREE.Vector2(0.120, 0.96), // الخصر الرشيق
      new THREE.Vector2(0.150, 0.82), // الورك
      new THREE.Vector2(0.220, 0.62), // انسياب التنورة
      new THREE.Vector2(0.310, 0.42), // منتصف الفستان
      new THREE.Vector2(0.360, 0.24)  // حافة الفستان السفلية
    ];
    const dressGeo = new THREE.LatheGeometry(dressCurve, 28);
    dressGeo.computeVertexNormals();
    const dressMesh = new THREE.Mesh(dressGeo, dressMat);
    dressMesh.castShadow = true;
    bodyMesh = dressMesh;
    skirtMesh = dressMesh;
    dressMesh.userData.avatarTorso = true;
    g.add(dressMesh);
  } else {
    const hoodieMat = new THREE.MeshStandardMaterial({ color: 0x223c58, roughness: .75 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: .8 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x141f2a, roughness: .8 });
    
    // جذع مقسم هندسياً لنسب بشرية واقعية مع محاذاة العرض
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(.27, .23, .56, 18), hoodieMat);
    torso.position.set(0, 1.08, 0); torso.scale.set(1.02, 1, .75); torso.castShadow = true; g.add(torso);
    torso.userData.avatarTorso = true;
    bodyMesh = torso;

    // حوض / أسفل الخصر بنسب متناسقة لا تبرز جانبياً
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(.235, .24, .18, 18), hoodieMat);
    pelvis.position.set(0, .74, 0); pelvis.scale.set(1.0, 1, .75); pelvis.castShadow = true; g.add(pelvis);

    // قميص داخلي وياقة
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(.20, .62, .04), shirtMat);
    shirt.position.set(0, 1.08, .215); g.add(shirt);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.12, .022, 8, 16, Math.PI), hoodieMat);
    collar.position.set(0, 1.34, .08); collar.rotation.x = Math.PI / 2.3; g.add(collar);

    [-1, 1].forEach(side => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(.11, .64, .05), hoodieMat);
      panel.position.set(side * .12, 1.08, .225); panel.rotation.z = side * -.03; g.add(panel);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(.010, .58, .01), trimMat);
      seam.position.set(side * .175, 1.08, .250); g.add(seam);
    });

    const zip = new THREE.Mesh(new THREE.BoxGeometry(.012, .62, .012),
      new THREE.MeshStandardMaterial({ color: 0xd8e0e2, metalness: .6, roughness: .3 }));
    zip.position.set(0, 1.08, .245); g.add(zip);

    const hood = new THREE.Mesh(new THREE.TorusGeometry(.19, .05, 8, 18, Math.PI), hoodieMat);
    hood.position.set(0, 1.34, -.12); hood.rotation.x = Math.PI / 2; hood.rotation.z = Math.PI; g.add(hood);
  }

  // ---- حقيبة الظهر 🎒 (للرجل) بستايل ببجي الواقعي وبأبعاد مدمجة ----
  if (!female) {
    hairMat = new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: .55 });
    const packMat = new THREE.MeshStandardMaterial({ color: 0x2e3b2b, roughness: .7 }); // أخضر عسكري ببجي
    const pack = new THREE.Mesh(new THREE.BoxGeometry(.32, .44, .16), packMat);
    pack.position.set(0, 1.12, -.24); pack.castShadow = true; g.add(pack);
    const packPocket = new THREE.Mesh(new THREE.BoxGeometry(.25, .20, .06), packMat);
    packPocket.position.set(0, 1.02, -.33); packPocket.castShadow = true; g.add(packPocket);
    [-.12, .12].forEach(x => {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(.045, .44, .030), packMat);
      strap.position.set(x, 1.15, .18); g.add(strap);
    });
  }

  // ---- الرأس والملامح البشرية ----
  // رأس أنثوي بيضاوي ناعم ورشيق / ورأس ذكوري محدد
  const head = new THREE.Mesh(new THREE.SphereGeometry(female ? .185 : .22, 28, 24), skin);
  head.userData.avatarHead = true;
  headPivot = new THREE.Group();
  headPivot.position.y = female ? 1.48 : 1.62; // ارتفاع متطابق مع الرقبة والكتفين تماماً
  headPivot.userData.avatarHeadPivot = true;
  headPivot.add(head); g.add(headPivot);
  head.scale.set(female ? .88 : .92, female ? 1.06 : 1.12, female ? .88 : .92);
  head.userData.baseScale = head.scale.clone();
  head.castShadow = true;

  // فك وذقن ناعمة ومحددة
  const chin = new THREE.Mesh(new THREE.SphereGeometry(female ? .065 : .085, 14, 12), skin);
  chin.position.set(0, female ? -.11 : -.13, female ? .08 : .095);
  chin.scale.set(1.0, .75, .95);
  headPivot.add(chin);

  [-1, 1].forEach(side => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(female ? .038 : .052, 12, 10), skin);
    ear.scale.set(.45, 1, .60);
    ear.position.set(side * (female ? .17 : .21), .01, -.02);
    headPivot.add(ear);
  });

  // عينان واقعيتان برموش وتفاصيل دقيقة مع جفن طبيعي
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xfffcf7, roughness: .25 });
  const faceRoot = headPivot;
  const irisMat = new THREE.MeshStandardMaterial({
    color: female ? 0x4a2a1a : 0x224a52, // عيون عسلية دافئة وجذابة
    roughness: .18, metalness: .12
  });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x05070a });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  [-1, 1].forEach(side => {
    const eyeSocket = new THREE.Group();
    eyeSocket.position.set(side * (female ? .068 : .080), female ? .035 : .042, female ? .170 : .198);
    eyeSocket.rotation.y = side * .05;
    faceRoot.add(eyeSocket);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(female ? .038 : .045, 16, 14), eyeWhite);
    eye.scale.set(1.15, .82, .58); eyeSocket.add(eye);

    const iris = new THREE.Mesh(new THREE.CircleGeometry(female ? .025 : .030, 20), irisMat);
    iris.position.set(0, 0, .026); eyeSocket.add(iris);

    const pupil = new THREE.Mesh(new THREE.CircleGeometry(female ? .012 : .015, 16), pupilMat);
    pupil.position.set(0, 0, .028); eyeSocket.add(pupil);

    const glint = new THREE.Mesh(new THREE.CircleGeometry(female ? .006 : .007, 10), glintMat);
    glint.position.set(.006, .006, .030); eyeSocket.add(glint);

    // رموش علوية جذابة
    const lash = new THREE.Mesh(new THREE.BoxGeometry(female ? .062 : .072, .008, .010),
      new THREE.MeshBasicMaterial({ color: 0x110c0e }));
    lash.position.set(0, .028, .024); lash.rotation.z = side * -.06; eyeSocket.add(lash);

    // حاجبان مرسومان بنعومة
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(.011, female ? .068 : .082, 3, 8),
      new THREE.MeshStandardMaterial({ color: female ? 0x241416 : 0x141210, roughness: .6 }));
    brow.position.set(side * (female ? .072 : .084), female ? .098 : .115, female ? .162 : .190);
    brow.rotation.z = side * -.12; faceRoot.add(brow);
  });

  // أنف منحوت طبيعي بدقة
  const noseBridge = new THREE.Mesh(new THREE.ConeGeometry(female ? .016 : .020, female ? .080 : .095, 8), skin);
  noseBridge.position.set(0, -.010, female ? .195 : .228); noseBridge.rotation.x = -.20; faceRoot.add(noseBridge);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(female ? .015 : .018, 10, 10), skin);
  noseTip.position.set(0, -.038, female ? .202 : .234); faceRoot.add(noseTip);

  // شفتان واقعيتان وممتلئتان بنعومة
  const lipMat = new THREE.MeshStandardMaterial({
    color: female ? 0xcc4460 : 0xab6f64, // أحمر شفاه كرزي دافئ
    roughness: .35
  });
  const lipTop = new THREE.Mesh(new THREE.CapsuleGeometry(female ? .010 : .011, female ? .055 : .065, 4, 8), lipMat);
  lipTop.position.set(0, female ? -.085 : -.102, female ? .180 : .208); lipTop.rotation.z = Math.PI / 2; faceRoot.add(lipTop);
  const lipBottom = new THREE.Mesh(new THREE.CapsuleGeometry(female ? .012 : .013, female ? .050 : .058, 4, 8), lipMat);
  lipBottom.position.set(0, female ? -.102 : -.120, female ? .178 : .205); lipBottom.rotation.z = Math.PI / 2; faceRoot.add(lipBottom);

  // حمرة خدود لطيفة للأنثى
  if (female) {
    const blushMat = new THREE.MeshBasicMaterial({ color: 0xff6b85, transparent: true, opacity: .28, depthWrite: false });
    [-1, 1].forEach(side => {
      const blush = new THREE.Mesh(new THREE.SphereGeometry(.028, 10, 8), blushMat);
      blush.scale.set(1, .45, .20);
      blush.position.set(side * .115, -.035, .155);
      faceRoot.add(blush);
    });
  }
  const faceHairMat = hairMat || new THREE.MeshStandardMaterial({ color: 0x5a2c3a, roughness: .5 });
  headPivot.traverse(part => { if (part.isMesh) part.userData.avatarHeadPart = true; });
  const hairMatForBack = faceHairMat;

  // شعر واقعي طبيعي محكم فوق الرأس فقط
  const hairBase = new THREE.Mesh(new THREE.SphereGeometry(.228, 24, 20, 0, Math.PI * 2, 0, Math.PI * .48), hairMatForBack);
  hairBase.userData.avatarHair = true;
  hairBase.position.set(0, .035, -.025);
  hairBase.scale.set(.96, 1.08, .98);
  hairBase.castShadow = true; headPivot.add(hairBase);

  if (!female) {
    // تسريحة شعر كلاسيكية عصرية ومحترمة (Realistic Fade / Comb style)
    const topHair = new THREE.Mesh(new THREE.CapsuleGeometry(.15, .14, 8, 14), hairMatForBack);
    topHair.position.set(0, .15, -.03);
    topHair.rotation.x = -.2;
    topHair.scale.set(1.05, .72, 1.15);
    topHair.castShadow = true; headPivot.add(topHair);

    // فرق جانبي وخصلات أمامية منسدلة طبيعية أعلى الجبهة (دون تغطية العيون)
    [-.09, -.03, .03, .09].forEach((x, i) => {
      const lock = new THREE.Mesh(new THREE.CapsuleGeometry(.024, .09, 4, 8), hairMatForBack);
      lock.position.set(x, .145, .145 - Math.abs(x) * .25);
      lock.rotation.x = .28;
      lock.rotation.z = (i - 1.5) * .12;
      lock.castShadow = true; headPivot.add(lock);
    });

    // شعر جانبي وخلفي نظيف
    [-1, 1].forEach(side => {
      const sideBurn = new THREE.Mesh(new THREE.BoxGeometry(.025, .09, .06), hairMatForBack);
      sideBurn.position.set(side * .205, .02, -.01);
      headPivot.add(sideBurn);
    });
  } else {
    // شعر أنثوي كستنائي داكن فاخر وانسيابي (Rich Flowing Layered Hair)
    const femaleHairMat = new THREE.MeshStandardMaterial({ color: 0x241418, roughness: .55, metalness: .08 });

    // قبة الشعر العلوية الناعمة
    const femaleHairTop = new THREE.Mesh(new THREE.CapsuleGeometry(.15, .15, 8, 16), femaleHairMat);
    femaleHairTop.position.set(0, .14, -.02);
    femaleHairTop.scale.set(1.05, .78, 1.15);
    femaleHairTop.castShadow = true; headPivot.add(femaleHairTop);

    // غرة أمامية أنثوية رقيقة تؤطر الوجه
    [-.08, -.03, .03, .08].forEach((x, i) => {
      const bang = new THREE.Mesh(new THREE.CapsuleGeometry(.022, .11, 4, 8), femaleHairMat);
      bang.position.set(x, .14, .145 - Math.abs(x) * .2);
      bang.rotation.x = .25;
      bang.rotation.z = (i - 1.5) * .1;
      bang.castShadow = true; headPivot.add(bang);
    });

    // خصلات جانبية متموجة تنحدر بنعومة على جانبي الصدر
    [-.15, .15].forEach(x => {
      const strand = new THREE.Mesh(new THREE.CapsuleGeometry(.032, .38, 4, 8), femaleHairMat);
      strand.position.set(x, .01, .08);
      strand.rotation.z = (x > 0 ? -1 : 1) * .14;
      strand.rotation.x = .1;
      strand.castShadow = true; headPivot.add(strand); hairStrands.push(strand);
    });

    // شعر خلفي طويل منسدل يتحرك بانسيابية مع المشي
    const backHair = new THREE.Mesh(new THREE.CapsuleGeometry(.065, .46, 4, 8), femaleHairMat);
    backHair.position.set(0, -.02, -.16);
    backHair.rotation.x = -.15;
    backHair.castShadow = true; headPivot.add(backHair); hairStrands.push(backHair);

    // فيونكة شعر قرمزية أنيقة في الخلف
    const ribbonMat = new THREE.MeshStandardMaterial({ color: 0x941832, roughness: .4, metalness: .2 });
    const ribbon = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), ribbonMat);
    ribbon.scale.set(1.4, .7, .6); ribbon.position.set(0, .12, -.18); headPivot.add(ribbon);
  }

  // ---- الذراعان بنسب وتشريح عضلي واقعي ومسافة كافية لمنع الدخول بالجذع ----
  [-1, 1].forEach((side, idx) => {
    const pivot = new THREE.Group();
    // إزاحة الأكتاف الأنثوية بنسب رشيقة طبيعية 0.22 متطابقة مع الجذع
    pivot.position.set(side * (female ? .22 : .42), female ? 1.23 : 1.22, 0);
    // زاوية ارتكاز ناعمة بمحاذاة الجسم
    pivot.rotation.z = side * (female ? -.08 : -.14);
    pivot.rotation.y = side * (female ? .02 : .08);
    const sleeveMat = female ? mat : new THREE.MeshStandardMaterial({ color: 0x223c58, roughness: .75 });
    
    // كتف / مفصل علوي
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(female ? .048 : .090, 12, 10), sleeveMat);
    shoulder.position.y = 0; shoulder.castShadow = true; pivot.add(shoulder);

    const bicep = new THREE.Mesh(new THREE.CylinderGeometry(female ? .044 : .070, female ? .036 : .060, female ? .26 : .32, 14), sleeveMat);
    bicep.position.y = -.16; bicep.castShadow = true; pivot.add(bicep);

    // كوع
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(female ? .038 : .058, 12, 10), sleeveMat);
    elbow.position.y = -.30; pivot.add(elbow);

    // ساعد بالجلد
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(female ? .036 : .058, female ? .028 : .046, female ? .24 : .26, 12), skin);
    forearm.position.y = -.42; forearm.castShadow = true; pivot.add(forearm);

    // كف اليد الناعم
    const hand = new THREE.Mesh(new THREE.BoxGeometry(female ? .040 : .070, female ? .068 : .090, female ? .022 : .038), skin);
    hand.position.set(side * -.006, -.56, .008); hand.castShadow = true; pivot.add(hand);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(female ? .014 : .020, female ? .030 : .040, female ? .016 : .024), skin);
    thumb.position.set(side * .024, -.54, .015); thumb.rotation.z = side * -.3; pivot.add(thumb);

    // ساعة يد تكتيكية باليسار للرجل
    if (side === -1 && !female) {
      const watch = new THREE.Mesh(new THREE.CylinderGeometry(.058, .058, .035, 12),
        new THREE.MeshStandardMaterial({ color: 0x111111, metalness: .7, roughness: .2 }));
      watch.position.y = -.56; pivot.add(watch);
    }

    pivot.userData.isAvatarArm = true; pivot.userData.side = side;
    pivot.userData.armIdx = idx;
    armRestZ.push(pivot.rotation.z); g.add(pivot); armPivots.push(pivot);
  });

  const legs = [];
  if (!female) {
    const jeansMat = new THREE.MeshStandardMaterial({ color: 0x222a32, roughness: .85 }); // بنطال جينز / كارغو
    const pocketMat = new THREE.MeshStandardMaterial({ color: 0x1c232a, roughness: .85 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: .5, metalness: .1 }); // حذاء عسكري PUBG
    const soleMat = new THREE.MeshStandardMaterial({ color: 0x2e2c28, roughness: .9 });

    [-.14, .14].forEach((x, index) => {
      const pivot = new THREE.Group(); pivot.position.set(x, .72, 0);

      // فخذ علوي
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(.125, .102, .42, 16), jeansMat);
      thigh.position.set(0, -.21, 0); thigh.castShadow = true; pivot.add(thigh);

      // جيب جانبي ستايل بنطال ببجي
      const legPocket = new THREE.Mesh(new THREE.BoxGeometry(.04, .14, .13), pocketMat);
      legPocket.position.set((x > 0 ? 1 : -1) * .115, -.20, 0); pivot.add(legPocket);

      // ركبة
      const knee = new THREE.Mesh(new THREE.SphereGeometry(.095, 12, 10), jeansMat);
      knee.position.set(0, -.42, .015); pivot.add(knee);

      // ساق سفلية
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(.095, .082, .36, 14), jeansMat);
      shin.position.set(0, -.58, 0); shin.castShadow = true; pivot.add(shin); legs.push(shin);

      // بوت تكتيكي واقعي
      const boot = new THREE.Mesh(new THREE.BoxGeometry(.17, .16, .28), bootMat);
      boot.position.set(0, -.72, .04); boot.castShadow = true; pivot.add(boot); shin.userData.shoe = boot;
      const bootFront = new THREE.Mesh(new THREE.CylinderGeometry(.082, .085, .14, 12), bootMat);
      bootFront.position.set(0, -.73, .12); bootFront.scale.set(1, .8, 1.2); pivot.add(bootFront);

      const sole = new THREE.Mesh(new THREE.BoxGeometry(.18, .045, .32), soleMat);
      sole.position.set(0, -.80, .05); pivot.add(sole);

      pivot.userData.baseY = .72; pivot.userData.phaseOffset = index * Math.PI;
      pivot.traverse(part => { if (part.isMesh) part.castShadow = true; });
      g.add(pivot); legPivots.push(pivot);
    });
  } else {
    const tightsMat = new THREE.MeshStandardMaterial({ color: 0x180a10, roughness: .82 }); // جوارب / تايتس راقية
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x240810, roughness: .45, metalness: .25 }); // بوت نسائي أنيق
    const buckleMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: .85, roughness: .2 });

    [-.095, .095].forEach((x, index) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, .68, 0); // نقطة ارتكاز الساقين من الحوض

      // فخذ رشيق
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(.078, .065, .36, 14), tightsMat);
      thigh.position.set(0, -.18, 0); thigh.castShadow = true; pivot.add(thigh);

      // ركبة ناعمة
      const knee = new THREE.Mesh(new THREE.SphereGeometry(.058, 10, 10), tightsMat);
      knee.position.set(0, -.36, .01); pivot.add(knee);

      // ساق سفلية
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(.058, .048, .32, 14), tightsMat);
      shin.position.set(0, -.51, 0); shin.castShadow = true; pivot.add(shin); legs.push(shin);

      // بوت أنيق بكعب وإبزيم ذهبي
      const boot = new THREE.Mesh(new THREE.BoxGeometry(.10, .14, .21), bootMat);
      boot.position.set(0, -.68, .03); boot.castShadow = true; pivot.add(boot); shin.userData.shoe = boot;

      const bootHeel = new THREE.Mesh(new THREE.BoxGeometry(.055, .06, .055), bootMat);
      bootHeel.position.set(0, -.77, -.04); pivot.add(bootHeel);

      const bootBuckle = new THREE.Mesh(new THREE.BoxGeometry(.06, .025, .015), buckleMat);
      bootBuckle.position.set(0, -.66, .13); pivot.add(bootBuckle);

      pivot.userData.baseY = .68; pivot.userData.phaseOffset = index * Math.PI;
      pivot.traverse(part => { if (part.isMesh) part.castShadow = true; });
      g.add(pivot); legPivots.push(pivot);
    });
  }

  const fallbackModel = new THREE.Group();
  fallbackModel.name = 'fallback-procedural-avatar';
  while (g.children.length) fallbackModel.add(g.children[0]);
  g.add(fallbackModel);

  if (isMe) {
    const halo = new THREE.Mesh(new THREE.RingGeometry(.42, .5, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: .6, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = .02; g.add(halo);
    g.userData.haloMesh = halo;

    // ضوء شخصي مزدوج (أمامي وخلفي) يرافق اللاعب ليبرز جمال وتفاصيل الشخصية من كل الزوايا
    const frontLight = new THREE.PointLight(female ? 0xffe2e8 : 0xffecd0, 1.25, 6.0, 1.4);
    frontLight.position.set(0, 1.6, 1.2);
    g.add(frontLight);

    const backLight = new THREE.PointLight(female ? 0xffced6 : 0xffdcc0, 1.25, 6.0, 1.4);
    backLight.position.set(0, 1.5, -1.2);
    g.add(backLight);
  }

  g.userData.avatarPose = { pitch: 0, torsoRoll: 0, headYaw: 0, headPitch: 0 };
  g.position.set(0, 0, 6);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
  const tag = document.createElement('div');
  tag.className = 'nameTag'; tag.textContent = nm; document.body.appendChild(tag);
  avatars.set(id, {
    id, group: g, visualRoot: fallbackModel, fallbackVisual: fallbackModel, mixer: null, actions: new Map(), animationActions: null, activeAnimation: null,
    head, headPivot, legs, legPivots, armPivots, armRestZ, hairStrands, skirtMesh, bodyMesh,
    walkPhase: 0, velocity: 0, runBlend: 0, gaitAmount: 0, turnLean: 0, moveDirX: 0, moveDirZ: 0,
    female, nameTagEl: tag, bubbleEl: null, idleT: Math.random() * 10, baseBodyY: bodyMesh ? bodyMesh.position.y : 1
  });
  const avatar = avatars.get(id);
  if (id === socket.id) resolveLocalAvatarReady(avatar);
  const targetModel = getAvatarTargetModelPath(avatar);
  if (targetModel) loadAvatarModel(avatar);
  return avatar;
}

function removeAvatar(id) {
  const avatar = avatars.get(id);
  if (!avatar) return;
  scene.remove(avatar.group);
  if (avatar.mixer) avatar.mixer.stopAllAction();
  avatar.nameTagEl.remove();
  if (avatar.bubbleEl) avatar.bubbleEl.remove();
  avatars.delete(id);
  const pc = peerConnections.get(id);
  if (pc) { pc.close(); peerConnections.delete(id); }
  const audio = peerAudioElements.get(id);
  if (audio) { audio.srcObject = null; peerAudioElements.delete(id); }
}

// ==================== الشبكة (Socket.io) ====================
const counterEl = document.getElementById('counter');
const others = new Map(); // id -> {x,z,rot,tx,tz,trot}

socket.on('connect_error', error => {
  console.error('Museum connection failed:', error.message);
  if (error.message === 'museum-password-required') {
    setMuseumPasswordGate = true;
    if (!sceneReady.api) {
      setLoadingMessage('أدخل كلمة سر المتحف من صفحة الدخول.', true);
      if (!loadingEl.querySelector('.loading-retry')) {
        const retry = document.createElement('button');
        retry.className = 'loading-retry'; retry.textContent = 'العودة لصفحة الدخول';
        retry.onclick = () => { sessionStorage.removeItem('mm_access_token'); location.href = '/'; };
        loadingEl.appendChild(retry);
      }
      clearTimeout(loadingWatchdog);
    }
  }
});

socket.on('connect', () => {
  socket.emit('join', { name, color: myColor, gender: myGender });
  if (!avatars.has(socket.id)) createAvatar(socket.id, name, myColor, true, myGender);
  if (setMuseumPasswordGate) {
    setMuseumPasswordGate = false;
    clearTimeout(loadingWatchdog);
    loadingEl.classList.remove('loading-failed');
    if (sceneReady.render) sceneReady.api = sceneReady.frame = sceneReady.model = true;
    if (sceneReady.api && sceneReady.frame && sceneReady.model && sceneReady.render) revealScene(true);
  }
  counterEl.innerHTML = `<b>${name}</b> هنا الآن ✨`;
});

socket.on('count', n => {
  const names = [name, ...[...others.values()].map(o => o.name)];
  counterEl.innerHTML = n <= 1
    ? `أنت هنا الآن... شارك الرابط 💞`
    : `<b>${names.slice(0, 3).join(' و')}</b> هنا الآن (${n}) 💕`;
});

socket.on('players', list => {
  list.filter(p => p.id !== socket.id).forEach(p => {
    if (!avatars.has(p.id)) {
      createAvatar(p.id, p.name, p.color, false, p.gender);
      others.set(p.id, { name: p.name, color: p.color, x: p.x, z: p.z, rot: p.rot, tx: p.x, tz: p.z, trot: p.rot });
    }
  });
  socket.emit('count-request'); // تحديث العداد
});

socket.on('player-joined', p => {
  if (p.id === socket.id || avatars.has(p.id)) return;
  createAvatar(p.id, p.name, p.color, false, p.gender);
  others.set(p.id, { name: p.name, color: p.color, x: p.x, z: p.z, rot: p.rot, tx: p.x, tz: p.z, trot: p.rot });
  addChatLine('النظام', `${p.name} دخل المتحف 👋`);
  socket.emit('count-request');
});

socket.on('player-moved', m => {
  const o = others.get(m.id);
  if (o) { o.tx = m.x; o.tz = m.z; o.trot = m.rot; }
});

socket.on('player-left', id => {
  const o = others.get(id);
  if (o) addChatLine('النظام', `${o.name} خرج من المتحف`);
  removeAvatar(id); others.delete(id);
});

socket.on('bubble', ({ id, text }) => {
  const a = avatars.get(id);
  if (!a) return;
  if (text) showBubble(a, text);
  else removeBubble(a);
});

socket.on('emoji', ({ id, emoji }) => {
  const a = avatars.get(id);
  if (a) floatEmoji(a, emoji);
});

socket.on('museum-updated', d => {
  lastFrameData = d.frames || [];
  buildFrames(lastFrameData);
  characterModelPath = d.characterModel || '';
  characterModelMalePath = d.characterModelMale || d.characterModel || '';
  characterModelFemalePath = d.characterModelFemale || '';
  characterAnimationPaths = d.characterAnimations || [];
  avatars.forEach(avatar => {
    loadAvatarModel(avatar, true);
  });
});

// تحديث العداد عند الطلب
socket.on('count', () => { });
socket.io.on('reconnect', () => location.reload());

// ==================== حركة اللاعب ====================
const keys = {};
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, button')) return;
  keys[e.code] = true;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { Object.keys(keys).forEach(code => { keys[code] = false; }); resetJoystick(); });

// عصا تحكم لمسية/ماوس عبر Pointer Events حتى تعمل على الجوال والكمبيوتر.
const joy = document.getElementById('joystick'), knob = document.getElementById('knob');
let joyVec = { x: 0, y: 0 }, joyActive = false, joyId = null;
function moveJoystick(clientX, clientY) {
  const r = joy.getBoundingClientRect();
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  const knobRadius = knob.offsetWidth / 2;
  const max = Math.max(1, r.width / 2 - knobRadius - 4);
  const length = Math.hypot(dx, dy);
  const scale = length > max ? max / length : 1;
  const clampedX = dx * scale, clampedY = dy * scale;
  knob.style.left = `calc(50% + ${clampedX}px)`;
  knob.style.top = `calc(50% + ${clampedY}px)`;

  const rawX = clampedX / max, rawY = clampedY / max;
  const magnitude = Math.hypot(rawX, rawY);
  const deadZone = .08;
  const strength = magnitude <= deadZone ? 0 : Math.min(1, (magnitude - deadZone) / (1 - deadZone));
  joyVec = magnitude ? { x: rawX / magnitude * strength, y: rawY / magnitude * strength } : { x: 0, y: 0 };
}
joy.addEventListener('pointerdown', e => {
  if (joyActive) return;
  joyActive = true; joyId = e.pointerId;
  joy.setPointerCapture(e.pointerId);
  moveJoystick(e.clientX, e.clientY);
  e.preventDefault();
});
joy.addEventListener('pointermove', e => {
  if (!joyActive || e.pointerId !== joyId) return;
  moveJoystick(e.clientX, e.clientY);
  e.preventDefault();
});
const resetJoystick = e => {
  if (e && (!joyActive || e.pointerId !== joyId)) return;
  joyActive = false; joyId = null; joyVec = { x: 0, y: 0 };
  knob.style.left = '50%'; knob.style.top = '50%';
};
joy.addEventListener('pointerup', resetJoystick);
joy.addEventListener('pointercancel', resetJoystick);
joy.addEventListener('lostpointercapture', resetJoystick);

let meYaw = Math.PI; // اتجاه اللاعب
let cameraYaw = Math.PI; // زاوية دوران الكاميرا
let cameraPitch = 0.28; // زاوية ارتفاع الكاميرا
Object.defineProperty(window, 'cameraYaw', { configurable: true, get: () => cameraYaw, set: value => { if (Number.isFinite(value)) cameraYaw = value; } });
Object.defineProperty(window, 'cameraPitch', { configurable: true, get: () => cameraPitch, set: value => { if (Number.isFinite(value)) cameraPitch = value; } });
let moveSent = 0;
const SPEED = 11.4;
const WALK_SPEED = 1.10;
const RUN_SPEED = 1.95;
let worldMoveYaw = Math.PI;
let sitting = null; // المقعد اللي اللاعب قاعد عليه
let myAction = null; // 'jump' | 'dance'
let actionT = 0; // توقيت الأنيميشن (مجمل على اللاعب داخل applyAction)
let camView = 0; // 0 خلفي (TPP) | 1 منظور الشخص الأول (FPP) | 2 منظور قريب | 3 من فوق
let mouseDrag = null; // سحب الماوس للتفريق
let dragYaw = 0, dragPitch = 0; // زوايا الكاميرا الإضافية

// ---- متغيرات PUBG: الميلان (Peak/Lean) والقفز السلس بالمسافة (Space) وفحص الاصطدام بالصور ----
let lastFrameData = [];
let pubgLean = 0; // -1 يسار (Q) | +1 يمين (E) | 0 طبيعي
let isJumping = false;
let jumpVelocityY = 0;
let avatarOffsetY = 0;
const GRAVITY = 19.0;
const JUMP_FORCE = 7.5;

// عناصر واجهة فتح الصورة ومنظور الشخص الأول
const imageModal = document.getElementById('imageModal');
const imageModalImg = document.getElementById('imageModalImg');
const imageModalTitle = document.getElementById('imageModalTitle');
const imageModalClose = document.getElementById('imageModalClose');
const modalPrevBtn = document.getElementById('modalPrevBtn');
const modalNextBtn = document.getElementById('modalNextBtn');
const openPhotoBtn = document.getElementById('openPhotoBtn');
const crosshair = document.getElementById('crosshair');
const btnLeanLeft = document.getElementById('btnLeanLeft');
const btnLeanRight = document.getElementById('btnLeanRight');

let currentModalIndex = 0;
function openImageModal(index) {
  if (!lastFrameData || !lastFrameData.length) return;
  currentModalIndex = ((index % lastFrameData.length) + lastFrameData.length) % lastFrameData.length;
  const item = lastFrameData[currentModalIndex];
  if (!item) return;
  imageModalImg.src = item.img;
  imageModalTitle.textContent = item.title || `صورة الذكرى (${currentModalIndex + 1}/${lastFrameData.length})`;
  imageModal.classList.add('open');
}
function closeImageModal() {
  imageModal.classList.remove('open');
}
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
if (imageModalClose) imageModalClose.onclick = closeImageModal;
if (modalPrevBtn) modalPrevBtn.onclick = () => openImageModal(currentModalIndex - 1);
if (modalNextBtn) modalNextBtn.onclick = () => openImageModal(currentModalIndex + 1);
if (imageModal) {
  imageModal.onclick = e => {
    if (e.target === imageModal) closeImageModal();
  };
}

// أزرار الميلان اللمسية للموبايل
if (btnLeanLeft) {
  btnLeanLeft.onpointerdown = e => { e.preventDefault(); pubgLean = pubgLean === -1 ? 0 : -1; updateLeanButtons(); };
}
if (btnLeanRight) {
  btnLeanRight.onpointerdown = e => { e.preventDefault(); pubgLean = pubgLean === 1 ? 0 : 1; updateLeanButtons(); };
}
function updateLeanButtons() {
  if (btnLeanLeft) btnLeanLeft.classList.toggle('active', pubgLean === -1);
  if (btnLeanRight) btnLeanRight.classList.toggle('active', pubgLean === 1);
}

// أسماء المناظير الأربعة
const viewNames = ['منظور ثالث (TPP) 👤', 'منظور شخص أول (FPP) 🎯', 'منظور قريب 🤳', 'منظور علوي 🚁'];

function switchView(nextView = null) {
  if (nextView !== null) camView = nextView;
  else camView = (camView + 1) % 4;
  
  if (camView === 1) { // FPP (منظور الشخص الأول)
    cameraPitch = 0.05;
    zoomDist = 0.15;
    if (crosshair) crosshair.classList.add('visible');
  } else {
    if (crosshair) crosshair.classList.remove('visible');
    if (camView === 0) { cameraPitch = 0.28; zoomDist = 6.2; }
    else if (camView === 2) { cameraPitch = 0.22; zoomDist = 3.2; }
    else if (camView === 3) { cameraPitch = 0.75; zoomDist = 8.8; }
  }
  showToast('المنظور: ' + viewNames[camView]);
}

// ---- تغيير المنظور: زر V + زر في الشاشة + مفاتيح PUBG ----
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea')) return;
  if (e.code === 'KeyV') {
    switchView();
  } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
    if (!horrorInteractionTarget || e.code === 'KeyQ') {
      pubgLean = pubgLean === (e.code === 'KeyQ' ? -1 : 1) ? 0 : (e.code === 'KeyQ' ? -1 : 1);
      updateLeanButtons();
    }
  } else if (e.code === 'Space') {
    if (!sitting && !isJumping) {
      isJumping = true;
      jumpVelocityY = JUMP_FORCE;
      playStep('run');
    }
  } else if (e.code === 'Escape') {
    closeImageModal();
  }
});
// اسحب على المشهد لتدوير الكاميرا؛ حركة المؤشر الحرة لا تغيّر اتجاهها.
const cameraCanvas = renderer.domElement;
let pointerDownTime = 0;
let pointerDownPos = { x: 0, y: 0 };

cameraCanvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('#toolbar, #chatPanel, #emojiPanel, #joystick, #questBox, #collectPrompt, #victoryBanner, #imageModal, #openPhotoBtn, .lean-btn')) return;
  pointerDownTime = performance.now();
  pointerDownPos = { x: e.clientX, y: e.clientY };
  mouseDrag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  cameraCanvas.setPointerCapture(e.pointerId);
});
cameraCanvas.addEventListener('pointermove', e => {
  if (!mouseDrag || e.pointerId !== mouseDrag.id) return;
  const dx = e.clientX - mouseDrag.x;
  const dy = e.clientY - mouseDrag.y;
  cameraYaw -= dx * .0045;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * .0032, camView === 1 ? -.8 : -.2, camView === 1 ? .85 : 1.1);
  mouseDrag.x = e.clientX;
  mouseDrag.y = e.clientY;
});
const stopCameraDrag = e => {
  if (!mouseDrag || (e && e.pointerId !== mouseDrag.id)) return;
  if (cameraCanvas.hasPointerCapture(mouseDrag.id)) cameraCanvas.releasePointerCapture(mouseDrag.id);
  
  // فحص النقر المباشر (Click) للتفاعل مع اللوحات وفتح الصورة
  const dtClick = performance.now() - pointerDownTime;
  const distClick = e ? Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) : 999;
  if (dtClick < 280 && distClick < 8 && e) {
    handleClickToOpenPhoto(e.clientX, e.clientY);
  }

  mouseDrag = null;
};
cameraCanvas.addEventListener('pointerup', stopCameraDrag);
cameraCanvas.addEventListener('pointercancel', stopCameraDrag);
cameraCanvas.addEventListener('lostpointercapture', () => { mouseDrag = null; });

// النقر على برواز الصورة لفتحها مباشرة بدقة كاملة
function handleClickToOpenPhoto(clientX, clientY) {
  const mouse = new THREE.Vector2(
    (clientX / innerWidth) * 2 - 1,
    -(clientY / innerHeight) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, camera);
  const frameMeshes = [];
  scene.children.filter(c => c.userData.isFrame).forEach(g => {
    g.traverse(ch => { if (ch.isMesh) { ch.userData.parentFrameGroup = g; frameMeshes.push(ch); } });
  });
  const hits = ray.intersectObjects(frameMeshes, false);
  if (hits.length) {
    const targetGroup = hits[0].object.userData.parentFrameGroup;
    if (targetGroup && targetGroup.userData.frameIndex !== undefined) {
      openImageModal(targetGroup.userData.frameIndex);
    }
  }
}
// عجلة الماوس = زووم
addEventListener('wheel', e => {
  zoomDist = THREE.MathUtils.clamp(zoomDist + e.deltaY * .004, 2, 10);
}, { passive: true });
let zoomDist = 6.2;

// تقريب وتبعيد باللمس بالأصبعين على الموبايل (Pinch to Zoom)
let initialPinchDist = null;
let initialPinchZoom = 5.2;
cameraCanvas.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    initialPinchDist = Math.hypot(dx, dy);
    initialPinchZoom = zoomDist;
  }
}, { passive: true });
cameraCanvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && initialPinchDist) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const currentDist = Math.hypot(dx, dy);
    const scale = initialPinchDist / Math.max(1, currentDist);
    zoomDist = THREE.MathUtils.clamp(initialPinchZoom * scale, 2.2, 9.5);
  }
}, { passive: true });
cameraCanvas.addEventListener('touchend', e => {
  if (e.touches.length < 2) initialPinchDist = null;
}, { passive: true });

// ---- زر القفز 🦘 والرقص 💃 ولوحة الحركات التعبيرية 🕺 ----
const emotesPanel = document.getElementById('emotesPanel');
const btnEmotes = document.getElementById('btnEmotes');

if (btnEmotes) {
  btnEmotes.onclick = () => {
    chatPanel.classList.remove('open');
    emojiPanel.classList.remove('open');
    emotesPanel.classList.toggle('open');
  };
}

// أزرار الحركات داخل لوحة الـ Emotes
if (emotesPanel) {
  emotesPanel.querySelectorAll('.emote-btn').forEach(btn => {
    btn.onclick = () => {
      if (sitting) return;
      const act = btn.getAttribute('data-action');
      myAction = (myAction === act) ? null : act;
      actionT = 0;
      socket.emit('action', { action: myAction });
      emotesPanel.querySelectorAll('.emote-btn').forEach(b => b.classList.remove('active'));
      if (myAction) btn.classList.add('active');
      const label = btn.textContent.trim();
      showToast(myAction ? `حركة تعبيرية: ${label}` : 'إيقاف الحركة');
      emotesPanel.classList.remove('open');
    };
  });
}

document.getElementById('btnJump').onclick = () => {
  if (sitting) return;
  myAction = (myAction === 'jump') ? null : 'jump';
  actionT = 0;
  socket.emit('action', { action: myAction });
  showToast(myAction === 'jump' ? 'اقفز معايا! 🦘' : 'رجعنا نمشي 😄');
};
document.getElementById('btnDance').onclick = () => {
  if (sitting) return;
  myAction = (myAction === 'dance') ? null : 'dance';
  actionT = 0;
  socket.emit('action', { action: myAction });
  showToast(myAction === 'dance' ? 'يلا نرقص! 🎶💃' : 'خلصنا رقص 😄');
};

socket.on('action', ({ id, action }) => {
  const a = avatars.get(id);
  if (a) {
    a.action = action;
    a.actionT = 0;
    a.emoteStartedAt = performance.now();
    if (a.modelLoaded && action && a.animationActions?.has(action)) {
      chooseAnimation(a, action);
      if (a.activeAnimation) {
        a.activeAnimation.timeScale = 1;
        a.activeAnimation.setLoop(THREE.LoopOnce, 1);
        a.activeAnimation.clampWhenFinished = true;
      }
    }
  }
});

let roomIndicator = null;
let activeRoom = -1;

function getRoomIndex(z) {
  const index = ROOM_CENTERS.findIndex(center => Math.abs(z - center) <= ROOM_D / 2);
  return index < 0 ? -1 : index;
}

function updateRoomIndicator(index) {
  if (!roomIndicator) return;
  if (index < 0 || index === activeRoom) return;
  activeRoom = index;
  const names = HALL_NAMES;
  roomIndicator.textContent = '✨ ' + names[index];
  roomIndicator.classList.remove('show');
  requestAnimationFrame(() => roomIndicator.classList.add('show'));
  clearTimeout(roomIndicator.hideTimer);
  roomIndicator.hideTimer = setTimeout(() => roomIndicator.classList.remove('show'), 2200);
}

function updateMe(dt) {
  if (!roomIndicator) roomIndicator = document.getElementById('roomIndicator');
  
  // أي حركة تلغي القفز/الرقص
  if (myAction && (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight || Math.hypot(joyVec.x, joyVec.y) > .12)) {
    myAction = null;
    socket.emit('action', { action: null });
  }

  // المصباح الومضي يتبع اتجاه الكاميرا، وشغله/إطفاؤه بالمفتاح F أو زر الهاتف.
  if (flashlight && flashlightEnabled) {
    camera.updateMatrixWorld();
    flashlight.target.position.set(0, -0.08, -1).applyMatrix4(camera.matrixWorld);
    flashlight.target.updateMatrixWorld();
    flashlight.position.set(0.03, -0.04, -0.02).applyMatrix4(camera.matrixWorld);
  }

  // في ببجي: Q و E مخصصان للميلان (Peak / Lean)، وعند عدم الميلان يمكن تدوير الكاميرا بالأسهم
  if (keys.ArrowRight && !sitting) cameraYaw -= dt * 2.5;
  if (keys.ArrowLeft && !sitting) cameraYaw += dt * 2.5;

  let fx = 0, fz = 0;
  if (sitting) {
    // وهو قاعد: أي حركة = قوم من المقعد
    if (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight || Math.hypot(joyVec.x, joyVec.y) > .12) {
      standUp();
    }
  } else {
    if (keys.KeyW || keys.ArrowUp) fz -= 1;
    if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
    fx += joyVec.x; fz += joyVec.y;
  }

  const a = avatars.get(socket.id);
  if (!a) return;

  // التقط العناصر فقط عند وجودها فعلياً في متناول اللاعب؛ E للتفاعل وF للمصباح.
  if (keys.KeyF) {
    keys.KeyF = false;
    flashlightEnabled = !flashlightEnabled;
    if (flashlight) flashlight.visible = flashlightEnabled;
    const stateLabel = document.getElementById('flashlightState');
    const btn = document.getElementById('btnFlashlight');
    const hint = document.getElementById('flashlightHint');
    if (stateLabel) stateLabel.textContent = flashlightEnabled ? 'المصباح مضاء' : 'المصباح مطفأ';
    if (btn) btn.classList.toggle('active', flashlightEnabled);
    if (hint) hint.textContent = flashlightEnabled ? '🔦 F لإطفاء المصباح' : '🔦 F لتشغيل المصباح';
    socket.emit('horror-player-state', { x: a.group.position.x, z: a.group.position.z, flashlight: flashlightEnabled, panic: Math.round(fearMeter) });
  }

  if (keys.KeyE && !puzzleState.riddleOpen) {
    keys.KeyE = false;
    if (horrorInteractionTarget?.type === 'skull') collectSkull(horrorInteractionTarget.object);
    else if (horrorInteractionTarget?.type === 'puzzle') completeChallengeAction(horrorInteractionTarget.object);
    else if (horrorInteractionTarget?.type === 'floor-trap') triggerFloorTrap(a);
    else if (horrorInteractionTarget?.type === 'blade-trap') triggerBladeTrap(a);
    if (pubgLean === 1) { pubgLean = 0; updateLeanButtons(); }
  }

  // ---- فيزياء قفز ببجي (Space jump with gravity) ----
  if (isJumping) {
    avatarOffsetY += jumpVelocityY * dt;
    jumpVelocityY -= GRAVITY * dt;
    if (avatarOffsetY <= 0) {
      avatarOffsetY = 0;
      isJumping = false;
      jumpVelocityY = 0;
      playStep('walk');
    }
  }

  if (myAction && (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight || Math.hypot(joyVec.x, joyVec.y) > .12)) {
    myAction = null;
    socket.emit('action', { action: null });
  }

  if (sitting && joyActive && Math.hypot(joyVec.x, joyVec.y) > .12) standUp();
  if (sitting) {
    // وضعية الجلوس: الشخصية على المقعد
    a.group.position.set(sitting.x, sitting.seatY - (a.female ? 0 : .42), sitting.z);
    a.group.rotation.y += (sitting.ry - a.group.rotation.y) * Math.min(1, dt * 8);
    meYaw = sitting.ry;
    animateLimbs(a, false, dt);
    // وضعية الجلوس: أرجل للأمام وأذرع مرتاحة
    if (a.armPivots) {
      a.armPivots[0].rotation.x = -.5;
      a.armPivots[1].rotation.x = -.5;
    }
    if (a.female) {
      a.legs[0].position.z = .25; a.legs[1].position.z = .25;
    }
    if (!a.modelLoaded) {
      a.legPivots.forEach(pivot => { pivot.rotation.x = -.12; pivot.position.y = pivot.userData.baseY; });
      if (!a.female) a.legPivots.forEach(pivot => { pivot.rotation.x = -1.15; });
    }
    chooseAnimation(a, a.modelLoaded ? 'sit' : 'idle');
    if (a.mixer) a.mixer.update(dt);
    a.velocity = 0; a.runBlend = 0; a.gaitAmount = 0;
    a.armPivots.forEach((arm, i) => { arm.rotation.x = -.5; arm.rotation.z = a.armRestZ[i]; });
    a.group.userData.avatarPose.pitch = 0;
    a.group.userData.avatarPose.torsoRoll = 0;
    a.group.userData.avatarPose.headYaw = 0;
    a.group.userData.avatarPose.headPitch = 0;
    a.group.rotation.x = a.group.rotation.z = 0;
    a.headPivot.rotation.set(0, 0, 0);
    a.bodyMesh.rotation.set(0, 0, 0);
    moveSent += dt;
    if (moveSent > .08) {
      moveSent = 0;
      socket.emit('move', { x: a.group.position.x, z: a.group.position.z, rot: a.group.rotation.y });
    }
    const sitCamDist = 4.4;
    const sitPitch = THREE.MathUtils.clamp(cameraPitch, -.12, .6);
    const cx = sitting.x + Math.sin(cameraYaw) * sitCamDist;
    const cz = sitting.z + Math.cos(cameraYaw) * sitCamDist;
    const cy = sitting.seatY + sitCamDist * Math.sin(sitPitch) + .9;
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 5));
    camera.lookAt(sitting.x, sitting.seatY + .65, sitting.z);
    frameInfo.style.display = 'none';
    if (openPhotoBtn) openPhotoBtn.style.display = 'none';
    return;
  }

  let inputLength = Math.hypot(fx, fz);
  const hasInput = inputLength > .08;
  const touchRun = matchMedia('(pointer: coarse)').matches && Math.hypot(joyVec.x, joyVec.y) > .92;
  const targetRunBlend = hasInput && (keys.ShiftLeft || keys.ShiftRight || touchRun) ? 1 : 0;
  a.runBlend = THREE.MathUtils.damp(a.runBlend || 0, targetRunBlend, hasInput ? 8 : 12, dt);
  a.gaitAmount = THREE.MathUtils.damp(a.gaitAmount || 0, hasInput ? Math.min(inputLength, 1) : 0, hasInput ? 12 : 10, dt);
  const targetSpeed = THREE.MathUtils.lerp(WALK_SPEED, RUN_SPEED, a.runBlend) * Math.min(inputLength, 1);
  a.velocity = THREE.MathUtils.damp(a.velocity || 0, targetSpeed, hasInput ? 11 : 12, dt);
  if (hasInput && inputLength > .0001) {
    a.moveDirX = fx / inputLength;
    a.moveDirZ = fz / inputLength;
  }
  const moving = a.velocity > .035;
  const walkMode = a.runBlend > .5 ? 'run' : 'walk';

  // حساب اتجاه الحركة الحقيقي المعتمد على اتجاه الكاميرا مثل PUBG
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  camForward.y = 0;
  camForward.normalize();
  const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

  if (moving && hasInput) {
    // تركيب اتجاه الحركة بالنسبة للكاميرا: -fz للأمام، +fx لليمين
    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(camForward, -fz);
    moveDir.addScaledVector(camRight, fx);
    if (moveDir.lengthSq() > 0.0001) moveDir.normalize();

    const sprintBoost = a.female ? 1.08 : 1;
    const s = SPEED * a.velocity * dt * sprintBoost;
    const dx = moveDir.x * s;
    const dz = moveDir.z * s;
    let nx = a.group.position.x, nz = a.group.position.z;
    if (isWalkablePosition(nx + dx, nz)) nx += dx;
    if (isWalkablePosition(nx, nz + dz)) nz += dz;
    a.group.position.x = nx; a.group.position.z = nz;

    const moveAngle = Math.atan2(moveDir.x, moveDir.z);
    worldMoveYaw = moveAngle;
    
    // في منظور الشخص الأول FPP، يتطابق دوران اللاعب تماماً مع زاوية الكاميرا لسرعة ودقة استجابة ببجي
    if (camView === 1) {
      a.group.rotation.y = cameraYaw + Math.PI;
      meYaw = a.group.rotation.y;
    } else {
      const yawDelta = Math.atan2(Math.sin(moveAngle - a.group.rotation.y), Math.cos(moveAngle - a.group.rotation.y));
      a.group.rotation.y += yawDelta * (1 - Math.exp(-14 * dt));
      meYaw = a.group.rotation.y;
      a.turnLean = THREE.MathUtils.damp(a.turnLean || 0, THREE.MathUtils.clamp(yawDelta * 1.5, -.6, .6), 8, dt);
    }

    const cadence = walkMode === 'run' ? 9.8 : 7.2;
    a.walkPhase = (a.walkPhase + dt * cadence * THREE.MathUtils.clamp(a.velocity / Math.max(targetSpeed, .1), .35, 1.2)) % (Math.PI * 2);
    a.footstepDistance = (a.footstepDistance || 0) + SPEED * a.velocity * dt;
    // مسافة خطوة دقيقة متطابقة مع خطوات المجسم البشري لمنع التزحلق
    const stepInterval = walkMode === 'run' ? 1.95 : 1.55;
    if (a.footstepDistance >= stepInterval) {
      a.footstepDistance %= stepInterval;
      playStep(walkMode);
    }
  } else {
    // تباطؤ طبيعي بقصور ذاتي (Inertia) بدلاً من التوقف المفاجئ
    a.velocity = THREE.MathUtils.damp(a.velocity || 0, 0, 8, dt);
    a.walkPhase = (a.walkPhase + dt * 2) % (Math.PI * 2);
    a.turnLean = THREE.MathUtils.damp(a.turnLean || 0, 0, 6, dt);
    if (camView === 1) {
      a.group.rotation.y = cameraYaw + Math.PI;
      meYaw = a.group.rotation.y;
    }
  }

  // تطبيق ارتفاع القفز على المجسم
  a.group.position.y = avatarOffsetY;

  const animationState = isJumping ? 'jump' : (myAction || (moving ? (a.runBlend > .5 ? 'run' : 'walk') : 'idle'));
  if (a.modelLoaded) {
    chooseAnimation(a, animationState);
    if (a.mixer) a.mixer.update(dt);
    applyAction(a, isJumping ? 'jump' : myAction, dt);

    // مزامنة سرعة الحركة المباشرة مع سرعة الرسوم لحذف أي تزحلق للأقدام
    if (a.activeAnimation) {
      if (animationState === 'walk') {
        a.activeAnimation.timeScale = THREE.MathUtils.clamp(a.velocity / 0.58, 0.75, 1.35);
      } else if (animationState === 'run') {
        a.activeAnimation.timeScale = THREE.MathUtils.clamp(a.velocity / 0.95, 0.85, 1.4);
      } else {
        a.activeAnimation.timeScale = 1.0;
      }
    }
  } else {
    // إذا كان يقوم بحركة تعبيرية، لا نترك animateLimbs تعيد الذراعين لوضع المشي
    animateLimbs(a, moving, dt, { runBlend: a.runBlend || 0, gait: a.gaitAmount || 0, turnLean: a.turnLean || 0, idle: !moving, hasAction: Boolean(myAction) });
    applyAction(a, isJumping ? 'jump' : myAction, dt);
  }

  // إذا لم يكن يقفز ولم يكن يستخدم الموديل المرفوع (لأن الموديل المرفوع يحتوي على اهتزاز طبيعي مدمج)
  if (!isJumping && !a.modelLoaded) {
    a.group.position.y += Math.sin(a.walkPhase * 2) * THREE.MathUtils.lerp(.02, .048, a.runBlend || 0) * (a.gaitAmount || 0);
  }

  // ميلان خفيف للجذع؛ Q/E يزيحان الكاميرا فعلياً لتفادي انحناء الشخصية بشكل حاد.
  const leanAngle = 0;
  a.group.userData.avatarPose.torsoRoll = THREE.MathUtils.damp(a.group.userData.avatarPose.torsoRoll || 0, leanAngle, 10, dt);
  const totalRoll = a.group.userData.avatarPose.torsoRoll + (moving ? a.turnLean * 0.08 : 0);
  a.group.rotation.z = THREE.MathUtils.damp(a.group.rotation.z, totalRoll, 10, dt);
  a.group.rotation.x = a.group.userData.avatarPose.pitch;

  updateRoomIndicator(getRoomIndex(a.group.position.z));

  // إرسال الحركة كل 80ms
  moveSent += dt;
  if (moveSent > .08) {
    moveSent = 0;
    socket.emit('move', { x: a.group.position.x, z: a.group.position.z, rot: a.group.rotation.y });
  }

  // ---- زر F للمصباح؛ يمكن الجلوس بزر المقعد فقط، حتى لا يتداخل الاختصار مع الكشاف ----
  // الجلوس يتم عبر sitPrompt/زر المقعد في الواجهة.

  // ==================== كاميرا ببجي (FPP / TPP مع إزاحة الميلان) ====================
  // إزاحة كاميرا الكتف: Q/E تمنح Peek يسار/يمين مع بقاء التصويب للأمام.
  const leanOffset = new THREE.Vector3().copy(camRight).multiplyScalar(pubgLean * (camView === 1 ? 0.22 : 0.42));

  if (camView === 1) {
    // ---- منظور الشخص الأول (FPP) ----
    // الكاميرا مكان عيني اللاعب مباشرة على ارتفاع 1.62m + حركة التنفس والمشي
    const headBob = moving ? Math.sin(a.walkPhase * 2) * 0.045 : Math.sin(performance.now() * 0.002) * 0.015;
    const eyeY = 1.60 + avatarOffsetY + headBob;
    const eyePos = new THREE.Vector3(
      a.group.position.x + leanOffset.x,
      eyeY,
      a.group.position.z + leanOffset.z
    );

    camera.position.copy(eyePos);
    
    // توجيه نظر الكاميرا بحرية كاملة بالماوس في الـ FPP
    const fppLookTarget = new THREE.Vector3(
      eyePos.x - Math.sin(cameraYaw) * Math.cos(cameraPitch),
      eyePos.y - Math.sin(cameraPitch),
      eyePos.z - Math.cos(cameraYaw) * Math.cos(cameraPitch)
    );
    camera.lookAt(fppLookTarget);

    // إخفاء مجسم الشخصية المحلية في الـ FPP حتى لا يحجب الرؤية
    if (a.model) a.model.visible = false;
    if (a.visualRoot) a.visualRoot.visible = false;
    if (a.fallbackVisual) a.fallbackVisual.visible = false;
  } else {
    // ---- منظور الشخص الثالث (TPP) ----
    if (a.modelLoaded && a.model) {
      // إخفاء وحذف مجسم اللعبة الافتراضي تماماً وعرض المجسم المرفوع فقط!
      a.model.visible = true;
      if (a.visualRoot) a.visualRoot.visible = false;
      if (a.fallbackVisual) a.fallbackVisual.visible = false;
    } else {
      if (a.visualRoot) a.visualRoot.visible = true;
      if (a.fallbackVisual) a.fallbackVisual.visible = true;
    }

    const views = [
      { height: 3.2, look: 1.15 }, // 0: خلفي TPP كلاسيكي ببجي
      { height: 0,   look: 1.60 }, // 1: FPP
      { height: 1.8, look: 1.35 }, // 2: قريب
      { height: 7.2, look: 0.60 }  // 3: من فوق
    ];
    const v = views[camView];
    const back = zoomDist;
    const pitch = THREE.MathUtils.clamp(cameraPitch + (camView === 3 ? .58 : 0), -.15, 1.15);
    const tx = a.group.position.x + Math.sin(cameraYaw) * back + leanOffset.x;
    const tz = a.group.position.z + Math.cos(cameraYaw) * back + leanOffset.z;
    const ty = a.group.position.y + back * Math.sin(pitch) + v.height * .3;
    const cameraTarget = new THREE.Vector3(a.group.position.x + leanOffset.x * 0.5, v.look + avatarOffsetY, a.group.position.z + leanOffset.z * 0.5);
    const desiredCamera = new THREE.Vector3(tx, ty, tz).add(leanOffset);
    const cameraDirection = desiredCamera.clone().sub(cameraTarget);
    const desiredDistance = cameraDirection.length();
    cameraDirection.normalize();
    const cameraRay = new THREE.Raycaster(cameraTarget, cameraDirection, .2, desiredDistance);
    const cameraHit = cameraRay.intersectObjects(cameraBlockers, false)[0];
    if (cameraHit) desiredCamera.copy(cameraTarget).addScaledVector(cameraDirection, Math.max(.8, cameraHit.distance - .3));
    const cameraAlpha = 1 - Math.exp(-14 * dt);
    camera.position.lerp(desiredCamera, cameraAlpha);
    camera.lookAt(cameraTarget);
  }

  // تأثير مجال الرؤية الديناميكي الحقيقي عند السبرنت / الركض ببجي (Dynamic Cinematic FOV)
  const targetFov = camView === 1 ? 75 : (walkMode === 'run' && moving ? 65 : 60);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
    camera.updateProjectionMatrix();
  }

  // تبقى خطوط التصويب أفقية أثناء الميلان؛ تأثير Q/E مكاني عبر إزاحة الكتف.
  camera.rotation.z = THREE.MathUtils.damp(camera.rotation.z, 0, 8, dt);

  // تأثير اهتزاز الكاميرا الواقعي عند تفعيل الـ Jump Scares.
  if (cameraShake > 0.001) {
    camera.rotation.x += (Math.random() - 0.5) * cameraShake * 0.12;
    camera.rotation.y += (Math.random() - 0.5) * cameraShake * 0.12;
    camera.rotation.z += (Math.random() - 0.5) * cameraShake * 0.035;
    cameraShake = THREE.MathUtils.damp(cameraShake, 0, 5.5, dt);
  }

  // فحص واكتشاف مناطق الـ Jump Scares بالمسافة والرؤية
  if (wallBurstArms && !wallBurstArms.userData.triggered) {
    const distToBurst = Math.hypot(a.group.position.x - 0, a.group.position.z - 44.0);
    if (distToBurst < 3.0 && a.group.position.z > 37 && a.group.position.z < 51) {
      wallBurstArms.userData.triggered = true;
      triggerJumpScare({ type: 'burst', intensity: 0.60, message: '😱 احذر! الأيدي الملعونة تخرج من الجدران!' });
    }
  }

  if (wallBurstArms && wallBurstArms.userData.triggered) {
    wallBurstArms.userData.timer += dt;
    const tBurst = wallBurstArms.userData.timer;
    if (tBurst < 0.22) {
      wallBurstArms.position.x = THREE.MathUtils.lerp(2.4, 0.75, tBurst / 0.22);
    } else if (tBurst < 1.8) {
      wallBurstArms.position.x = 0.75 + Math.sin(tBurst * 16) * 0.05;
    } else if (tBurst < 2.8) {
      wallBurstArms.position.x = THREE.MathUtils.lerp(0.75, 2.4, (tBurst - 1.8) / 1.0);
    }
  }

  if (lungingPhantom && !lungingPhantom.userData.triggered) {
    const distToPhantom = Math.hypot(a.group.position.x - lungingPhantom.userData.startX, a.group.position.z - lungingPhantom.userData.startZ);
    if (distToPhantom < 3.8 && a.group.position.z > 80 && a.group.position.z < 98) {
      lungingPhantom.userData.triggered = true;
      lungingPhantom.userData.active = true;
      lungingPhantom.visible = true;
      triggerJumpScare({ type: 'lunge', intensity: 0.85, message: '😱 هجوم الشبح الهائم!' });
    }
  }

  if (lungingPhantom && lungingPhantom.userData.active) {
    lungingPhantom.userData.lungeT += dt;
    const tLunge = lungingPhantom.userData.lungeT;
    if (tLunge < 0.55) {
      const progress = tLunge / 0.55;
      lungingPhantom.position.x = THREE.MathUtils.lerp(lungingPhantom.userData.startX, a.group.position.x, progress);
      lungingPhantom.position.z = THREE.MathUtils.lerp(lungingPhantom.userData.startZ, a.group.position.z, progress);
      lungingPhantom.rotation.y = cameraYaw;
      lungingPhantom.scale.setScalar(1.0 + progress * 0.9);
    } else {
      lungingPhantom.visible = false;
      lungingPhantom.userData.active = false;
    }
  }

  // توهج البراويز عند الاقتراب + معلومات + زر فتح الصورة (محسّن بنسبة 100% لخفة المعالجة)
  let nearest = null, nd = 4.5, nearestFrameIndex = -1;
  const myPos = a.group.position;
  const frameList = scene.children.filter(c => c.userData.isFrame);

  for (let i = 0; i < frameList.length; i++) {
    const f = frameList[i];
    const d = f.position.distanceTo(myPos);
    if (f.userData.spotlight) {
      const targetIntensity = d < 4.5 ? (isMobileDevice ? 50 : 100) : (isMobileDevice ? 20 : 40);
      f.userData.spotlight.intensity = THREE.MathUtils.lerp(f.userData.spotlight.intensity, targetIntensity, dt * 5);
    }
    if (d < nd) { nd = d; nearest = f; nearestFrameIndex = f.userData.frameIndex; }
  }

    if (nearest && lastFrameData[nearestFrameIndex]) {
    frameInfo.textContent = '🖼️ ' + lastFrameData[nearestFrameIndex].title + ' (اضغط لفتح الصورة)';
    frameInfo.style.display = 'block';
    if (openPhotoBtn) {
      openPhotoBtn.style.display = 'block';
      openPhotoBtn.onclick = () => openImageModal(nearestFrameIndex);
    }
  } else {
    if (openPhotoBtn) openPhotoBtn.style.display = 'none';

    // فحص الاقتراب من الجماجم الملعونة للتحدي (Skull Proximity & Quest)
    let nearSkull = null;
    const collectPrompt = document.getElementById('collectPrompt');
    for (let k = 0; k < cursedSkulls.length; k++) {
      const sk = cursedSkulls[k];
      if (!sk.userData.collected) {
        const d = Math.hypot(myPos.x - sk.position.x, myPos.z - sk.position.z);
        if (d < 2.5) { nearSkull = sk; break; }
      }
    }

    if (nearSkull) {
      if (collectPrompt) {
        collectPrompt.style.display = 'block';
        collectPrompt.textContent = `💀 اضغط E أو انقر لجمع ${nearSkull.userData.label}`;
        collectPrompt.onclick = () => collectSkull(nearSkull);
      }
      frameInfo.textContent = `💀 اقتربت من ${nearSkull.userData.label} - انقر للجمع!`;
      frameInfo.style.display = 'block';
    } else {
      if (collectPrompt) collectPrompt.style.display = 'none';
      // اقترب من مقعد؟
      let nearBench = null;
      for (const b of benches) {
        if (Math.hypot(a.group.position.x - b.x, a.group.position.z - b.z) < 2.8) { nearBench = b; break; }
      }
      const sitPrompt = document.getElementById('sitPrompt');
      if (sitting) {
        if (sitPrompt) { sitPrompt.style.display = 'block'; sitPrompt.textContent = '🧍 قف من المقعد'; }
        frameInfo.style.display = 'none';
      } else if (nearBench) {
        frameInfo.textContent = '🪑 اضغط زر المقعد أو F للجلوس';
        frameInfo.style.display = 'block';
        if (sitPrompt) { sitPrompt.style.display = 'block'; sitPrompt.textContent = '🪑 اجلس هنا'; }
      } else {
        frameInfo.style.display = 'none';
        if (sitPrompt) sitPrompt.style.display = 'none';
      }
    }
  }
}

// ==================== القفز والرقص والحركات التعبيرية 🕺💃 ====================
function applyAction(a, action, dt) {
  if (!action) return;
  a.actionT = (a.actionT || 0) + dt;
  const t = a.actionT;

  // الـ GLB إذا احتوى الحركة التعبيرية، يملك حركة العظام كاملة؛ لا نطبق عليه تحريكاً إجرائياً ثانياً.
  if (a.modelLoaded && a.animationActions?.has(action)) {
    return;
  }

  if (action === 'jump') {
    // قفزات متتالية انسيابية
    const hop = Math.abs(Math.sin(t * 5.5)) * .55;
    a.group.position.y = Math.max(hop, (a.group.position.y || 0) * .9);
    a.legs.forEach(l => { l.rotation.x = -.35; });
    if (a.armPivots) {
      a.armPivots[0].rotation.z = THREE.MathUtils.damp(a.armPivots[0].rotation.z, 2.4, 12, dt);
      a.armPivots[1].rotation.z = THREE.MathUtils.damp(a.armPivots[1].rotation.z, -2.4, 12, dt);
    }
  } else if (action === 'dance') {
    // رقصة ببجي التعبيرية: تمايل حركي انسيابي متناسق مع موسيقى هادئة
    a.group.rotation.y += Math.sin(t * 6) * dt * 3.5;
    a.group.position.y = Math.abs(Math.sin(t * 6)) * .12;
    a.group.rotation.z = THREE.MathUtils.damp(a.group.rotation.z, Math.sin(t * 6) * .08, 10, dt);
    if (a.armPivots) {
      const armWave = Math.sin(t * 8) * .4;
      a.armPivots[0].rotation.z = THREE.MathUtils.damp(a.armPivots[0].rotation.z, 1.8 + armWave, 10, dt);
      a.armPivots[1].rotation.z = THREE.MathUtils.damp(a.armPivots[1].rotation.z, -1.8 - armWave, 10, dt);
      a.armPivots[0].rotation.x = THREE.MathUtils.damp(a.armPivots[0].rotation.x, Math.cos(t * 6) * .45, 10, dt);
      a.armPivots[1].rotation.x = THREE.MathUtils.damp(a.armPivots[1].rotation.x, -Math.cos(t * 6) * .45, 10, dt);
    }
    if (a.headPivot) {
      a.headPivot.rotation.z = Math.sin(t * 6) * .06;
    }
  } else if (action === 'wave') {
    // حركة تلويح واقعية وجميلة جداً 👋: رفع الذراع اليمنى (side = 1) بزاوية طبيعية دون أي تداخل بالجسم
    const rightArm = a.armPivots && a.armPivots.find(p => p.userData.side === 1);
    const leftArm = a.armPivots && a.armPivots.find(p => p.userData.side === -1);

    if (rightArm) {
      const waveCycle = Math.sin(t * 7);
      // رفع الذراع اليمنى للأعلى وللخارج قليلاً (+X و -Z)
      rightArm.rotation.z = THREE.MathUtils.damp(rightArm.rotation.z, -2.15 + waveCycle * 0.35, 14, dt);
      rightArm.rotation.x = THREE.MathUtils.damp(rightArm.rotation.x, 0.40 + Math.cos(t * 7) * 0.1, 14, dt);
    }
    // الذراع اليسرى مسترخية بمحاذاة الجسم مع مسافة أمان
    if (leftArm) {
      leftArm.rotation.z = THREE.MathUtils.damp(leftArm.rotation.z, 0.22, 10, dt);
      leftArm.rotation.x = THREE.MathUtils.damp(leftArm.rotation.x, 0, 10, dt);
    }
    // إمالة لطيفة للرأس مع التلويح
    if (a.headPivot) {
      a.headPivot.rotation.z = THREE.MathUtils.damp(a.headPivot.rotation.z, Math.sin(t * 3.5) * 0.08 - 0.05, 8, dt);
      a.headPivot.rotation.x = THREE.MathUtils.damp(a.headPivot.rotation.x, -0.05, 8, dt);
    }
  } else if (action === 'clap') {
    // حركة تصفيق واقعية 👏: اليدان للأمام تتقاربان وتتباعدان بإيقاع منتظم مع الحفاظ على مسافة أمان
    const clapCycle = Math.abs(Math.sin(t * 8.5)) * 0.22;
    const rightArm = a.armPivots && a.armPivots.find(p => p.userData.side === 1);
    const leftArm = a.armPivots && a.armPivots.find(p => p.userData.side === -1);

    if (leftArm) {
      leftArm.rotation.z = THREE.MathUtils.damp(leftArm.rotation.z, 0.48 - clapCycle, 14, dt);
      leftArm.rotation.x = THREE.MathUtils.damp(leftArm.rotation.x, -1.05, 12, dt);
    }
    if (rightArm) {
      rightArm.rotation.z = THREE.MathUtils.damp(rightArm.rotation.z, -0.48 + clapCycle, 14, dt);
      rightArm.rotation.x = THREE.MathUtils.damp(rightArm.rotation.x, -1.05, 12, dt);
    }
    if (a.headPivot) {
      a.headPivot.rotation.x = THREE.MathUtils.damp(a.headPivot.rotation.x, 0.08, 8, dt);
    }
  } else if (action === 'salute') {
    // تحية عسكرية واقعية ومحكمة بستايل ببجي 🫡
    const rightArm = a.armPivots && a.armPivots.find(p => p.userData.side === 1);
    const leftArm = a.armPivots && a.armPivots.find(p => p.userData.side === -1);

    if (rightArm) {
      rightArm.rotation.z = THREE.MathUtils.damp(rightArm.rotation.z, -2.15, 12, dt);
      rightArm.rotation.x = THREE.MathUtils.damp(rightArm.rotation.x, 0.65, 12, dt);
    }
    if (leftArm) {
      leftArm.rotation.z = THREE.MathUtils.damp(leftArm.rotation.z, 0.18, 10, dt);
      leftArm.rotation.x = THREE.MathUtils.damp(leftArm.rotation.x, 0, 10, dt);
    }
    if (a.headPivot) {
      a.headPivot.rotation.x = THREE.MathUtils.damp(a.headPivot.rotation.x, -0.06, 10, dt);
      a.headPivot.rotation.z = THREE.MathUtils.damp(a.headPivot.rotation.z, 0, 10, dt);
    }
  } else if (action === 'kiss') {
    // إرسال قبلة باليد 😘: حركة سلسة لليد إلى الفم ثم انبساط للأمام
    const kissPhase = Math.sin(t * 3.5);
    const rightArm = a.armPivots && a.armPivots.find(p => p.userData.side === 1);
    if (rightArm) {
      rightArm.rotation.x = THREE.MathUtils.damp(rightArm.rotation.x, -1.05 + kissPhase * 0.40, 10, dt);
      rightArm.rotation.z = THREE.MathUtils.damp(rightArm.rotation.z, -0.45 - kissPhase * 0.30, 10, dt);
    }
    if (a.headPivot) {
      a.headPivot.rotation.x = THREE.MathUtils.damp(a.headPivot.rotation.x, -0.12 + kissPhase * 0.05, 8, dt);
    }
  } else if (action === 'cheer') {
    // تشجيع واحتفال 🎉: رفع كلتا اليدين مع قفزة حماسية خفيفة
    a.group.position.y = Math.abs(Math.sin(t * 5)) * 0.08;
    if (a.armPivots) {
      const cheerBob = Math.sin(t * 7) * 0.18;
      a.armPivots[0].rotation.z = THREE.MathUtils.damp(a.armPivots[0].rotation.z, 2.5 + cheerBob, 12, dt);
      a.armPivots[1].rotation.z = THREE.MathUtils.damp(a.armPivots[1].rotation.z, -2.5 - cheerBob, 12, dt);
      a.armPivots[0].rotation.x = THREE.MathUtils.damp(a.armPivots[0].rotation.x, -0.15, 12, dt);
      a.armPivots[1].rotation.x = THREE.MathUtils.damp(a.armPivots[1].rotation.x, -0.15, 12, dt);
    }
  } else if (action === 'laugh') {
    // ضحك 😂: اهتزاز متناغم للرأس والجسم
    a.group.position.y = Math.abs(Math.sin(t * 11)) * 0.035;
    if (a.headPivot) {
      a.headPivot.rotation.x = THREE.MathUtils.damp(a.headPivot.rotation.x, Math.sin(t * 10) * 0.14 + 0.08, 12, dt);
    }
    if (a.armPivots) {
      a.armPivots[0].rotation.z = THREE.MathUtils.damp(a.armPivots[0].rotation.z, 0.32, 8, dt);
      a.armPivots[1].rotation.z = THREE.MathUtils.damp(a.armPivots[1].rotation.z, -0.32, 8, dt);
      a.armPivots[0].rotation.x = THREE.MathUtils.damp(a.armPivots[0].rotation.x, -0.65, 8, dt);
      a.armPivots[1].rotation.x = THREE.MathUtils.damp(a.armPivots[1].rotation.x, -0.65, 8, dt);
    }
  } else if (action === 'cry') {
    // حزن وبكاء 😭: خفض الرأس ووضع اليدين للأعلى
    if (a.headPivot) {
      a.headPivot.rotation.x = THREE.MathUtils.damp(a.headPivot.rotation.x, 0.28, 8, dt);
    }
    if (a.armPivots) {
      a.armPivots[0].rotation.x = THREE.MathUtils.damp(a.armPivots[0].rotation.x, -1.25, 10, dt);
      a.armPivots[1].rotation.x = THREE.MathUtils.damp(a.armPivots[1].rotation.x, -1.25, 10, dt);
      a.armPivots[0].rotation.z = THREE.MathUtils.damp(a.armPivots[0].rotation.z, 0.48 + Math.sin(t * 6) * 0.05, 10, dt);
      a.armPivots[1].rotation.z = THREE.MathUtils.damp(a.armPivots[1].rotation.z, -0.48 - Math.sin(t * 6) * 0.05, 10, dt);
    }
  }

  // تطبيق الحركات التعبيرية المباشرة على عظام المجسم المرفوع (GLB Bones Layer) إذا لم تكن مضمنة كأنيميشن داخل ملف الـ GLB
  if (a.modelLoaded && a.modelBones && !a.animationActions?.has(action)) {
    const b = a.modelBones;
    if (action === 'wave') {
      const waveVal = Math.sin(t * 7) * 0.45;
      if (b.rightArm) {
        b.rightArm.rotation.z = -1.6 + waveVal;
        b.rightArm.rotation.x = 0.5;
      }
      if (b.rightForearm) {
        b.rightForearm.rotation.z = -0.8 + waveVal * 0.5;
      }
      if (b.head) {
        b.head.rotation.z = Math.sin(t * 3.5) * 0.12 - 0.05;
      }
    } else if (action === 'salute') {
      if (b.rightArm) {
        b.rightArm.rotation.z = -1.8;
        b.rightArm.rotation.x = 0.8;
      }
      if (b.rightForearm) {
        b.rightForearm.rotation.z = -1.1;
      }
      if (b.head) {
        b.head.rotation.x = -0.12;
      }
    } else if (action === 'cheer') {
      const cheerVal = Math.sin(t * 6) * 0.2;
      if (b.rightArm) {
        b.rightArm.rotation.z = -2.4 - cheerVal;
        b.rightArm.rotation.x = -0.2;
      }
      if (b.leftArm) {
        b.leftArm.rotation.z = 2.4 + cheerVal;
        b.leftArm.rotation.x = -0.2;
      }
    } else if (action === 'kiss') {
      const kissVal = Math.sin(t * 3.5);
      if (b.rightArm) {
        b.rightArm.rotation.x = -1.1 + kissVal * 0.4;
        b.rightArm.rotation.z = -0.6 - kissVal * 0.3;
      }
      if (b.head) {
        b.head.rotation.x = -0.15;
      }
    } else if (action === 'dance') {
      a.group.rotation.y += Math.sin(t * 6) * dt * 3.5;
      a.group.position.y = Math.abs(Math.sin(t * 6)) * .12;
      a.group.rotation.z = THREE.MathUtils.damp(a.group.rotation.z, Math.sin(t * 6) * .08, 10, dt);
      const danceVal = Math.sin(t * 7) * 0.4;
      if (b.rightArm) b.rightArm.rotation.z = -1.4 + danceVal;
      if (b.leftArm) b.leftArm.rotation.z = 1.4 - danceVal;
    }
  }

  // نضف الإيماءة للسماح بحركة جديدة
  if (a.legs && action === 'jump') a.legs.forEach(l => l.rotation.x = -.4);
}

function sitDown(b) {
  const a = avatars.get(socket.id);
  if (!a) return;
  a.velocity = 0; a.runBlend = 0; a.gaitAmount = 0;
  const faceYaw = (b.ry !== undefined) ? b.ry : 0;
  const forwardX = Math.sin(faceYaw) * 0.12;
  const forwardZ = Math.cos(faceYaw) * 0.12;
  sitting = { x: b.x + forwardX, z: b.z + forwardZ, seatY: .56, ry: faceYaw };
  cameraYaw = faceYaw + 0.22;
  cameraPitch = 0.22;
  if (a.group.userData.haloMesh) a.group.userData.haloMesh.visible = false;

  const btnSit = document.getElementById('btnSit');
  if (btnSit) { btnSit.textContent = '🧍'; btnSit.classList.add('active'); btnSit.title = 'الوقوف'; }
  const sitPrompt = document.getElementById('sitPrompt');
  if (sitPrompt) { sitPrompt.style.display = 'block'; sitPrompt.textContent = '🧍 قف من المقعد'; }
  showToast('جلسة مريحة ☕ — تحرك للوقوف');
}

function standUp() {
  const a = avatars.get(socket.id);
  if (a && sitting) {
    const stepX = Math.sin(sitting.ry) * 0.85;
    const stepZ = Math.cos(sitting.ry) * 0.85;
    a.group.position.x = sitting.x + stepX;
    a.group.position.z = sitting.z + stepZ;
    a.group.position.y = 0;
    cameraYaw = sitting.ry + Math.PI;
    if (a.group.userData.haloMesh) a.group.userData.haloMesh.visible = true;
  }
  sitting = null;
  const btnSit = document.getElementById('btnSit');
  if (btnSit) { btnSit.textContent = '🪑'; btnSit.classList.remove('active'); btnSit.title = 'الجلوس على المقعد'; }
  const sitPrompt = document.getElementById('sitPrompt');
  if (sitPrompt) sitPrompt.textContent = '🪑 اجلس هنا';
  if (a) {
    a.velocity = 0; a.runBlend = 0; a.gaitAmount = 0;
    a.group.position.y = 0;
    if (a.modelLoaded) chooseAnimation(a, 'idle');
    if (!a.female) {
      if (a.legs[0]) a.legs[0].rotation.x = 0;
      if (a.legs[1]) a.legs[1].rotation.x = 0;
    } else {
      if (a.legs[0]) a.legs[0].position.z = 0;
      if (a.legs[1]) a.legs[1].position.z = 0;
    }
  }
}

function toggleSit() {
  if (sitting) {
    standUp();
    showToast('وقفت من المقعد 🧍');
  } else {
    const a = avatars.get(socket.id);
    if (!a) return;
    let closestB = null, minD = Infinity;
    for (const b of benches) {
      const d = Math.hypot(a.group.position.x - b.x, a.group.position.z - b.z);
      if (d < minD) { minD = d; closestB = b; }
    }
    if (closestB) {
      sitDown(closestB);
    } else {
      showToast('اقترب من أي مقعد للجلوس 🪑');
    }
  }
}

const btnSitEl = document.getElementById('btnSit');
if (btnSitEl) btnSitEl.onclick = toggleSit;
const sitPromptEl = document.getElementById('sitPrompt');
if (sitPromptEl) sitPromptEl.onclick = toggleSit;

// ==================== أنيميشن الأطراف (أرجل + أذرع + شعر) بفيزياء كينماتيكية واقعية ====================
function animateLimbs(a, moving, dt, options = {}) {
  const runBlend = THREE.MathUtils.clamp(options.runBlend ?? a.runBlend ?? 0, 0, 1);
  const gait = THREE.MathUtils.clamp(options.gait ?? a.gaitAmount ?? (moving ? 1 : 0), 0, 1);
  const turnLean = options.turnLean ?? a.turnLean ?? 0;
  const step = a.walkPhase || 0;
  const cadence = THREE.MathUtils.lerp(1, 1.25, runBlend);
  const leftPhase = step;
  const rightPhase = step + Math.PI;

  // مقدار التأرجح والارتفاع الطبيعي للقدم
  const strideAmount = THREE.MathUtils.lerp(.42, a.female ? .62 : .68, runBlend) * gait;
  const liftAmount = THREE.MathUtils.lerp(.09, a.female ? .17 : .20, runBlend) * gait;
  const crouch = THREE.MathUtils.lerp(0, -.075, runBlend) * gait;
  const pose = a.group.userData.avatarPose;

  // دوران خفيف في الحوض عند المشي (Pelvic sway)
  const pelvicRoll = Math.sin(step) * 0.04 * gait;
  const pelvicYaw = Math.cos(step) * 0.05 * gait;

  if (a.skirtMesh) a.skirtMesh.rotation.z = Math.sin(step * 2) * .035 * gait + turnLean * .025;

  // حركة الأرجل الكينماتيكية: فخذ + ركبة تنثني عند الرفع
  a.legPivots.forEach((pivot, index) => {
    const phase = (index === 0 ? leftPhase : rightPhase) * cadence;
    const isForward = Math.sin(phase);
    const footSwing = isForward * strideAmount;
    
    // ثني الركبة الطبيعي: الساق تنثني للخلف عند رفع القدم
    const kneeBend = Math.max(0, -Math.sin(phase)) * THREE.MathUtils.lerp(.35, .75, runBlend) * gait;
    const footLift = Math.max(0, Math.cos(phase)) * liftAmount;
    const idleShift = options.idle ? Math.sin(a.idleT * 1.5 + index * Math.PI) * .004 : 0;

    pivot.rotation.x = THREE.MathUtils.damp(pivot.rotation.x, footSwing, 16, dt);
    pivot.position.y = pivot.userData.baseY + footLift + idleShift;
    pivot.rotation.z = THREE.MathUtils.damp(pivot.rotation.z, (index === 0 ? -1 : 1) * pelvicRoll + turnLean * .035, 12, dt);

    // ثني الركبة على الجزء السفلي (الساق)
    if (a.legs && a.legs[index]) {
      a.legs[index].rotation.x = THREE.MathUtils.damp(a.legs[index].rotation.x || 0, kneeBend, 16, dt);
    }

    if (a.female) pivot.position.z = Math.sin(phase) * .08 * gait;
  });

  // حركة الذراعين الانسيابية المتعاكسة مع الأرجل (مع هامش أمان خارجي يمنع دخول الذراعين بالجسم)
  if (!options.hasAction) {
    a.armPivots.forEach((arm, index) => {
      const side = arm.userData.side;
      const phase = (index === 0 ? rightPhase : leftPhase) * cadence;
      
      // الذراع تتأرجح للأمام والخلف مع انحراف خارجي يضمن عدم ملامسة الورك أو الجذع
      const forwardSwing = Math.sin(phase) * THREE.MathUtils.lerp(.28, .55, runBlend) * gait;
      // ابتعاد الذراع عن الجسم للخارج أثناء التأرجح
      const safeClearance = THREE.MathUtils.lerp(0.04, 0.12, gait);
      const outwardSwing = (Math.abs(Math.sin(phase)) * 0.06 + safeClearance) * (side === 1 ? -1 : 1);
      const rest = a.female ? -0.1 : a.armRestZ[index];
      const armPose = a.group.userData.avatarPose;
      const safeLean = THREE.MathUtils.clamp(armPose.torsoRoll || 0, -0.08, 0.08);

      arm.rotation.z = THREE.MathUtils.damp(arm.rotation.z, rest + outwardSwing + turnLean * .08 * side - safeLean * .3, 14, dt);
      arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, forwardSwing, 14, dt);
    });
  }

  // حركة الجذع والعمود الفقري والتنفس
  if (a.bodyMesh) {
    a.bodyMesh.position.y = a.baseBodyY + crouch;
    a.bodyMesh.rotation.y = THREE.MathUtils.damp(a.bodyMesh.rotation.y || 0, pelvicYaw, 10, dt);
    a.bodyMesh.rotation.z = THREE.MathUtils.damp(a.bodyMesh.rotation.z || 0, pelvicRoll + pose.torsoRoll, 10, dt);
  }

  // حركة الرأس المستقلة مع استقرار النظر للأمام (Head stabilization)
  pose.pitch = THREE.MathUtils.damp(pose.pitch, -crouch * .1, 8, dt);
  pose.torsoRoll = THREE.MathUtils.damp(pose.torsoRoll, -turnLean * .04, 8, dt);
  pose.headYaw = THREE.MathUtils.damp(pose.headYaw, -pelvicYaw * 0.7 - turnLean * .06, 10, dt);
  pose.headPitch = THREE.MathUtils.damp(pose.headPitch, -crouch * .08, 8, dt);

  a.headPivot.rotation.z = pose.headYaw;
  a.headPivot.rotation.x = pose.headPitch;

  // صعود وهبوط الجذع الطبيعي أثناء المشي والركض (Vertical bounce)
  const verticalBob = Math.sin(step * cadence * 2) * THREE.MathUtils.lerp(.022, .052, runBlend) * gait;
  a.group.position.y = (a.group.position.y || 0) + (Math.sin(a.idleT * 2) * .003 + verticalBob);

  a.idleT += dt;
  const breathe = Math.sin(a.idleT * 2) * .006;
  a.head.scale.copy(a.head.userData.baseScale);
  a.head.scale.multiplyScalar(1 + breathe);
  a.head.scale.y *= Math.sin(a.idleT * 2.1) > .985 ? .12 : 1; // طرفة عين واقعية خفيفة
}

// ==================== تحديث الآخرين ====================
function updateOthers(dt) {
  others.forEach((o, id) => {
    const a = avatars.get(id);
    if (!a) return;
    const p = a.group.position;
    const remoteMoveAlpha = 1 - Math.exp(-8 * dt);
    p.x += (o.tx - p.x) * remoteMoveAlpha;
    p.z += (o.tz - p.z) * remoteMoveAlpha;
    a.group.rotation.y += Math.atan2(Math.sin(o.trot - a.group.rotation.y), Math.cos(o.trot - a.group.rotation.y)) * (1 - Math.exp(-8 * dt));
    const d = Math.hypot(o.tx - p.x, o.tz - p.z);
    a.velocity = THREE.MathUtils.damp(a.velocity || 0, d > .08 ? .7 : 0, 8, dt);
    a.runBlend = d > .08 ? THREE.MathUtils.damp(a.runBlend || 0, .55, 5, dt) : THREE.MathUtils.damp(a.runBlend || 0, 0, 8, dt);
    a.gaitAmount = THREE.MathUtils.damp(a.gaitAmount || 0, d > .025 ? Math.min(1, d / .12) : 0, 8, dt);
    a.walkPhase = (a.walkPhase + dt * (a.runBlend > .5 ? 9.4 : 7.2)) % (Math.PI * 2);
    if (a.modelLoaded) {
      chooseAnimation(a, a.action || (d > .02 ? (a.runBlend > .5 ? 'run' : 'walk') : 'idle'));
      if (a.mixer) a.mixer.update(dt);
      applyAction(a, a.action, dt);
    } else {
      animateLimbs(a, d > .02, dt, { runBlend: a.runBlend, gait: a.gaitAmount, turnLean: 0, idle: d <= .02, hasAction: Boolean(a.action) });
      applyAction(a, a.action, dt);
    }
    const peerAudio = peerAudioElements.get(id);
    if (peerAudio) {
      // الصوت يصل للجميع في أرجاء المتحف بنقاء كامل (Global Broadcast) بدون انقطاع أو خفض بالمسافة
      peerAudio.volume = 1.0;
    }
  });
}

// ==================== أسماء وبابلات فوق الرؤوس ====================
const v3 = new THREE.Vector3();
function projectToScreen(pos, yOff) {
  v3.copy(pos); v3.y += yOff;
  v3.project(camera);
  if (v3.z > 1) return null;
  return { x: (v3.x * .5 + .5) * innerWidth, y: (-v3.y * .5 + .5) * innerHeight };
}

function updateTags() {
  avatars.forEach((a, id) => {
    const pt = projectToScreen(a.group.position, a.modelLoaded ? 2.15 : 2.05);
    a.nameTagEl.style.display = pt ? 'block' : 'none';
    if (pt) { a.nameTagEl.style.left = pt.x + 'px'; a.nameTagEl.style.top = pt.y + 'px'; }
    if (a.bubbleEl) {
      const bp = projectToScreen(a.group.position, a.modelLoaded ? 2.60 : 2.50);
      a.bubbleEl.style.display = bp ? 'block' : 'none';
      if (bp) { a.bubbleEl.style.left = bp.x + 'px'; a.bubbleEl.style.top = bp.y + 'px'; }
    }
  });
}

function showBubble(a, text) {
  removeBubble(a);
  const b = document.createElement('div');
  b.className = 'bubble3d'; b.textContent = text;
  document.body.appendChild(b);
  a.bubbleEl = b;
}
function removeBubble(a) {
  if (a.bubbleEl) { a.bubbleEl.remove(); a.bubbleEl = null; }
}

function floatEmoji(a, emoji) {
  const el = document.createElement('div');
  el.className = 'bubble3d'; el.textContent = emoji;
  el.style.fontSize = '30px';
  document.body.appendChild(el);
  let t = 0;
  const anim = () => {
    t += .03;
    const pt = projectToScreen(a.group.position, 2.3 + t);
    if (pt && t < 1.2) {
      el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
      el.style.opacity = 1 - t / 1.2;
      requestAnimationFrame(anim);
    } else el.remove();
  };
  anim();
}

// ==================== الدردشة والإيموجي والشريط ====================
const chatPanel = document.getElementById('chatPanel');
const emojiPanel = document.getElementById('emojiPanel');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');

function addChatLine(who, text) {
  const d = document.createElement('div');
  d.innerHTML = `<b>${who}:</b> ${escapeHtml(text)}`;
  chatLog.appendChild(d);
  chatLog.scrollTop = chatLog.scrollHeight;
  while (chatLog.children.length > 50) chatLog.firstChild.remove();
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

socket.on('chat-broadcast', () => { });
// استقبل رسائل الدردشة عبر bubble (نفس القناة)
const _origChat = addChatLine;

document.getElementById('btnChat').onclick = () => {
  emojiPanel.classList.remove('open');
  chatPanel.classList.toggle('open');
  if (chatPanel.classList.contains('open')) chatInput.focus();
};
document.getElementById('btnEmoji').onclick = () => {
  chatPanel.classList.remove('open');
  emojiPanel.classList.toggle('open');
};
emojiPanel.querySelectorAll('span').forEach(s => s.onclick = () => {
  socket.emit('emoji', { emoji: s.textContent });
  const me = avatars.get(socket.id);
  if (me) floatEmoji(me, s.textContent);
  emojiPanel.classList.remove('open');
});

function sendChat() {
  const t = chatInput.value.trim();
  if (!t) return;
  socket.emit('chat', { text: t });
  addChatLine(name, t);
  chatInput.value = '';
}
document.getElementById('sendBtn').onclick = sendChat;
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// تغيير المنظور من الزر
document.getElementById('btnView').onclick = () => {
  switchView();
};
const flashlightButton = document.getElementById('btnFlashlight');
if (flashlightButton) flashlightButton.onclick = () => { keys.KeyF = true; };
const flashlightHintButton = document.getElementById('flashlightHint');
if (flashlightHintButton) {
  flashlightHintButton.style.pointerEvents = 'auto';
  flashlightHintButton.onclick = () => { keys.KeyF = true; };
}

// مشاركة الرابط
const toast = document.getElementById('toast');
document.getElementById('btnShare').onclick = async () => {
  const url = location.origin;
  try {
    if (navigator.share) await navigator.share({ title: document.title, text: 'ادخل متحف ذكرياتنا 💕', url });
    else { await navigator.clipboard.writeText(url); showToast('تم نسخ الرابط ✅'); }
  } catch {
    showToast(location.origin);
  }
};
function showToast(msg) {
  toast.textContent = msg; toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 2500);
}

// عداد المشاهدات (عدد مرات دخول الصالة — تقديري)
let views = +(localStorage.getItem('mm_views') || 0) + 1;
localStorage.setItem('mm_views', views);
document.getElementById('viewsN').textContent = views;
document.getElementById('btnViews').onclick = () => showToast(`شاهدتِ المتحف ${views} مرة 💕`);

// ==================== الصوت ====================
const btnMute = document.getElementById('btnMute');
let music = null, muted = localStorage.getItem('mm_muted') === '1';

// مؤثرات وموسيقى الرعب السينمائي (نبضات قلب عميقة مرعبة + أصوات ظلام وتوتر)
let audioCtx = null, musicTimer = null, heartbeatTimer = null;
function startMusic() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    // 1. نبضات قلب واقعية عميقة ومرعبة (Deep Throbbing Heartbeat)
    let beatStep = 0;
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        if (muted || !audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(beatStep % 2 === 0 ? 68 : 50, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + 0.16);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(beatStep % 2 === 0 ? 0.32 : 0.20, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.23);
        beatStep++;
      }, 750);
    }

    // 2. همسات وظلام رعب سينمائي متوتر (Dark Horror Drone / Suspense Ambience)
    const eerieFrequencies = [55.0, 77.78, 110.0, 116.54, 155.56, 164.81];
    let noteIdx = 0;
    if (!musicTimer) {
      musicTimer = setInterval(() => {
        if (muted || !audioCtx) return;
        const now = audioCtx.currentTime;
        const o1 = audioCtx.createOscillator();
        const o2 = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o1.type = 'sawtooth';
        o2.type = 'triangle';
        const baseFreq = eerieFrequencies[noteIdx % eerieFrequencies.length];
        o1.frequency.setValueAtTime(baseFreq, now);
        o2.frequency.setValueAtTime(baseFreq * 1.015, now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.038, now + 1.2);
        g.gain.linearRampToValueAtTime(0.001, now + 3.4);
        o1.connect(g); o2.connect(g);
        g.connect(audioCtx.destination);
        o1.start(now); o2.start(now);
        o1.stop(now + 3.5); o2.stop(now + 3.5);
        noteIdx++;
      }, 2600);
    }
  } catch { }
}
function playStep(mode = 'walk') {
  if (muted || !audioCtx) return;
  try {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    oscillator.type = mode === 'run' ? 'square' : 'triangle';
    oscillator.frequency.setValueAtTime(mode === 'run' ? 105 : 82, now);
    oscillator.frequency.exponentialRampToValueAtTime(mode === 'run' ? 58 : 52, now + .085);
    gain.gain.setValueAtTime(mode === 'run' ? .018 : .012, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .105);
    oscillator.connect(gain).connect(audioCtx.destination);
    oscillator.start(now); oscillator.stop(now + .11);
  } catch { }
}
btnMute.textContent = muted ? '🔇' : '🔊';
btnMute.onclick = () => {
  muted = !muted;
  localStorage.setItem('mm_muted', muted ? '1' : '0');
  btnMute.textContent = muted ? '🔇' : '🔊';
  if (!muted && !musicTimer) startMusic();
};

// ==================== المحادثة الصوتية (الميكروفون عالي الوضوح HD) ====================
const btnMic = document.getElementById('btnMic');
let isMicActive = false;
let localMediaStream = null;
let voiceAudioCtx = null;
let voiceAnalyser = null;
const peerConnections = new Map(); // remoteId -> RTCPeerConnection
const peerAudioElements = new Map(); // remoteId -> HTMLAudioElement

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function getOrCreatePeerConnection(remoteId) {
  if (peerConnections.has(remoteId)) return peerConnections.get(remoteId);
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(remoteId, pc);

  if (localMediaStream) {
    localMediaStream.getAudioTracks().forEach(track => pc.addTrack(track, localMediaStream));
  }

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('voice-signal', { to: remoteId, signal: { candidate: e.candidate } });
    }
  };

  pc.ontrack = e => {
    if (e.streams && e.streams[0]) {
      let audio = peerAudioElements.get(remoteId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        peerAudioElements.set(remoteId, audio);
      }
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      const audio = peerAudioElements.get(remoteId);
      if (audio) { audio.srcObject = null; peerAudioElements.delete(remoteId); }
      peerConnections.delete(remoteId);
    }
  };

  return pc;
}

async function initiateVoiceCall(remoteId) {
  const pc = getOrCreatePeerConnection(remoteId);
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice-signal', { to: remoteId, signal: { sdp: pc.localDescription } });
  } catch (err) {
    console.warn('Voice call notice:', err);
  }
}

async function handleVoiceSignal({ from, signal }) {
  if (!from || !signal) return;
  const pc = getOrCreatePeerConnection(from);
  try {
    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice-signal', { to: from, signal: { sdp: pc.localDescription } });
      }
    } else if (signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  } catch (err) {
    console.warn('Voice signal notice:', err);
  }
}

socket.on('voice-signal', handleVoiceSignal);

async function toggleMicrophone() {
  if (isMicActive) {
    isMicActive = false;
    btnMic.classList.remove('active', 'speaking');
    btnMic.textContent = '🎙️';
    if (localMediaStream) {
      localMediaStream.getTracks().forEach(t => t.stop());
      localMediaStream = null;
    }
    peerConnections.forEach((pc) => {
      pc.getSenders().forEach(sender => { if (sender.track) pc.removeTrack(sender); });
    });
    socket.emit('voice-status', { speaking: false, muted: true });
    showToast('تم إيقاف الميكروفون 🔇');
    return;
  }

  try {
    showToast('جارٍ تشغيل الميكروفون... 🎙️');
    localMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000
      }
    });
    isMicActive = true;
    btnMic.classList.add('active');
    btnMic.textContent = '🎙️';
    showToast('الميكروفون مفعّل بصوت عام للجميع — تحدث الآن! 🎙️');
    socket.emit('voice-status', { speaking: false, muted: false });

    // ربط خطوط الصوت بالجميع مباشرة
    peerConnections.forEach((pc) => {
      localMediaStream.getAudioTracks().forEach(track => pc.addTrack(track, localMediaStream));
    });

    others.forEach((_, remoteId) => {
      initiateVoiceCall(remoteId);
    });

    try {
      voiceAudioCtx = voiceAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (voiceAudioCtx.state === 'suspended') await voiceAudioCtx.resume();
      const src = voiceAudioCtx.createMediaStreamSource(localMediaStream);
      voiceAnalyser = voiceAudioCtx.createAnalyser();
      voiceAnalyser.fftSize = 256;
      src.connect(voiceAnalyser);
      const dataArr = new Uint8Array(voiceAnalyser.frequencyBinCount);
      let wasSpeaking = false;

      const checkSpeech = () => {
        if (!isMicActive) return;
        voiceAnalyser.getByteFrequencyData(dataArr);
        let sum = 0;
        for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
        const avg = sum / dataArr.length;
        const isSpeaking = avg > 14;
        btnMic.classList.toggle('speaking', isSpeaking);
        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          socket.emit('voice-status', { speaking: isSpeaking, muted: false });
        }
        requestAnimationFrame(checkSpeech);
      };
      requestAnimationFrame(checkSpeech);
    } catch (e) {
      console.warn('Voice analyser notice:', e);
    }
  } catch (err) {
    console.error('Microphone access notice:', err);
    isMicActive = false;
    btnMic.classList.remove('active', 'speaking');
    btnMic.textContent = '🎙️';
    showToast('يرجى السماح بإذن الميكروفون في المتصفح ⚠️');
  }
}

if (btnMic) btnMic.onclick = toggleMicrophone;

socket.on('player-joined', p => {
  if (isMicActive && p && p.id && p.id !== socket.id) {
    setTimeout(() => initiateVoiceCall(p.id), 1000);
  }
});

socket.on('voice-status', ({ id, speaking }) => {
  const a = avatars.get(id);
  if (!a) return;
  if (speaking) {
    if (!a.nameTagEl.querySelector('.speaking-badge')) {
      const badge = document.createElement('span');
      badge.className = 'speaking-badge';
      badge.title = 'يتحدث الآن';
      a.nameTagEl.appendChild(badge);
    }
  } else {
    const badge = a.nameTagEl.querySelector('.speaking-badge');
    if (badge) badge.remove();
  }
});

// تشغيل الموسيقى عند أول تفاعل (سياسات المتصفح)
let started = false;
addEventListener('pointerdown', () => {
  if (started) return; started = true;
  if (!muted) startMusic();
}, { once: true });

// ==================== تحميل بيانات المتحف ====================
window.lastFrameData = lastFrameData;
fetch('/api/museum', {
  headers: museumToken ? { 'x-museum-access': museumToken } : {},
  cache: 'no-store'
})
  .then(async response => {
    if (response.status === 401) {
      const savedPassword = sessionStorage.getItem('mm_pass') || '';
      if (savedPassword) {
        try {
          const refreshed = await fetch('/api/museum/access', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: savedPassword }), cache: 'no-store'
          });
          const access = await refreshed.json();
          if (refreshed.ok && access.token) {
            sessionStorage.setItem('mm_access_token', access.token);
            return fetch('/api/museum', { headers: { 'x-museum-access': access.token }, cache: 'no-store' });
          }
        } catch (refreshError) { console.warn('Museum session refresh failed:', refreshError); }
      }
      sessionStorage.removeItem('mm_access_token');
      if (loadingEl) loadingEl.style.display = 'grid';
      if (loadingMessage) loadingMessage.textContent = 'انتهت جلسة الدخول — جارٍ تحويلك لصفحة الدخول…';
      setTimeout(() => { location.replace('/'); }, 250);
      throw new Error('انتهت جلسة الدخول. أدخل كلمة المرور مجدداً.');
    }
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    if (!contentType.includes('application/json')) {
      throw new Error(`الخادم لم يُرجع JSON لبيانات المتحف (HTTP ${response.status}). شغّل خادم المشروع على العنوان نفسه.`);
    }
    let data;
    try { data = JSON.parse(body); }
    catch { throw new Error(`بيانات المتحف بصيغة JSON غير صالحة (HTTP ${response.status})`); }
    if (!response.ok) throw new Error(data.error || `تعذر التحقق من كلمة السر (HTTP ${response.status})`);
    return data;
  })
  .then(async d => {
    document.title = d.museumName || document.title;
    lastFrameData = d.frames || [];
    characterModelPath = d.characterModel || '';
    characterModelMalePath = d.characterModelMale || d.characterModel || '';
    characterModelFemalePath = d.characterModelFemale || '';
    characterAnimationPaths = d.characterAnimations || [];
    buildFrames(d.frames || []);
    sceneReady.api = true;
    sceneReady.frame = true;
    const anyModel = characterModelMalePath || characterModelFemalePath || characterModelPath;
    setLoadingMessage(anyModel ? 'جارٍ تحميل مجسم الشخصية والحركات…' : 'جارٍ عرض المتحف…');
    await Promise.race([localAvatarReady, new Promise(resolve => setTimeout(resolve, 1800))]);
    await Promise.allSettled([...avatars.values()].map(avatar => loadAvatarModel(avatar, true)));
    completeModelLoad();
  })
  .catch(error => {
    console.error('Museum data load failed:', error);
    if (!setMuseumPasswordGate) setLoadingMessage(error.message || 'تعذّر فتح المتحف. أدخل كلمة سره من صفحة الدخول ثم حاول مجددًا.', true);
    if (!loadingEl.querySelector('.loading-retry')) {
      const retry = document.createElement('button');
      retry.className = 'loading-retry'; retry.textContent = 'العودة لصفحة الدخول';
      retry.onclick = () => { sessionStorage.removeItem('mm_access_token'); sessionStorage.removeItem('mm_pass'); location.href = '/'; };
      loadingEl.appendChild(retry);
    }
    clearTimeout(loadingWatchdog);
  });

// ==================== تحدي كسر اللعنة ومراحل المتاهة ====================
const cursedSkulls = [];
let collectedSkullsCount = 0;
const TOTAL_SKULLS = 5;
const skullLocations = [
  { x: -5.5, z: 2.0, label: 'جمجمة الدماء 🩸', hidden: 'جنب جدار المدخل' },
  { x: 5.5, z: 24.0, label: 'جمجمة الكوابيس 👁️', hidden: 'داخل تجويف العمود' },
  { x: -4.5, z: 68.0, label: 'جمجمة الصرخات 😱', hidden: 'في الممر المعتم' },
  { x: 4.8, z: 112.0, label: 'جمجمة المشرحة 🪓', hidden: 'قرب الأرضية المتصدعة' },
  { x: 0.0, z: 156.0, label: 'جمجمة الجحيم الأخيرة 🔥', hidden: 'عند الحاجز الأخير قبل بوابة اللغز' }
];

function buildCursedSkulls() {
  const questBox = document.getElementById('questBox');
  if (questBox) questBox.style.display = 'block';

  skullLocations.forEach((loc, idx) => {
    const sg = new THREE.Group();
    sg.position.set(loc.x, 1.25, loc.z);

    // مجسم الجمجمة الملعونة (Skull Geometry)
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xdfd8c8,
      roughness: 0.65,
      metalness: 0.1,
      emissive: 0x3d050a,
      emissiveIntensity: 0.35
    });

    // قبة الجمجمة
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 14), boneMat);
    cranium.scale.set(0.9, 1.0, 1.08);
    cranium.castShadow = true;
    sg.add(cranium);

    // الفك
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), boneMat);
    jaw.position.set(0, -0.16, 0.08);
    jaw.castShadow = true;
    sg.add(jaw);

    // محجر العينين المظلم
    const eyeSocketMat = new THREE.MeshBasicMaterial({ color: 0x050102 });
    [-0.07, 0.07].forEach(ex => {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), eyeSocketMat);
      socket.position.set(ex, -0.02, 0.22);
      sg.add(socket);

      // عين حمراء خافتة، دون PointLight مستقل لكل جمجمة لتقليل كلفة الإضاءة.
      const glowOrb = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff1122 })
      );
      glowOrb.position.set(ex, -0.02, 0.24);
      sg.add(glowOrb);
    });

    // التوهج الأحمر صادر عن خامة العين؛ نتجنب ضوءاً متحركاً منفصلاً لكل جمجمة على الهاتف.
    const redGlow = null;

    // دائرة تعويذة دموية تدور أسفل الجمجمة
    const runeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0xff2233, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
    );
    runeRing.rotation.x = -Math.PI / 2;
    runeRing.position.y = -1.22;
    sg.add(runeRing);

    sg.userData = {
      isSkull: true,
      index: idx,
      collected: false,
      label: loc.label,
      baseY: 1.25,
      light: redGlow,
      ring: runeRing
    };

    scene.add(sg);
    cursedSkulls.push(sg);
  });
}



function playSkullCollectSound() {
  if (muted || !audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.35);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.46);
  } catch (e) { }
}

buildCursedSkulls();

// ==================== نظام الرعب، الوحوش ثلاثية الأبعاد، والـ Jump Scares ====================
let cameraShake = 0.0;
let horrorPanic = 0.0;
let horrorAudioListener = null;
try { horrorAudioListener = new THREE.AudioListener(); camera.add(horrorAudioListener); } catch (error) { console.warn('3D audio unavailable:', error); }

let wallBurstArms = null;
let lungingPhantom = null;

function triggerJumpScare({ type = 'lunge', intensity = 0.75, message = '😱 كابوس!' } = {}) {
  cameraShake = intensity;
  horrorPanic = 1.0;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    startFastHeartbeat();
  }
  socket.emit('horror-scare-event', { type: type === 'whisper' ? 'whisper' : 'scream', x: avatars.get(socket.id)?.group.position.x || 0, z: avatars.get(socket.id)?.group.position.z || 0 });
  const overlay = document.getElementById('scareOverlay');
  if (overlay) {
    overlay.classList.remove('flash');
    void overlay.offsetWidth;
    overlay.classList.add('flash');
  }
  playJumpScareAudio(type);
  showToast(message);
}

function startFastHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  let beatStep = 0;
  heartbeatTimer = setInterval(() => {
    if (muted || !audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(beatStep % 2 === 0 ? 88 : 64, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(beatStep % 2 === 0 ? 0.45 : 0.28, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
    beatStep++;
  }, 400);
}

function playJumpScareAudio(type = 'lunge') {
  if (muted || !audioCtx) return;
  try {
    const now = audioCtx.currentTime;

    const screamOsc = audioCtx.createOscillator();
    const screamGain = audioCtx.createGain();
    screamOsc.type = 'sawtooth';
    screamOsc.frequency.setValueAtTime(type === 'burst' ? 520 : 980, now);
    screamOsc.frequency.exponentialRampToValueAtTime(150, now + 0.65);
    screamGain.gain.setValueAtTime(0, now);
    screamGain.gain.linearRampToValueAtTime(0.42, now + 0.04);
    screamGain.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    screamOsc.connect(screamGain).connect(audioCtx.destination);
    screamOsc.start(now);
    screamOsc.stop(now + 0.75);

    const subOsc = audioCtx.createOscillator();
    const subGain = audioCtx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(115, now);
    subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.45);
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(0.65, now + 0.03);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.50);
    subOsc.connect(subGain).connect(audioCtx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.55);

    const bufferSize = audioCtx.sampleRate * 0.22;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.035));
    }
    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.2);
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    noiseNode.connect(filter).connect(noiseGain).connect(audioCtx.destination);
    noiseNode.start(now);
  } catch (e) { }
}

function buildHorrorMonstersAndStatues() {
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x140c10,
    roughness: 0.88,
    metalness: 0.15
  });
  const bloodStoneMat = new THREE.MeshStandardMaterial({
    color: 0x2e080e,
    roughness: 0.70,
    metalness: 0.25,
    emissive: 0x4a0812,
    emissiveIntensity: 0.35
  });

  ROOM_CENTERS.forEach(cz => {
    [-6.2, 6.2].forEach(px => {
      [-3.8, 3.8].forEach(pz => {
        const pillar = new THREE.Group();
        pillar.position.set(px, 0, cz + pz);

        const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.45, 0.85), stoneMat);
        base.position.y = 0.225;
        base.castShadow = true; base.receiveShadow = true;
        pillar.add(base);

        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, WALL_H - 0.9, 14), stoneMat);
        shaft.position.y = (WALL_H - 0.9) / 2 + 0.45;
        shaft.castShadow = true; shaft.receiveShadow = true;
        pillar.add(shaft);

        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.45, 0.80), stoneMat);
        cap.position.y = WALL_H - 0.225;
        cap.castShadow = true; cap.receiveShadow = true;
        pillar.add(cap);

        scene.add(pillar);
        cameraBlockers.push(base);
      });
    });
  });

  const gargoyle = new THREE.Group();
  gargoyle.position.set(-6.8, 0, 24.0);
  gargoyle.rotation.y = Math.PI / 2;

  const altar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), bloodStoneMat);
  altar.position.y = 0.55; altar.castShadow = true; altar.receiveShadow = true;
  gargoyle.add(altar);

  const demonTorso = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.1, 0.45), stoneMat);
  demonTorso.position.set(0, 1.65, 0); demonTorso.castShadow = true;
  gargoyle.add(demonTorso);

  const demonHead = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), stoneMat);
  demonHead.position.set(0, 2.35, 0.1);
  gargoyle.add(demonHead);

  [-0.20, 0.20].forEach(hx => {
    const horn = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 12, Math.PI * 0.8), bloodStoneMat);
    horn.position.set(hx, 2.55, 0.05);
    horn.rotation.z = (hx > 0 ? 1 : -1) * 0.8;
    gargoyle.add(horn);
  });

  const eyeLight = new THREE.PointLight(0xff0022, 35, 8, 2.0);
  eyeLight.position.set(0, 2.35, 0.35);
  gargoyle.add(eyeLight);

  [-0.08, 0.08].forEach(ex => {
    const eyeOrb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0022 }));
    eyeOrb.position.set(ex, 2.35, 0.32);
    gargoyle.add(eyeOrb);
  });

  [-1, 1].forEach(side => {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.06), stoneMat);
    wing.position.set(side * 0.95, 2.0, -0.22);
    wing.rotation.y = side * 0.35;
    wing.rotation.z = side * 0.25;
    wing.castShadow = true;
    gargoyle.add(wing);
  });

  scene.add(gargoyle);
  cameraBlockers.push(altar);

  const burstGroup = new THREE.Group();
  burstGroup.position.set(1.65, 1.6, 44.0);
  burstGroup.userData = {
    isWallBurst: true,
    triggered: false,
    timer: 0
  };

  const bMat = new THREE.MeshStandardMaterial({ color: 0xcfc4b0, roughness: 0.6, metalness: 0.1 });
  const bloodMat = new THREE.MeshBasicMaterial({ color: 0xaa0a15 });

  for (let h = 0; h < 3; h++) {
    const armGroup = new THREE.Group();
    armGroup.position.set(0, (h - 1) * 0.45, (h - 1) * 0.35);
    
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.85, 8), bMat);
    arm.rotation.z = Math.PI / 2;
    armGroup.add(arm);

    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), bMat);
    claw.position.x = -0.48;
    armGroup.add(claw);

    const bloodDrip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.25, 6), bloodMat);
    bloodDrip.position.set(-0.52, -0.10, 0);
    armGroup.add(bloodDrip);

    burstGroup.add(armGroup);
  }

  burstGroup.position.x = 2.4;
  scene.add(burstGroup);
  wallBurstArms = burstGroup;

  const phantomGroup = new THREE.Group();
  phantomGroup.position.set(3.8, 1.8, 90.0);
  phantomGroup.userData = {
    isPhantom: true,
    triggered: false,
    active: false,
    lungeT: 0,
    startX: 3.8,
    startZ: 90.0
  };

  const ghostMat = new THREE.MeshStandardMaterial({
    color: 0x12080c,
    roughness: 0.85,
    emissive: 0x3d0208,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.95
  });

  const phantomHead = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), ghostMat);
  phantomGroup.add(phantomHead);

  const phantomJaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.22), ghostMat);
  phantomJaw.position.set(0, -0.32, 0.12);
  phantomGroup.add(phantomJaw);

  const mouthVoid = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.15), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  mouthVoid.position.set(0, -0.30, 0.18);
  phantomGroup.add(mouthVoid);

  [-0.09, 0.09].forEach(ex => {
    const ghostEye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ghostEye.position.set(ex, 0.05, 0.26);
    phantomGroup.add(ghostEye);
  });

  const shroud = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 12, 1, true), ghostMat);
  shroud.position.y = -0.95;
  phantomGroup.add(shroud);

  [-0.32, 0.32].forEach(side => {
    const ghostClaw = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.75, 6), ghostMat);
    ghostClaw.position.set(side, -0.4, 0.35);
    ghostClaw.rotation.x = -Math.PI / 2.5;
    phantomGroup.add(ghostClaw);
  });

  phantomGroup.visible = false;
  scene.add(phantomGroup);
  lungingPhantom = phantomGroup;
}

buildHorrorMonstersAndStatues();

window.cursedSkulls = cursedSkulls;
window.wallBurstArms = wallBurstArms;
window.lungingPhantom = lungingPhantom;
window.triggerJumpScare = triggerJumpScare;
window.collectSkull = collectSkull;



// ==================== حلقة الرسم ====================
const clock = new THREE.Clock();
let frameStarted = false;
function animate() {
  if (frameStarted) return;
  frameStarted = true;
  requestAnimationFrame(renderFrame);
}
let lastFrameTime = performance.now();
const targetFrameInterval = isMobileDevice ? 1000 / 60 : 0;

function updateHorrorWorld(dt) {
  const player = avatars.get(socket.id);
  if (!player) return;
  horrorClock += dt;
  const pos = player.group.position;
  let cursePressure = 0;
  for (const skull of cursedSkulls) {
    if (!skull.userData.collected) {
      const distance = Math.hypot(pos.x - skull.position.x, pos.z - skull.position.z);
      cursePressure = Math.max(cursePressure, THREE.MathUtils.clamp(1 - distance / 10, 0, 1));
    }
  }
  const fearTarget = THREE.MathUtils.clamp((flashlightEnabled ? 7 : 54) + cursePressure * 35 + (player.velocity > .2 ? 4 : 0), 0, 100);
  fearMeter = THREE.MathUtils.damp(fearMeter, fearTarget, 1.8, dt);
  sanity = THREE.MathUtils.damp(sanity, 100 - fearMeter, .5, dt);

  if (nowSafeNumber(fearMeter) && performance.now() - lastHorrorUiUpdate > 120) {
    lastHorrorUiUpdate = performance.now();
    const fill = document.getElementById('sanityFill');
    const percent = document.getElementById('sanityPercent');
    const glitch = document.getElementById('fearGlitch');
    const vignette = document.getElementById('bloodVignette');
    const value = Math.round(sanity);
    if (fill) fill.style.width = `${value}%`;
    if (percent) percent.textContent = `${value}%`;
    if (glitch) {
      const glitchOpacity = Math.max(0, (fearMeter - 35) / 100);
      glitch.style.opacity = String(glitchOpacity);
      glitch.classList.toggle('active', fearMeter > 68);
    }
    if (vignette) vignette.style.opacity = String(.45 + fearMeter / 200);
    scene.fog.density = HORROR_FOG_BASE + (fearMeter / 100) * (isMobileDevice ? .003 : .006);
  }

  emergencyLights.forEach(({ light, seed, baseIntensity }) => {
    const pulse = .72 + .20 * Math.sin(horrorClock * 5 + seed) + .08 * Math.sin(horrorClock * 13 + seed * 2);
    const flicker = Math.random() < .006 ? .08 : 1;
    light.intensity = baseIntensity * pulse * flicker;
  });
  possessedVines.forEach(({ material, phase }) => {
    material.emissiveIntensity = .22 + .22 * (Math.sin(horrorClock * 1.8 + phase) * .5 + .5);
  });
  bloodDrips.forEach(drip => {
    const phase = horrorClock * .9 + drip.userData.phase;
    drip.position.y = drip.userData.baseY - (phase % 2.4) * .08;
    drip.visible = (phase % 2.4) < 1.9;
  });

  if (swingingBladeTrap?.userData.pivot) {
    const trap = swingingBladeTrap;
    const distance = Math.hypot(pos.x - trap.position.x, pos.z - trap.position.z);
    trap.userData.pivot.rotation.z = Math.sin(horrorClock * (distance < 5 ? 3.3 : 1.2)) * (distance < 5 ? .48 : .18);
    if (distance < 2.0 && !trap.userData.triggered) {
      trap.userData.triggered = true;
      triggerJumpScare({ type: 'burst', intensity: .42, message: '🪓 نصل يتأرجح فوقك!' });
      setTimeout(() => { trap.userData.triggered = false; }, 5500);
    }
  }
  if (brokenFloorTrap && !brokenFloorTrap.userData.triggered && Math.hypot(pos.x - brokenFloorTrap.position.x, pos.z - brokenFloorTrap.position.z) < 1.0) {
    brokenFloorTrap.userData.triggered = true;
    triggerJumpScare({ type: 'burst', intensity: .34, message: 'الأرض تنهار تحت قدميك!' });
    setTimeout(() => { brokenFloorTrap.userData.triggered = false; }, 6500);
  }

  let nearestProp = null;
  let nearestDistance = Infinity;
  for (const prop of interactivePuzzleProps) {
    if (!prop.visible || ['floor-trap', 'blade-trap'].includes(prop.userData.kind)) continue;
    if ((prop.userData.kind === 'riddle' && sharedChallengeState.stage !== 'riddle') || (prop.userData.kind === 'key' && sharedChallengeState.stage !== 'key') || (prop.userData.kind === 'fuse' && sharedChallengeState.stage !== 'fuse') || (prop.userData.kind === 'exit' && sharedChallengeState.stage !== 'door')) continue;
    const distance = Math.hypot(pos.x - prop.position.x, pos.z - prop.position.z);
    if (distance < (prop.userData.interactionRadius || 2.5) && distance < nearestDistance) {
      nearestProp = prop;
      nearestDistance = distance;
    }
  }
  const prompt = document.getElementById('collectPrompt');
  const nearestSkull = cursedSkulls.find(skull => !skull.userData.collected && Math.hypot(pos.x - skull.position.x, pos.z - skull.position.z) < 2.5);
  const propAllowed = nearestProp && ((nearestProp.userData.kind === 'riddle' && sharedChallengeState.stage === 'riddle') || (nearestProp.userData.kind === 'key' && sharedChallengeState.stage === 'key') || (nearestProp.userData.kind === 'fuse' && sharedChallengeState.stage === 'fuse') || (nearestProp.userData.kind === 'exit' && sharedChallengeState.stage === 'door'));
  if (prompt && nearestSkull && sharedChallengeState.stage === 'skulls') {
    prompt.style.display = 'block';
    prompt.textContent = `💀 اضغط E لجمع ${nearestSkull.userData.label}`;
    prompt.onclick = () => collectSkull(nearestSkull);
    horrorInteractionTarget = { type: 'skull', object: nearestSkull };
  } else if (prompt && propAllowed) {
    const labels = { riddle: '🩸 اضغط E لحل اللغز', key: '🗝️ اضغط E لالتقاط المفتاح', fuse: '⚡ اضغط E لإصلاح الكهرباء', exit: '🚪 اضغط E لفتح البوابة' };
    prompt.style.display = 'block';
    prompt.textContent = labels[nearestProp.userData.kind] || 'اضغط E للتفاعل';
    prompt.onclick = () => completeChallengeAction(nearestProp);
    horrorInteractionTarget = { type: 'puzzle', object: nearestProp };
  } else {
    if (prompt) prompt.style.display = 'none';
    horrorInteractionTarget = null;
  }

  const now = performance.now();
  if (!flashlightEnabled && now > nextWhisperAt) {
    nextWhisperAt = now + 18000 + Math.random() * 24000;
    if (!muted && audioCtx) playSpatialHorrorSound(pos.x + (Math.random() < .5 ? -1 : 1) * 3, pos.z + (Math.random() - .5) * 4);
  }
  if (fearMeter > 58 && now > nextScareAt) {
    nextScareAt = now + 35000 + Math.random() * 30000;
    if (Math.random() < .45) triggerJumpScare({ type: 'whisper', intensity: .22, message: 'سمعتَ شيئاً يتحرك خلفك...' });
  }
  if (now - lastHorrorSync > 900) {
    lastHorrorSync = now;
    socket.emit('horror-player-state', { x: pos.x, z: pos.z, flashlight: flashlightEnabled, panic: Math.round(fearMeter) });
  }
}
if (socket) socket.on('horror-scare-event', event => {
  if (!event || event.id === socket.id) return;
  const me = avatars.get(socket.id), source = avatars.get(event.id);
  const sx = source?.group.position.x ?? event.x;
  const sz = source?.group.position.z ?? event.z;
  if (!me || Math.hypot(me.group.position.x - sx, me.group.position.z - sz) > 24) return;
  cameraShake = Math.max(cameraShake, event.type === 'whisper' ? .16 : .32);
  if (event.type !== 'whisper') playJumpScareAudio('lunge');
});

function nowSafeNumber(value) { return Number.isFinite(value) ? value : 0; }

function playSpatialHorrorSound(x, z) {
  if (!audioCtx || muted) return;
  try {
    const player = avatars.get(socket.id);
    const dx = x - (player?.group.position.x || 0);
    const dz = z - (player?.group.position.z || 0);
    const pan = THREE.MathUtils.clamp(dx / 8, -1, 1);
    const now = audioCtx.currentTime;
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(260 + Math.random() * 110, now);
    oscillator.frequency.exponentialRampToValueAtTime(95, now + .7);
    panner.pan.setValueAtTime(pan, now);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(.035, now + .08);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .8);
    oscillator.connect(panner).connect(gain).connect(audioCtx.destination);
    oscillator.start(now); oscillator.stop(now + .82);
  } catch { }
}

function renderFrame(now) {
  requestAnimationFrame(renderFrame);

  // حماية من استهلاك المعالج وتفادي التهنيج على الهواتف
  if (targetFrameInterval > 0) {
    const elapsed = now - lastFrameTime;
    if (elapsed < targetFrameInterval - 1.5) return;
    lastFrameTime = now - (elapsed % targetFrameInterval);
  }

  const dt = Math.min(clock.getDelta(), .045);
  try {
    // وميض أضواء الرعب المفاجئ (Horror Light Flicker)
    if (doorwayLight && Math.random() < 0.035) {
      doorwayLight.intensity = Math.random() < 0.5 ? 18 : 95;
    }

    // دوران وتحليق الجماجم الملعونة في مكانها بأسلوب سينمائي
    if (cursedSkulls.length) {
      const nowSec = performance.now() * 0.002;
      cursedSkulls.forEach(sg => {
        if (!sg.userData.collected) {
          sg.rotation.y += dt * 1.5;
          sg.position.y = sg.userData.baseY + Math.sin(nowSec * 2 + sg.userData.index) * 0.12;
          if (sg.userData.ring) sg.userData.ring.rotation.z -= dt * 2.0;
        }
      });
    }

    updateMe(dt);
    updateHorrorWorld(dt);
    updateOthers(dt);
    updateTags();
  } catch (error) {
    console.error('Museum frame update failed:', error);
    if (!sceneReady.render) {
      sceneReady.render = true;
      completeModelLoad();
      setLoadingMessage('حدث خطأ أثناء تجهيز بعض تفاصيل المشهد؛ سيعمل المتحف بالوضع الأساسي.', true);
    }
  }
  try {
    renderer.render(scene, camera);
    if (!sceneReady.render) {
      sceneReady.render = true;
      checkSceneReady();
    }
  } catch (error) {
    console.error('Museum renderer failed:', error);
    setLoadingMessage('تعذّر عرض المشهد ثلاثي الأبعاد على هذا المتصفح.', true);
    sceneReady.render = true;
  }
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(isMobileDevice ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 2));
});

function collectSkull(skull) {
  if (!skull || skull.userData.collected || sharedChallengeState.stage !== 'skulls') return;
  const player = avatars.get(socket.id);
  if (!player || Math.hypot(player.group.position.x - skull.position.x, player.group.position.z - skull.position.z) > 3.8) return;
  socket.emit('horror-challenge-action', { type: 'collect-skull', index: skull.userData.index, x: player.group.position.x, z: player.group.position.z });
  playSkullCollectSound();
  showToast(`💀 أُرسلت ${skull.userData.label} للمشاركة الجماعية`);
}

window.cursedSkulls = cursedSkulls;
