/**
 * Ring World War — Public Website Interactive Engine
 * Handles Interactive Ballistics Simulator, Unit Armory Dossier, First Contact Tutorial, and Navigation.
 */

document.addEventListener('DOMContentLoaded', () => {
  initBallisticsSimulator();
  initUnitArmory();
  initTutorialStepper();
  initNavbarScroll();
});

/* ==========================================================================
   1. Interactive Canvas Ballistics Physics Simulator
   ========================================================================== */
function initBallisticsSimulator() {
  const canvas = document.getElementById('ballisticsCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Controls
  const velocityInput = document.getElementById('simVelocity');
  const angleInput = document.getElementById('simAngle');
  const velVal = document.getElementById('velVal');
  const angleVal = document.getElementById('angleVal');
  const btnSpinward = document.getElementById('btnSpinward');
  const btnAntispinward = document.getElementById('btnAntispinward');
  const chordToggle = document.getElementById('chordToggle');

  const statTime = document.getElementById('simStatTime');
  const statRange = document.getElementById('simStatRange');
  const statAlt = document.getElementById('simStatAlt');

  let spinDirection = 'antispinward'; // 'spinward' or 'antispinward'
  let isChord = false;

  // Ring physical constants (scaled for canvas visualization)
  const R_REAL = 3600; // 3.6 km radius
  const G_CENTRIFUGAL = 6.0; // 6.0 m/s^2
  const V_RING = Math.sqrt(G_CENTRIFUGAL * R_REAL); // ~147 m/s tangential floor velocity

  // Resize canvas dynamically
  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    drawSimulation();
  }
  window.addEventListener('resize', resizeCanvas);

  // Event Listeners
  velocityInput.addEventListener('input', (e) => {
    velVal.textContent = e.target.value;
    drawSimulation();
  });

  angleInput.addEventListener('input', (e) => {
    angleVal.textContent = e.target.value;
    drawSimulation();
  });

  btnSpinward.addEventListener('click', () => {
    spinDirection = 'spinward';
    btnSpinward.classList.add('active');
    btnAntispinward.classList.remove('active');
    drawSimulation();
  });

  btnAntispinward.addEventListener('click', () => {
    spinDirection = 'antispinward';
    btnAntispinward.classList.add('active');
    btnSpinward.classList.remove('active');
    drawSimulation();
  });

  if (chordToggle) {
    chordToggle.addEventListener('change', (e) => {
      isChord = e.target.checked;
      drawSimulation();
    });
  }

  function drawSimulation() {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Center of ring in canvas coords
    const cx = width / 2;
    const cy = height / 2;
    const rCanvas = Math.min(width, height) * 0.42;

    // Draw background outer ring structure
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rCanvas, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.25)';
    ctx.lineWidth = 12;
    ctx.stroke();

    // Draw ring inner surface line
    ctx.beginPath();
    ctx.arc(cx, cy, rCanvas - 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#00f3ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Central Solar Filament
    const filamentGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 25);
    filamentGlow.addColorStop(0, '#ffffff');
    filamentGlow.addColorStop(0.4, '#f59e0b');
    filamentGlow.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.fillStyle = filamentGlow;
    ctx.fill();

    // Launch point at bottom of ring
    const launchAngle = Math.PI / 2; // Bottom of circle
    const launchX = cx + (rCanvas - 6) * Math.cos(launchAngle);
    const launchY = cy + (rCanvas - 6) * Math.sin(launchAngle);

    // Draw Launcher icon
    ctx.fillStyle = '#ff8c00';
    ctx.beginPath();
    ctx.arc(launchX, launchY, 6, 0, Math.PI * 2);
    ctx.fill();

    // Calculate missile trajectory
    const vMuzzle = parseFloat(velocityInput.value); // m/s
    const thetaDeg = parseFloat(angleInput.value); // deg relative to horizon
    const thetaRad = (thetaDeg * Math.PI) / 180;

    // In ring frame:
    // Spinward (+x) adds to tangential spin velocity
    // Antispinward (-x) subtracts from tangential spin velocity
    const dirSign = spinDirection === 'spinward' ? 1 : -1;
    const vxRel = dirSign * vMuzzle * Math.cos(thetaRad);
    const vyRel = -vMuzzle * Math.sin(thetaRad); // Upward toward ring center

    // Convert to rotating frame trajectory points
    const points = [];
    const dt = 0.2; // simulation step size
    let x = 0; // arc distance along surface
    let y = 0; // altitude above surface
    let vx = vxRel;
    let vy = vyRel;

    let time = 0;
    let maxAlt = 0;
    let impactX = 0;

    points.push({ x: launchX, y: launchY });

    for (let t = 0; t < 120; t += dt) {
      time += dt;

      // In rotating reference frame:
      // Coriolis acceleration: a_coriolis = 2 * (omega x v)
      // Centrifugal acceleration: a_centrifugal = omega^2 * (R - y)
      const omega = Math.sqrt(G_CENTRIFUGAL / R_REAL);
      const ax = -2 * omega * vy * dirSign;
      const ay = G_CENTRIFUGAL * (1 - y / R_REAL) + 2 * omega * Math.abs(vx);

      vx += ax * dt;
      vy += ay * dt;

      x += vx * dt;
      y -= vy * dt; // y positive is upward

      if (y > maxAlt) maxAlt = y;

      // Convert (x, y) polar coordinates on ring canvas
      const angleOnRing = launchAngle + (dirSign * x) / (R_REAL * (rCanvas / R_REAL));
      const currentR = rCanvas - 6 - (y / R_REAL) * rCanvas;

      const px = cx + currentR * Math.cos(angleOnRing);
      const py = cy + currentR * Math.sin(angleOnRing);

      points.push({ x: px, y: py });

      // Ground impact check or chord cut through
      if (y <= 0 && t > 0.5) {
        impactX = Math.abs(x);
        break;
      }
      if (isChord && currentR <= 25) {
        // Cut across center
        impactX = Math.abs(x) * 2;
        break;
      }
    }

    // Draw Trajectory Ribbon
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    const strokeColor = spinDirection === 'antispinward' ? '#00f3ff' : '#ff8c00';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.setLineDash(isChord ? [8, 4] : []);
    ctx.stroke();

    // Draw Impact marker
    if (points.length > 0) {
      const last = points[points.length - 1];
      ctx.fillStyle = '#ff0055';
      ctx.beginPath();
      ctx.arc(last.x, last.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing ring
      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Update Stats Display
    statTime.textContent = `${time.toFixed(1)} s`;
    statRange.textContent = `${Math.round(impactX || Math.abs(vMuzzle * time * 0.9))} m`;
    statAlt.textContent = `${Math.round(maxAlt)} m`;
  }

  // Initial draw
  resizeCanvas();
}

/* ==========================================================================
   2. Unit & Structure Armory Dossier
   ========================================================================== */
const UNIT_DATA = [
  {
    id: 'choir-aegis',
    name: 'Aegis Interceptor',
    faction: 'choir',
    factionName: 'Axiom Choir',
    role: 'Mobile Point-Defense Umbrella',
    image: 'assets/units/dossier.choir.aegis.webp',
    hp: 1200,
    speed: 'High',
    range: 'Medium',
    cost: '450 S / 120 E',
    desc: 'Equipped with rapid-cycling interception pulse lasers. Provides a mobile point-defense bubble protecting mech lances from long-range ballistic rockets and cruise missiles.',
    ability: 'Overcharge Shielding: Instantly projects a 100% rocket interception barrier for 6s.'
  },
  {
    id: 'choir-vanguard',
    name: 'Vanguard Mech',
    faction: 'choir',
    factionName: 'Axiom Choir',
    role: 'Fast Assault Vanguard',
    image: 'assets/units/dossier.choir.vanguard.webp',
    hp: 1800,
    speed: 'High',
    range: 'Short',
    cost: '600 S / 150 E',
    desc: 'Sleek composite-plated striker unit. Excels at fast flanking maneuvers around the cylinder map to surprise static siege batteries.',
    ability: 'Plasma Dash: High-speed thruster burst that bypasses enemy chokepoints.'
  },
  {
    id: 'choir-longbow',
    name: 'Longbow Walker',
    faction: 'choir',
    factionName: 'Axiom Choir',
    role: 'Deployable Siege Mortar',
    image: 'assets/units/dossier.choir.longbow.webp',
    hp: 1400,
    speed: 'Medium',
    range: 'Extreme',
    cost: '750 S / 200 E',
    desc: 'Mobile ballistic artillery walker. Deploys into stationary Siege Mode to fire antispinward mortar shells using true simulated Coriolis physics.',
    ability: 'Siege Lock: Anchors legs into ground to double firing range and accuracy.'
  },
  {
    id: 'choir-wisp',
    name: 'Wisp Recon Drone',
    faction: 'choir',
    factionName: 'Axiom Choir',
    role: 'Cloaked Scout & Target Spotter',
    image: 'assets/units/dossier.choir.wisp.webp',
    hp: 450,
    speed: 'Very High',
    range: 'Long Vision',
    cost: '180 S / 50 E',
    desc: 'Ultra-light stealth scout. Cloaks automatically when stationary, providing target designation for over-the-horizon rocket strikes.',
    ability: 'Spinal Paint: Highlights target structures through Fog of War for 15s.'
  },
  {
    id: 'compact-vanguard',
    name: 'Vanguard Heavy Mech',
    faction: 'compact',
    factionName: 'Meridian Compact',
    role: 'Heavy Shield Brawler',
    image: 'assets/units/dossier.compact.vanguard.webp',
    hp: 2400,
    speed: 'Medium',
    range: 'Short-Medium',
    cost: '700 S / 100 E',
    desc: 'Heavy angular-plated combat anchor. Takes direct control (`V` key) to pilot with WASD + mouse torso aim for crushing head-on pushes.',
    ability: 'Bulwark Wall: Deploys heavy frontal armor plates absorbing 80% incoming damage.'
  },
  {
    id: 'compact-bulwark',
    name: 'Bulwark Siege Anchor',
    faction: 'compact',
    factionName: 'Meridian Compact',
    role: 'Fortified Siege Engine',
    image: 'assets/units/dossier.compact.bulwark.webp',
    hp: 3000,
    speed: 'Slow',
    range: 'Long',
    cost: '900 S / 180 E',
    desc: 'Massive armored mobile Bastion escort. Equipped with twin heavy autocannons and reinforced kinetic plating.',
    ability: 'Fortify Stance: Locks down chassis, turning into an impenetrable temporary pillbox.'
  },
  {
    id: 'compact-longbow',
    name: 'Longbow Artillery',
    faction: 'compact',
    factionName: 'Meridian Compact',
    role: 'Kinetic Siege Cannon',
    image: 'assets/units/dossier.compact.longbow.webp',
    hp: 1600,
    speed: 'Slow',
    range: 'Extreme',
    cost: '800 S / 150 E',
    desc: 'Industrial kinetic artillery system designed for sustained antispinward bombardment against enemy Bastions.',
    ability: 'Chord Salvo: Prepares a high-velocity 3-round rocket burst.'
  },
  {
    id: 'compact-wisp',
    name: 'Wisp Scout',
    faction: 'compact',
    factionName: 'Meridian Compact',
    role: 'Recon & Target Spotter',
    image: 'assets/units/dossier.compact.wisp.webp',
    hp: 500,
    speed: 'High',
    range: 'Long Vision',
    cost: '200 S / 40 E',
    desc: 'Rugged scout vehicle equipped with high-gain radar arrays for guiding strategic rocket batteries.',
    ability: 'Radar Ping: Emits a high-frequency sensor pulse revealing enemy stealth units.'
  }
];

function initUnitArmory() {
  const dossierGrid = document.getElementById('dossierGrid');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const modal = document.getElementById('unitModal');
  const modalClose = document.getElementById('modalClose');

  if (!dossierGrid) return;

  function renderUnits(filter = 'all') {
    dossierGrid.innerHTML = '';
    const filtered = filter === 'all' 
      ? UNIT_DATA 
      : UNIT_DATA.filter(u => u.faction === filter);

    filtered.forEach(unit => {
      const card = document.createElement('div');
      card.className = 'glass-panel unit-card';
      card.innerHTML = `
        <div class="unit-img-wrap">
          <img src="${unit.image}" alt="${unit.name}" loading="lazy">
          <span class="unit-faction-badge ${unit.faction}">${unit.factionName}</span>
        </div>
        <div class="unit-body">
          <h3 class="unit-name">${unit.name}</h3>
          <div class="unit-role">${unit.role}</div>
          <div class="unit-stats-mini">
            <div class="stat-item">
              <div class="stat-lbl">HP</div>
              <div class="stat-val">${unit.hp}</div>
            </div>
            <div class="stat-item">
              <div class="stat-lbl">Speed</div>
              <div class="stat-val">${unit.speed}</div>
            </div>
            <div class="stat-item">
              <div class="stat-lbl">Cost</div>
              <div class="stat-val" style="font-size:0.75rem">${unit.cost}</div>
            </div>
          </div>
        </div>
      `;

      card.addEventListener('click', () => openUnitModal(unit));
      dossierGrid.appendChild(card);
    });
  }

  // Tab Switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderUnits(btn.dataset.tab);
    });
  });

  // Modal handlers
  function openUnitModal(unit) {
    if (!modal) return;
    document.getElementById('modalImg').src = unit.image;
    document.getElementById('modalTitle').textContent = unit.name;
    document.getElementById('modalFaction').textContent = unit.factionName;
    document.getElementById('modalFaction').className = `unit-faction-badge ${unit.faction}`;
    document.getElementById('modalRole').textContent = unit.role;
    document.getElementById('modalDesc').textContent = unit.desc;
    document.getElementById('modalAbility').textContent = unit.ability;
    document.getElementById('modalHp').textContent = unit.hp;
    document.getElementById('modalCost').textContent = unit.cost;

    modal.classList.add('active');
  }

  if (modalClose) {
    modalClose.addEventListener('click', () => modal.classList.remove('active'));
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  // Initial render
  renderUnits('all');
}

/* ==========================================================================
   3. First Contact Tutorial Stepper
   ========================================================================== */
const TUTORIAL_STEPS = [
  { step: 1, title: 'Select Engineer Unit', detail: 'Click to select your starting construction Engineer. Engineers are the backbone of fabrication and resource infrastructure.' },
  { step: 2, title: 'Build 2 Solar Arrays', detail: 'Place two Solar Arrays to generate stable baseline Energy (E) upkeep. Energy powers active radar and weapon systems.' },
  { step: 3, title: 'Construct Extractor', detail: 'Build a Scrith Extractor over a nearby ruin deposit. Scrith Salvage (S) is finite per deposit and drives mass unit production.' },
  { step: 4, title: 'Build Fabricator', detail: 'Construct the Fabricator facility to unlock light support vehicles, hauler drones, and technical structures.' },
  { step: 5, title: 'Build Mech Foundry', detail: 'Construct the Mech Foundry to enable fabrication of heavy combat mechs (Vanguard, Longbow, Aegis).' },
  { step: 6, title: 'Produce Wisp Drone', detail: 'Queue a Wisp scout drone from the Fabricator. Fast scouting is required to clear Fog of War for artillery.' },
  { step: 7, title: 'Capture Forward Spinal Node', detail: 'Move your Wisp to capture the forward antispinward Spinal Node tower. Capturing Nodes increases Command Points (C).' },
  { step: 8, title: 'Produce Longbow Walker', detail: 'Fabricate a Longbow artillery walker from the Mech Foundry.' },
  { step: 9, title: 'Deploy Siege Mode', detail: 'Command the Longbow to enter deployed Siege Mode, extending its stabilizers for max antispinward range.' },
  { step: 10, title: 'Antispinward Mortar Strike', detail: 'Fire the mortar antispinward at the Choir power core beyond the node to complete the scenario!' }
];

function initTutorialStepper() {
  const stepItems = document.querySelectorAll('.step-item');
  const heading = document.getElementById('stepHeading');
  const text = document.getElementById('stepDetailText');
  const tag = document.getElementById('stepTag');

  if (!stepItems.length) return;

  stepItems.forEach(item => {
    item.addEventListener('click', () => {
      stepItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const index = parseInt(item.dataset.step) - 1;
      const data = TUTORIAL_STEPS[index];
      if (data) {
        tag.textContent = `OBJECTIVE 0${data.step} / 10`;
        heading.textContent = data.title;
        text.textContent = data.detail;
      }
    });
  });
}

/* ==========================================================================
   4. Navbar Scroll & Active Highlights
   ========================================================================== */
function initNavbarScroll() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');

  window.addEventListener('scroll', () => {
    let current = '';
    const scrollY = window.pageYOffset;

    sections.forEach(section => {
      const sectionTop = section.offsetTop - 120;
      const sectionHeight = section.offsetHeight;
      if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  });
}
