/**
 * Electromagnetic Signal 3D Visualization Lab
 * Three.js Simulation of Microstrip TEM Wave, Poynting Vector, and Differential Coupling
 */

(function () {
  'use strict';

  // --- Configuration & Simulation State ---
  const state = {
    mode: 'single-high', // 'single-high' | 'differential' | 'single-low'
    w: 2.0,              // Trace width in mm
    h: 1.2,              // Substrate height in mm
    s: 0.8,              // Differential spacing in mm
    epsR: 4.4,           // Relative dielectric constant (FR-4 default)
    speed: 1.5,          // Wave propagation speed multiplier
    noiseAmp: 0.4,       // Common-mode noise amplitude (V)
    isNoiseActive: true, // Toggle noise injection in diff mode
    isPaused: false,     // Pause animation

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
    delayPsInch: 154.2,
    zDiff: 88.6,
    couplingK: 0.22,

    // Time counters
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
  const POYNTING_COUNT = 900;
  let poyntingParticles = null;
  let poyntingPositions = null;
  let poyntingVelocities = null;

  // Electron Drift Particles (Low speed)
  const ELECTRON_COUNT = 350;
  let electronParticles = null;
  let electronPositions = null;
  let electronJitter = null;

  // Return Current Lines / Ribbons
  let returnLines = [];

  // Wave physics constants
  const BOARD_LENGTH = 32.0; // Z span: -16 to +16
  const BOARD_WIDTH = 22.0;  // X span: -11 to +11
  const SCALE_FACTOR = 2.2;  // mm to 3D units

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

    // Check URL parameters for direct mode linking
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam && ['single-high', 'differential', 'single-low'].includes(modeParam)) {
      document.querySelectorAll('.mode-tab').forEach(t => {
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
    scene.background = new THREE.Color(0x0b0f19);
    scene.fog = new THREE.FogExp2(0x0b0f19, 0.015);

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
    controls.maxPolarAngle = Math.PI / 2 + 0.08; // Allow slight under-angle view
    controls.minDistance = 8;
    controls.maxDistance = 80;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight1.position.set(20, 30, 20);
    dirLight1.castShadow = true;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.4);
    dirLight2.position.set(-20, 15, -20);
    scene.add(dirLight2);

    // Grid Floor
    const gridHelper = new THREE.GridHelper(50, 50, 0x1e293b, 0x111827);
    gridHelper.position.y = -0.05;
    scene.add(gridHelper);

    // Root groups
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
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === preset);
    });

    if (!camera) return;

    if (preset === 'isometric') {
      camera.position.set(20, 16, 26);
      if (controls) controls.target.set(0, 1.5, 0);
    } else if (preset === 'front') {
      // Direct cross section view down the Z axis
      camera.position.set(0, 3, 30);
      if (controls) controls.target.set(0, 2, 0);
    } else if (preset === 'side') {
      // Side view showing dielectric corridor propagation
      camera.position.set(28, 4, 0);
      if (controls) controls.target.set(0, 2, 0);
    } else if (preset === 'top') {
      // Top down view showing return current spreading
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

    // Phase velocity (fraction of c, and cm/ns)
    const vpFraction = 1 / Math.sqrt(epsEff);
    state.velocityRatio = vpFraction;

    // Delay in ps/inch (c ~ 11.8 inch/ns => 84.72 ps/inch in vacuum)
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
      document.querySelector('#card-z0 .metric-label').innerHTML = '差分特征阻抗 <span class="math-sub">Z_diff</span>';
      valZ0.textContent = state.zDiff.toFixed(1);

      labelExtra.innerHTML = '差分耦合系数 <span class="math-sub">k</span>';
      valExtra.textContent = (state.couplingK * 100).toFixed(1);
      unitExtra.textContent = '%';
    } else if (state.mode === 'single-low') {
      document.querySelector('#card-z0 .metric-label').innerHTML = '微带线特征阻抗 <span class="math-sub">Z₀</span>';
      valZ0.textContent = state.z0.toFixed(1);

      labelExtra.innerHTML = '电路理论模型';
      valExtra.textContent = 'λ ≫ L';
      unitExtra.textContent = '(集总无时延)';
    } else {
      document.querySelector('#card-z0 .metric-label').innerHTML = '微带线特征阻抗 <span class="math-sub">Z₀</span>';
      valZ0.textContent = state.z0.toFixed(1);

      labelExtra.innerHTML = '每英寸走线延迟 <span class="math-sub">T_pd</span>';
      valExtra.textContent = state.delayPsInch.toFixed(1);
      unitExtra.textContent = 'ps/inch';
    }

    valEpsEff.textContent = state.epsEff.toFixed(2);
    valWh.textContent = state.whRatio.toFixed(2);
    valVelocity.textContent = state.velocityRatio.toFixed(2);

    // Sliders readouts
    document.getElementById('readout-w').textContent = state.w.toFixed(1);
    document.getElementById('readout-h').textContent = state.h.toFixed(1);
    document.getElementById('readout-s').textContent = state.s.toFixed(1);
    document.getElementById('readout-speed').textContent = state.speed.toFixed(1);

    // Text explainer card updates
    const title = document.getElementById('current-mode-title');
    const desc = document.getElementById('current-mode-desc');
    const tipBadge = document.getElementById('tip-badge');
    const tipContent = document.getElementById('tip-content');

    if (state.mode === 'single-high') {
      title.textContent = '微带线（Microstrip）电磁场与坡印廷能量流 3D 可视化';
      desc.textContent = '实时观察高频传输线介质层中的电场 (E)、磁场 (H) 架构与电磁能量 (S) 传播过程';
      tipBadge.textContent = '关键电磁物理本质：能量在介质中冲刺';
      tipContent.innerHTML = '<strong>信号不是在铜线里流，而是在绝缘介质中跑！</strong><br>良导体铜线内部电场 <i>E</i> ≈ 0，因此铜线内部坡印廷能流 <i>S</i> = <i>E</i> × <i>H</i> ≈ 0。绝大部分能量由铜线构成的“波导护栏”死死约束在 FR-4 介质走廊中向前高速传输！';
    } else if (state.mode === 'differential') {
      title.textContent = '高速差分对（Differential Pair）奇模耦合与抗噪可视化';
      desc.textContent = '观察双线对称奇模电磁场横向耦合、远场辐射自抵消与共模噪声抑制机理 (CMRR)';
      tipBadge.textContent = '抗噪本质：差分相减与远场相消';
      tipContent.innerHTML = '<strong>差分走线间的横向电场直接互相锁定！</strong><br>两根线携带相反相位的信号电流，在远场空间激发的磁场相互反向对消，对外辐射极低；外部共模噪声同时入侵时，接收端相减 (<i>V</i><sub>+</sub> − <i>V</i><sub>−</sub>) 瞬间清除噪声！';
    } else {
      title.textContent = '单端低速信号（集总参数模型 / 传统电路理论）';
      desc.textContent = '观察低频下电子在铜线内的缓慢漂移碰撞，以及回流在整个地平面的大面积扩散';
      tipBadge.textContent = '传统水流视角：电子极慢漂移与全地漫延';
      tipContent.innerHTML = '<strong>低频下信号波长远大于导线物理长度 (λ ≫ L)</strong><br>导线内部自由电子做剧烈的无规则热碰撞运动，并在驱动电压下以微米每秒级极慢定向漂移；返回电流走欧姆电阻最小路径，在整个地平面广域扩散！';
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

  // --- Board, Dielectric & Copper Traces ---
  function buildBoardGeometry() {
    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const s3d = state.s * SCALE_FACTOR;
    const traceThick = 0.22;

    // 1. Dielectric Substrate (FR-4)
    const dielectricGeo = new THREE.BoxGeometry(BOARD_WIDTH, h3d, BOARD_LENGTH);
    dielectricMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: state.transDielectric ? 0.28 : 0.82,
      roughness: 0.15,
      metalness: 0.05,
      transmission: state.transDielectric ? 0.75 : 0.1,
      ior: 1.5,
      depthWrite: !state.transDielectric
    });
    dielectricMesh = new THREE.Mesh(dielectricGeo, dielectricMaterial);
    dielectricMesh.position.set(0, h3d / 2, 0);
    dielectricMesh.receiveShadow = true;
    boardGroup.add(dielectricMesh);

    // Dielectric border outline
    const edges = new THREE.EdgesGeometry(dielectricGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x059669, transparent: true, opacity: 0.4 });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    dielectricMesh.add(wireframe);

    // 2. Ground Plane (GND at bottom, Y = 0)
    const groundGeo = new THREE.BoxGeometry(BOARD_WIDTH, 0.12, BOARD_LENGTH);
    groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.35
    });
    groundMesh = new THREE.Mesh(groundGeo, groundMaterial);
    groundMesh.position.set(0, -0.06, 0);
    groundMesh.receiveShadow = true;
    boardGroup.add(groundMesh);

    // 3. Copper Signal Trace(s)
    copperMaterial = new THREE.MeshStandardMaterial({
      color: 0xe07a5f,
      metalness: 0.8,
      roughness: 0.25
    });

    if (state.mode === 'differential') {
      // Differential Pair: Trace+ and Trace-
      const traceGeo = new THREE.BoxGeometry(w3d, traceThick, BOARD_LENGTH);

      // Left trace (TX+)
      traceMesh1 = new THREE.Mesh(traceGeo, copperMaterial.clone());
      traceMesh1.material.color.setHex(0xe07a5f);
      const x1 = -(s3d / 2 + w3d / 2);
      traceMesh1.position.set(x1, h3d + traceThick / 2, 0);
      traceMesh1.castShadow = true;
      boardGroup.add(traceMesh1);

      // Right trace (TX-)
      traceMesh2 = new THREE.Mesh(traceGeo, copperMaterial.clone());
      traceMesh2.material.color.setHex(0xd97706);
      const x2 = +(s3d / 2 + w3d / 2);
      traceMesh2.position.set(x2, h3d + traceThick / 2, 0);
      traceMesh2.castShadow = true;
      boardGroup.add(traceMesh2);
    } else {
      // Single-Ended Trace
      const traceGeo = new THREE.BoxGeometry(w3d, traceThick, BOARD_LENGTH);
      traceMesh1 = new THREE.Mesh(traceGeo, copperMaterial);
      traceMesh1.position.set(0, h3d + traceThick / 2, 0);
      traceMesh1.castShadow = true;
      boardGroup.add(traceMesh1);
      traceMesh2 = null;
    }
  }

  // --- Electromagnetic Field Lines Generation ---
  function buildFieldLines() {
    if (state.mode === 'single-low') {
      // Low speed: quasi-static, minimal EM field visualization to emphasize lumped perspective
      return;
    }

    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const s3d = state.s * SCALE_FACTOR;

    const zCount = 14; // Number of cross-sectional slices along Z
    const zStep = (BOARD_LENGTH - 4) / (zCount - 1);

    if (state.mode === 'single-high') {
      buildSingleHighFields(h3d, w3d, zCount, zStep);
    } else if (state.mode === 'differential') {
      buildDifferentialFields(h3d, w3d, s3d, zCount, zStep);
    }
  }

  // Single-Ended High-Speed Fields
  function buildSingleHighFields(h3d, w3d, zCount, zStep) {
    const eLinesMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });

    const hLinesMat = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    const ePositions = [];
    const hPositions = [];

    for (let i = 0; i < zCount; i++) {
      const z = -BOARD_LENGTH / 2 + 2 + i * zStep;

      // --- Electric Field Lines E ---
      // 1. Direct vertical lines under the trace
      const numUnder = 7;
      for (let j = 0; j < numUnder; j++) {
        const x = -w3d / 2 + (j / (numUnder - 1)) * w3d;
        // From trace bottom to ground
        ePositions.push(x, h3d, z);
        ePositions.push(x, 0, z);
      }

      // 2. Fringing fields on left and right edges (curved arcs)
      const numFringe = 4;
      for (let j = 1; j <= numFringe; j++) {
        const factor = j / numFringe;
        const xOffset = factor * 2.4;
        const bulge = factor * 1.5;

        // Left fringe arc (from left edge of trace curving out and down to GND)
        const leftCurve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-w3d / 2, h3d * 0.9, z),
          new THREE.Vector3(-w3d / 2 - bulge, h3d * 0.5, z),
          new THREE.Vector3(-w3d / 2 - xOffset, 0, z)
        );
        const leftPts = leftCurve.getPoints(10);
        for (let k = 0; k < leftPts.length - 1; k++) {
          ePositions.push(leftPts[k].x, leftPts[k].y, leftPts[k].z);
          ePositions.push(leftPts[k + 1].x, leftPts[k + 1].y, leftPts[k + 1].z);
        }

        // Right fringe arc
        const rightCurve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(w3d / 2, h3d * 0.9, z),
          new THREE.Vector3(w3d / 2 + bulge, h3d * 0.5, z),
          new THREE.Vector3(w3d / 2 + xOffset, 0, z)
        );
        const rightPts = rightCurve.getPoints(10);
        for (let k = 0; k < rightPts.length - 1; k++) {
          ePositions.push(rightPts[k].x, rightPts[k].y, rightPts[k].z);
          ePositions.push(rightPts[k + 1].x, rightPts[k + 1].y, rightPts[k + 1].z);
        }
      }

      // --- Magnetic Field Loops H ---
      // Closed loops enclosing the trace
      const loopCount = 3;
      for (let l = 1; l <= loopCount; l++) {
        const radiusX = (w3d / 2) + l * 0.9;
        const radiusY = (h3d / 2) + l * 0.65;
        const centerY = h3d / 2 + 0.1;

        const loopPts = 32;
        for (let p = 0; p < loopPts; p++) {
          const theta1 = (p / loopPts) * Math.PI * 2;
          const theta2 = ((p + 1) / loopPts) * Math.PI * 2;

          const x1 = Math.cos(theta1) * radiusX;
          const y1 = Math.max(0.05, centerY + Math.sin(theta1) * radiusY);

          const x2 = Math.cos(theta2) * radiusX;
          const y2 = Math.max(0.05, centerY + Math.sin(theta2) * radiusY);

          hPositions.push(x1, y1, z);
          hPositions.push(x2, y2, z);
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

  // Differential High-Speed Fields
  function buildDifferentialFields(h3d, w3d, s3d, zCount, zStep) {
    const eLinesMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending
    });

    const hLinesMat = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    const ePositions = [];
    const hPositions = [];

    const xLeft = -(s3d / 2 + w3d / 2);
    const xRight = +(s3d / 2 + w3d / 2);

    for (let i = 0; i < zCount; i++) {
      const z = -BOARD_LENGTH / 2 + 2 + i * zStep;

      // 1. Differential E-Field across the gap between the two traces! (Odd Mode)
      const numInterTrace = 6;
      for (let j = 0; j < numInterTrace; j++) {
        const yFrac = 0.2 + (j / (numInterTrace - 1)) * 0.8;
        const yStart = h3d * yFrac;
        // Arc bridging Trace+ to Trace-
        const bridgeCurve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(xLeft + w3d / 2, yStart, z),
          new THREE.Vector3(0, yStart + 0.4, z),
          new THREE.Vector3(xRight - w3d / 2, yStart, z)
        );
        const pts = bridgeCurve.getPoints(8);
        for (let k = 0; k < pts.length - 1; k++) {
          ePositions.push(pts[k].x, pts[k].y, pts[k].z);
          ePositions.push(pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
        }
      }

      // 2. Direct vertical E-lines to GND under both traces
      const numUnder = 4;
      for (let j = 0; j < numUnder; j++) {
        const uLeft = xLeft - w3d / 2 + (j / (numUnder - 1)) * w3d;
        ePositions.push(uLeft, h3d, z);
        ePositions.push(uLeft, 0, z);

        const uRight = xRight - w3d / 2 + (j / (numUnder - 1)) * w3d;
        ePositions.push(uRight, h3d, z);
        ePositions.push(uRight, 0, z);
      }

      // 3. Magnetic Field Loops H: Counter-circulating loops!
      // Trace+ has clockwise loop, Trace- has counter-clockwise loop.
      // Notice in the center gap, both point in the same direction! In the far field, they cancel!
      const loopCount = 2;
      for (let l = 1; l <= loopCount; l++) {
        const radX = (w3d / 2) + l * 0.6;
        const radY = (h3d / 2) + l * 0.5;
        const centerY = h3d / 2 + 0.1;
        const loopPts = 24;

        // Trace+ (left) loop
        for (let p = 0; p < loopPts; p++) {
          const t1 = (p / loopPts) * Math.PI * 2;
          const t2 = ((p + 1) / loopPts) * Math.PI * 2;
          hPositions.push(xLeft + Math.cos(t1) * radX, Math.max(0.05, centerY + Math.sin(t1) * radY), z);
          hPositions.push(xLeft + Math.cos(t2) * radX, Math.max(0.05, centerY + Math.sin(t2) * radY), z);
        }

        // Trace- (right) loop
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

  // --- Poynting Energy Flow Particles (High-Speed & Differential) ---
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
        // Particles strictly located in dielectric and adjacent fringe, NEVER inside the conductor!
        const r = Math.random();
        if (r < 0.7) {
          // In dielectric directly below trace: 0 < Y < h3d, -W/2 < X < W/2
          x = (Math.random() - 0.5) * (w3d * 1.2);
          y = Math.random() * h3d * 0.95 + 0.05;
        } else {
          // Fringe region on sides
          const side = Math.random() < 0.5 ? -1 : 1;
          x = side * (w3d / 2 + Math.random() * 2.5);
          y = Math.random() * (h3d * 1.2) + 0.05;
        }
      } else {
        // Differential Mode: High density in the gap between traces and underneath traces
        const r = Math.random();
        if (r < 0.45) {
          // In the dielectric gap between Trace+ and Trace-
          x = (Math.random() - 0.5) * s3d;
          y = Math.random() * h3d * 1.1 + 0.05;
        } else if (r < 0.8) {
          // Underneath one of the traces
          const which = Math.random() < 0.5 ? -1 : 1;
          const center = which * (s3d / 2 + w3d / 2);
          x = center + (Math.random() - 0.5) * w3d;
          y = Math.random() * h3d * 0.95 + 0.05;
        } else {
          // Outer fringe
          const which = Math.random() < 0.5 ? -1 : 1;
          const center = which * (s3d / 2 + w3d / 2);
          x = center + which * (w3d / 2 + Math.random() * 2.0);
          y = Math.random() * h3d + 0.05;
        }
      }

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      velocities[i] = 1.0 + Math.random() * 0.4;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Particle Material with luminous texture
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#fbbf24');
    grad.addColorStop(0.8, 'rgba(245, 158, 11, 0.4)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      color: 0xfffbeb,
      size: 0.75,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    poyntingParticles = new THREE.Points(geometry, material);
    poyntingParticles.name = 'poyntingParticles';
    poyntingParticles.visible = state.showS;
    particlesGroup.add(poyntingParticles);

    poyntingPositions = positions;
    poyntingVelocities = velocities;
  }

  // --- Electron Particles (Low-Speed Lumped Model) ---
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
      // Confined strictly INSIDE the copper trace
      const x = (Math.random() - 0.5) * (w3d * 0.9);
      const y = h3d + Math.random() * traceThick;
      const z = (Math.random() - 0.5) * BOARD_LENGTH;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      jitters[i * 3 + 0] = (Math.random() - 0.5) * 0.05;
      jitters[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
      jitters[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#60a5fa');
    grad.addColorStop(1, 'rgba(96, 165, 250, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.65,
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

  // --- Return Current Visuals on Ground Plane ---
  function buildReturnCurrentVisuals() {
    returnLines = [];
    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const s3d = state.s * SCALE_FACTOR;

    const yGnd = 0.04; // Slightly above ground plane surface

    if (state.mode === 'single-low') {
      // Low frequency DC: Spreads widely across the entire ground plane (minimum resistance path)
      const lineCount = 20;
      const positions = [];

      for (let i = 0; i < lineCount; i++) {
        const u = (i / (lineCount - 1)) * 2 - 1; // -1 to +1
        const xSpan = u * (BOARD_WIDTH * 0.42); // Wide spreading

        // Curving path on GND from wide to wide
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
          color: 0xa855f7,
          transparent: true,
          opacity: 0.55
        })
      );
      mat.visible = state.showReturnCurrent;
      returnCurrentGroup.add(mat);
      returnLines.push(mat);

    } else if (state.mode === 'single-high') {
      // High frequency: Return current is tightly confined directly under the trace!
      // (Minimum loop inductance min omega*L)
      const stripWidth = w3d + h3d * 0.8;
      const positions = [];
      const numLines = 14;

      for (let i = 0; i < numLines; i++) {
        const frac = i / (numLines - 1);
        const x = -stripWidth / 2 + frac * stripWidth;
        // Cosine density profile
        const opacity = Math.cos(frac * Math.PI - Math.PI / 2);

        positions.push(x, yGnd, -BOARD_LENGTH / 2 + 1);
        positions.push(x, yGnd, BOARD_LENGTH / 2 - 1);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xc084fc,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending
        })
      );
      mat.visible = state.showReturnCurrent;
      returnCurrentGroup.add(mat);
      returnLines.push(mat);

    } else if (state.mode === 'differential') {
      // Differential Pair: Two equal and opposite return streams that cancel in the center!
      const xLeft = -(s3d / 2 + w3d / 2);
      const xRight = +(s3d / 2 + w3d / 2);
      const positions = [];
      const numPerTrace = 7;

      for (let i = 0; i < numPerTrace; i++) {
        const frac = i / (numPerTrace - 1);
        const offset = (frac - 0.5) * w3d * 1.2;

        // Under left trace
        positions.push(xLeft + offset, yGnd, -BOARD_LENGTH / 2 + 1);
        positions.push(xLeft + offset, yGnd, BOARD_LENGTH / 2 - 1);

        // Under right trace
        positions.push(xRight + offset, yGnd, -BOARD_LENGTH / 2 + 1);
        positions.push(xRight + offset, yGnd, BOARD_LENGTH / 2 - 1);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xc084fc,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending
        })
      );
      mat.visible = state.showReturnCurrent;
      returnCurrentGroup.add(mat);
      returnLines.push(mat);
    }
  }

  // ==========================================================================
  // Animation Loop & Real-Time Physics Updates
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

  // Animate dynamic wave front on field lines
  function updateFieldAnimations() {
    const eMesh = fieldsGroup.getObjectByName('eFieldLines');
    const hMesh = fieldsGroup.getObjectByName('hFieldLines');

    if (eMesh && eMesh.material) {
      // Pulse wave intensity
      const pulse = 0.55 + 0.25 * Math.sin(state.simTime * 4.0);
      eMesh.material.opacity = pulse;
    }

    if (hMesh && hMesh.material) {
      const pulse = 0.6 + 0.2 * Math.cos(state.simTime * 4.0);
      hMesh.material.opacity = pulse;
    }
  }

  // Update Poynting Particles flowing down the transmission corridor
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

  // Update Electron Drift inside conductor
  function updateElectronDrift() {
    if (!electronParticles || !electronPositions) return;

    const count = ELECTRON_COUNT;
    const driftSpeed = 0.04 * state.speed; // Very slow drift compared to EM wave
    const h3d = state.h * SCALE_FACTOR;
    const w3d = state.w * SCALE_FACTOR;
    const traceThick = 0.22;

    for (let i = 0; i < count; i++) {
      if (!state.isPaused) {
        // 1. Slow macro drift
        let z = electronPositions[i * 3 + 2] + driftSpeed;
        if (z > BOARD_LENGTH / 2) z = -BOARD_LENGTH / 2;

        // 2. High-speed microscopic Brownian thermal jitter
        let x = electronPositions[i * 3 + 0] + (Math.random() - 0.5) * 0.035;
        let y = electronPositions[i * 3 + 1] + (Math.random() - 0.5) * 0.015;

        // Keep inside copper boundary
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
  // Real-Time Oscilloscope / Signal Eye-Diagram Monitor
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

    // Clear background
    scopeCtx.fillStyle = '#060911';
    scopeCtx.fillRect(0, 0, w, h);

    // Grid lines
    scopeCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    scopeCtx.lineWidth = 1;
    scopeCtx.setLineDash([2, 4]);

    for (let x = 30; x < w; x += 30) {
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

    // Zero center line
    const cy = h / 2;
    scopeCtx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    scopeCtx.beginPath();
    scopeCtx.moveTo(0, cy);
    scopeCtx.lineTo(w, cy);
    scopeCtx.stroke();

    const t = state.simTime * 3.5;

    if (state.mode === 'differential') {
      // Differential Mode: Trace+ (Blue), Trace- (Red), Diff Out (Green)
      const noise = state.isNoiseActive ? state.noiseAmp : 0;

      // 1. Draw TX+ (Signal + Noise)
      scopeCtx.strokeStyle = '#60a5fa';
      scopeCtx.lineWidth = 1.5;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = Math.sin(phi);
        const n = noise * (Math.sin(phi * 4.3) + Math.cos(phi * 7.1) * 0.5);
        const val = sig + n;
        const y = cy - val * 26;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

      // 2. Draw TX- (Inverted Signal + Same Common Mode Noise!)
      scopeCtx.strokeStyle = '#f87171';
      scopeCtx.lineWidth = 1.5;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = -Math.sin(phi); // Inverted phase
        const n = noise * (Math.sin(phi * 4.3) + Math.cos(phi * 7.1) * 0.5); // Identical noise
        const val = sig + n;
        const y = cy - val * 26;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

      // 3. Draw Diff Out = (TX+ - TX-) / 2 => PURE CLEAN SIGNAL!
      scopeCtx.strokeStyle = '#34d399';
      scopeCtx.lineWidth = 2.5;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = Math.sin(phi); // Perfectly clean reconstructed
        const y = cy - sig * 34;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

    } else {
      // Single-Ended High vs Low
      // Input signal
      scopeCtx.strokeStyle = '#60a5fa';
      scopeCtx.lineWidth = 1.5;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6;
        const sig = Math.sin(phi);
        const y = cy - sig * 32;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();

      // Receiver signal
      // High speed: shows phase delay due to dielectric propagation
      // Low speed: almost zero phase delay
      const phaseDelay = state.mode === 'single-high' ? 1.8 : 0.08;

      scopeCtx.strokeStyle = '#34d399';
      scopeCtx.lineWidth = 2.0;
      scopeCtx.beginPath();
      for (let x = 0; x < w; x++) {
        const phi = t - (x / w) * 6 - phaseDelay;
        const sig = Math.sin(phi);
        const y = cy - sig * 32;
        if (x === 0) scopeCtx.moveTo(x, y);
        else scopeCtx.lineTo(x, y);
      }
      scopeCtx.stroke();
    }
  }

  // ==========================================================================
  // 2D Cross Section Diagram Canvas
  // ==========================================================================
  function render2DCrossSection() {
    const crossPanel = document.getElementById('cross-section-panel');
    if (crossPanel.style.display === 'none' || !crossCtx) return;

    const w = crossCanvas.width;
    const h = crossCanvas.height;

    crossCtx.fillStyle = '#080c16';
    crossCtx.fillRect(0, 0, w, h);

    const centerX = w / 2;
    const groundY = h - 35;
    const subH = Math.min(80, state.h * 32);
    const traceY = groundY - subH;
    const traceW = Math.min(100, state.w * 25);
    const traceH = 8;

    // 1. Draw Dielectric Substrate Box
    crossCtx.fillStyle = 'rgba(16, 185, 129, 0.18)';
    crossCtx.fillRect(20, traceY, w - 40, subH);
    crossCtx.strokeStyle = '#10b981';
    crossCtx.lineWidth = 1;
    crossCtx.strokeRect(20, traceY, w - 40, subH);

    // 2. Draw Ground Plane
    crossCtx.fillStyle = '#475569';
    crossCtx.fillRect(15, groundY, w - 30, 8);
    crossCtx.fillStyle = '#94a3b8';
    crossCtx.font = '10px monospace';
    crossCtx.fillText('GND 参考地平面', 24, groundY + 22);

    if (state.mode === 'differential') {
      // Differential Pair: Two traces
      const spacing = Math.min(60, state.s * 25);
      const x1 = centerX - spacing / 2 - traceW;
      const x2 = centerX + spacing / 2;

      // Trace +
      crossCtx.fillStyle = '#e07a5f';
      crossCtx.fillRect(x1, traceY - traceH, traceW, traceH);
      crossCtx.fillStyle = '#fff';
      crossCtx.font = '10px sans-serif';
      crossCtx.fillText('Line (+)', x1 + 4, traceY - traceH - 4);

      // Trace -
      crossCtx.fillStyle = '#d97706';
      crossCtx.fillRect(x2, traceY - traceH, traceW, traceH);
      crossCtx.fillText('Line (-)', x2 + 4, traceY - traceH - 4);

      // Inter-trace E-field arrows
      crossCtx.strokeStyle = '#38bdf8';
      crossCtx.lineWidth = 1.5;
      for (let y = traceY - traceH / 2; y <= traceY + subH * 0.4; y += 12) {
        crossCtx.beginPath();
        crossCtx.moveTo(x1 + traceW, y);
        crossCtx.lineTo(x2, y);
        crossCtx.stroke();
      }

    } else {
      // Single Trace
      const xTrace = centerX - traceW / 2;
      crossCtx.fillStyle = '#e07a5f';
      crossCtx.fillRect(xTrace, traceY - traceH, traceW, traceH);
      crossCtx.fillStyle = '#fff';
      crossCtx.font = '10px sans-serif';
      crossCtx.fillText('信号铜线', xTrace + traceW / 2 - 18, traceY - traceH - 4);

      // Vertical E-field lines
      crossCtx.strokeStyle = '#38bdf8';
      crossCtx.lineWidth = 1.2;
      for (let x = xTrace + 8; x <= xTrace + traceW - 8; x += 12) {
        crossCtx.beginPath();
        crossCtx.moveTo(x, traceY);
        crossCtx.lineTo(x, groundY);
        crossCtx.stroke();
      }

      // Magnetic H-field loop (ellipse)
      crossCtx.strokeStyle = '#34d399';
      crossCtx.lineWidth = 1.5;
      crossCtx.beginPath();
      crossCtx.ellipse(centerX, traceY + subH / 2, traceW / 2 + 18, subH / 2 + 14, 0, 0, Math.PI * 2);
      crossCtx.stroke();
    }
  }

  // ==========================================================================
  // UI Event Handlers & Control Binding
  // ==========================================================================
  function setupUI() {
    // Mode switcher buttons
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        setMode(tab.dataset.mode);
      });
    });

    // View Presets
    document.querySelectorAll('.preset-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyCameraPreset(btn.dataset.view);
      });
    });

    document.getElementById('btn-reset-cam').addEventListener('click', () => {
      applyCameraPreset('isometric');
    });

    // Checkboxes in Legend
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
      returnLines.forEach(l => l.visible = state.showReturnCurrent);
    });

    document.getElementById('chk-electrons').addEventListener('change', e => {
      state.showElectrons = e.target.checked;
      const m = electronsGroup.getObjectByName('electronParticles');
      if (m) m.visible = state.showElectrons;
    });

    // Action Pills (matching screenshot buttons)
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
        dielectricMaterial.opacity = state.transDielectric ? 0.28 : 0.85;
        dielectricMaterial.transmission = state.transDielectric ? 0.75 : 0.1;
        dielectricMaterial.depthWrite = !state.transDielectric;
      }
    });

    document.getElementById('pill-pause').addEventListener('click', () => {
      state.isPaused = !state.isPaused;
      const btn = document.getElementById('pill-pause');
      btn.textContent = state.isPaused ? '继续动画' : '暂停动画';
      btn.classList.toggle('active', state.isPaused);
    });

    // Sliders
    document.getElementById('slider-w').addEventListener('input', e => {
      state.w = parseFloat(e.target.value);
      recalculateMetrics();
      rebuildScene();
    });

    document.getElementById('slider-h').addEventListener('input', e => {
      state.h = parseFloat(e.target.value);
      recalculateMetrics();
      rebuildScene();
    });

    document.getElementById('slider-s').addEventListener('input', e => {
      state.s = parseFloat(e.target.value);
      recalculateMetrics();
      rebuildScene();
    });

    document.getElementById('slider-speed').addEventListener('input', e => {
      state.speed = parseFloat(e.target.value);
      document.getElementById('readout-speed').textContent = state.speed.toFixed(1);
    });

    document.getElementById('select-material').addEventListener('change', e => {
      state.epsR = parseFloat(e.target.value);
      const text = e.target.options[e.target.selectedIndex].text;
      document.getElementById('readout-material').textContent = text.split(' ')[0] + ` (${state.epsR})`;
      recalculateMetrics();
      rebuildScene();
    });

    // Differential Noise Injection
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

    // 2D Cross Section Panel Toggle
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

  // Set simulation mode
  function setMode(newMode) {
    state.mode = newMode;

    const groupS = document.getElementById('group-s');
    const diffNoiseBox = document.getElementById('diff-noise-box');
    const legendElectrons = document.getElementById('legend-electrons');
    const legendE = document.getElementById('legend-e-field');
    const legendH = document.getElementById('legend-h-field');
    const legendS = document.getElementById('legend-s-poynting');

    const scopeLegend = document.getElementById('scope-legend');

    const pillE = document.getElementById('pill-e-field');
    const pillH = document.getElementById('pill-h-field');
    const pillS = document.getElementById('pill-s-poynting');
    const pillElectrons = document.getElementById('pill-electrons');

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
        <span class="scope-tag tag-blue">Line (+) 带噪</span>
        <span class="scope-tag tag-red">Line (-) 带噪</span>
        <span class="scope-tag tag-green">差分相减 V_diff (纯净)</span>
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
        <span class="scope-tag tag-blue">输入电压 V_in</span>
        <span class="scope-tag tag-green">负载接收 V_out (瞬间同相)</span>
      `;
    } else {
      // single-high
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
        <span class="scope-tag tag-blue">驱动端信号 V_in</span>
        <span class="scope-tag tag-green">远端接收 V_out (时延与行波)</span>
      `;
    }

    recalculateMetrics();
    rebuildScene();
  }

  // Run on page load
  window.addEventListener('DOMContentLoaded', init);
})();
