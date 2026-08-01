/**
 * The HUD.
 *
 * DOM overlay rather than in-scene geometry: text stays crisp at any
 * resolution, layout is free, and none of it costs draw calls.
 *
 * Two pieces are specific to this world and worth calling out:
 *
 *   THE MINIMAP IS A STRIP, not a rectangle. The world is a cylinder, so the
 *   map is the ring unrolled: the left and right edges are the same place. The
 *   minimap therefore teaches the topology just by being looked at.
 *
 *   THE RANGE OVERLAY IS LOPSIDED. Artillery reaches roughly four times further
 *   antispinward than spinward, so a range circle would be a lie. The selected
 *   launcher's real reach is drawn as an asymmetric footprint.
 */

import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import { deltaS } from '@core/ringMath';
import {
  BUILDABLE,
  effectiveStructureStats,
  effectiveUnitStats,
  FACTION_COLOR,
  FACTION_NAME,
  Faction,
  STRUCTURES,
  UNITS,
  WEAPONS,
  type StructureKind,
  type UnitKind,
} from '@sim/data';
import type { AbilityId } from '@sim/abilities';
import type { Structure, Unit, World } from '@sim/world';

const CSS = `
.rww-root { position: fixed; inset: 0; pointer-events: none; z-index: 30;
  font-family: 'Rajdhani','Bahnschrift','DIN Alternate','Segoe UI Semibold',system-ui,sans-serif;
  color: #dbe3ec; letter-spacing: 0.04em; user-select: none; }
.rww-panel { background: rgba(8,12,18,0.72); border: 1px solid rgba(150,180,210,0.16);
  backdrop-filter: blur(8px); }

/* Resources */
.rww-top { position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  display: flex; gap: 0; padding: 0; }
.rww-res { padding: 9px 22px; display: flex; align-items: baseline; gap: 9px;
  border-right: 1px solid rgba(150,180,210,0.12); }
.rww-res:last-child { border-right: 0; }
.rww-res b { font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }
.rww-res span { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.24em; opacity: 0.5; }
.rww-warn b { color: #ff7a5e; }

/* Selection + build bar */
.rww-bottom { position: absolute; bottom: 0; left: 0; right: 0;
  display: flex; align-items: flex-end; gap: 10px; padding: 10px; }
.rww-sel { flex: 0 0 auto; min-width: 250px; padding: 10px 14px; }
.rww-sel h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; letter-spacing: 0.1em; }
.rww-sel p { margin: 0; font-size: 11px; opacity: 0.6; line-height: 1.45; max-width: 34ch; }
.rww-sel .rww-hp { margin-top: 7px; height: 3px; background: rgba(255,255,255,0.1); }
.rww-sel .rww-hp i { display: block; height: 100%; background: #6ee7a0; }

.rww-cmds { flex: 1 1 auto; display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-end; }
.rww-btn { pointer-events: auto; cursor: pointer; padding: 7px 11px; min-width: 92px;
  background: rgba(12,17,24,0.8); border: 1px solid rgba(150,180,210,0.18);
  color: #dbe3ec; text-align: left; transition: border-color .12s, background .12s; }
.rww-btn:hover { border-color: rgba(240,130,30,0.75); background: rgba(24,20,14,0.9); }
.rww-btn.off { opacity: 0.32; cursor: not-allowed; }
.rww-btn.on { border-color: #f0821e; background: rgba(50,28,8,0.9); }
.rww-btn u { display: block; font-size: 12px; font-weight: 600;
  text-decoration: none; letter-spacing: 0.06em; }
.rww-btn s { display: block; font-size: 9.5px; opacity: 0.55;
  text-decoration: none; font-variant-numeric: tabular-nums; }
.rww-btn em { position: absolute; margin-left: -9px; margin-top: -2px;
  font-style: normal; font-size: 9px; opacity: 0.7; }

/* Minimap: the ring, unrolled */
.rww-map { position: absolute; bottom: 10px; right: 10px; width: 460px; height: 92px; padding: 6px; }
.rww-map canvas { display: block; width: 100%; height: 100%; pointer-events: auto; cursor: crosshair; }
.rww-maplbl { position: absolute; top: -15px; left: 6px; font-size: 8.5px;
  letter-spacing: 0.26em; text-transform: uppercase; opacity: 0.42; }

/* Alerts + end card */
.rww-alert { position: absolute; top: 74px; left: 50%; transform: translateX(-50%);
  font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase;
  padding: 7px 18px; opacity: 0; transition: opacity .3s; }
.rww-end { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  background: rgba(4,7,11,0.82); backdrop-filter: blur(10px); pointer-events: auto; }
.rww-end h1 { margin: 0; font-size: 54px; font-weight: 600; letter-spacing: 0.24em; }
.rww-end p { margin: 0; font-size: 13px; letter-spacing: 0.2em;
  text-transform: uppercase; opacity: 0.6; }
.rww-end button { pointer-events: auto; margin-top: 14px; cursor: pointer;
  padding: 12px 34px; background: transparent; border: 1px solid rgba(240,130,30,0.7);
  color: #f0821e; letter-spacing: 0.22em; text-transform: uppercase; font-size: 12px; }
.rww-end button:hover { background: rgba(240,130,30,0.14); }

/* Hints */
.rww-hint { position: absolute; left: 12px; bottom: 132px; font-size: 10.5px;
  line-height: 1.85; opacity: 0.4; letter-spacing: 0.08em; }
@media (max-width: 900px) {
  .rww-map { width: min(440px, calc(100vw - 20px)); }
  .rww-bottom { padding-right: min(470px, calc(100vw - 10px)); }
  .rww-sel { min-width: 210px; }
}
@media (max-width: 900px), (max-height: 560px) {
  .rww-top { left: 8px; right: 8px; transform: none; }
  .rww-res { flex: 1; padding: 7px 8px; }
  .rww-res b { font-size: 15px; }
  .rww-res span { display: none; }
  .rww-bottom { padding: 6px; padding-bottom: 108px; flex-wrap: wrap; }
  .rww-sel { min-width: 180px; max-width: 45vw; }
  .rww-cmds { max-height: 104px; overflow-y: auto; }
  .rww-btn { min-width: 78px; padding: 6px 8px; }
  .rww-map { left: 6px; right: 6px; bottom: 6px; width: auto; height: 86px; }
  .rww-hint { display: none; }
}
`;

export type BuildRequest = { kind: StructureKind } | null;

const ARTILLERY_LABEL: Record<string, string> = {
  batteryGun: 'Standard Rocket',
  cruiseMissile: 'Cruise Missile',
  chordShot: 'Chord Shot',
};

const ABILITY_LABEL: Record<AbilityId, string> = {
  shieldWall: 'Shield Wall',
  siegeMode: 'Siege Mode',
  cloak: 'Cloak',
  umbrella: 'Umbrella',
};

export class Hud {
  readonly root: HTMLDivElement;
  /** Structure kind the player is currently placing, if any. */
  placing: StructureKind | null = null;
  /** Set when the player clicks Restart. */
  restartRequested = false;

  private resEl: HTMLDivElement;
  private selEl: HTMLDivElement;
  private cmdEl: HTMLDivElement;
  private alertEl: HTMLDivElement;
  private endEl: HTMLDivElement | null = null;
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private alertTimer = 0;
  private selectionSignature = '';
  private cameraS = 0;
  private cameraZ = 0;

  /** Callback wired by main: jump the camera to a surface position. */
  onMinimapClick: ((s: number, z: number) => void) | null = null;
  /** Begin a ground-targeted artillery command for a selected launcher. */
  onArtilleryTarget: ((sourceId: number, weaponId: string) => void) | null = null;
  /** Toggle the active ability on a single selected mech. */
  onAbilityToggle: ((unitId: number) => void) | null = null;
  /** Route build mode changes through the game mode coordinator. */
  onBuildRequest: ((kind: StructureKind | null) => void) | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('div', 'rww-root');

    const top = el('div', 'rww-top rww-panel');
    this.resEl = top;
    this.root.appendChild(top);

    const bottom = el('div', 'rww-bottom');
    this.selEl = el('div', 'rww-sel rww-panel');
    this.selEl.setAttribute('aria-live', 'polite');
    this.cmdEl = el('div', 'rww-cmds');
    bottom.appendChild(this.selEl);
    bottom.appendChild(this.cmdEl);
    this.root.appendChild(bottom);

    const mapWrap = el('div', 'rww-map rww-panel');
    const lbl = el('div', 'rww-maplbl');
    lbl.textContent = 'ring — antispinward ◀ · ▶ spinward · edges join';
    mapWrap.appendChild(lbl);
    this.map = document.createElement('canvas');
    this.map.width = 900;
    this.map.height = 160;
    this.map.tabIndex = 0;
    this.map.setAttribute('role', 'application');
    this.map.setAttribute('aria-label', 'Ring minimap. Use arrow keys to move the camera.');
    mapWrap.appendChild(this.map);
    this.mapCtx = this.map.getContext('2d')!;
    this.root.appendChild(mapWrap);

    this.map.addEventListener('pointerdown', (e) => {
      const r = this.map.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      this.onMinimapClick?.(fx * RING_CIRCUMFERENCE, (fy - 0.5) * 2 * RING_HALF_WIDTH);
    });
    this.map.addEventListener('keydown', (e) => {
      const stepS = e.shiftKey ? 1_500 : 500;
      const stepZ = e.shiftKey ? 500 : 200;
      if (e.key === 'ArrowLeft') this.cameraS -= stepS;
      else if (e.key === 'ArrowRight') this.cameraS += stepS;
      else if (e.key === 'ArrowUp') this.cameraZ -= stepZ;
      else if (e.key === 'ArrowDown') this.cameraZ += stepZ;
      else return;
      e.preventDefault();
      this.onMinimapClick?.(
        ((this.cameraS % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE,
        Math.max(-RING_HALF_WIDTH, Math.min(RING_HALF_WIDTH, this.cameraZ)),
      );
    });

    this.alertEl = el('div', 'rww-alert rww-panel');
    this.alertEl.setAttribute('role', 'status');
    this.alertEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.alertEl);

    const hint = el('div', 'rww-hint');
    hint.innerHTML =
      'WASD / edge — pan &nbsp;·&nbsp; wheel — zoom &nbsp;·&nbsp; Q E — rotate<br>' +
      'left click — select &nbsp;·&nbsp; drag — box select &nbsp;·&nbsp; right click — move / attack<br>' +
      'V — pilot mech &nbsp;·&nbsp; X — ability &nbsp;·&nbsp; Alt/Ctrl+1..9 — group &nbsp;·&nbsp; esc — cancel / tactical &nbsp;·&nbsp; F3 — stats';
    this.root.appendChild(hint);

    document.body.appendChild(this.root);
  }

  alert(text: string): void {
    this.alertEl.textContent = text;
    this.alertEl.style.opacity = '1';
    this.alertTimer = 2.6;
  }

  invalidate(): void {
    this.selectionSignature = '';
  }

  // -------------------------------------------------------------------------

  update(
    dt: number,
    world: World,
    player: Faction,
    selection: Set<number>,
    cameraS: number,
    cameraZ: number,
  ): void {
    this.cameraS = cameraS;
    this.cameraZ = cameraZ;
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) this.alertEl.style.opacity = '0';
    }

    this.drawResources(world, player);
    this.drawSelection(world, player, selection);
    this.drawMinimap(world, player, cameraS, cameraZ);
    this.drawEnd(world, player);
  }

  private drawResources(world: World, player: Faction): void {
    const p = world.players[player];
    const net = p.energyProduced - p.energyDrawn;
    const brownout = net < 0;

    this.resEl.innerHTML = '';
    const add = (label: string, value: string, warn = false): void => {
      const d = el('div', 'rww-res' + (warn ? ' rww-warn' : ''));
      const b = document.createElement('b');
      b.textContent = value;
      const s = document.createElement('span');
      s.textContent = label;
      d.appendChild(b);
      d.appendChild(s);
      this.resEl.appendChild(d);
    };
    add('salvage', Math.floor(p.salvage).toString());
    add('power', `${net >= 0 ? '+' : ''}${net.toFixed(0)}`, brownout);
    const committedCommand = p.commandUsed + world.queuedCommand(player);
    add('command', `${committedCommand}/${p.commandCap}`, committedCommand >= p.commandCap);

    const mins = Math.floor(world.time / 60);
    const secs = Math.floor(world.time % 60);
    add('clock', `${mins}:${secs.toString().padStart(2, '0')}`);
  }

  private drawSelection(world: World, player: Faction, selection: Set<number>): void {
    const units: Unit[] = [];
    const structs: Structure[] = [];
    for (const id of selection) {
      const u = world.unitById(id);
      if (u) {
        units.push(u);
        continue;
      }
      const st = world.structureById(id);
      if (st) structs.push(st);
    }

    const playerState = world.players[player];
    const signature = [
      [...selection].join(','),
      Math.floor(playerState.salvage / 10),
      playerState.commandUsed,
      playerState.commandCap,
      [...playerState.unlocked].sort().join(','),
      this.placing ?? '',
      units
        .map((unit) =>
          `${unit.id}:${Math.ceil(unit.hp / 25)}:${unit.order.kind}:` +
          `${unit.ability?.active ?? false}:${Math.ceil((unit.ability?.cooldown ?? 0) * 10)}:` +
          `${Math.ceil((unit.ability?.transitionTimer ?? 0) * 10)}`,
        )
        .join('|'),
      structs
        .map((structure) =>
          `${structure.id}:${Math.ceil(structure.hp / 50)}:${Math.ceil(structure.progress * 20)}:` +
          `${structure.progress >= 1 ? 1 : 0}:${structure.queue.length}:` +
          `${structure.cd.map((cooldown) => Math.ceil(cooldown * 10)).join(',')}`,
        )
        .join('|'),
    ].join(';');
    if (signature === this.selectionSignature) return;
    this.selectionSignature = signature;

    this.cmdEl.innerHTML = '';

    if (units.length === 0 && structs.length === 0) {
      this.selEl.innerHTML =
        '<h3>No selection</h3><p>Select an engineer to build, or a foundry to produce units.</p>';
      return;
    }

    // --- Structure selected: show its production options --------------------
    if (structs.length === 1 && units.length === 0) {
      const st = structs[0]!;
      const def = STRUCTURES[st.kind];
      const pct = Math.round((st.hp / st.maxHp) * 100);
      this.selEl.innerHTML =
        `<h3>${def.name}</h3><p>${def.role}</p>` +
        (st.progress < 1
          ? `<p style="opacity:.8;color:#f0b26e">Under construction — ${Math.round(st.progress * 100)}%</p>`
          : '') +
        `<div class="rww-hp"><i style="width:${pct}%"></i></div>`;

      if (st.faction === player && st.progress >= 1 && def.produces) {
        for (const kind of def.produces) {
          this.addUnitButton(world, player, st, kind);
        }
        if (st.queue.length > 0) {
          const q = el('div', 'rww-btn off');
          q.innerHTML = `<u>Queue</u><s>${st.queue.length} pending</s>`;
          this.cmdEl.appendChild(q);
        }
      }
      if (st.faction === player && st.progress >= 1) {
        for (const weaponId of def.weapons) {
          if (WEAPONS[weaponId]?.kind === 'ballistic') this.addArtilleryButton(st, weaponId);
        }
      }
      return;
    }

    // --- Units selected -----------------------------------------------------
    const first = units[0];
    if (first) {
      const def = UNITS[first.kind];
      if (units.length === 1) {
        const pct = Math.round((first.hp / first.maxHp) * 100);
        this.selEl.innerHTML =
          `<h3>${def.name}</h3><p>${def.role}</p>` +
          `<div class="rww-hp"><i style="width:${pct}%;background:${pct > 50 ? '#6ee7a0' : pct > 25 ? '#f0c26e' : '#ff7a5e'}"></i></div>`;
      } else {
        const counts = new Map<UnitKind, number>();
        for (const u of units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
        const list = [...counts.entries()].map(([k, n]) => `${n}× ${UNITS[k].name}`).join(' · ');
        this.selEl.innerHTML = `<h3>${units.length} units</h3><p>${list}</p>`;
      }

      // Engineers get the build bar.
      if (units.some((u) => UNITS[u.kind].canBuild && u.faction === player)) {
        for (const kind of BUILDABLE) this.addBuildButton(world, player, kind);
      }
      if (units.length === 1 && first.faction === player && first.ability && first.ability.id !== 'cloak') {
        this.addAbilityButton(first);
      }
    }
  }

  private addArtilleryButton(st: Structure, weaponId: string): void {
    const weaponIndex = STRUCTURES[st.kind].weapons.indexOf(weaponId);
    if (weaponIndex < 0) return;
    const cooldown = st.cd[weaponIndex] ?? 0;
    const ready = cooldown <= 0;
    const label = ARTILLERY_LABEL[weaponId] ?? WEAPONS[weaponId]!.id;
    const target = button('rww-btn' + (ready ? '' : ' off'));
    target.setAttribute('aria-label', weaponId === 'batteryGun' ? `${label} - Target rocket` : label);
    target.setAttribute('aria-disabled', String(!ready));
    const targetKind = WEAPONS[weaponId]?.flightMode === 'chord' ? 'blind-fire ground target' : 'ground target';
    target.innerHTML = `<u>${label}</u><s>${ready ? targetKind : `${cooldown.toFixed(1)}s reload`}</s>`;
    target.title = 'Preview the ring-physics trajectory, then click to fire';
    target.onclick = (): void => {
      if (ready) this.onArtilleryTarget?.(st.id, weaponId);
      else this.alert(`${label} is reloading`);
    };
    this.cmdEl.appendChild(target);
  }

  private addAbilityButton(unit: Unit): void {
    const ability = unit.ability;
    if (!ability || ability.id === 'cloak') return;
    const label = ABILITY_LABEL[ability.id];
    const transitioning = ability.transitionTimer > 0;
    const coolingDown = !ability.active && ability.cooldown > 0;
    const usable = !transitioning && !coolingDown;
    const state = transitioning
      ? `${ability.active ? 'deploying' : 'stowing'} ${ability.transitionTimer.toFixed(1)}s`
      : ability.active
        ? 'active - press X to disable'
        : coolingDown
          ? `cooldown ${ability.cooldown.toFixed(1)}s`
          : 'ready - press X';
    const control = button(
      'rww-btn' + (usable ? '' : ' off') + (ability.active ? ' on' : ''),
    );
    control.setAttribute('aria-label', `${label} ability`);
    control.setAttribute('aria-pressed', String(ability.active));
    control.setAttribute('aria-disabled', String(!usable));
    control.innerHTML = `<em>X</em><u>${label}</u><s>${state}</s>`;
    control.onclick = (): void => {
      if (transitioning) this.alert(`${label} is transitioning`);
      else if (coolingDown) this.alert(`${label} cooldown: ${ability.cooldown.toFixed(1)}s`);
      else this.onAbilityToggle?.(unit.id);
    };
    this.cmdEl.appendChild(control);
  }

  private addUnitButton(world: World, player: Faction, st: Structure, kind: UnitKind): void {
    const def = UNITS[kind];
    const effective = effectiveUnitStats(player, kind);
    const p = world.players[player];
    const affordable =
      p.salvage >= effective.salvageCost &&
      (!def.cost.command || p.commandUsed + world.queuedCommand(player) + def.cost.command <= p.commandCap);

    const b = button('rww-btn' + (affordable ? '' : ' off'));
    b.innerHTML =
      `<u>${def.name}</u><s>${effective.salvageCost} slv` +
      (def.cost.command ? ` · ${def.cost.command} cmd` : '') +
      `</s>`;
    b.title = def.role;
    b.onclick = (): void => {
      if (!world.tryQueueUnit(st.id, kind)) {
        this.alert(
          p.salvage < effective.salvageCost ? 'Not enough salvage' : 'Command cap reached',
        );
      }
    };
    this.cmdEl.appendChild(b);
  }

  private addBuildButton(world: World, player: Faction, kind: StructureKind): void {
    const def = STRUCTURES[kind];
    const effective = effectiveStructureStats(player, kind);
    const p = world.players[player];

    const locked = Boolean(def.requires && !p.unlocked.has(def.requires));
    const affordable = p.salvage >= effective.salvageCost;
    const usable = affordable && !locked;

    const b = button('rww-btn' + (usable ? '' : ' off') + (this.placing === kind ? ' on' : ''));
    b.innerHTML =
      (def.hotkey ? `<em>${def.hotkey}</em>` : '') +
      `<u>${def.name}</u><s>${effective.salvageCost} slv · ${def.energy >= 0 ? '+' : ''}${def.energy} pwr</s>`;
    b.title = locked ? `${def.role}  (requires ${STRUCTURES[def.requires!].name})` : def.role;
    b.onclick = (): void => {
      if (locked) {
        this.alert(`Requires ${STRUCTURES[def.requires!].name}`);
        return;
      }
      if (!affordable) {
        this.alert('Not enough salvage');
        return;
      }
      this.onBuildRequest?.(this.placing === kind ? null : kind);
    };
    this.cmdEl.appendChild(b);
  }

  /**
   * The minimap: the ring unrolled into a strip.
   *
   * Left and right edges are the same place, which is exactly the property
   * that makes flanking work here, so the map is drawn to make that obvious
   * rather than hiding it behind a conventional square.
   */
  private drawMinimap(world: World, player: Faction, camS: number, camZ: number): void {
    const g = this.mapCtx;
    const W = this.map.width;
    const H = this.map.height;

    g.fillStyle = '#0a0e14';
    g.fillRect(0, 0, W, H);

    const X = (s: number): number => (s / RING_CIRCUMFERENCE) * W;
    const Y = (z: number): number => ((z + RING_HALF_WIDTH) / (RING_HALF_WIDTH * 2)) * H;

    // Shadow-square bands, so the player can see night coming.
    for (let x = 0; x < W; x += 4) {
      const s = (x / W) * RING_CIRCUMFERENCE;
      const light = world.daylightAt(s);
      if (light < 0.98) {
        g.fillStyle = `rgba(10,16,28,${(1 - light) * 0.75})`;
        g.fillRect(x, 0, 4, H);
      }
    }

    // Rim edges.
    g.strokeStyle = 'rgba(150,180,210,0.16)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Deposits.
    for (const d of world.deposits) {
      if (d.amount <= 0) continue;
      g.fillStyle = 'rgba(190,170,110,0.55)';
      g.fillRect(X(d.s) - 1.5, Y(d.z) - 1.5, 3, 3);
    }

    // Structures.
    for (const st of world.structures) {
      if (!st.alive) continue;
      const visible = world.isEntityVisible(player, st.id);
      if (!visible) continue;
      const col =
        st.faction < 0 ? '#9fb0c0' : `#${FACTION_COLOR[st.faction as Faction].toString(16).padStart(6, '0')}`;
      g.fillStyle = col;
      const r = st.kind === 'bastion' ? 5 : st.kind === 'spinalNode' ? 4 : 2.5;
      g.fillRect(X(st.s) - r, Y(st.z) - r, r * 2, r * 2);
    }

    // Units.
    for (const u of world.units) {
      if (!u.alive) continue;
      const visible = world.isEntityVisible(player, u.id);
      if (!visible) continue;
      g.fillStyle = `#${FACTION_COLOR[u.faction].toString(16).padStart(6, '0')}`;
      const r = UNITS[u.kind].isMech ? 2.2 : 1.4;
      g.beginPath();
      g.arc(X(u.s), Y(u.z), r, 0, Math.PI * 2);
      g.fill();
    }

    // Live shells, so incoming fire is visible before it lands.
    for (const pr of world.projectiles) {
      if (!pr.alive || !pr.ballistic) continue;
      if (!world.isProjectileVisible(player, pr)) continue;
      g.fillStyle = '#ffffff';
      g.fillRect(X(pr.p.s) - 1, Y(pr.p.z) - 1, 2, 2);
      g.strokeStyle = 'rgba(255,120,90,0.65)';
      g.beginPath();
      g.arc(X(pr.impactS), Y(pr.impactZ), 4, 0, Math.PI * 2);
      g.stroke();
    }

    // Camera box.
    g.strokeStyle = 'rgba(255,255,255,0.62)';
    g.lineWidth = 1.5;
    const cw = 26;
    const ch = 20;
    g.strokeRect(X(camS) - cw / 2, Y(camZ) - ch / 2, cw, ch);
  }

  private drawEnd(world: World, player: Faction): void {
    if (world.status === 'running') {
      if (this.endEl) {
        this.endEl.remove();
        this.endEl = null;
      }
      return;
    }
    if (this.endEl) return;

    const draw = world.winner === null;
    const won = world.winner === player;
    this.endEl = el('div', 'rww-end');
    this.endEl.setAttribute('role', 'dialog');
    this.endEl.setAttribute('aria-modal', 'true');
    const h = document.createElement('h1');
    h.textContent = draw ? 'Draw' : won ? 'Victory' : 'Defeat';
    h.style.color = draw ? '#dbe3ec' : won ? '#8ce8b0' : '#ff7a5e';
    const p = document.createElement('p');
    p.textContent = draw
      ? world.endReason
      : `${world.endReason} — ${FACTION_NAME[world.winner!]} holds the ring`;
    const b = document.createElement('button');
    b.textContent = 'Fight again';
    b.onclick = (): void => {
      this.restartRequested = true;
    };
    this.endEl.append(h, p, b);
    this.root.appendChild(this.endEl);
    b.focus();
  }
}

function el(tag: string, cls: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  return e;
}

function button(cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  return b;
}

/** Shortest signed screen-space delta, used for minimap camera boxes. */
export function mapDelta(a: number, b: number): number {
  return deltaS(a, b);
}
