/**
 * Electromagnetic Signal 3D Visualization Lab
 * Precision Engineering Edition: Unit Switching (mm / mil) & Manual Numeric Input
 */

(function () {
  'use strict';

  // Conversion constants
  const MIL_PER_MM = 39.37007874;
  const MM_PER_MIL = 0.0254;

  // Simulation State
  const state = {
    mode: 'single-high', // 'single-high' | 'differential' | 'single-low'
    unit: 'mm',          // 'mm' | 'mil'

    // Internal physical values (always normalized in mm)
    w: 2.0,              // Trace width in mm
    h: 1.2,              // Substrate height in mm
    s: 0.8,              // Differential spacing in mm
    epsR: 4.4,           // Relative dielectric constant
    speed: 1.5,          // Wave propagation speed multiplier
    noiseAmp: 0.4,       // Noise amplitude (V)
    isNoiseActive: true,
    isPaused: false,

    // Layer visibility
    showE: true,
    showH: true,
    showS: true,
    showReturnCurrent: true,
    showElectrons: true,
    transDielectric: true,

    // Camera preset
    viewPreset: 'isometric',

    // Calculated metrics
    z0: 54.4,
    epsEff: 3.29,
    whRatio: 1.67,
    velocityRatio: 0.55,
    delayPsInch: 153.8,
    zDiff: 81.3,
    couplingK: 0.173,

    simTime: 0
  };

  // Three.js Core Variables
  let scene, camera, renderer, controls;
  let animFrameId = null;

  // Geometry groups
  let boardGroup = null;
  let fieldsGroup = null;
  let particlesGroup = null;
  let electronsGroup = null;
  let returnCurrentGroup = null;

  // Materials & Meshes references
  let dielectricMesh = null;
  let groundMesh = null;
  let traceMesh1 = null;
  let traceMesh2 = null;
  let dielectricMaterial = null;
  let groundMaterial = null;
  let copperMaterial = null;

  // Poynting Particles State
  const POYNTING_COUNT = 850;
  let poyntingParticles = null;
  let poyntingPositions = null;
  let poyntingVelocities = null;

  // Electron Drift Particles
  const ELECTRON_COUNT = 300;
  let electronParticles = null;
  let electronPositions = null;
  let electronJitter = null;

  // Return Current Lines
  let returnLines = [];

  // Wave physics constants
  const BOARD_LENGTH = 32.0;
  const BOARD_WIDTH = 22.0;
  const SCALE_FACTOR = 2.2;

  // 2D Canvases
  let scopeCanvas, scopeCtx;
  let crossCanvas, crossCtx;

  // ==========================================================================
  // Initialization
  // ==========================================================================
  function init() {
    setupThree();
    setupCanvases();
    setupUI();

    // Check URL parameters for direct mode
    const urlParams = new URLSearchParams(window.location.search);
    const unitParam = urlParams.get('unit');
    if (unitParam && ['mm', 'mil'].includes(unitParam)) {
      state.unit = unitParam;
      document.getElementById('btn-unit-mm').classList.toggle('active', unitParam === 'mm');
      document.getElementById('btn-unit-mil').classList.toggle('active', unitParam === 'mil');
    }

    const modeParam = urlParams.get('mode');
    if (modeParam && ['single-high', 'differential', 'single-low'].includes(modeParam)) {
      document.querySelectorAll('.segment-btn').forEach(t => {
        t.classList.toggle('active', t.dataset.mode === modeParam);
      });
      setMode(modeParam);
    } else {
      setMode('single-high');
    }

    animate();
  }

  // --- Three.js Scene Setup ---
  function setupThree() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f7);
    scene.fog = new THREE.FogExp2(0xf5f5f7, 0.008);

    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    applyCameraPreset('isometric');

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 + 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 80;

    // Apple studio light setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe2e8f0, 0.65);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.65);
    dirLight1.position.set(15, 30, 20);
    dirLight1.castShadow = true;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xf1f5f9, 0.4);
    dirLight2.position.set(-20, 20, -15);
    scene.add(dirLight2);

    // Apple studio hairline floor grid
    const gridHelper = new THREE.GridHelper(50, 50, 0xd1d1d6, 0xe5e5ea);
    gridHelper.position.y = -0.05;
    scene.add(gridHelper);

    // Groups
    boardGroup = new THREE.Group();
    fieldsGroup = new THREE.Group();
    particlesGroup = new THREE.Group();
    electronsGroup = new THREE.Group();
    returnCurrentGroup = new THREE.Group();

    scene.add(boardGroup);
    scene.add(fieldsGroup);
    scene.add(particlesGroup);
    scene.add(electronsGroup);
    scene.add(returnCurrentGroup);

    window.addEventListener('resize', onWindowResize);
  }

  function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  // --- Camera Views ---
  function applyCameraPreset(preset) {
    state.viewPreset = preset;
    document.querySelectorAll('.v-btn[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === preset);
    });

    if (!camera) return;

    if (preset === 'isometric') {
      camera.position.set(20, 16, 26);
      if (controls) controls.target.set(0, 1.5, 0);
    } else if (preset === 'front') {
      camera.position.set(0, 3, 30);
      if (controls) controls.target.set(0, 2, 0);
    } else if (preset === 'side') {
      camera.position.set(28, 4, 0);
      if (controls) controls.target.set(0, 2, 0);
    } else if (preset === 'top') {
      camera.position.set(0, 35, 0.001);
      if (controls) controls.target.set(0, 0, 0);
    }
  }

  // ==========================================================================
  // Transmission Line Physical Calculations (IPC-2141 / Wheeler standard)
  // ==========================================================================
  function recalculateMetrics() {
    const w = state.w;
    const h = state.h;
    const s = state.s;
    const er = state.epsR;

    const wh = w / h;
    state.whRatio = wh;

    // Effective dielectric constant eps_eff
    const epsEff = (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 12 / wh, -0.5);
    state.epsEff = epsEff;

    // Characteristic Impedance Z0 (Wheeler formula)
    let z0 = 50;
    if (wh <= 1.0) {
      z0 = (60 / Math.sqrt(epsEff)) * Math.log(8 / wh + 0.25 * wh);
    } else {
      z0 = (120 * Math.PI) / (Math.sqrt(epsEff) * (wh + 1.393 + 0.667 * Math.log(wh + 1.444)));
    }
    state.z0 = z0;

    // Phase velocity
    const vpFraction = 1 / Math.sqrt(epsEff);
    state.velocityRatio = vpFraction;

    // Delay in ps/inch
    const delayPs = 84.72 * Math.sqrt(epsEff);
    state.delayPsInch = delayPs;

    // Differential Impedance
    const shRatio = s / h;
    const zDiff = 2 * z0 * (1 - 0.48 * Math.exp(-0.96 * shRatio));
    state.zDiff = zDiff;

    const zOdd = zDiff / 2;
    const zEven = z0 * (1 + 0.1 * Math.exp(-0.8 * shRatio));
    state.couplingK = (zEven - zOdd) / (zEven + zOdd);

    updateUIReadouts();
  }

  function updateUIReadouts() {
    // Top metric cards
    const valZ0 = document.getElementById('val-z0');
    const valEpsEff = document.getElementById('val-eps-eff');
    const valWh = document.getElementById('val-wh');
    const valVelocity = document.getElementById('val-velocity');
    const valExtra = document.getElementById('val-extra');
    const labelExtra = document.getElementById('label-extra');
    const unitExtra = document.getElementById('unit-extra');

    if (state.mode === 'differential') {
      document.querySelector('#card-z0 .metric-caption').innerHTML = '差分特征阻抗 <span class="math-sym">Z_diff</span>';
      valZ0.textContent = state.zDiff.toFixed(1);

      labelExtra.innerHTML = '差分耦合系数 <span class="math-sym">k</span>';
      valExtra.textContent = (state.couplingK * 100).toFixed(1);
      unitExtra.textContent = '%';
    } else if (state.mode === 'single-low') {
      document.querySelector('#card-z0 .metric-caption').innerHTML = '微带线特征阻抗 <span class="math-sym">Z₀</span>';
      valZ0.textContent = state.z0.toFixed(1);

      labelExtra.innerHTML = '电路理论模型';
      valExtra.textContent = 'λ ≫ L';
      unitExtra.textContent = '(集总无时延)';
    } else {
      document.querySelector('#card-z0 .metric-caption').innerHTML = '微带线特征阻抗 <span class="math-sym">Z₀</span>';
      valZ0.textContent = state.z0.toFixed(1);

      labelExtra.innerHTML = '走线延迟 <span class="math-sym">T_pd</span>';
      valExtra.textContent = state.delayPsInch.toFixed(1);
      unitExtra.textContent = 'ps/in';
    }

    valEpsEff.textContent = state.epsEff.toFixed(2);
    valWh.textContent = state.whRatio.toFixed(2);
    valVelocity.textContent = state.velocityRatio.toFixed(2);

    // Sync input boxes & sliders according to active unit (mm vs mil)
    syncParamInputs();

    // Material and speed badges
    document.getElementById('readout-material-eps').textContent = state.epsR.toFixed(2);
    document.getElementById('readout-speed').textContent = state.speed.toFixed(1) + 'x';

    // HUD Title and Note
    const title = document.getElementById('current-mode-title');
    const tipBadge = document.getElementById('tip-badge');
    const tipContent = document.getElementById('tip-content');

    if (state.mode === 'single-high') {
      title.textContent = '微带线电磁场与坡印廷能流 3D 可视化';
      tipBadge.textContent = '物理本质：能量在介质中冲刺';
      tipContent.innerHTML = '<strong>信号不是在铜线里流，而是在绝缘介质中跑：</strong><br>良导体铜线内部电场 <i>E</i> ≈ 0，故铜线内部坡印廷能流 <i>S</i> = <i>E</i> × <i>H</i> ≈ 0。绝大部分能量由铜线构成的“波导护栏”约束在 FR-4 介质走廊中向前高速传输。';
    } else if (state.mode === 'differential') {
      title.textContent = '高速差分对奇模耦合与抗噪可视化';
      tipBadge.textContent = '抗噪本质：差分相减与远场相消';
      tipContent.innerHTML = '<strong>差分双线横向电场自闭合：</strong><br>两根走线携带相反极性电荷，在远场空间激发的磁场相互反向对消，对外辐射极低；外部共模噪声入侵时，接收端相减 (<i>V</i><sub>+</sub> − <i>V</i><sub>−</sub>) 瞬间消除噪声。';
    } else {
      title.textContent = '单端低速信号 (集总参数电路模型)';
      tipBadge.textContent = '传统水流视角：电子微米慢漂移与全地漫延';
      tipContent.innerHTML = '<strong>低频下信号波长远大于导线物理长度 (λ ≫ L)：</strong><br>导线内部自由电子做剧烈的无规则布朗热运动，并在电压驱动下以微米每秒级极慢定向漂移；返回电流走欧姆直流电阻最小路径，在整个地平面广域扩散。';
    }
  }

  // Sync Input Elements (mm ⇋ mil)
  function syncParamInputs() {
    const isMil = state.unit === 'mil';

    // Update unit labels next to number inputs
    document.querySelectorAll('.active-unit-text').forEach(el => {
      el.textContent = isMil ? 'mil' : 'mm';
    });

    // 1. Trace Width W
    const numW = document.getElementById('num-input-w');
    const sliderW = document.getElementById('slider-w');
    const subW = document.getElementById('sub-readout-w');

    if (isMil) {
      const valMil = state.w * MIL_PER_MM;
      if (document.activeElement !== numW) numW.value = valMil.toFixed(1);
      numW.step = '1';
      sliderW.min = '8';
      sliderW.max = '200';
      sliderW.step = '1';
      sliderW.value = Math.round(valMil);
      subW.textContent = `${state.w.toFixed(2)} mm`;
    } else {
      if (document.activeElement !== numW) numW.value = state.w.toFixed(2);
      numW.step = '0.05';
      sliderW.min = '0.2';
      sliderW.max = '5.0';
      sliderW.step = '0.05';
      sliderW.value = state.w;
      subW.textContent = `${(state.w * MIL_PER_MM).toFixed(1)} mil`;
    }

    // 2. Substrate Height h
    const numH = document.getElementById('num-input-h');
    const sliderH = document.getElementById('slider-h');
    const subH = document.getElementById('sub-readout-h');

    if (isMil) {
      const valMil = state.h * MIL_PER_MM;
      if (document.activeElement !== numH) numH.value = valMil.toFixed(1);
      numH.step = '1';
      sliderH.min = '8';
      sliderH.max = '140';
      sliderH.step = '1';
      sliderH.value = Math.round(valMil);
      subH.textContent = `${state.h.toFixed(2)} mm`;
    } else {
      if (document.activeElement !== numH) numH.value = state.h.toFixed(2);
      numH.step = '0.05';
      sliderH.min = '0.2';
      sliderH.max = '3.5';
      sliderH.step = '0.05';
      sliderH.value = state.h;
      subH.textContent = `${(state.h * MIL_PER_MM).toFixed(1)} mil`;
    }

    // 3. Differential Spacing S
    const numS = document.getElementById('num-input-s');
    const sliderS = document.getElementById('slider-s');
    const subS = document.getElementById('sub-readout-s');

    if (isMil) {
      const valMil = state.s * MIL_PER_MM;
      if (document.activeElement !== numS) numS.value = valMil.toFixed(1);
      numS.step = '1';
      sliderS.min = '8';
      sliderS.max = '160';
      sliderS.step = '1';
      sliderS.value = Math.round(valMil);
      subS.textContent = `${state.s.toFixed(2)} mm`;
    } else {
      if (document.activeElement !== numS) numS.value = state.s.toFixed(2);
      numS.step = '0.05';
      sliderS.min = '0.2';
      sliderS.max = '4.0';
      sliderS.step = '0.05';
      sliderS.value = state.s;
      subS.textContent = `${(state.s * MIL_PER_MM).toFixed(1)} mil`;
    }
  }

  // ==========================================================================
  // 3D Geometry Builder
  // ==========================================================================
  function rebuildScene() {
    clearGroup(boardGroup);
    clearGroup(fieldsGroup);
    clearGroup(particlesGroup);
    clearGroup(electronsGroup);
    clearGroup(returnCurrentGroup);

    buildBoardGeometry();
    buildFieldLines();
    buildPoyntingParticles();
    buildElectronParticles();
    buildReturnCurrentVisuals();
  }

  function clearGroup(group) {
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    }
  }

  function buildBoardGeometry() {
    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const s3d = state.s * SCALE_FACTOR;
    const traceThick = 0.22;

    // 1. Dielectric Substrate (Optical frosted crystal glass / high-grade polymer)
    const dielectricGeo = new THREE.BoxGeometry(BOARD_WIDTH, h3d, BOARD_LENGTH);
    dielectricMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xeef2f6,
      transparent: true,
      opacity: state.transDielectric ? 0.32 : 0.88,
      roughness: 0.12,
      metalness: 0.02,
      transmission: state.transDielectric ? 0.82 : 0.1,
      ior: 1.52,
      depthWrite: !state.transDielectric
    });
    dielectricMesh = new THREE.Mesh(dielectricGeo, dielectricMaterial);
    dielectricMesh.position.set(0, h3d / 2, 0);
    dielectricMesh.receiveShadow = true;
    boardGroup.add(dielectricMesh);

    // Subtle crisp slate hairline outline
    const edges = new THREE.EdgesGeometry(dielectricGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    dielectricMesh.add(wireframe);

    // 2. Ground Plane (GND at bottom, Y = 0 - Anodized space-gray / satin aluminum chassis)
    const groundGeo = new THREE.BoxGeometry(BOARD_WIDTH, 0.12, BOARD_LENGTH);
    groundMaterial = new THREE.MeshStandardMaterial({
      color: 0xdde3ea,
      metalness: 0.35,
      roughness: 0.45
    });
    groundMesh = new THREE.Mesh(groundGeo, groundMaterial);
    groundMesh.position.set(0, -0.06, 0);
    groundMesh.receiveShadow = true;
    boardGroup.add(groundMesh);

    // 3. Copper Signal Trace(s) - Sleek anodized electroplated copper
    copperMaterial = new THREE.MeshStandardMaterial({
      color: 0xd97736,
      metalness: 0.65,
      roughness: 0.38
    });

    if (state.mode === 'differential') {
      const traceGeo = new THREE.BoxGeometry(w3d, traceThick, BOARD_LENGTH);

      // Left trace (TX+)
      traceMesh1 = new THREE.Mesh(traceGeo, copperMaterial.clone());
      traceMesh1.material.color.setHex(0xd97736);
      const x1 = -(s3d / 2 + w3d / 2);
      traceMesh1.position.set(x1, h3d + traceThick / 2, 0);
      traceMesh1.castShadow = true;
      boardGroup.add(traceMesh1);

      // Right trace (TX-)
      traceMesh2 = new THREE.Mesh(traceGeo, copperMaterial.clone());
      traceMesh2.material.color.setHex(0xc96726);
      const x2 = +(s3d / 2 + w3d / 2);
      traceMesh2.position.set(x2, h3d + traceThick / 2, 0);
      traceMesh2.castShadow = true;
      boardGroup.add(traceMesh2);
    } else {
      const traceGeo = new THREE.BoxGeometry(w3d, traceThick, BOARD_LENGTH);
      traceMesh1 = new THREE.Mesh(traceGeo, copperMaterial);
      traceMesh1.position.set(0, h3d + traceThick / 2, 0);
      traceMesh1.castShadow = true;
      boardGroup.add(traceMesh1);
      traceMesh2 = null;
    }
  }

  // --- Electromagnetic Field Lines ---
  function buildFieldLines() {
    if (state.mode === 'single-low') return;

    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const s3d = state.s * SCALE_FACTOR;

    const zCount = 13;
    const zStep = (BOARD_LENGTH - 4) / (zCount - 1);

    if (state.mode === 'single-high') {
      buildSingleHighFields(h3d, w3d, zCount, zStep);
    } else if (state.mode === 'differential') {
      buildDifferentialFields(h3d, w3d, s3d, zCount, zStep);
    }
  }

  function buildSingleHighFields(h3d, w3d, zCount, zStep) {
    const eLinesMat = new THREE.LineBasicMaterial({
      color: 0x0071e3, // Apple System Blue E-field
      transparent: true,
      opacity: 0.85,
      blending: THREE.NormalBlending
    });

    const hLinesMat = new THREE.LineBasicMaterial({
      color: 0x34c759, // Apple System Emerald H-field
      transparent: true,
      opacity: 0.85,
      blending: THREE.NormalBlending
    });

    const ePositions = [];
    const hPositions = [];

    for (let i = 0; i < zCount; i++) {
      const z = -BOARD_LENGTH / 2 + 2 + i * zStep;

      // Vertical lines under the trace
      const numUnder = 7;
      for (let j = 0; j < numUnder; j++) {
        const x = -w3d / 2 + (j / (numUnder - 1)) * w3d;
        ePositions.push(x, h3d, z);
        ePositions.push(x, 0, z);
      }

      // Fringing fields on left and right edges
      const numFringe = 4;
      for (let j = 1; j <= numFringe; j++) {
        const factor = j / numFringe;
        const xOffset = factor * 2.3;
        const bulge = factor * 1.4;

        const leftCurve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-w3d / 2, h3d * 0.9, z),
          new THREE.Vector3(-w3d / 2 - bulge, h3d * 0.5, z),
          new THREE.Vector3(-w3d / 2 - xOffset, 0, z)
        );
        const leftPts = leftCurve.getPoints(9);
        for (let k = 0; k < leftPts.length - 1; k++) {
          ePositions.push(leftPts[k].x, leftPts[k].y, leftPts[k].z);
          ePositions.push(leftPts[k + 1].x, leftPts[k + 1].y, leftPts[k + 1].z);
        }

        const rightCurve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(w3d / 2, h3d * 0.9, z),
          new THREE.Vector3(w3d / 2 + bulge, h3d * 0.5, z),
          new THREE.Vector3(w3d / 2 + xOffset, 0, z)
        );
        const rightPts = rightCurve.getPoints(9);
        for (let k = 0; k < rightPts.length - 1; k++) {
          ePositions.push(rightPts[k].x, rightPts[k].y, rightPts[k].z);
          ePositions.push(rightPts[k + 1].x, rightPts[k + 1].y, rightPts[k + 1].z);
        }
      }

      // Magnetic field loops around the trace
      const loopCount = 3;
      for (let l = 1; l <= loopCount; l++) {
        const radiusX = (w3d / 2) + l * 0.85;
        const radiusY = (h3d / 2) + l * 0.6;
        const centerY = h3d / 2 + 0.1;

        const loopPts = 30;
        for (let p = 0; p < loopPts; p++) {
          const t1 = (p / loopPts) * Math.PI * 2;
          const t2 = ((p + 1) / loopPts) * Math.PI * 2;
          hPositions.push(Math.cos(t1) * radiusX, Math.max(0.05, centerY + Math.sin(t1) * radiusY), z);
          hPositions.push(Math.cos(t2) * radiusX, Math.max(0.05, centerY + Math.sin(t2) * radiusY), z);
        }
      }
    }

    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.Float32BufferAttribute(ePositions, 3));
    const eLinesMesh = new THREE.LineSegments(eGeo, eLinesMat);
    eLinesMesh.name = 'eFieldLines';
    eLinesMesh.visible = state.showE;
    fieldsGroup.add(eLinesMesh);

    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute('position', new THREE.Float32BufferAttribute(hPositions, 3));
    const hLinesMesh = new THREE.LineSegments(hGeo, hLinesMat);
    hLinesMesh.name = 'hFieldLines';
    hLinesMesh.visible = state.showH;
    fieldsGroup.add(hLinesMesh);
  }

  function buildDifferentialFields(h3d, w3d, s3d, zCount, zStep) {
    const eLinesMat = new THREE.LineBasicMaterial({
      color: 0x0071e3, // Apple System Blue E-field
      transparent: true,
      opacity: 0.85,
      blending: THREE.NormalBlending
    });

    const hLinesMat = new THREE.LineBasicMaterial({
      color: 0x34c759, // Apple System Emerald H-field
      transparent: true,
      opacity: 0.85,
      blending: THREE.NormalBlending
    });

    const ePositions = [];
    const hPositions = [];

    const xLeft = -(s3d / 2 + w3d / 2);
    const xRight = +(s3d / 2 + w3d / 2);

    for (let i = 0; i < zCount; i++) {
      const z = -BOARD_LENGTH / 2 + 2 + i * zStep;

      // Transverse differential field between traces
      const numInterTrace = 6;
      for (let j = 0; j < numInterTrace; j++) {
        const yFrac = 0.2 + (j / (numInterTrace - 1)) * 0.8;
        const yStart = h3d * yFrac;
        const bridgeCurve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(xLeft + w3d / 2, yStart, z),
          new THREE.Vector3(0, yStart + 0.35, z),
          new THREE.Vector3(xRight - w3d / 2, yStart, z)
        );
        const pts = bridgeCurve.getPoints(8);
        for (let k = 0; k < pts.length - 1; k++) {
          ePositions.push(pts[k].x, pts[k].y, pts[k].z);
          ePositions.push(pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
        }
      }

      // Vertical lines to GND
      const numUnder = 4;
      for (let j = 0; j < numUnder; j++) {
        const uLeft = xLeft - w3d / 2 + (j / (numUnder - 1)) * w3d;
        ePositions.push(uLeft, h3d, z);
        ePositions.push(uLeft, 0, z);

        const uRight = xRight - w3d / 2 + (j / (numUnder - 1)) * w3d;
        ePositions.push(uRight, h3d, z);
        ePositions.push(uRight, 0, z);
      }

      // Magnetic field loops (counter-circulating)
      const loopCount = 2;
      for (let l = 1; l <= loopCount; l++) {
        const radX = (w3d / 2) + l * 0.55;
        const radY = (h3d / 2) + l * 0.45;
        const centerY = h3d / 2 + 0.1;
        const loopPts = 24;

        for (let p = 0; p < loopPts; p++) {
          const t1 = (p / loopPts) * Math.PI * 2;
          const t2 = ((p + 1) / loopPts) * Math.PI * 2;
          hPositions.push(xLeft + Math.cos(t1) * radX, Math.max(0.05, centerY + Math.sin(t1) * radY), z);
          hPositions.push(xLeft + Math.cos(t2) * radX, Math.max(0.05, centerY + Math.sin(t2) * radY), z);
        }

        for (let p = 0; p < loopPts; p++) {
          const t1 = (p / loopPts) * Math.PI * 2;
          const t2 = ((p + 1) / loopPts) * Math.PI * 2;
          hPositions.push(xRight + Math.cos(t1) * radX, Math.max(0.05, centerY + Math.sin(t1) * radY), z);
          hPositions.push(xRight + Math.cos(t2) * radX, Math.max(0.05, centerY + Math.sin(t2) * radY), z);
        }
      }
    }

    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.Float32BufferAttribute(ePositions, 3));
    const eLinesMesh = new THREE.LineSegments(eGeo, eLinesMat);
    eLinesMesh.name = 'eFieldLines';
    eLinesMesh.visible = state.showE;
    fieldsGroup.add(eLinesMesh);

    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute('position', new THREE.Float32BufferAttribute(hPositions, 3));
    const hLinesMesh = new THREE.LineSegments(hGeo, hLinesMat);
    hLinesMesh.name = 'hFieldLines';
    hLinesMesh.visible = state.showH;
    fieldsGroup.add(hLinesMesh);
  }

  // --- Poynting Particles (High-Speed & Differential) ---
  function buildPoyntingParticles() {
    if (state.mode === 'single-low') return;

    const count = POYNTING_COUNT;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);

    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const s3d = state.s * SCALE_FACTOR;

    for (let i = 0; i < count; i++) {
      let x, y, z;
      z = (Math.random() - 0.5) * BOARD_LENGTH;

      if (state.mode === 'single-high') {
        const r = Math.random();
        if (r < 0.72) {
          x = (Math.random() - 0.5) * (w3d * 1.15);
          y = Math.random() * h3d * 0.95 + 0.05;
        } else {
          const side = Math.random() < 0.5 ? -1 : 1;
          x = side * (w3d / 2 + Math.random() * 2.3);
          y = Math.random() * (h3d * 1.1) + 0.05;
        }
      } else {
        const r = Math.random();
        if (r < 0.5) {
          x = (Math.random() - 0.5) * s3d;
          y = Math.random() * h3d * 1.05 + 0.05;
        } else if (r < 0.82) {
          const which = Math.random() < 0.5 ? -1 : 1;
          const center = which * (s3d / 2 + w3d / 2);
          x = center + (Math.random() - 0.5) * w3d;
          y = Math.random() * h3d * 0.95 + 0.05;
        } else {
          const which = Math.random() < 0.5 ? -1 : 1;
          const center = which * (s3d / 2 + w3d / 2);
          x = center + which * (w3d / 2 + Math.random() * 1.8);
          y = Math.random() * h3d + 0.05;
        }
      }

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      velocities[i] = 1.0 + Math.random() * 0.35;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#ff9500');
    grad.addColorStop(0.85, 'rgba(255, 149, 0, 0.65)');
    grad.addColorStop(1, 'rgba(255, 149, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      color: 0xff9500, // Apple Sunrise Amber
      size: 0.72,
      map: texture,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false
    });

    poyntingParticles = new THREE.Points(geometry, material);
    poyntingParticles.name = 'poyntingParticles';
    poyntingParticles.visible = state.showS;
    particlesGroup.add(poyntingParticles);

    poyntingPositions = positions;
    poyntingVelocities = velocities;
  }

  // --- Electron Particles (Low-Speed Model) ---
  function buildElectronParticles() {
    if (state.mode !== 'single-low') return;

    const count = ELECTRON_COUNT;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const jitters = new Float32Array(count * 3);

    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const traceThick = 0.22;

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * (w3d * 0.9);
      const y = h3d + Math.random() * traceThick;
      const z = (Math.random() - 0.5) * BOARD_LENGTH;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      jitters[i * 3 + 0] = (Math.random() - 0.5) * 0.04;
      jitters[i * 3 + 1] = (Math.random() - 0.5) * 0.04;
      jitters[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#0071e3');
    grad.addColorStop(1, 'rgba(0, 113, 227, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      color: 0x64d2ff,
      size: 0.6,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    electronParticles = new THREE.Points(geometry, material);
    electronParticles.name = 'electronParticles';
    electronParticles.visible = state.showElectrons;
    electronsGroup.add(electronParticles);

    electronPositions = positions;
    electronJitter = jitters;
  }

  // --- Ground Return Current Visuals ---
  function buildReturnCurrentVisuals() {
    returnLines = [];
    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const s3d = state.s * SCALE_FACTOR;
    const yGnd = 0.04;

    if (state.mode === 'single-low') {
      const lineCount = 18;
      const positions = [];

      for (let i = 0; i < lineCount; i++) {
        const u = (i / (lineCount - 1)) * 2 - 1;
        const xSpan = u * (BOARD_WIDTH * 0.42);

        const zStart = BOARD_LENGTH / 2 - 1;
        const zEnd = -BOARD_LENGTH / 2 + 1;

        positions.push(xSpan * 1.3, yGnd, zStart);
        positions.push(xSpan * 0.8, yGnd, 0);
        positions.push(xSpan * 0.8, yGnd, 0);
        positions.push(xSpan * 1.3, yGnd, zEnd);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0x5856d6, // Apple System Indigo / Purple
          transparent: true,
          opacity: 0.75,
          blending: THREE.NormalBlending
        })
      );
      mat.visible = state.showReturnCurrent;
      returnCurrentGroup.add(mat);
      returnLines.push(mat);

    } else if (state.mode === 'single-high') {
      const stripWidth = w3d + h3d * 0.8;
      const positions = [];
      const numLines = 14;

      for (let i = 0; i < numLines; i++) {
        const frac = i / (numLines - 1);
        const x = -stripWidth / 2 + frac * stripWidth;
        positions.push(x, yGnd, -BOARD_LENGTH / 2 + 1);
        positions.push(x, yGnd, BOARD_LENGTH / 2 - 1);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0x5856d6, // Apple System Indigo / Purple
          transparent: true,
          opacity: 0.85,
          blending: THREE.NormalBlending
        })
      );
      mat.visible = state.showReturnCurrent;
      returnCurrentGroup.add(mat);
      returnLines.push(mat);

    } else if (state.mode === 'differential') {
      const xLeft = -(s3d / 2 + w3d / 2);
      const xRight = +(s3d / 2 + w3d / 2);
      const positions = [];
      const numPerTrace = 7;

      for (let i = 0; i < numPerTrace; i++) {
        const frac = i / (numPerTrace - 1);
        const offset = (frac - 0.5) * w3d * 1.2;

        positions.push(xLeft + offset, yGnd, -BOARD_LENGTH / 2 + 1);
        positions.push(xLeft + offset, yGnd, BOARD_LENGTH / 2 - 1);

        positions.push(xRight + offset, yGnd, -BOARD_LENGTH / 2 + 1);
        positions.push(xRight + offset, yGnd, BOARD_LENGTH / 2 - 1);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0x5856d6, // Apple System Indigo / Purple
          transparent: true,
          opacity: 0.8,
          blending: THREE.NormalBlending
        })
      );
      mat.visible = state.showReturnCurrent;
      returnCurrentGroup.add(mat);
      returnLines.push(mat);
    }
  }

  // ==========================================================================
  // Animation Loop
  // ==========================================================================
  function animate() {
    animFrameId = requestAnimationFrame(animate);

    if (!state.isPaused) {
      state.simTime += 0.016 * state.speed;
    }

    controls.update();

    updateFieldAnimations();
    updatePoyntingParticles();
    updateElectronDrift();
    renderOscilloscope();
    render2DCrossSection();

    renderer.render(scene, camera);
  }

  function updateFieldAnimations() {
    const eMesh = fieldsGroup.getObjectByName('eFieldLines');
    const hMesh = fieldsGroup.getObjectByName('hFieldLines');

    if (eMesh && eMesh.material) {
      const pulse = 0.55 + 0.25 * Math.sin(state.simTime * 4.0);
      eMesh.material.opacity = pulse;
    }

    if (hMesh && hMesh.material) {
      const pulse = 0.6 + 0.2 * Math.cos(state.simTime * 4.0);
      hMesh.material.opacity = pulse;
    }
  }

  function updatePoyntingParticles() {
    if (!poyntingParticles || !poyntingPositions) return;

    const count = POYNTING_COUNT;
    const baseSpeed = 0.35 * state.speed * (state.velocityRatio / 0.55);

    for (let i = 0; i < count; i++) {
      let z = poyntingPositions[i * 3 + 2];
      const vel = poyntingVelocities[i];

      if (!state.isPaused) {
        z += baseSpeed * vel;
        if (z > BOARD_LENGTH / 2) {
          z = -BOARD_LENGTH / 2;
        }
        poyntingPositions[i * 3 + 2] = z;
      }
    }

    poyntingParticles.geometry.attributes.position.needsUpdate = true;
  }

  function updateElectronDrift() {
    if (!electronParticles || !electronPositions) return;

    const count = ELECTRON_COUNT;
    const driftSpeed = 0.04 * state.speed;
    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const traceThick = 0.22;

    for (let i = 0; i < count; i++) {
      if (!state.isPaused) {
        let z = electronPositions[i * 3 + 2] + driftSpeed;
        if (z > BOARD_LENGTH / 2) z = -BOARD_LENGTH / 2;

        let x = electronPositions[i * 3 + 0] + (Math.random() - 0.5) * 0.035;
        let y = electronPositions[i * 3 + 1] + (Math.random() - 0.5) * 0.015;

        if (x < -w3d / 2) x = -w3d / 2;
        if (x > w3d / 2) x = w3d / 2;
        if (y < h3d) y = h3d;
        if (y > h3d + traceThick) y = h3d + traceThick;

        electronPositions[i * 3 + 0] = x;
        electronPositions[i * 3 + 1] = y;
        electronPositions[i * 3 + 2] = z;
      }
    }

    electronParticles.geometry.attributes.position.needsUpdate = true;
  }

  // ==========================================================================
  // Oscilloscope & Cross Section Canvases
  // ==========================================================================
  function setupCanvases() {
    scopeCanvas = document.getElementById('scopeCanvas');
    scopeCtx = scopeCanvas.getContext('2d');

    crossCanvas = document.getElementById('crossCanvas');
    crossCtx = crossCanvas.getContext('2d');
  }

  function renderOscilloscope() {
    if (!scopeCtx) return;
    const w = scopeCanvas.width;
    const h = scopeCanvas.height;

    // Apple flat pure white / studio light canvas
    scopeCtx.fillStyle = '#FFFFFF';
    scopeCtx.fillRect(0, 0, w, h);

    // Subtle Apple reticle grid lines
    scopeCtx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    scopeCtx.lineWidth = 1;
    scopeCtx.setLineDash([2, 4]);

    for (let x = 28; x < w; x += 28) {
      scopeCtx.beginPath();
      scopeCtx.moveTo(x, 0);
      scopeCtx.lineTo(x, h);
      scopeCtx.stroke();
    }
    for (let y = 20; y < h; y += 20) {
      scopeCtx.beginPath();
      scopeCtx.moveTo(0, y);
      scopeCtx.lineTo(w, y);
      scopeCtx.stroke();
    }
    scopeCtx.setLineDash([]);

    const cy = h / 2;
    scopeCtx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    scopeCtx.beginPath();
    scopeCtx.moveTo(0, cy);
    scopeCtx.lineTo(w, cy);
    scopeCtx.stroke();

    const t = state.simTime * 3.5;

    if (state.mode === 'differential') {
      const noise = state.isNoiseActive ? state.noiseAmp : 0;

      // TX+ (Signal + Noise) - Apple Blue
      scopeCtx.strokeStyle = '#0071E3';
      scopeCtx.lineWidth = 1.6;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = Math.sin(phi);
        const n = noise * (Math.sin(phi * 4.3) + Math.cos(phi * 7.1) * 0.5);
        const val = sig + n;
        const y = cy - val * 24;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

      // TX- (Inverted Signal + Identical Noise) - Apple Red
      scopeCtx.strokeStyle = '#FF3B30';
      scopeCtx.lineWidth = 1.6;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = -Math.sin(phi);
        const n = noise * (Math.sin(phi * 4.3) + Math.cos(phi * 7.1) * 0.5);
        const val = sig + n;
        const y = cy - val * 24;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

      // Diff Out = (TX+ - TX-) / 2 - Apple Green pure recovered signal
      scopeCtx.strokeStyle = '#34C759';
      scopeCtx.lineWidth = 2.4;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = Math.sin(phi);
        const y = cy - sig * 30;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

    } else {
      // Driver signal Vin - Apple Blue
      scopeCtx.strokeStyle = '#0071E3';
      scopeCtx.lineWidth = 1.6;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = Math.sin(phi);
        const y = cy - sig * 28;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

      const phaseDelay = state.mode === 'single-high' ? 1.8 : 0.08;

      // Receiver signal Vout - Apple Green
      scopeCtx.strokeStyle = '#34C759';
      scopeCtx.lineWidth = 2.2;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6 - phaseDelay;
        const sig = Math.sin(phi);
        const y = cy - sig * 28;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();
    }
  }

  function render2DCrossSection() {
    const crossPanel = document.getElementById('cross-section-panel');
    if (crossPanel.style.display === 'none' || !crossCtx) return;

    const w = crossCanvas.width;
    const h = crossCanvas.height;

    // Apple pure studio white
    crossCtx.fillStyle = '#FFFFFF';
    crossCtx.fillRect(0, 0, w, h);

    const centerX = w / 2;
    const groundY = h - 30;
    const subH = Math.min(75, state.h * 30);
    const traceY = groundY - subH;
    const traceW = Math.min(90, state.w * 24);
    const traceH = 8;

    // Substrate - Frosted crystal glass appearance
    crossCtx.fillStyle = 'rgba(235, 242, 248, 0.95)';
    crossCtx.fillRect(20, traceY, w - 40, subH);
    crossCtx.strokeStyle = '#CBD5E1';
    crossCtx.lineWidth = 1;
    crossCtx.strokeRect(20, traceY, w - 40, subH);

    // Ground Plane - Space gray / satin aluminum chassis
    crossCtx.fillStyle = '#CBD5E1';
    crossCtx.fillRect(15, groundY, w - 30, 6);
    crossCtx.fillStyle = '#64748B';
    crossCtx.font = '10px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    crossCtx.fillText('GND 参考地平面', 22, groundY + 18);

    if (state.mode === 'differential') {
      const spacing = Math.min(55, state.s * 24);
      const x1 = centerX - spacing / 2 - traceW;
      const x2 = centerX + spacing / 2;

      crossCtx.fillStyle = '#C2633E';
      crossCtx.fillRect(x1, traceY - traceH, traceW, traceH);
      crossCtx.fillStyle = '#1D1D1F';
      crossCtx.font = '9.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      crossCtx.fillText('Line (+)', x1 + 4, traceY - traceH - 4);

      crossCtx.fillStyle = '#B35330';
      crossCtx.fillRect(x2, traceY - traceH, traceW, traceH);
      crossCtx.fillText('Line (-)', x2 + 4, traceY - traceH - 4);

      // Differential E-field lines between traces (Apple Blue)
      crossCtx.strokeStyle = '#0071E3';
      crossCtx.lineWidth = 1.2;
      for (let y = traceY - traceH / 2; y <= traceY + subH * 0.4; y += 10) {
        crossCtx.beginPath();
        crossCtx.moveTo(x1 + traceW, y);
        crossCtx.lineTo(x2, y);
        crossCtx.stroke();
      }
    } else {
      const xTrace = centerX - traceW / 2;
      crossCtx.fillStyle = '#C2633E';
      crossCtx.fillRect(xTrace, traceY - traceH, traceW, traceH);
      crossCtx.fillStyle = '#1D1D1F';
      crossCtx.font = '9.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      crossCtx.fillText('信号铜线', xTrace + traceW / 2 - 18, traceY - traceH - 4);

      // Vertical E-field lines (Apple Blue)
      crossCtx.strokeStyle = '#0071E3';
      crossCtx.lineWidth = 1.1;
      for (let x = xTrace + 6; x <= xTrace + traceW - 6; x += 10) {
        crossCtx.beginPath();
        crossCtx.moveTo(x, traceY);
        crossCtx.lineTo(x, groundY);
        crossCtx.stroke();
      }

      // H-field loops (Apple Green)
      crossCtx.strokeStyle = '#34C759';
      crossCtx.lineWidth = 1.2;
      crossCtx.beginPath();
      crossCtx.ellipse(centerX, traceY + subH / 2, traceW / 2 + 16, subH / 2 + 12, 0, 0, Math.PI * 2);
      crossCtx.stroke();
    }
  }

  // ==========================================================================
  // UI Event Handlers & Unit Switch (mm ⇋ mil)
  // ==========================================================================
  function setupUI() {
    // Mode switcher buttons
    const tabs = document.querySelectorAll('.segment-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        setMode(tab.dataset.mode);
      });
    });

    // View Presets
    document.querySelectorAll('.v-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCameraPreset(btn.dataset.view);
      });
    });

    document.getElementById('btn-reset-cam').addEventListener('click', () => {
      applyCameraPreset('isometric');
    });

    // Left HUD Collapse Toggle
    const btnToggleLeft = document.getElementById('btn-toggle-left-hud');
    const leftHudBody = document.getElementById('left-hud-body');
    btnToggleLeft.addEventListener('click', () => {
      const isCollapsed = leftHudBody.style.display === 'none';
      leftHudBody.style.display = isCollapsed ? 'block' : 'none';
      btnToggleLeft.textContent = isCollapsed ? '−' : '+';
    });

    // Unit Switcher (mm / mil)
    const btnMm = document.getElementById('btn-unit-mm');
    const btnMil = document.getElementById('btn-unit-mil');

    btnMm.addEventListener('click', () => {
      if (state.unit === 'mm') return;
      state.unit = 'mm';
      btnMm.classList.add('active');
      btnMil.classList.remove('active');
      syncParamInputs();
    });

    btnMil.addEventListener('click', () => {
      if (state.unit === 'mil') return;
      state.unit = 'mil';
      btnMil.classList.add('active');
      btnMm.classList.remove('active');
      syncParamInputs();
    });

    // --- Trace Width W Input & Slider Binding ---
    const numW = document.getElementById('num-input-w');
    const sliderW = document.getElementById('slider-w');

    numW.addEventListener('change', () => {
      let val = parseFloat(numW.value);
      if (isNaN(val) || val <= 0) val = state.unit === 'mil' ? 40 : 1.0;
      if (state.unit === 'mil') {
        state.w = Math.max(0.1, Math.min(10.0, val * MM_PER_MIL));
      } else {
        state.w = Math.max(0.1, Math.min(10.0, val));
      }
      recalculateMetrics();
      rebuildScene();
    });

    sliderW.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      if (state.unit === 'mil') {
        state.w = val * MM_PER_MIL;
      } else {
        state.w = val;
      }
      recalculateMetrics();
      rebuildScene();
    });

    // --- Substrate Height h Input & Slider Binding ---
    const numH = document.getElementById('num-input-h');
    const sliderH = document.getElementById('slider-h');

    numH.addEventListener('change', () => {
      let val = parseFloat(numH.value);
      if (isNaN(val) || val <= 0) val = state.unit === 'mil' ? 30 : 0.8;
      if (state.unit === 'mil') {
        state.h = Math.max(0.1, Math.min(8.0, val * MM_PER_MIL));
      } else {
        state.h = Math.max(0.1, Math.min(8.0, val));
      }
      recalculateMetrics();
      rebuildScene();
    });

    sliderH.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      if (state.unit === 'mil') {
        state.h = val * MM_PER_MIL;
      } else {
        state.h = val;
      }
      recalculateMetrics();
      rebuildScene();
    });

    // --- Differential Spacing S Input & Slider Binding ---
    const numS = document.getElementById('num-input-s');
    const sliderS = document.getElementById('slider-s');

    numS.addEventListener('change', () => {
      let val = parseFloat(numS.value);
      if (isNaN(val) || val <= 0) val = state.unit === 'mil' ? 20 : 0.5;
      if (state.unit === 'mil') {
        state.s = Math.max(0.1, Math.min(8.0, val * MM_PER_MIL));
      } else {
        state.s = Math.max(0.1, Math.min(8.0, val));
      }
      recalculateMetrics();
      rebuildScene();
    });

    sliderS.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      if (state.unit === 'mil') {
        state.s = val * MM_PER_MIL;
      } else {
        state.s = val;
      }
      recalculateMetrics();
      rebuildScene();
    });

    // Material Selector
    document.getElementById('select-material').addEventListener('change', e => {
      state.epsR = parseFloat(e.target.value);
      recalculateMetrics();
      rebuildScene();
    });

    // Speed Slider
    document.getElementById('slider-speed').addEventListener('input', e => {
      state.speed = parseFloat(e.target.value);
      document.getElementById('readout-speed').textContent = state.speed.toFixed(1) + 'x';
    });

    // Noise Slider & Toggle
    document.getElementById('slider-noise').addEventListener('input', e => {
      state.noiseAmp = parseFloat(e.target.value);
      document.getElementById('noise-val').textContent = state.noiseAmp.toFixed(2) + ' V';
    });

    document.getElementById('btn-toggle-noise').addEventListener('click', () => {
      state.isNoiseActive = !state.isNoiseActive;
      const btn = document.getElementById('btn-toggle-noise');
      btn.classList.toggle('active', state.isNoiseActive);
      btn.textContent = state.isNoiseActive ? '停止噪声注入' : '开启噪声注入';
    });

    // Checklist checkboxes
    document.getElementById('chk-e-field').addEventListener('change', e => {
      state.showE = e.target.checked;
      togglePill('pill-e-field', state.showE);
      const m = fieldsGroup.getObjectByName('eFieldLines');
      if (m) m.visible = state.showE;
    });

    document.getElementById('chk-h-field').addEventListener('change', e => {
      state.showH = e.target.checked;
      togglePill('pill-h-field', state.showH);
      const m = fieldsGroup.getObjectByName('hFieldLines');
      if (m) m.visible = state.showH;
    });

    document.getElementById('chk-s-poynting').addEventListener('change', e => {
      state.showS = e.target.checked;
      togglePill('pill-s-poynting', state.showS);
      const m = particlesGroup.getObjectByName('poyntingParticles');
      if (m) m.visible = state.showS;
    });

    document.getElementById('chk-return-current').addEventListener('change', e => {
      state.showReturnCurrent = e.target.checked;
      togglePill('pill-return-cur', state.showReturnCurrent);
      returnLines.forEach(l => l.visible = state.showReturnCurrent);
    });

    document.getElementById('chk-electrons').addEventListener('change', e => {
      state.showElectrons = e.target.checked;
      togglePill('pill-electrons', state.showElectrons);
      const m = electronsGroup.getObjectByName('electronParticles');
      if (m) m.visible = state.showElectrons;
    });

    // Pill toggles
    document.getElementById('pill-e-field').addEventListener('click', () => {
      state.showE = !state.showE;
      document.getElementById('chk-e-field').checked = state.showE;
      togglePill('pill-e-field', state.showE);
      const m = fieldsGroup.getObjectByName('eFieldLines');
      if (m) m.visible = state.showE;
    });

    document.getElementById('pill-h-field').addEventListener('click', () => {
      state.showH = !state.showH;
      document.getElementById('chk-h-field').checked = state.showH;
      togglePill('pill-h-field', state.showH);
      const m = fieldsGroup.getObjectByName('hFieldLines');
      if (m) m.visible = state.showH;
    });

    document.getElementById('pill-s-poynting').addEventListener('click', () => {
      state.showS = !state.showS;
      document.getElementById('chk-s-poynting').checked = state.showS;
      togglePill('pill-s-poynting', state.showS);
      const m = particlesGroup.getObjectByName('poyntingParticles');
      if (m) m.visible = state.showS;
    });

    document.getElementById('pill-return-cur').addEventListener('click', () => {
      state.showReturnCurrent = !state.showReturnCurrent;
      document.getElementById('chk-return-current').checked = state.showReturnCurrent;
      togglePill('pill-return-cur', state.showReturnCurrent);
      returnLines.forEach(l => l.visible = state.showReturnCurrent);
    });

    document.getElementById('pill-electrons').addEventListener('click', () => {
      state.showElectrons = !state.showElectrons;
      document.getElementById('chk-electrons').checked = state.showElectrons;
      togglePill('pill-electrons', state.showElectrons);
      const m = electronsGroup.getObjectByName('electronParticles');
      if (m) m.visible = state.showElectrons;
    });

    document.getElementById('pill-trans-dielectric').addEventListener('click', () => {
      state.transDielectric = !state.transDielectric;
      togglePill('pill-trans-dielectric', state.transDielectric);
      if (dielectricMaterial) {
        dielectricMaterial.opacity = state.transDielectric ? 0.22 : 0.85;
        dielectricMaterial.transmission = state.transDielectric ? 0.8 : 0.1;
        dielectricMaterial.depthWrite = !state.transDielectric;
      }
    });

    document.getElementById('pill-pause').addEventListener('click', () => {
      state.isPaused = !state.isPaused;
      const btn = document.getElementById('pill-pause');
      btn.textContent = state.isPaused ? '继续' : '暂停';
      btn.classList.toggle('active', state.isPaused);
    });

    // Modals
    const modal = document.getElementById('physics-modal');
    document.getElementById('btn-physics-info').addEventListener('click', () => {
      modal.style.display = 'flex';
    });
    document.getElementById('btn-close-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.style.display = 'none';
    });

    // 2D Cross Section Panel
    const crossPanel = document.getElementById('cross-section-panel');
    document.getElementById('btn-cross-section').addEventListener('click', () => {
      const isHidden = crossPanel.style.display === 'none';
      crossPanel.style.display = isHidden ? 'block' : 'none';
    });
    document.getElementById('btn-close-cross').addEventListener('click', () => {
      crossPanel.style.display = 'none';
    });
  }

  function togglePill(pillId, active) {
    const el = document.getElementById(pillId);
    if (el) el.classList.toggle('active', active);
  }

  function setMode(newMode) {
    state.mode = newMode;

    const groupS = document.getElementById('group-s');
    const diffNoiseBox = document.getElementById('diff-noise-box');
    const legendElectrons = document.getElementById('legend-electrons');
    const legendE = document.getElementById('legend-e-field');
    const legendH = document.getElementById('legend-h-field');
    const legendS = document.getElementById('legend-s-poynting');

    const pillE = document.getElementById('pill-e-field');
    const pillH = document.getElementById('pill-h-field');
    const pillS = document.getElementById('pill-s-poynting');
    const pillElectrons = document.getElementById('pill-electrons');

    const scopeLegend = document.getElementById('scope-legend');

    if (newMode === 'differential') {
      groupS.style.display = 'flex';
      diffNoiseBox.style.display = 'block';
      legendElectrons.style.display = 'none';
      legendE.style.display = 'flex';
      legendH.style.display = 'flex';
      legendS.style.display = 'flex';

      pillE.style.display = 'inline-block';
      pillH.style.display = 'inline-block';
      pillS.style.display = 'inline-block';
      pillElectrons.style.display = 'none';

      scopeLegend.innerHTML = `
        <span class="legend-chip coral">Line (+) 带噪</span>
        <span class="legend-chip rose">Line (-) 带噪</span>
        <span class="legend-chip gold">差分相减 V_diff (纯净)</span>
      `;
    } else if (newMode === 'single-low') {
      groupS.style.display = 'none';
      diffNoiseBox.style.display = 'none';
      legendElectrons.style.display = 'flex';
      legendE.style.display = 'none';
      legendH.style.display = 'none';
      legendS.style.display = 'none';

      pillE.style.display = 'none';
      pillH.style.display = 'none';
      pillS.style.display = 'none';
      pillElectrons.style.display = 'inline-block';

      scopeLegend.innerHTML = `
        <span class="legend-chip coral">输入电压 V_in</span>
        <span class="legend-chip gold">负载接收 V_out (瞬间同相)</span>
      `;
    } else {
      groupS.style.display = 'none';
      diffNoiseBox.style.display = 'none';
      legendElectrons.style.display = 'none';
      legendE.style.display = 'flex';
      legendH.style.display = 'flex';
      legendS.style.display = 'flex';

      pillE.style.display = 'inline-block';
      pillH.style.display = 'inline-block';
      pillS.style.display = 'inline-block';
      pillElectrons.style.display = 'none';

      scopeLegend.innerHTML = `
        <span class="legend-chip coral">驱动端 V_in</span>
        <span class="legend-chip gold">远端接收 V_out (行波时延)</span>
      `;
    }

    recalculateMetrics();
    rebuildScene();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
