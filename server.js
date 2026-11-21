const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- بيانات المتحف ----------
const DEFAULT_DATA = {
  museumName: 'متحف الذكريات الافتراضي',
  password: '', // كلمة السر (فارغة = بدون كلمة سر)
  characterModel: '',
  characterModelMale: '',
  characterModelFemale: '',
  characterAnimations: [],
  zombieModel: '',
  frames: [
    // صور افتراضية (رسم توضيحي) — استبدليها من لوحة التحكم /admin بصوركم الحقيقية
    { img: 'https://picsum.photos/seed/mem1/640/480', title: 'أول لقاء لنا 💕' },
    { img: 'https://picsum.photos/seed/mem2/640/480', title: 'أجمل يوم 🌅' },
    { img: 'https://picsum.photos/seed/mem3/640/480', title: 'رحلتنا الأولى ✈️' },
    { img: 'https://picsum.photos/seed/mem4/640/480', title: 'ضحكتنا مع بعض 😂' },
    { img: 'https://picsum.photos/seed/mem5/640/480', title: 'ذكرى سنة كاملة 🎉' }
  ]
};

function loadData() {
  try {
    return { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_DATA };
  }
}
function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8');
}
let museum = loadData();
const adminSessions = new Map();
const museumSessions = new Map();
const sessionTokensByPassword = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hasAdminSession(req) {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith('museum_admin='))?.slice('museum_admin='.length);
  const createdAt = token && adminSessions.get(token);
  if (!createdAt) return false;
  if (Date.now() - createdAt > SESSION_TTL_MS) { adminSessions.delete(token); return false; }
  return true;
}
function hasMuseumAccess(req) {
  const headerToken = req.get('x-museum-access');
  const cookieToken = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith('museum_token='))?.slice('museum_token='.length);
  const token = headerToken || cookieToken;
  const createdAt = token && museumSessions.get(token);
  if (!createdAt) return false;
  if (Date.now() - createdAt > SESSION_TTL_MS) { museumSessions.delete(token); return false; }
  return true;
}
function requireAdmin(req, res, next) {
  if (!hasAdminSession(req)) return res.status(401).json({ error: 'سجّل دخول لوحة التحكم أولاً' });
  next();
}
function publicMuseumData() {
  const { password, ...publicData } = museum;
  return { ...publicData, requiresPassword: Boolean(password) };
}

// ---------- رفع الصور ----------
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'img_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype))
});
const isAvatarAsset = (file) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.glb') return ['model/gltf-binary', 'application/octet-stream', 'application/gltf-buffer'].includes(file.mimetype);
  return ext === '.gltf' && ['model/gltf+json', 'application/json', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
};
const modelUpload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, isAvatarAsset(file))
});
const animationsUpload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, isAvatarAsset(file))
});

// ---------- إعداد Express ----------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// لوحة التحكم
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---------- API ----------
app.get('/api/museum', (req, res) => {
  if (museum.password && !hasMuseumAccess(req) && !hasAdminSession(req)) {
    return res.status(401).json({ museumName: 'متحف خاص', error: 'كلمة السر مطلوبة أو غير صحيحة', requiresPassword: true });
  }
  res.set('Cache-Control', 'no-store');
  res.json(publicMuseumData());
});

app.get('/api/admin/config', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(museum);
});

app.post('/api/museum/access', (req, res) => {
  const suppliedPassword = String((req.body || {}).password || '');
  if (museum.password && suppliedPassword !== museum.password) {
    return res.status(401).json({ ok: false, error: 'كلمة السر غير صحيحة' });
  }
  if (!museum.password) return res.json({ ok: true, token: '' });
  let token = sessionTokensByPassword.get(suppliedPassword);
  if (token && !museumSessions.has(token)) sessionTokensByPassword.delete(suppliedPassword);
  token = sessionTokensByPassword.get(suppliedPassword) || crypto.randomBytes(32).toString('hex');
  museumSessions.set(token, Date.now());
  sessionTokensByPassword.set(suppliedPassword, token);
  res.setHeader('Set-Cookie', `museum_token=${token}; SameSite=Lax; Path=/; Max-Age=43200`);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, token });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (museum.password && password !== museum.password) {
    return res.status(401).json({ error: 'كلمة السر غير صحيحة' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now());
  res.setHeader('Set-Cookie', `museum_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${req.secure ? '; Secure' : ''}`);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith('museum_admin='))?.slice('museum_admin='.length);
  if (token) adminSessions.delete(token);
  res.setHeader('Set-Cookie', 'museum_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.post('/api/admin/logout-after-save', (req, res) => {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith('museum_admin='))?.slice('museum_admin='.length);
  if (token) adminSessions.delete(token);
  res.setHeader('Set-Cookie', 'museum_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.post('/api/admin/frames', requireAdmin, express.urlencoded({ extended: true }), (req, res, next) => next());

app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار صورة' });
  res.json({ ok: true, path: '/uploads/' + req.file.filename });
});

app.post('/api/admin/upload-multiple', requireAdmin, upload.array('images', 100), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'لم يتم اختيار صور' });
  const files = req.files.map(f => ({
    path: '/uploads/' + f.filename,
    title: path.parse(f.originalname).name.slice(0, 80)
  }));
  res.json({ ok: true, files });
});

app.post('/api/admin/model', requireAdmin, modelUpload.single('model'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'اختر ملف GLB أو GLTF صالحًا، بحد أقصى 40 ميجابايت' });
  const modelPath = '/uploads/' + req.file.filename;
  const gender = String(req.body.gender || 'both').toLowerCase();

  if (gender === 'male') {
    museum.characterModelMale = modelPath;
    if (!museum.characterModel) museum.characterModel = modelPath;
  } else if (gender === 'female') {
    museum.characterModelFemale = modelPath;
    if (!museum.characterModel) museum.characterModel = modelPath;
  } else {
    museum.characterModel = modelPath;
    museum.characterModelMale = modelPath;
    museum.characterModelFemale = modelPath;
  }

  saveData(museum);
  io.emit('museum-updated', publicMuseumData());
  res.json({
    ok: true,
    path: modelPath,
    gender,
    characterModel: museum.characterModel,
    characterModelMale: museum.characterModelMale,
    characterModelFemale: museum.characterModelFemale
  });
});

app.post('/api/admin/model/delete', requireAdmin, (req, res) => {
  const gender = String((req.body || {}).gender || 'both').toLowerCase();
  if (gender === 'male') {
    museum.characterModelMale = '';
    if (museum.characterModel === museum.characterModelMale) museum.characterModel = '';
  } else if (gender === 'female') {
    museum.characterModelFemale = '';
    if (museum.characterModel === museum.characterModelFemale) museum.characterModel = '';
  } else {
    museum.characterModel = '';
    museum.characterModelMale = '';
    museum.characterModelFemale = '';
  }
  saveData(museum);
  io.emit('museum-updated', publicMuseumData());
  res.json({
    ok: true,
    gender,
    characterModel: museum.characterModel,
    characterModelMale: museum.characterModelMale,
    characterModelFemale: museum.characterModelFemale
  });
});

app.post('/api/admin/animations', requireAdmin, animationsUpload.array('animations', 8), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'اختر ملف حركة GLB أو GLTF واحدًا على الأقل' });
  const paths = req.files.map(file => '/uploads/' + file.filename);
  museum.characterAnimations = [...(museum.characterAnimations || []), ...paths].slice(0, 8);
  saveData(museum);
  io.emit('museum-updated', publicMuseumData());
  res.json({ ok: true, paths: museum.characterAnimations });
});

app.post('/api/admin/zombie-model', requireAdmin, modelUpload.single('model'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'اختر ملف GLB أو GLTF صالحًا للزومبي، بحد أقصى 40 ميجابايت' });
  const modelPath = '/uploads/' + req.file.filename;
  museum.zombieModel = modelPath;
  saveData(museum);
  io.emit('museum-updated', publicMuseumData());
  res.json({ ok: true, path: modelPath, zombieModel: museum.zombieModel });
});

app.post('/api/admin/zombie-model/delete', requireAdmin, (req, res) => {
  museum.zombieModel = '';
  saveData(museum);
  io.emit('museum-updated', publicMuseumData());
  res.json({ ok: true, zombieModel: '' });
});

// حفظ إعدادات المالك (صور + عناوين + اسم + كلمة سر)
app.post('/api/admin/save', requireAdmin, (req, res) => {
  const { museumName, password, frames, characterModel, characterModelMale, characterModelFemale, characterAnimations, zombieModel } = req.body || {};
  let passwordChanged = false;
  if (typeof museumName === 'string' && museumName.trim()) museum.museumName = museumName.trim();
  if (typeof password === 'string' && password.trim() !== museum.password) {
    museum.password = password.trim();
    passwordChanged = true;
    museumSessions.clear();
    sessionTokensByPassword.clear();
    adminSessions.clear();
    const logoutToken = (req.headers.cookie || '').split(';').map(part => part.trim())
      .find(part => part.startsWith('museum_admin='))?.slice('museum_admin='.length);
    if (logoutToken) adminSessions.set(logoutToken, Date.now());
    res.setHeader('Set-Cookie', 'museum_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  }
  if (typeof characterModel === 'string') museum.characterModel = characterModel;
  if (typeof characterModelMale === 'string') museum.characterModelMale = characterModelMale;
  if (typeof characterModelFemale === 'string') museum.characterModelFemale = characterModelFemale;
  if (typeof zombieModel === 'string') museum.zombieModel = zombieModel;
  if (Array.isArray(characterAnimations)) museum.characterAnimations = characterAnimations
    .filter(file => typeof file === 'string' && /^\/uploads\/[^/]+\.(?:glb|gltf)$/i.test(file)).slice(0, 8);
  if (Array.isArray(frames)) {
    museum.frames = frames
      .filter(f => f && f.img)
      .slice(0, 100)
      .map(f => ({ img: String(f.img), title: String(f.title || '').slice(0, 80) }));
  }
  saveData(museum);
  io.emit('museum-updated', publicMuseumData());
  res.json({ ok: true, passwordChanged });
});

// Return JSON for API parsing errors and unknown endpoints.
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  console.error('API request failed:', req.method, req.originalUrl, err.message);
  res.status(status).json({
    error: status === 413 ? 'حجم الملف أكبر من الحد المسموح' : (err.message || 'حدث خطأ في الخادم')
  });
});
app.use('/api', (req, res) => res.status(404).json({ error: 'مسار API غير موجود', path: req.originalUrl }));
app.use((req, res) => {
  if (req.method === 'GET' && !path.extname(req.path)) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  res.status(404).json({ error: 'الملف أو المسار غير موجود' });
});

server.on('clientError', (error, socket) => {
  // المتصفح أو الوكيل قد يغلق الاتصال قبل اكتمال الطلب؛ هذا ليس خطأ خادم يستحق تسجيله.
  if (!['ECONNRESET', 'ECONNABORTED'].includes(error.code)) {
    console.error('HTTP client error:', error.message);
  }
  if (socket.writable && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

// ---------- Socket.io (تعدد اللاعبين) ----------
io.use((socket, next) => {
  const tokenFromAuth = socket.handshake.auth?.museumToken;
  const cookieToken = (socket.request.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith('museum_token='))?.slice('museum_token='.length);
  const accessToken = tokenFromAuth || cookieToken;
  const createdAt = accessToken && museumSessions.get(accessToken);
  const validMuseumSession = Boolean(createdAt && Date.now() - createdAt <= SESSION_TTL_MS);
  if (!museum.password || validMuseumSession || hasAdminSession(socket.request)) return next();
  next(new Error('museum-password-required'));
});
const players = new Map(); // socketId -> {id, name, color, x, z, rot, bubble}
const HORROR_SKULL_TOTAL = 5;
const horrorChallengeState = {
  skulls: Array(HORROR_SKULL_TOTAL).fill(false),
  riddleSolved: false,
  keyFound: false,
  fuseFixed: false,
  doorOpen: false,
  stage: 'skulls'
};
function updateHorrorStage() {
  if (!horrorChallengeState.skulls.every(Boolean)) horrorChallengeState.stage = 'skulls';
  else if (!horrorChallengeState.riddleSolved) horrorChallengeState.stage = 'riddle';
  else if (!horrorChallengeState.keyFound) horrorChallengeState.stage = 'key';
  else if (!horrorChallengeState.fuseFixed) horrorChallengeState.stage = 'fuse';
  else if (!horrorChallengeState.doorOpen) horrorChallengeState.stage = 'door';
  else horrorChallengeState.stage = 'escaped';
}

io.on('connection', (socket) => {
  socket.on('join', ({ name, color, gender }) => {
    const spawnX = Number(((Math.random() - 0.5) * 2.2).toFixed(2));
    const spawnZ = Number((5.8 + Math.random() * 0.8).toFixed(2));
    players.set(socket.id, {
      id: socket.id,
      name: String(name || 'زائر').slice(0, 20),
      color: color || '#e39aae',
      gender: gender === 'female' ? 'female' : 'male',
      x: spawnX, z: spawnZ, rot: 0, bubble: ''
    });
    // إرسال حالة اللاعبين الحاليين للجديد + إشعار الباقين
    socket.emit('players', [...players.values()]);
    socket.emit('horror-challenge-state', horrorChallengeState);
    socket.broadcast.emit('player-joined', players.get(socket.id));
    io.emit('count', players.size);
  });

  socket.on('move', ({ x, z, rot }) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.x = x; p.z = z; p.rot = rot;
    socket.broadcast.emit('player-moved', { id: socket.id, x, z, rot });
  });

  socket.on('chat', ({ text }) => {
    const p = players.get(socket.id);
    if (!p || !text) return;
    const bubble = String(text).slice(0, 120);
    p.bubble = bubble;
    io.emit('bubble', { id: socket.id, text: bubble });
    clearTimeout(p._bt);
    p._bt = setTimeout(() => {
      if (players.has(socket.id)) {
        p.bubble = '';
        io.emit('bubble', { id: socket.id, text: '' });
      }
    }, 6000);
  });

  socket.on('emoji', ({ emoji }) => {
    socket.broadcast.emit('emoji', { id: socket.id, emoji: String(emoji || '❤️').slice(0, 8) });
  });

  socket.on('action', ({ action }) => {
    const allowedActions = ['wave', 'clap', 'salute', 'kiss', 'cheer', 'laugh', 'cry', 'dance', 'jump'];
    socket.broadcast.emit('action', { id: socket.id, action: allowedActions.includes(action) ? action : null });
  });

  // حالة التحدي مرجعية من الخادم كي يرى جميع اللاعبين الجماجم/الألغاز نفسها.
  socket.on('horror-challenge-action', ({ type, index, answer, x, z }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const px = Number.isFinite(x) ? x : player.x;
    const pz = Number.isFinite(z) ? z : player.z;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(px - player.x, pz - player.z) > 4.5) return;

    if (type === 'collect-skull' && Number.isInteger(index) && index >= 0 && index < HORROR_SKULL_TOTAL && !horrorChallengeState.skulls[index]) {
      const spots = [
        { x: -5.5, z: 2.0 }, { x: 5.5, z: 24.0 }, { x: -4.5, z: 68.0 },
        { x: 4.8, z: 112.0 }, { x: 0.0, z: 156.0 }
      ];
      const spot = spots[index];
      if (Math.hypot(px - spot.x, pz - spot.z) > 3.8) return;
      horrorChallengeState.skulls[index] = true;
    } else if (type === 'solve-riddle' && horrorChallengeState.skulls.every(Boolean) && Math.hypot(px - 5.8, pz - 150) < 3.4 && String(answer || '').trim().replace(/[ًٌٍَُِّْـ]/g, '').toLowerCase() === 'قلب') {
      horrorChallengeState.riddleSolved = true;
    } else if (type === 'find-key' && horrorChallengeState.riddleSolved && Math.hypot(px + 5.4, pz - 174) < 3.2) {
      horrorChallengeState.keyFound = true;
    } else if (type === 'repair-fuse' && horrorChallengeState.keyFound && Math.hypot(px - 5.8, pz - 194) < 3.4) {
      horrorChallengeState.fuseFixed = true;
    } else if (type === 'open-exit' && horrorChallengeState.fuseFixed && Math.hypot(px - 1.62, pz - 203.5) < 4.0) {
      horrorChallengeState.doorOpen = true;
    } else {
      return;
    }
    updateHorrorStage();
    io.emit('horror-challenge-state', { ...horrorChallengeState, skulls: [...horrorChallengeState.skulls] });
  });

  socket.on('horror-player-state', ({ x, z, flashlight, panic }) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (Number.isFinite(x)) player.x = x;
    if (Number.isFinite(z)) player.z = z;
    player.flashlight = Boolean(flashlight);
    player.panic = Math.max(0, Math.min(100, Number(panic) || 0));
    socket.broadcast.emit('horror-player-state', {
      id: socket.id, x: player.x, z: player.z,
      flashlight: player.flashlight, panic: player.panic
    });
  });

  socket.on('horror-scare-event', ({ type, x, z }) => {
    const player = players.get(socket.id);
    if (!player) return;
    socket.broadcast.emit('horror-scare-event', {
      id: socket.id,
      type: type === 'whisper' ? 'whisper' : 'scream',
      x: Number.isFinite(x) ? x : player.x,
      z: Number.isFinite(z) ? z : player.z
    });
  });

  socket.on('panic-status', ({ name, panic }) => {
    socket.broadcast.emit('panic-status', {
      id: socket.id,
      name: String(name || 'لاعب').slice(0, 20),
      panic: Math.max(0, Math.min(100, Number(panic) || 0))
    });
  });

  socket.on('horror-scare', ({ type }) => {
    socket.broadcast.emit('horror-scare', { from: socket.id, type: type === 'whisper' ? 'whisper' : 'scream' });
  });

  socket.on('horror-trap', ({ id, type }) => {
    socket.broadcast.emit('horror-trap', {
      from: socket.id,
      id: String(id || '').slice(0, 48),
      type: ['floor-collapse', 'swinging-blade', 'door-scare'].includes(type) ? type : 'door-scare'
    });
  });

  socket.on('proximity-chat', ({ enabled }) => {
    socket.broadcast.emit('proximity-chat', { id: socket.id, enabled: Boolean(enabled) });
  });

  socket.on('player-visual-state', ({ flashlight, panic }) => {
    socket.broadcast.emit('player-visual-state', {
      id: socket.id,
      flashlight: Boolean(flashlight),
      panic: Math.max(0, Math.min(100, Number(panic) || 0))
    });
  });

  socket.on('player-action-state', ({ action, fear }) => {
    const player = players.get(socket.id);
    if (player) player.action = String(action || '').slice(0, 24);
    socket.broadcast.emit('player-action-state', {
      id: socket.id,
      action: String(action || '').slice(0, 24),
      fear: Math.max(0, Math.min(100, Number(fear) || 0))
    });
  });

  socket.on('challenge-reset', () => {
    if (!socket.request.headers.cookie?.includes('museum_admin=')) return;
    horrorChallengeState.skulls = Array(HORROR_SKULL_TOTAL).fill(false);
    horrorChallengeState.riddleSolved = false;
    horrorChallengeState.keyFound = false;
    horrorChallengeState.fuseFixed = false;
    horrorChallengeState.doorOpen = false;
    updateHorrorStage();
    io.emit('horror-challenge-state', horrorChallengeState);
  });

  socket.on('admin-quest-reset', () => {
    if (!socket.request.headers.cookie?.includes('museum_admin=')) return;
    horrorChallengeState.skulls = Array(HORROR_SKULL_TOTAL).fill(false);
    horrorChallengeState.riddleSolved = false;
    horrorChallengeState.keyFound = false;
    horrorChallengeState.fuseFixed = false;
    horrorChallengeState.doorOpen = false;
    updateHorrorStage();
    io.emit('horror-challenge-state', horrorChallengeState);
  });

  socket.on('door-interaction', ({ doorId, opened }) => {
    socket.broadcast.emit('door-interaction', {
      id: socket.id,
      doorId: String(doorId || '').slice(0, 48),
      opened: Boolean(opened)
    });
  });

  socket.on('challenge-puzzle', ({ puzzleId, action, value }) => {
    socket.broadcast.emit('challenge-puzzle', {
      from: socket.id,
      puzzleId: String(puzzleId || '').slice(0, 48),
      action: String(action || '').slice(0, 24),
      value: String(value || '').slice(0, 32)
    });
  });

  socket.on('player-proximity', ({ x, z }) => {
    const p = players.get(socket.id);
    if (p && Number.isFinite(x) && Number.isFinite(z)) {
      p.x = x;
      p.z = z;
    }
    socket.broadcast.emit('player-proximity', { id: socket.id, x: p?.x, z: p?.z });
  });

  socket.on('item-collected', ({ itemId }) => {
    socket.broadcast.emit('item-collected', { id: socket.id, itemId: String(itemId || '').slice(0, 48) });
  });

  socket.on('challenge-victory', () => {
    socket.broadcast.emit('challenge-victory', { id: socket.id });
  });

  socket.on('jump-scare-triggered', ({ scareId }) => {
    socket.broadcast.emit('jump-scare-triggered', { id: socket.id, scareId: String(scareId || '').slice(0, 48) });
  });

  socket.on('ambient-sound', ({ soundId, x, z }) => {
    socket.broadcast.emit('ambient-sound', {
      id: socket.id,
      soundId: String(soundId || '').slice(0, 48),
      x: Number.isFinite(x) ? x : 0,
      z: Number.isFinite(z) ? z : 0
    });
  });

  socket.on('panic-emote', ({ emote }) => {
    socket.broadcast.emit('panic-emote', { id: socket.id, emote: String(emote || '').slice(0, 24) });
  });

  socket.on('heartbeat-sync', ({ level }) => {
    socket.broadcast.emit('heartbeat-sync', {
      id: socket.id,
      level: Math.max(0, Math.min(100, Number(level) || 0))
    });
  });

  socket.on('flashlight-state', ({ enabled }) => {
    socket.broadcast.emit('flashlight-state', { id: socket.id, enabled: Boolean(enabled) });
  });

  socket.on('riddle-state', ({ solved, answer }) => {
    socket.broadcast.emit('riddle-state', {
      id: socket.id,
      solved: Boolean(solved),
      answer: String(answer || '').slice(0, 24)
    });
  });

  socket.on('fuse-state', ({ fixed }) => {
    socket.broadcast.emit('fuse-state', { id: socket.id, fixed: Boolean(fixed) });
  });

  socket.on('exit-door-state', ({ open }) => {
    socket.broadcast.emit('exit-door-state', { id: socket.id, open: Boolean(open) });
  });

  socket.on('key-state', ({ found }) => {
    socket.broadcast.emit('key-state', { id: socket.id, found: Boolean(found) });
  });

  socket.on('skull-state', ({ skullId, collected }) => {
    socket.broadcast.emit('skull-state', { id: socket.id, skullId: String(skullId || '').slice(0, 24), collected: Boolean(collected) });
  });

  socket.on('monster-state', ({ monsterId, state }) => {
    socket.broadcast.emit('monster-state', { id: socket.id, monsterId: String(monsterId || '').slice(0, 24), state: String(state || '').slice(0, 24) });
  });

  socket.on('whisper-heard', ({ whisperId }) => {
    socket.broadcast.emit('whisper-heard', { id: socket.id, whisperId: String(whisperId || '').slice(0, 24) });
  });

  socket.on('sanity-state', ({ sanity }) => {
    socket.broadcast.emit('sanity-state', { id: socket.id, sanity: Math.max(0, Math.min(100, Number(sanity) || 0)) });
  });

  socket.on('trap-triggered', ({ trapId }) => {
    socket.broadcast.emit('trap-triggered', { id: socket.id, trapId: String(trapId || '').slice(0, 24) });
  });

  socket.on('map-zone-unlocked', ({ zoneId }) => {
    socket.broadcast.emit('map-zone-unlocked', { id: socket.id, zoneId: String(zoneId || '').slice(0, 24) });
  });

  socket.on('fear-effect', ({ type, level }) => {
    socket.broadcast.emit('fear-effect', { id: socket.id, type: String(type || '').slice(0, 24), level: Math.max(0, Math.min(100, Number(level) || 0)) });
  });

  socket.on('spatial-sound', ({ soundId, x, z }) => {
    socket.broadcast.emit('spatial-sound', {
      id: socket.id,
      soundId: String(soundId || '').slice(0, 48),
      x: Number.isFinite(x) ? x : 0,
      z: Number.isFinite(z) ? z : 0
    });
  });

  socket.on('challenge-progress', ({ stage, progress }) => {
    socket.broadcast.emit('challenge-progress', {
      id: socket.id,
      stage: String(stage || '').slice(0, 24),
      progress: Math.max(0, Math.min(HORROR_SKULL_TOTAL, Number(progress) || 0))
    });
  });

  socket.on('player-panic', ({ value }) => {
    socket.broadcast.emit('player-panic', { id: socket.id, value: Math.max(0, Math.min(100, Number(value) || 0)) });
  });

  socket.on('monster-scare', ({ monsterId, scare }) => {
    socket.broadcast.emit('monster-scare', { id: socket.id, monsterId: String(monsterId || '').slice(0, 24), scare: Boolean(scare) });
  });

  socket.on('interaction-prompt', ({ promptId, visible }) => {
    socket.broadcast.emit('interaction-prompt', { id: socket.id, promptId: String(promptId || '').slice(0, 48), visible: Boolean(visible) });
  });

  socket.on('player-emote', ({ emote }) => {
    socket.broadcast.emit('player-emote', { id: socket.id, emote: String(emote || '').slice(0, 24) });
  });

  socket.on('game-horror-event', ({ eventId, payload }) => {
    socket.broadcast.emit('game-horror-event', {
      id: socket.id,
      eventId: String(eventId || '').slice(0, 48),
      payload: payload && typeof payload === 'object' ? payload : {}
    });
  });

  socket.on('game-state-request', () => {
    socket.emit('horror-challenge-state', { ...horrorChallengeState, skulls: [...horrorChallengeState.skulls] });
  });

  socket.on('horror-progress', () => {
    // Client progress is informational only. The server-authoritative puzzle actions above
    // are the only path that can advance shared challenge state.
    socket.emit('horror-challenge-state', { ...horrorChallengeState, skulls: [...horrorChallengeState.skulls] });
  });

  socket.on('horror-player-state', ({ x, z, flashlight, sanity }) => {
    const p = players.get(socket.id);
    if (p) {
      if (Number.isFinite(x)) p.x = x;
      if (Number.isFinite(z)) p.z = z;
      p.flashlight = Boolean(flashlight);
      p.sanity = Math.max(0, Math.min(100, Number(sanity) || 0));
    }
    socket.broadcast.emit('horror-player-state', { id: socket.id, x: p?.x, z: p?.z, flashlight: p?.flashlight, sanity: p?.sanity });
  });

  socket.on('horror-world-event', ({ id, kind, x, z }) => {
    socket.broadcast.emit('horror-world-event', {
      id: String(id || '').slice(0, 48),
      kind: String(kind || '').slice(0, 24),
      x: Number.isFinite(x) ? x : 0,
      z: Number.isFinite(z) ? z : 0
    });
  });

  socket.on('horror-reset-request', () => {
    if (!socket.request.headers.cookie?.includes('museum_admin=')) return;
    horrorChallengeState.skulls = Array(HORROR_SKULL_TOTAL).fill(false);
    horrorChallengeState.riddleSolved = false;
    horrorChallengeState.keyFound = false;
    horrorChallengeState.fuseFixed = false;
    horrorChallengeState.doorOpen = false;
    updateHorrorStage();
    io.emit('horror-challenge-state', horrorChallengeState);
  });

  socket.on('voice-data', (data) => {
    // لا نمرر الصوت الخام عبر Socket.IO؛ WebRTC هو المسار الصوتي الفعلي.
    if (!data || typeof data !== 'object') return;
    socket.broadcast.emit('voice-data', { id: socket.id, ...data });
  });

  socket.on('voice-signal', ({ to, signal }) => {
    if (typeof to !== 'string' || !signal || typeof signal !== 'object') return;
    const target = players.get(to);
    const source = players.get(socket.id);
    if (!target || !source || to === socket.id) return;
    // ترحيل إشارات WebRTC بين اللاعبين الموجودين في نفس الغرفة.
    io.to(to).emit('voice-signal', { from: socket.id, signal });
  });

  socket.on('voice-status', (status) => {
    socket.broadcast.emit('voice-status', { id: socket.id, ...status });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    socket.broadcast.emit('player-left', socket.id);
    io.emit('count', players.size);
  });
});

function startServer() {
  server.listen(PORT, HOST, () => {
    const address = server.address();
    const activePort = address && typeof address === 'object' ? address.port : PORT;
    console.log(`✅ متحف الذكريات يعمل على: http://localhost:${activePort}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ المنفذ ${PORT} مستخدم بالفعل. أوقف الخادم الآخر أو شغّل المشروع على منفذ بديل: $env:PORT=3001; npm start`);
  } else {
    console.error('HTTP server error:', err);
  }
  // إنهاء العملية مهم حتى لا تبقى جلسة Socket.IO مفتوحة وتُطبع رسالة نجاح زائفة.
  process.exitCode = 1;
  io.close(() => process.exit(1));
});

startServer();

module.exports = { server, app, io };
