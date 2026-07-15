// =====================================================================
// AQUILA-7 showcase — scroll-driven 3D drone viewer
// Swap 'my_aircraft.glb' below for your exported model filename.
// =====================================================================

gsap.registerPlugin(ScrollTrigger);

const DUST = new THREE.Color(0xc9a776);
const WATER = new THREE.Color(0x4fd1c5);

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090b);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.4, 6);

// soft fill so the model isn't pure silhouette even before the glow kicks in
scene.add(new THREE.AmbientLight(0x223333, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 0.4);
key.position.set(3, 4, 5);
scene.add(key);

// ---------- fresnel glow material (dust -> water driven by scroll) ----------
const glowMaterial = new THREE.ShaderMaterial({
  uniforms: {
    glowColor: { value: DUST.clone() },
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
    uniform vec3 glowColor;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);
      float intensity = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
      gl_FragColor = vec4(glowColor * (intensity + 0.08), intensity + 0.08);
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
  // Simple stand-in geometry so the page still works before you drop in the real .glb
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 12), glowMaterial);
  body.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.55), glowMaterial);
  wing.position.z = 0.1;
  group.add(body, wing);
  return group;
}

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
    // model missing or failed — fall back so the rest of the page is still testable
    labelEl.textContent = 'NO MODEL FOUND — USING PLACEHOLDER';
    aircraft = placeholderJet();
    normalizeAndAdd(aircraft);
    setTimeout(finishLoading, 500);
  }
);

function normalizeAndAdd(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const scale = 2.4 / size;
  obj.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  obj.position.sub(center);
  scene.add(obj);
}

// ---------- scroll rig ----------
const tmAlt = document.getElementById('tm-alt');
const tmMoist = document.getElementById('tm-moist');
const tmStatus = document.getElementById('tm-status');
const statusStages = ['STANDBY', 'ASCENDING', 'SCANNING', 'DISPERSING', 'RETURNING'];

ScrollTrigger.create({
  trigger: 'main',
  start: 'top top',
  end: 'bottom bottom',
  scrub: 0.6,
  onUpdate: (self) => {
    const p = self.progress; // 0 -> 1 across the whole page

    if (aircraft) {
      aircraft.rotation.y = p * Math.PI * 2.4;
      aircraft.rotation.x = Math.sin(p * Math.PI) * 0.15;
      camera.position.z = 6 - p * 3.2;
      camera.position.y = 0.4 - p * 0.3;
    }

    // dust -> water color interpolation, the page's signature move
    const mixed = DUST.clone().lerp(WATER, p);
    glowMaterial.uniforms.glowColor.value.copy(mixed);
    const hex = '#' + mixed.getHexString();
    document.documentElement.style.setProperty('--accent', hex);
    document.querySelectorAll('.eyebrow, .step-index, .telemetry-row span:first-child').forEach((el) => {
      el.style.color = hex;
    });

    // telemetry HUD
    tmAlt.textContent = Math.round(p * 120).toString().padStart(3, '0');
    tmMoist.textContent = Math.round(20 + p * 60).toString().padStart(2, '0');
    const stageIndex = Math.min(statusStages.length - 1, Math.floor(p * statusStages.length));
    tmStatus.textContent = statusStages[stageIndex];
  },
});

// ---------- render loop ----------
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- repo link ----------
// Point this at your actual GitHub repo once it's created.
document.getElementById('repo-link').href = 'https://github.com/your-username/aquila-7-showcase';
