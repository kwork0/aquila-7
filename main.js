// =====================================================================
// AQUILA-7 showcase — scroll-driven 3D viewer
// Motion model follows Apple's fluid-interface principles:
//   - critically-damped springs (no canned easing) driven by scroll
//   - the model is directly draggable, 1:1 with the pointer
//   - on release, velocity carries through into the spring (no "seam")
//   - drag past the natural pitch range rubber-bands instead of hard-stopping
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
scene.background = new THREE.Color(0x0a0a0a);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0.3, 6);

scene.add(new THREE.AmbientLight(0x999999, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.35);
key.position.set(3, 4, 5);
scene.add(key);

// ---------- fresnel glow material, pure grayscale, intensity is scroll-driven ----------
const glowMaterial = new THREE.ShaderMaterial({
  uniforms: { energy: { value: 0.8 } },
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
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
      float a = (fresnel + 0.06) * energy;
      gl_FragColor = vec4(vec3(1.0) * a, a);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// ---------- model loading (with a placeholder if the glb isn't there yet) ----------
let aircraft;
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
  // "materialize, don't just fade" — the HUD arrives as a real surface, not a plain opacity toggle
  telemetryEl.classList.add('materialized');
}

function placeholderJet() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 12), glowMaterial);
  body.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.55), glowMaterial);
  wing.position.z = 0.1;
  group.add(body, wing);
  return group;
}

const rig = new THREE.Group(); // aircraft sits inside this, so shots can move/rotate it as one unit
scene.add(rig);

const loader = new THREE.GLTFLoader();
loader.load(
  'my_aircraft.glb',
  (gltf) => {
    aircraft = gltf.scene;
    aircraft.traverse((child) => {
      if (child.isMesh) child.material = glowMaterial;
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
  { pos: { x: 0.35, y: -0.1, z: 0 }, rot: { x: -0.22, y: 1.1, z: 0.35 }, cam: { x: 0.7, y: 0.55, z: 4.7 } },
  { pos: { x: -0.3, y: 0.15, z: 0 }, rot: { x: 0.1, y: 2.3, z: -0.32 }, cam: { x: -0.55, y: 0.1, z: 4.0 } },
  { pos: { x: 0, y: -0.05, z: 0.2 }, rot: { x: 0, y: 3.55, z: 0.08 }, cam: { x: 0, y: 0.15, z: 2.5 } },
  { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 4.5, z: 0 }, cam: { x: 0, y: 0.4, z: 5.3 } },
];

// scroll-derived target — the spring always chases this
const target = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 },
  cam: { x: 0, y: 0.3, z: 6 },
};

// ---------- tiny critically-damped spring system (value + velocity per channel) ----------
// This is the actual physics behind Apple's "damping 1.0" default: no overshoot,
// but velocity is a real state, so a moving value can be redirected without a seam.
function makeSpring(initial) {
  return { value: initial, velocity: 0 };
}
function springStep(spring, target, dt, omega) {
  // analytic critically-damped integration (stable at any frame rate)
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
const OMEGA_POSITION = 9;   // response ~0.4s, matches Apple's "move/reposition" default
const OMEGA_ROTATION = 7;

// ---------- direct manipulation: grab and spin the model, 1:1 with the pointer ----------
const drag = {
  active: false,
  lastX: 0,
  lastY: 0,
  lastTime: 0,
  baseRotY: 0,
  offsetY: 0, // extra yaw added on top of the scroll target, decays back out via the spring after release
  offsetX: 0, // extra pitch, rubber-banded near the shot's natural limit
};
const PITCH_LIMIT = 0.5; // how far off the current shot's pitch feels "natural" before resisting

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

    // write straight into the spring's value AND velocity — this is the 1:1 tracking,
    // and it's what makes release feel continuous instead of snapping to a new animation
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
    // let the offsets relax back to 0 over the next few frames rather than resetting instantly —
    // the spring already carries the release velocity, so this reads as a smooth hand-off
    drag.offsetY = 0;
    drag.offsetX = 0;
  });
}

// ---------- telemetry + scroll target ----------
const tmAlt = document.getElementById('tm-alt');
const tmMoist = document.getElementById('tm-moist');
const tmStatus = document.getElementById('tm-status');
const statusStages = ['STANDBY', 'ASCENDING', 'SCANNING', 'DISPERSING', 'RETURNING'];

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

    glowMaterial.uniforms.energy.value = 0.75 + p * 0.55;

    tmAlt.textContent = Math.round(p * 120).toString().padStart(3, '0');
    tmMoist.textContent = Math.round(20 + p * 60).toString().padStart(2, '0');
    const stageIndex = Math.min(statusStages.length - 1, Math.floor(p * statusStages.length));
    tmStatus.textContent = statusStages[stageIndex];
  },
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

// ---------- render loop: springs, not canned easing ----------
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

  // rotation springs only chase the scroll target when the user isn't actively dragging —
  // while dragging, pointermove writes value/velocity directly (see above)
  if (!drag.active) {
    springStep(springs.rotX, target.rot.x, dt, OMEGA_ROTATION);
    springStep(springs.rotY, target.rot.y, dt, OMEGA_ROTATION);
  }
  springStep(springs.rotZ, target.rot.z, dt, OMEGA_ROTATION);

  rig.position.set(springs.posX.value, springs.posY.value, springs.posZ.value);
  rig.rotation.set(springs.rotX.value, springs.rotY.value, springs.rotZ.value);
  camera.position.set(springs.camX.value, springs.camY.value, springs.camZ.value);
  camera.lookAt(rig.position);

  renderer.render(scene, camera);
}
sizeRenderer();
animate();

// ---------- resize ----------
window.addEventListener('resize', sizeRenderer);

// ---------- repo link ----------
document.getElementById('repo-link').href = 'https://github.com/your-username/aquila-7-showcase';
