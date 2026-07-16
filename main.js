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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const viewportEl = document.getElementById('viewport');
const navEl = document.getElementById('site-nav');
function sizeRenderer() {
  const w = viewportEl.clientWidth;
  const h = viewportEl.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0, 0, 0);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0.15, 3.0);

scene.add(new THREE.AmbientLight(0x999999, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.35);
key.position.set(3, 4, 5);
scene.add(key);

// ---------- hero-only hangar rig ----------
// Used just for the opening "does this look real" moment, referencing the kind of
// moody hangar photo you shared: an overhead arc of lamps, a strong rim/back light,
// and a dark floor the aircraft actually casts a shadow onto. Hidden the rest of
// the time so it doesn't fight the stylized fresnel look used everywhere else.
const heroLights = new THREE.Group();
const arcLightCount = 7;
for (let n = 0; n < arcLightCount; n++) {
  const t = n / (arcLightCount - 1);
  const angle = lerp(-1.1, 1.1, t);
  const light = new THREE.PointLight(0xfff2df, 1.1, 9, 2);
  light.position.set(Math.sin(angle) * 3.2, 2.6 + Math.cos(angle) * 0.6, -1.5 + Math.cos(angle) * 1.2);
  heroLights.add(light);
}
const rimLight = new THREE.PointLight(0xdfe8ff, 2.2, 12, 2);
rimLight.position.set(0, 1.0, -3.2);
heroLights.add(rimLight);
const heroFill = new THREE.DirectionalLight(0xaab0c0, 0.25);
heroFill.position.set(-2, 1.5, 2);
heroLights.add(heroFill);
scene.add(heroLights);

const floorGeo = new THREE.PlaneGeometry(50, 50);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.55, metalness: 0.25 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.15;
floor.receiveShadow = true;
scene.add(floor);

// A grounded, physically-lit material for the hero moment — the fresnel glow
// material reads as a stylized HUD element, not a "real object", so the hero
// swaps to this instead and hands back to the glow material once you scroll.
const realMaterial = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.55, roughness: 0.38 });

let heroMode = null; // null forces the first setHeroMode() call to actually apply
function currentAircraftMaterial() {
  return heroMode ? realMaterial : glowMaterial;
}
function setHeroMode(active) {
  if (active === heroMode) return;
  heroMode = active;
  const mat = currentAircraftMaterial();
  meshList.forEach((m) => (m.material = mat));
  heroLights.visible = active;
  floor.visible = active;
}

// ---------- fresnel glow material — a single material whose color continuously
// blends from white (dark theme) to black (light theme), driven every scroll
// tick by the same progress value that drives the flight path. Nothing here
// snaps at a section edge; it's one continuous function of scroll position. ----------
const glowMaterial = new THREE.ShaderMaterial({
  uniforms: {
    energy: { value: 0.8 },
    mixT: { value: 0 }, // 0 = fully dark theme (white glow), 1 = fully light theme (black glow)
  },
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
    uniform float mixT;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
      float a = (fresnel + 0.06) * energy;
      vec3 glowColor = mix(vec3(1.0), vec3(0.0), mixT);
      gl_FragColor = vec4(glowColor, a);
    }
  `,
  transparent: true,
  blending: THREE.NormalBlending,
  side: THREE.DoubleSide,
  depthWrite: false,
});

let meshList = []; // every mesh in the aircraft — all share the one material above

// Applies the current blend value (0..1) to everything that needs to invert:
// the material color, the scene/viewport background, the vignette, and the
// HUD text — all as one continuous read of the same number.
function applyThemeBlend(t) {
  glowMaterial.uniforms.mixT.value = t;

  const bg = Math.round(255 * t); // 0 = black bg, 255 = white bg
  scene.background.setRGB(bg / 255, bg / 255, bg / 255);
  viewportEl.style.background = `rgb(${bg}, ${bg}, ${bg})`;

  const ink = Math.round(255 * (1 - t)); // text color inverts opposite to bg
  viewportEl.style.setProperty('--ink-1', `rgb(${ink}, ${ink}, ${ink})`);
  viewportEl.style.setProperty('--ink-2', `rgba(${ink}, ${ink}, ${ink}, 0.62)`);
  viewportEl.style.setProperty('--ink-3', `rgba(${ink}, ${ink}, ${ink}, 0.38)`);
  viewportEl.style.setProperty('--panel-line', `rgba(${ink}, ${ink}, ${ink}, 0.14)`);
  viewportEl.style.borderRightColor = `rgba(${ink}, ${ink}, ${ink}, 0.14)`;

  const vignetteAlpha = lerp(0.75, 0.08, t);
  document.getElementById('vignette').style.boxShadow = `inset 0 0 14vw 2vw rgba(0, 0, 0, ${vignetteAlpha})`;

  // the fixed top nav inverts the same way — same numbers, just applied to a
  // translucent bar instead of an opaque one
  navEl.style.background = `rgba(${bg}, ${bg}, ${bg}, 0.55)`;
  navEl.style.color = `rgb(${ink}, ${ink}, ${ink})`;
  navEl.style.borderBottomColor = `rgba(${ink}, ${ink}, ${ink}, 0.14)`;
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
  const mat = currentAircraftMaterial();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 12), mat);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.55), mat);
  wing.position.z = 0.1;
  wing.castShadow = true;
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
        child.material = currentAircraftMaterial();
        child.castShadow = true;
        meshList.push(child);
      }
      const name = (child.name || '').toLowerCase();
      if (name.includes('rotor') || name.includes('prop')) {
        rotors.push(child);
      }
    });
    normalizeObject(aircraft, 2.2);
    rig.add(aircraft);
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
    normalizeObject(aircraft, 2.2);
    rig.add(aircraft);
    setTimeout(finishLoading, 500);
  }
);

// ---------- decorative/functional propeller ----------
// The source file bakes a 90° rotation into its single node, which is what
// leaves it lying flat. Its own geometry already faces the camera correctly
// (it's a wide, thin disc), so clearing that baked rotation stands it back up.
// Nudge PROP_OFFSET / PROP_SCALE below once you see where it actually needs to sit.
const PROP_SCALE = 0.85; // relative to the aircraft's normalized size (2.2 units)
const PROP_OFFSET = { x: 0, y: 0.05, z: 1.05 }; // position relative to the aircraft's center
const propRig = new THREE.Group();
propRig.position.set(PROP_OFFSET.x, PROP_OFFSET.y, PROP_OFFSET.z);
rig.add(propRig);

loader.load(
  'propeller2_Untitled.glb',
  (gltf) => {
    const prop = gltf.scene;
    prop.traverse((child) => {
      if (child.isMesh) {
        child.material = currentAircraftMaterial();
        child.castShadow = true;
        meshList.push(child);
        rotors.push(child);
      }
      // clear the baked lay-flat rotation/offset — see comment above
      child.rotation.set(0, 0, 0);
      child.position.set(0, 0, 0);
    });
    normalizeObject(prop, PROP_SCALE);
    propRig.add(prop);
  },
  undefined,
  () => {
    // no propeller file present — silently skip, the rest of the scene works without it
  }
);

function normalizeObject(obj, targetSize) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const scale = targetSize / size;
  obj.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  obj.position.sub(center);
}

// ---------- shot list: one per section, a deliberate flight move rather than a spin ----------
const shots = [
  { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, cam: { x: 0, y: 0.15, z: 3.0 } },
  { pos: { x: 0.3, y: -0.05, z: 0 }, rot: { x: -0.1, y: 0.65, z: 0.2 }, cam: { x: 0.5, y: 0.4, z: 5.0 } },
  { pos: { x: 0.35, y: -0.1, z: 0 }, rot: { x: -0.22, y: 1.3, z: 0.35 }, cam: { x: 0.7, y: 0.55, z: 4.7 } },
  { pos: { x: 0.1, y: -0.08, z: 0.15 }, rot: { x: -0.05, y: 1.9, z: 0.15 }, cam: { x: 0.3, y: 0.35, z: 4.3 } },
  { pos: { x: -0.3, y: 0.15, z: 0 }, rot: { x: 0.1, y: 2.5, z: -0.32 }, cam: { x: -0.55, y: 0.1, z: 4.0 } },
  { pos: { x: 0, y: -0.05, z: 0.2 }, rot: { x: 0, y: 3.3, z: 0.08 }, cam: { x: 0, y: 0.15, z: 2.5 } },
  { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 4.0, z: 0 }, cam: { x: 0, y: 0.4, z: 5.3 } },
];

const target = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 },
  cam: { x: 0, y: 0.15, z: 3.0 },
};

// one entry per shot/section, in the same order: 0 = dark, 1 = light.
// The scroll handler blends continuously between these — same mechanism as the
// flight path above, so the theme and the camera move in perfect lockstep.
const themeStops = [0, 1, 0, 1, 0, 1, 0];

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
  camX: makeSpring(0), camY: makeSpring(0.15), camZ: makeSpring(3.0),
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

    glowMaterial.uniforms.energy.value = 0.75 + p * 0.55;

    const themeValue = lerp(themeStops[i], themeStops[i + 1], localT);
    applyThemeBlend(themeValue);

    // the realistic hangar-photo look only lives in the first sliver of scroll —
    // as soon as you start moving through the page it hands off to the fresnel glow
    setHeroMode(p < 0.045);

    tmAlt.textContent = Math.round(p * 120).toString().padStart(3, '0');
    tmMoist.textContent = Math.round(20 + p * 60).toString().padStart(2, '0');
    const stageIndex = Math.min(statusStages.length - 1, Math.floor(p * statusStages.length));
    tmStatus.textContent = statusStages[stageIndex];
  },
});

// ---------- video fallback: if flight-demo.mp4 isn't in the repo yet, show a placeholder
// instead of a broken player ----------
const showcaseVideo = document.getElementById('showcase-video');
const videoPlaceholder = document.getElementById('video-placeholder');
showcaseVideo.addEventListener('error', () => {
  showcaseVideo.style.display = 'none';
  videoPlaceholder.classList.add('visible');
}, true);

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
applyThemeBlend(0);
setHeroMode(true);
animate();

// ---------- resize ----------
window.addEventListener('resize', sizeRenderer);

// ---------- repo link ----------
document.getElementById('repo-link').href = 'https://github.com/your-username/aquila-7-showcase';
