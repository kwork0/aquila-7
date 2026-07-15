// =====================================================================
// AQUILA-7 showcase — scroll-driven 3D viewer
// - critically-damped springs drive the flight path (see springStep)
// - the model is directly draggable, 1:1 with the pointer, velocity
//   carries through into the spring on release
// - the whole viewport (background + aircraft material) inverts between
//   a dark and light theme depending on which text section is active
// - any mesh named with "rotor" or "prop" in it spins continuously —
//   drop a rigged rotor model in and it'll be picked up automatically
// Swap 'my_aircraft.glb' below for your exported model filename.
// =====================================================================

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const viewportEl = document.getElementById('viewport');
function sizeRenderer() {
  const w = viewportEl.clientWidth;
  const h = viewportEl.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const scene = new THREE.Scene();
const bgColor = { r: 0, g: 0, b: 0 }; // crossfaded by gsap, applied to scene.background each tick
scene.background = new THREE.Color(0, 0, 0);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0.3, 6);

scene.add(new THREE.AmbientLight(0x999999, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.35);
key.position.set(3, 4, 5);
scene.add(key);

// ---------- fresnel glow materials — one per theme, swapped on the meshes at runtime ----------
function makeFresnelMaterial(rgb, blending) {
  return new THREE.ShaderMaterial({
    uniforms: { energy: { value: 0.8 }, glowColor: { value: new THREE.Color(rgb) } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      uniform float energy;
      uniform vec3 glowColor;
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
        float a = (fresnel + 0.06) * energy;
        gl_FragColor = vec4(glowColor, a);
      }
    `,
    transparent: true,
    blending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}
// dark theme: white glow, additive — glass x-ray look on black
const darkMaterial = makeFresnelMaterial(0xffffff, THREE.AdditiveBlending);
// light theme: black glow, normal blending — inverted silhouette on white
const lightMaterial = makeFresnelMaterial(0x000000, THREE.NormalBlending);

let currentTheme = 'dark';
let meshList = []; // every mesh in the aircraft, so we can swap materials on theme change

function applyTheme(theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  const mat = theme === 'light' ? lightMaterial : darkMaterial;
  meshList.forEach((m) => (m.material = mat));

  viewportEl.classList.toggle('light-theme', theme === 'light');
  const target = theme === 'light' ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  gsap.to(bgColor, {
    r: target.r, g: target.g, b: target.b,
    duration: 0.7,
    ease: 'power2.out',
    onUpdate: () => scene.background.setRGB(bgColor.r / 255, bgColor.g / 255, bgColor.b / 255),
  });
}

// ---------- model loading (with a placeholder if the glb isn't there yet) ----------
let aircraft;
const rotors = []; // meshes/groups whose name contains "rotor" or "prop" — spun continuously in animate()
const loadingEl = document.getElementById('loading');
const pctEl = document.getElementById('loading-pct');
const labelEl = document.getElementById('loading-label');
const telemetryEl = document.getElementById('telemetry');

function finishLoading() {
  gsap.to(loadingEl, {
    opacity: 0,
    duration: 0.8,
    onComplete: () => (loadingEl.style.display = 'none'),
  });
  telemetryEl.classList.add('materialized');
}

function placeholderJet() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 12), darkMaterial);
  body.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.55), darkMaterial);
  wing.position.z = 0.1;
  group.add(body, wing);
  meshList = [body, wing];
  return group;
}

const rig = new THREE.Group(); // aircraft sits inside this, so shots can move/rotate it as one unit
scene.add(rig);

const loader = new THREE.GLTFLoader();
loader.load(
  'my_aircraft.glb',
  (gltf) => {
    aircraft = gltf.scene;
    meshList = [];
    aircraft.traverse((child) => {
      if (child.isMesh) {
        child.material = darkMaterial;
        meshList.push(child);
      }
      const name = (child.name || '').toLowerCase();
      if (name.includes('rotor') || name.includes('prop')) {
        rotors.push(child);
      }
    });
    normalizeAndAdd(aircraft);
    finishLoading();
  },
  (xhr) => {
    if (xhr.lengthComputable) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      pctEl.textContent = pct + '%';
      if (pct > 60) labelEl.textContent = 'ALIGNING FRESNEL SHADER';
    }
  },
  () => {
    labelEl.textContent = 'NO MODEL FOUND — USING PLACEHOLDER';
    aircraft = placeholderJet();
    normalizeAndAdd(aircraft);
    setTimeout(finishLoading, 500);
  }
);

function normalizeAndAdd(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const scale = 2.2 / size;
  obj.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  obj.position.sub(center);
  rig.add(obj);
}

// ---------- shot list: one per section, a deliberate flight move rather than a spin ----------
const shots = [
  { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, cam: { x: 0, y: 0.3, z: 6 } },
  { pos: { x: 0.3, y: -0.05, z: 0 }, rot: { x: -0.1, y: 0.7, z: 0.2 }, cam: { x: 0.5, y: 0.4, z: 5.0 } },
  { pos: { x: 0.35, y: -0.1, z: 0 }, rot: { x: -0.22, y: 1.4, z: 0.35 }, cam: { x: 0.7, y: 0.55, z: 4.7 } },
  { pos: { x: -0.3, y: 0.15, z: 0.1 }, rot: { x: 0.06, y: 2.1, z: -0.28 }, cam: { x: -0.5, y: 0.2, z: 4.2 } },
  { pos: { x: -0.3, y: 0.15, z: 0 }, rot: { x: 0.1, y: 2.9, z: -0.32 }, cam: { x: -0.55, y: 0.1, z: 4.0 } },
  { pos: { x: 0, y: -0.05, z: 0.2 }, rot: { x: 0, y: 3.7, z: 0.08 }, cam: { x: 0, y: 0.15, z: 2.5 } },
  { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 4.5, z: 0 }, cam: { x: 0, y: 0.4, z: 5.3 } },
];

const target = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 },
  cam: { x: 0, y: 0.3, z: 6 },
};

// ---------- tiny critically-damped spring system ----------
function makeSpring(initial) {
  return { value: initial, velocity: 0 };
}
function springStep(spring, target, dt, omega) {
  const x = spring.value - target;
  const v = spring.velocity;
  const decay = Math.exp(-omega * dt);
  const newX = (x + (v + omega * x) * dt) * decay;
  const newV = (v - omega * dt * (v + omega * x)) * decay;
  spring.value = newX + target;
  spring.velocity = newV;
}
function rubberband(overshoot, dimension, constant = 0.55) {
  const sign = overshoot < 0 ? -1 : 1;
  const o = Math.abs(overshoot);
  return sign * (o * dimension * constant) / (dimension + constant * o);
}
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

const springs = {
  posX: makeSpring(0), posY: makeSpring(0), posZ: makeSpring(0),
  rotX: makeSpring(0), rotY: makeSpring(0), rotZ: makeSpring(0),
  camX: makeSpring(0), camY: makeSpring(0.3), camZ: makeSpring(6),
};
const OMEGA_POSITION = 9;
const OMEGA_ROTATION = 7;

// ---------- direct manipulation: grab and spin the model, 1:1 with the pointer ----------
const drag = { active: false, lastX: 0, lastY: 0, lastTime: 0, offsetY: 0, offsetX: 0 };
const PITCH_LIMIT = 0.5;

if (!prefersReducedMotion) {
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (e) => {
    drag.active = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.lastTime = performance.now();
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag.active) return;
    const now = performance.now();
    const dt = Math.max((now - drag.lastTime) / 1000, 1 / 120);
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;

    drag.offsetY += dx * 0.010;
    const rawPitchOffset = drag.offsetX + dy * 0.008;
    drag.offsetX = Math.abs(rawPitchOffset) > PITCH_LIMIT
      ? Math.sign(rawPitchOffset) * PITCH_LIMIT + rubberband(rawPitchOffset - Math.sign(rawPitchOffset) * PITCH_LIMIT, 0.6)
      : rawPitchOffset;

    springs.rotY.value = target.rot.y + drag.offsetY;
    springs.rotY.velocity = (dx * 0.010) / dt;
    springs.rotX.value = target.rot.x + drag.offsetX;
    springs.rotX.velocity = (dy * 0.008) / dt;

    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.lastTime = now;
  });

  window.addEventListener('pointerup', () => {
    if (!drag.active) return;
    drag.active = false;
    canvas.style.cursor = 'grab';
    drag.offsetY = 0;
    drag.offsetX = 0;
  });
}

// ---------- telemetry + scroll target ----------
const tmAlt = document.getElementById('tm-alt');
const tmMoist = document.getElementById('tm-moist');
const tmStatus = document.getElementById('tm-status');
const statusStages = ['STANDBY', 'ASCENDING', 'SCANNING', 'DISPERSING', 'RETURNING', 'RETURNING', 'STANDBY'];

ScrollTrigger.create({
  trigger: 'main',
  start: 'top top',
  end: 'bottom bottom',
  scrub: 0.7,
  onUpdate: (self) => {
    const p = self.progress;
    const segCount = shots.length - 1;
    const scaled = p * segCount;
    const i = Math.min(segCount - 1, Math.floor(scaled));
    const localT = smoothstep(scaled - i);
    const a = shots[i];
    const b = shots[i + 1];

    target.pos.x = lerp(a.pos.x, b.pos.x, localT);
    target.pos.y = lerp(a.pos.y, b.pos.y, localT);
    target.pos.z = lerp(a.pos.z, b.pos.z, localT);
    target.rot.x = lerp(a.rot.x, b.rot.x, localT);
    target.rot.y = lerp(a.rot.y, b.rot.y, localT);
    target.rot.z = lerp(a.rot.z, b.rot.z, localT);
    target.cam.x = lerp(a.cam.x, b.cam.x, localT);
    target.cam.y = lerp(a.cam.y, b.cam.y, localT);
    target.cam.z = lerp(a.cam.z, b.cam.z, localT);

    const energy = 0.75 + p * 0.55;
    darkMaterial.uniforms.energy.value = energy;
    lightMaterial.uniforms.energy.value = energy;

    tmAlt.textContent = Math.round(p * 120).toString().padStart(3, '0');
    tmMoist.textContent = Math.round(20 + p * 60).toString().padStart(2, '0');
    const stageIndex = Math.min(statusStages.length - 1, Math.floor(p * statusStages.length));
    tmStatus.textContent = statusStages[stageIndex];
  },
});

// ---------- theme switching: whichever section is centered wins ----------
document.querySelectorAll('.panel[data-theme]').forEach((panel) => {
  ScrollTrigger.create({
    trigger: panel,
    start: 'top center',
    end: 'bottom center',
    onEnter: () => applyTheme(panel.dataset.theme),
    onEnterBack: () => applyTheme(panel.dataset.theme),
  });
});

// ---------- reveal-on-scroll for the right-hand text column ----------
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('in-view');
    });
  },
  { threshold: 0.35 }
);
revealEls.forEach((el) => io.observe(el));

// ---------- render loop ----------
let lastFrame = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
  lastFrame = now;

  springStep(springs.posX, target.pos.x, dt, OMEGA_POSITION);
  springStep(springs.posY, target.pos.y, dt, OMEGA_POSITION);
  springStep(springs.posZ, target.pos.z, dt, OMEGA_POSITION);
  springStep(springs.camX, target.cam.x, dt, OMEGA_POSITION);
  springStep(springs.camY, target.cam.y, dt, OMEGA_POSITION);
  springStep(springs.camZ, target.cam.z, dt, OMEGA_POSITION);

  if (!drag.active) {
    springStep(springs.rotX, target.rot.x, dt, OMEGA_ROTATION);
    springStep(springs.rotY, target.rot.y, dt, OMEGA_ROTATION);
  }
  springStep(springs.rotZ, target.rot.z, dt, OMEGA_ROTATION);

  rig.position.set(springs.posX.value, springs.posY.value, springs.posZ.value);
  rig.rotation.set(springs.rotX.value, springs.rotY.value, springs.rotZ.value);
  camera.position.set(springs.camX.value, springs.camY.value, springs.camZ.value);
  camera.lookAt(rig.position);

  // spin any rotor/prop meshes continuously, independent of the flight-path animation
  rotors.forEach((r) => { r.rotation.y += dt * 18; });

  renderer.render(scene, camera);
}
sizeRenderer();
animate();

// ---------- resize ----------
window.addEventListener('resize', sizeRenderer);

// ---------- repo link ----------
document.getElementById('repo-link').href = 'https://github.com/your-username/aquila-7-showcase';
