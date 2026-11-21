import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_MODEL_URL = '/uploads/img_1794558443288_790835.glb';
const SPAWN_DEPTH = 1.85;
const RISE_SECONDS = 2.25;
const MOVE_SPEED = 3.8;
const ATTACK_RANGE = 1.65;
const HIT_COOLDOWN = 3.2;
const MAX_LIFETIME = 48;

export function createZombieController({
  THREE,
  scene,
  listener,
  getPlayers,
  isWalkable,
  onScare,
  onDamage,
  isMuted,
  modelUrl = DEFAULT_MODEL_URL
}) {
  const loader = new GLTFLoader();
  const root = new THREE.Group();
  root.name = 'zombie-enemy';
  root.visible = false;
  scene.add(root);

  const state = {
    loaded: false,
    loading: false,
    active: false,
    phase: 'hidden',
    phaseTime: 0,
    life: 0,
    hitCooldown: 0,
    hitCount: 0,
    mixer: null,
    actions: Object.create(null),
    currentAction: null,
    model: null,
    dust: null,
    audio: null,
    audioReady: false,
    lastTriggerAt: -Infinity,
    dustBasePositions: null
  };

  function createFallbackModel() {
    const fallback = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x66705a, roughness: 0.95 });
    const rotten = new THREE.MeshStandardMaterial({ color: 0x273027, roughness: 1 });
    const eyes = new THREE.MeshStandardMaterial({ color: 0xff1728, emissive: 0x9f0010, emissiveIntensity: 1.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.7, 4, 8), rotten);
    body.position.y = 1.03;
    fallback.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), skin);
    head.position.set(0, 1.78, 0.12);
    head.scale.set(0.9, 1.05, 0.82);
    fallback.add(head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyes);
      eye.position.set(side * 0.105, 1.82, 0.365);
      fallback.add(eye);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.66, 3, 6), skin);
      arm.position.set(side * 0.48, 1.17, 0.22);
      arm.rotation.z = side * -0.28;
      arm.rotation.x = -0.75;
      fallback.add(arm);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.65, 3, 6), rotten);
      leg.position.set(side * 0.16, 0.38, 0);
      fallback.add(leg);
    }
    fallback.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
    return fallback;
  }

  function buildDust() {
    const count = 34;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.85;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.random() * 0.12;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      velocities[i * 3] = Math.cos(angle) * (0.35 + Math.random() * 0.65);
      velocities[i * 3 + 1] = 0.45 + Math.random() * 1.1;
      velocities[i * 3 + 2] = Math.sin(angle) * (0.35 + Math.random() * 0.65);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x9b8174, size: 0.16, transparent: true, opacity: 0.72, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    points.visible = false;
    points.userData.velocities = velocities;
    points.userData.age = 0;
    points.userData.basePositions = positions.slice();
    state.dustBasePositions = positions.slice();
    scene.add(points);
    state.dust = points;
  }

  function createGroanBuffer(context) {
    const sampleRate = context.sampleRate;
    const duration = 2.4;
    const buffer = context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const envelope = 0.45 + 0.35 * Math.sin((t / duration) * Math.PI * 2);
      const frequency = 72 + 12 * Math.sin(t * 3.2) + 4 * Math.sin(t * 8.1);
      const growl = Math.sin(2 * Math.PI * frequency * t) * 0.55 + Math.sin(2 * Math.PI * frequency * 1.51 * t) * 0.24;
      const noise = (Math.random() * 2 - 1) * 0.20;
      data[i] = (growl + noise) * envelope * Math.min(1, t * 12, (duration - t) * 12);
    }
    return buffer;
  }

  function attachPositionalAudio() {
    if (!listener || state.audioReady) return;
    try {
      const audio = new THREE.PositionalAudio(listener);
      audio.setBuffer(createGroanBuffer(listener.context));
      audio.setLoop(true);
      audio.setRefDistance(4);
      audio.setMaxDistance(34);
      audio.setRolloffFactor(1.45);
      audio.setVolume(isMuted() ? 0 : 0.34);
      root.add(audio);
      state.audio = audio;
      state.audioReady = true;
    } catch (error) {
      console.warn('Zombie positional audio unavailable:', error);
    }
  }

  function selectAction(name, fade = 0.18) {
    const action = state.actions[name];
    if (!action || action === state.currentAction) return;
    if (state.currentAction?.isRunning()) state.currentAction.fadeOut(fade);
    action.reset();
    action.enabled = true;
    action.setLoop(name === 'rise' || name === 'attack' ? THREE.LoopOnce : THREE.LoopRepeat, name === 'rise' || name === 'attack' ? 1 : Infinity);
    action.clampWhenFinished = name === 'rise' || name === 'attack';
    action.fadeIn(fade).play();
    state.currentAction = action;
  }

  function registerModel(gltf) {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = size.y > 0.001 ? 1.95 / size.y : 1;
    const fitted = new THREE.Group();
    fitted.scale.setScalar(scale);
    fitted.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    fitted.add(model);
    model.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = !/Android|iPhone|iPad/i.test(navigator.userAgent);
      obj.receiveShadow = true;
    });
    root.add(fitted);
    state.model = fitted;
    state.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations || []) {
      const label = `${clip.name} ${clip.tracks.map(track => track.name).join(' ')}`.toLowerCase();
      const action = state.mixer.clipAction(clip);
      if (/rise|emerge|burrow|get.?up|stand.?up|climb|crawl/.test(label)) state.actions.rise ||= action;
      else if (/attack|bite|strike|claw|hit/.test(label)) state.actions.attack ||= action;
      else if (/run|sprint|chase/.test(label)) state.actions.run ||= action;
      else if (/idle|stand|breath|walk/.test(label)) state.actions.idle ||= action;
      else if (!state.actions.idle) state.actions.idle = action;
      else if (!state.actions.run) state.actions.run = action;
    }
    state.loaded = true;
    if (!state.actions.run) state.actions.run = state.actions.idle;
  }

  let currentModelUrl = modelUrl || DEFAULT_MODEL_URL;

  async function setModelUrl(newUrl) {
    const nextUrl = newUrl || DEFAULT_MODEL_URL;
    if (nextUrl === currentModelUrl && state.loaded) return;
    currentModelUrl = nextUrl;
    despawn();
    if (state.model) {
      root.remove(state.model);
      state.model = null;
    }
    state.actions = Object.create(null);
    state.currentAction = null;
    state.loaded = false;
    state.loading = false;
    await load();
  }

  async function load() {
    if (state.loaded || state.loading) return;
    state.loading = true;
    try {
      const gltf = await loader.loadAsync(currentModelUrl);
      registerModel(gltf);
    } catch (error) {
      console.warn(`Zombie model not found at ${currentModelUrl}; using built-in fallback.`, error);
      state.model = createFallbackModel();
      root.add(state.model);
      state.loaded = true;
    } finally {
      state.loading = false;
    }
  }

  function findSpawnPosition(player) {
    const origin = player.group.position;
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.25;
      const radius = 2.8 + Math.random() * 1.8;
      const x = THREE.MathUtils.clamp(origin.x + Math.cos(angle) * radius, -7.8, 7.8);
      const z = origin.z + Math.sin(angle) * radius;
      if (isWalkable(x, z)) return { x, z };
    }
    return { x: origin.x, z: origin.z - 5 };
  }

  function spawnNear(player) {
    if (!state.loaded || state.active || !player?.group) return false;
    const point = findSpawnPosition(player);
    root.position.set(point.x, -SPAWN_DEPTH, point.z);
    root.visible = true;
    state.active = true;
    state.phase = 'rising';
    state.phaseTime = 0;
    state.life = 0;
    state.hitCooldown = 1.6;
    state.hitCount = 0;
    state.lastTriggerAt = performance.now();
    if (state.dust) {
      state.dust.position.set(point.x, 0.05, point.z);
      state.dust.geometry.attributes.position.array.set(state.dustBasePositions);
      state.dust.geometry.attributes.position.needsUpdate = true;
      state.dust.visible = true;
      state.dust.userData.age = 0;
      state.dust.material.opacity = 0.72;
    }
    selectAction('rise');
    attachPositionalAudio();
    if (state.audio && !state.audio.isPlaying && !isMuted()) {
      try { state.audio.play(); } catch { /* user activation may be needed; retried below */ }
    }
    onScare({ kind: 'spawn', distance: Math.hypot(player.group.position.x - point.x, player.group.position.z - point.z) });
    return true;
  }

  function despawn() {
    state.active = false;
    state.phase = 'hidden';
    root.visible = false;
    if (state.audio?.isPlaying) state.audio.stop();
    if (state.dust) {
      state.dust.visible = false;
      state.dust.geometry.attributes.position.array.set(state.dustBasePositions);
      state.dust.geometry.attributes.position.needsUpdate = true;
    }
  }

  function tryWalk(x, z, dx, dz) {
    let nx = x, nz = z;
    if (isWalkable(x + dx, z)) nx += dx;
    if (isWalkable(nx, z + dz)) nz += dz;
    return { x: nx, z: nz, moved: nx !== x || nz !== z };
  }

  function updateDust(dt) {
    const dust = state.dust;
    if (!dust?.visible) return;
    dust.userData.age += dt;
    const positions = dust.geometry.attributes.position.array;
    const velocities = dust.userData.velocities;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += velocities[i] * dt;
      positions[i + 1] += velocities[i + 1] * dt;
      positions[i + 2] += velocities[i + 2] * dt;
    }
    dust.geometry.attributes.position.needsUpdate = true;
    dust.material.opacity = Math.max(0, 0.72 * (1 - dust.userData.age / 1.7));
    if (dust.userData.age > 1.7) {
      dust.visible = false;
      dust.geometry.attributes.position.array.set(state.dustBasePositions);
      dust.geometry.attributes.position.needsUpdate = true;
    }
  }

  function update(dt) {
    updateDust(dt);
    if (state.audio) {
      state.audio.setVolume(isMuted() ? 0 : 0.34);
      if (state.active && !isMuted() && !state.audio.isPlaying && listener?.context?.state === 'running') {
        try { state.audio.play(); } catch { /* Audio unlock can be delayed by browser policy. */ }
      }
    }
    const players = getPlayers().filter(player => player?.group && player.group.visible !== false);
    if (!state.active) {
      if (state.loaded && players.length && performance.now() - state.lastTriggerAt > 12000) {
        const zones = [{ x: 0, z: 44, radius: 7.5 }, { x: 3.8, z: 90, radius: 8.5 }];
        for (const player of players) {
          const p = player.group.position;
          if (zones.some(zone => Math.hypot(p.x - zone.x, p.z - zone.z) < zone.radius)) {
            spawnNear(player);
            break;
          }
        }
      }
      return;
    }
    state.life += dt;
    state.phaseTime += dt;
    state.hitCooldown = Math.max(0, state.hitCooldown - dt);
    state.mixer?.update(dt);

    if (state.phase === 'rising') {
      const t = Math.min(1, state.phaseTime / RISE_SECONDS);
      const eased = t * t * (3 - 2 * t);
      root.position.y = -SPAWN_DEPTH * (1 - eased);
      if (t >= 1) {
        root.position.y = 0;
        state.phase = 'chasing';
        state.phaseTime = 0;
        selectAction('run');
      }
      return;
    }

    let target = null;
    let targetDistance = Infinity;
    for (const player of players) {
      const p = player.group.position;
      const distance = Math.hypot(p.x - root.position.x, p.z - root.position.z);
      if (distance < targetDistance) { target = player; targetDistance = distance; }
    }
    if (!target) { if (state.life > MAX_LIFETIME) despawn(); return; }
    if (state.phase === 'escaping') {
      state.phaseTime += dt;
      root.position.y = THREE.MathUtils.damp(root.position.y, -SPAWN_DEPTH, 3.2, dt);
      if (root.position.y < -SPAWN_DEPTH + 0.08 || state.phaseTime > 2.8) despawn();
      return;
    }

    const targetPos = target.group.position;
    const dx = targetPos.x - root.position.x;
    const dz = targetPos.z - root.position.z;
    const distance = Math.hypot(dx, dz);
    root.rotation.y = Math.atan2(dx, dz);

    if (distance <= ATTACK_RANGE) {
      state.phase = 'attacking';
      selectAction('attack');
      if (state.hitCooldown <= 0) {
        state.hitCooldown = HIT_COOLDOWN;
        state.hitCount++;
        onDamage(target, 24);
        onScare({ kind: 'attack', distance });
        if (state.hitCount >= 3) {
          state.phase = 'escaping';
          state.phaseTime = 0;
        }
      }
    } else {
      if (state.phase === 'attacking') state.phase = 'chasing';
      if (state.phase === 'chasing') selectAction('run');
      const amount = Math.min(MOVE_SPEED * dt, Math.max(0, distance - ATTACK_RANGE * 0.8));
      const stepX = (dx / Math.max(distance, 0.001)) * amount;
      const stepZ = (dz / Math.max(distance, 0.001)) * amount;
      const moved = tryWalk(root.position.x, root.position.z, stepX, stepZ);
      if (moved.moved) root.position.set(moved.x, 0, moved.z);
      else {
        const side = tryWalk(root.position.x, root.position.z, -stepZ, stepX);
        if (side.moved) root.position.set(side.x, 0, side.z);
      }
    }

    if (state.phase === 'escaping' || state.life > MAX_LIFETIME) {
      root.position.y = THREE.MathUtils.damp(root.position.y, -SPAWN_DEPTH, 3.2, dt);
      if (root.position.y < -SPAWN_DEPTH + 0.08 || state.phaseTime > 2.8) despawn();
    }
  }

  function spawnAtPlayer() {
    const players = getPlayers().filter(player => player?.group);
    if (!players.length) return false;
    players.sort((a, b) => a.group.position.distanceTo(root.position) - b.group.position.distanceTo(root.position));
    return spawnNear(players[0]);
  }

  buildDust();
  load();

  return {
    root,
    state,
    load,
    setModelUrl,
    update,
    spawnNear,
    spawnAtPlayer,
    despawn,
    dispose() {
      despawn();
      scene.remove(root);
      if (state.dust) {
        scene.remove(state.dust);
        state.dust.geometry.dispose();
        state.dust.material.dispose();
      }
    }
  };
}
