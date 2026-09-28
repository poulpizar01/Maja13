/* La Maja 13 — blason 3D du hero (three.js r128) */
(function () {
  if (typeof THREE === 'undefined') return;
  const canvas = document.getElementById('hero3d');
  if (!canvas) return;
  const hero = canvas.parentElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // au-delà, 2× plus de pixels à calculer pour une différence à peine visible
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.2, 6.2);

  // ---- textures
  const loader = new THREE.TextureLoader();
  const faceTex = loader.load('assets/medallion.webp');
  faceTex.encoding = THREE.sRGBEncoding;
  faceTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // ---- medallion
  const R = 1.75, T = 0.16, SEG = 128;
  const bronze = new THREE.MeshStandardMaterial({ color: 0x9a7440, metalness: 0.95, roughness: 0.32 });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, metalness: 0.55, roughness: 0.45, emissive: 0x2a1d0c, emissiveMap: faceTex, emissiveIntensity: 0.55 });

  const coin = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, SEG, 1, true), bronze);
  disc.rotation.x = Math.PI / 2;
  coin.add(disc);
  const front = new THREE.Mesh(new THREE.CircleGeometry(R, SEG), faceMat); front.position.z = T / 2; coin.add(front);
  const back = new THREE.Mesh(new THREE.CircleGeometry(R, SEG), faceMat); back.position.z = -T / 2; back.rotation.y = Math.PI; coin.add(back);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.075, 24, SEG), new THREE.MeshStandardMaterial({ color: 0xc9a45c, metalness: 1, roughness: 0.22 }));
  coin.add(rim);
  const reeds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, T * 1.05, 0.06), new THREE.MeshStandardMaterial({ color: 0x6b4f24, metalness: 1, roughness: 0.4 }), 160);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 160; i++) {
    const a = i / 160 * Math.PI * 2;
    p.set(Math.cos(a) * (R + 0.02), Math.sin(a) * (R + 0.02), 0);
    q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, a));
    m.compose(p, q, s); reeds.setMatrixAt(i, m);
  }
  coin.add(reeds);
  scene.add(coin);

  // ---- lights
  scene.add(new THREE.AmbientLight(0x3a2c1a, 0.9));
  const key = new THREE.SpotLight(0xffe2b0, 2.2, 30, 0.6, 0.6, 1); key.position.set(4, 5, 6); scene.add(key);
  const rimL = new THREE.DirectionalLight(0xc9a45c, 1.4); rimL.position.set(-5, 2, -4); scene.add(rimL);
  const fill = new THREE.PointLight(0x6d5030, 0.8, 20); fill.position.set(-3, -2, 4); scene.add(fill);
  const glow = new THREE.PointLight(0xffc873, 0.0, 12); glow.position.set(0, 0, 2.5); scene.add(glow);

  // ---- gold dust
  const N = 700;
  const pos = new Float32Array(N * 3), spd = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * 16; pos[i * 3 + 1] = (Math.random() - .5) * 9; pos[i * 3 + 2] = (Math.random() - .5) * 8 - 1; spd[i] = 0.2 + Math.random() * 0.8; }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sprite = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,225,160,1)'); gr.addColorStop(.35, 'rgba(255,200,110,.6)'); gr.addColorStop(1, 'rgba(255,200,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.07, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd48a, opacity: 0.85 }));
  scene.add(dust);

  // ---- halo : lueur douce derrière la pièce + deux traînées de lumière qui tournent autour
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,215,140,.55)'); gr.addColorStop(.35, 'rgba(230,170,80,.22)'); gr.addColorStop(.7, 'rgba(160,110,40,.06)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  halo.scale.setScalar(R * 3.4);
  scene.add(halo);

  const RING_N = 160, ringR = R + 0.32;
  const ringPos = new Float32Array(RING_N * 3), ringCol = new Float32Array(RING_N * 3);
  for (let i = 0; i < RING_N; i++) { const a = i / RING_N * Math.PI * 2; ringPos[i * 3] = Math.cos(a) * ringR; ringPos[i * 3 + 1] = Math.sin(a) * ringR; ringPos[i * 3 + 2] = 0; }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  ringGeo.setAttribute('color', new THREE.BufferAttribute(ringCol, 3));
  const ring = new THREE.Points(ringGeo, new THREE.PointsMaterial({ size: 0.16, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  const ring2 = ring.clone(); ring2.material = ring.material;
  scene.add(ring); scene.add(ring2);
  // deux "comètes" qui courent le long de l'anneau : l'intensité décroît derrière la tête
  function updateRing(t) {
    const col = ringGeo.attributes.color.array;
    const heads = [t * 0.45, t * 0.45 + Math.PI];
    for (let i = 0; i < RING_N; i++) {
      const a = i / RING_N * Math.PI * 2; let v = 0;
      for (const h of heads) { let d = (h - a) % (Math.PI * 2); if (d < 0) d += Math.PI * 2; v = Math.max(v, Math.exp(-d * 2.2)); }
      const g = 0.06 + v * 1.2;
      col[i * 3] = g; col[i * 3 + 1] = g * 0.82; col[i * 3 + 2] = g * 0.45;
    }
    ringGeo.attributes.color.needsUpdate = true;
  }

  // ---- interaction (drag on the hero, wheel left to the page)
  let dragging = false, lx = 0, ly = 0, velX = 0, velY = 0, rotX = 0, rotY = 0, autoSpin = true;
  const mouse = { x: 0, y: 0 };
  let coinX = 0, coinY = 0, coinScale = 1;

  function layout() {
    const w = hero.clientWidth, h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // sous 1000 px (tablette, téléphone) : blason au-dessus du texte, comme .hero__content dans styles.css
    if (w > 1000) { coinX = Math.min(1.8, w / 760); coinY = 0; coinScale = Math.min(0.88, w / 1500); }
    else { coinX = 0; coinY = 0.85; coinScale = Math.min(0.45, w / 1000); }
    coin.scale.setScalar(coinScale);
  }
  addEventListener('resize', layout); layout();

  canvas.addEventListener('pointerdown', e => { dragging = true; autoSpin = false; lx = e.clientX; ly = e.clientY; velX = velY = 0; canvas.setPointerCapture(e.pointerId); });
  addEventListener('pointermove', e => {
    mouse.x = (e.clientX / innerWidth - .5) * 2; mouse.y = (e.clientY / innerHeight - .5) * 2;
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    velY = dx * 0.006; velX = dy * 0.006; rotY += velY; rotX += velX;
  });
  const up = () => { if (!dragging) return; dragging = false; setTimeout(() => { if (!dragging) autoSpin = true; }, 2500); };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);

  // pause when the hero is off-screen
  let visible = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(en => { visible = en[0].isIntersecting; }, { threshold: 0.02 }).observe(hero);

  const clock = new THREE.Clock();
  function tick() {
    requestAnimationFrame(tick);
    if (!visible) return;
    const t = clock.getElapsedTime();
    if (!dragging) { rotY += velY; rotX += velX; velX *= 0.94; velY *= 0.94; }
    if (autoSpin) rotY += 0.0045;
    rotX = THREE.MathUtils.clamp(rotX, -0.9, 0.9);
    coin.rotation.y = rotY;
    coin.rotation.x = rotX + Math.sin(t * 0.7) * 0.04;
    coin.position.set(coinX, coinY + Math.sin(t * 0.9) * 0.08, 0);
    // halo qui respire et dérive légèrement autour de la pièce
    halo.position.set(coinX + Math.sin(t * 0.5) * 0.12, coin.position.y + Math.cos(t * 0.4) * 0.1, -0.4);
    halo.scale.setScalar((R * 3.2 + Math.sin(t * 1.3) * 0.25) * coinScale);
    halo.material.opacity = 0.75 + Math.sin(t * 0.9) * 0.15;
    // anneaux de lumière : inclinés, en rotation lente, autour de la pièce
    ring.position.copy(coin.position); ring2.position.copy(coin.position);
    ring.scale.setScalar(coinScale); ring2.scale.setScalar(coinScale);
    ring.rotation.set(0.35 + Math.sin(t * 0.3) * 0.1, t * 0.25, 0);
    ring2.rotation.set(-0.5 + Math.cos(t * 0.27) * 0.1, -t * 0.2 + 1.3, 0.3);
    updateRing(t);
    camera.position.x += ((mouse.x * 0.35) - camera.position.x) * 0.04;
    camera.position.y += ((-mouse.y * 0.25 + 0.2) - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
    const facing = Math.abs(Math.cos(rotY));
    glow.position.set(coinX, coinY, 2.5);
    glow.intensity = 0.4 + facing * 1.4 + Math.sin(t * 2) * 0.15;
    faceMat.emissiveIntensity = 0.35 + facing * 0.35;
    const a = dustGeo.attributes.position.array;
    for (let i = 0; i < N; i++) { a[i * 3 + 1] += spd[i] * 0.0025; if (a[i * 3 + 1] > 4.5) a[i * 3 + 1] = -4.5; }
    dustGeo.attributes.position.needsUpdate = true;
    dust.rotation.y = t * 0.02;
    renderer.render(scene, camera);
  }
  tick();
})();
