// =====================================================================
// AQUILA-7 showcase — scroll-driven 3D viewer, monochrome, shot-based
// Swap 'my_aircraft.glb' below for your exported model filename.
// =====================================================================

gsap.registerPlugin(ScrollTrigger);

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
  uniforms: {
    energy: { value: 0.8 },
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

function finishLoading() {
  gsap.to(loadingEl, {
    opacity: 0,
    duration: 0.8,
    onComplete: () => (loadingEl.style.display = 'none'),
  });
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
// pos/rot describe the RIG (the aircraft as a whole); cam describes the camera.
const shots = [
  { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, cam: { x: 0, y: 0.3, z: 6 } },       // hero — level
  { pos: { x: 0.35, y: -0.1, z: 0 }, rot: { x: -0.22, y: 1.1, z: 0.35 }, cam: { x: 0.7, y: 0.55, z: 4.7 } }, // bank right, climbing
  { pos: { x: -0.3, y: 0.15, z: 0 }, rot: { x: 0.1, y: 2.3, z: -0.32 }, cam: { x: -0.55, y: 0.1, z: 4.0 } }, // bank left, leveling
  { pos: { x: 0, y: -0.05, z: 0.2 }, rot: { x: 0, y: 3.55, z: 0.08 }, cam: { x: 0, y: 0.15, z: 2.5 } },      // push in, detail
  { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 4.5, z: 0 }, cam: { x: 0, y: 0.4, z: 5.3 } },                 // level out, pull back
];

const target = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 },
  cam: { x: 0, y: 0.3, z: 6 },
};

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

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
    const p = self.progress; // 0 -> 1 across the whole page
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

// ---------- render loop, with easing toward the current shot target ----------
function animate() {
  requestAnimationFrame(animate);

  rig.position.x = lerp(rig.position.x, target.pos.x, 0.06);
  rig.position.y = lerp(rig.position.y, target.pos.y, 0.06);
  rig.position.z = lerp(rig.position.z, target.pos.z, 0.06);
  rig.rotation.x = lerp(rig.rotation.x, target.rot.x, 0.06);
  rig.rotation.y = lerp(rig.rotation.y, target.rot.y, 0.06);
  rig.rotation.z = lerp(rig.rotation.z, target.rot.z, 0.06);

  camera.position.x = lerp(camera.position.x, target.cam.x, 0.06);
  camera.position.y = lerp(camera.position.y, target.cam.y, 0.06);
  camera.position.z = lerp(camera.position.z, target.cam.z, 0.06);
  camera.lookAt(rig.position);

  renderer.render(scene, camera);
}
sizeRenderer();
animate();

// ---------- resize ----------
window.addEventListener('resize', sizeRenderer);

// ---------- repo link ----------
document.getElementById('repo-link').href = 'https://github.com/your-username/aquila-7-showcase';
