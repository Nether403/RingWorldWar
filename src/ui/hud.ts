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
import type { DirectionalReachProfile } from '@sim/ballistics';
import type { BallisticFireResult, Structure, Unit, World } from '@sim/world';
import type { MissionHudModel } from '../tutorial/mission';
import type { MissionDebriefModel } from '../tutorial/mission';

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
.rww-sel .rww-directional-range { margin-top: 6px; opacity: 0.88; font-variant-numeric: tabular-nums; }
.rww-directional-range strong { color: #f0b26e; font-size: 10px; letter-spacing: 0.12em; }
.rww-sel .rww-sensor-range { margin-top: 5px; color: #9fd8ff; opacity: 0.88;
  font-variant-numeric: tabular-nums; text-transform: uppercase; letter-spacing: 0.1em; }
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
.rww-sensor-lbl { position: absolute; top: -15px; right: 6px; font-size: 8.5px;
  letter-spacing: 0.2em; color: #9fd8ff; text-transform: uppercase; }
.rww-target-status { position: absolute; right: 6px; bottom: calc(100% + 5px); max-width: 440px;
  padding: 4px 7px; background: rgba(6,10,15,0.9); border-left: 2px solid #f0b26e;
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; text-align: right; }
.rww-target-status.ready { border-left-color: #6ee7a0; }
.rww-target-status.blocked { border-left-color: #ff8b73; }
.rww-selection-box { position: fixed; display: none; pointer-events: none; z-index: 80;
  box-sizing: border-box; border: 1px solid rgba(186,226,255,0.95);
  background: repeating-linear-gradient(135deg, rgba(125,194,238,0.09) 0 2px, transparent 2px 7px);
  box-shadow: inset 0 0 0 1px rgba(4,10,16,0.9); }

/* Tutorial mission */
.rww-mission { position: absolute; top: 74px; left: 12px; width: min(360px, calc(100vw - 24px));
  max-height: calc(100vh - 86px); overflow-y: auto; box-sizing: border-box; pointer-events: auto;
  padding: 12px 14px 13px; border-left: 2px solid #f0821e; }
.rww-mission[hidden] { display: none; }
.rww-mission-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
  margin-bottom: 7px; font-size: 10px; text-transform: uppercase; letter-spacing: .2em; opacity: .72; }
.rww-mission h2 { margin: 0 0 5px; color: #f0b26e; font-size: 17px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase; }
.rww-mission p { margin: 0; max-width: 45ch; font-size: 12px; line-height: 1.45; opacity: .86; }
.rww-mission .rww-mission-hint { margin-top: 7px; padding-top: 7px;
  border-top: 1px solid rgba(150,180,210,.14); color: #9fd8ff; font-size: 11px; opacity: .78; }
.rww-mission.complete { border-left-color: #6ee7a0; }
.rww-mission.complete h2 { color: #6ee7a0; }
.rww-mission.failed { border-left-color: #ff6f59; }
.rww-mission.failed h2 { color: #ff8b73; }

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
.rww-debrief-rows { display: grid; grid-template-columns: auto auto; gap: 7px 28px;
  min-width: min(420px, calc(100vw - 40px)); padding: 14px 18px;
  border-top: 1px solid rgba(150,180,210,.16); border-bottom: 1px solid rgba(150,180,210,.16); }
.rww-debrief-rows span { font-size: 11px; text-transform: uppercase; letter-spacing: .14em; opacity: .62; }
.rww-debrief-rows b { text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }

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
  .rww-mission { top: 54px; left: 6px; width: min(340px, calc(100vw - 12px));
    max-height: calc(100vh - 60px); }
}
`;

export type BuildRequest = { kind: StructureKind } | null;

const ARTILLERY_LABEL: Record<string, string> = {
  batteryGun: 'Standard Rocket',
  siegeMortar: 'Siege Mortar',
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
  private dismissedDebriefKey = '';
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private targetStatusEl: HTMLDivElement;
  private selectionBoxEl: HTMLDivElement;
  private missionEl: HTMLDivElement;
  private alertTimer = 0;
  private selectionSignature = '';
  private cameraS = 0;
  private cameraZ = 0;
  private lastTargetStatusText = '';
  private lastTargetStatusClass = '';
  private lastTargetStatusHidden = true;
  private missionSignature = '';

  onMinimapPointer: ((s: number, z: number) => void) | null = null;
  onMinimapPrimary: ((s: number, z: number) => void) | null = null;
  onMinimapSecondary: ((s: number, z: number, attackMove: boolean) => void) | null = null;
  onMinimapMove: ((s: number, z: number, attackMove: boolean) => void) | null = null;
  onMinimapCancel: (() => boolean) | null = null;
  onMinimapCamera: ((s: number, z: number) => void) | null = null;
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
    const sensorLabel = el('div', 'rww-sensor-lbl');
    sensorLabel.textContent = 'SENSOR COVERAGE';
    mapWrap.appendChild(sensorLabel);
    this.targetStatusEl = el('div', 'rww-target-status');
    this.targetStatusEl.hidden = true;
    this.targetStatusEl.setAttribute('role', 'status');
    mapWrap.appendChild(this.targetStatusEl);
    this.map = document.createElement('canvas');
    this.map.width = 900;
    this.map.height = 160;
    this.map.tabIndex = 0;
    this.map.setAttribute('role', 'application');
    this.map.setAttribute('aria-label', minimapAriaLabel('Ring minimap with nominal sensor coverage.'));
    mapWrap.appendChild(this.map);
    this.mapCtx = this.map.getContext('2d')!;
    this.root.appendChild(mapWrap);

    this.selectionBoxEl = el('div', 'rww-selection-box');
    this.selectionBoxEl.dataset.selectionRectangle = '';
    this.root.appendChild(this.selectionBoxEl);

    this.missionEl = el('section', 'rww-mission rww-panel');
    this.missionEl.hidden = true;
    this.missionEl.setAttribute('aria-label', 'Current mission objective');
    this.missionEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.missionEl);

    const mapPoint = (e: PointerEvent): { s: number; z: number } => {
      const r = this.map.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      return {
        s: Math.max(0, Math.min(1, fx)) * RING_CIRCUMFERENCE,
        z: (Math.max(0, Math.min(1, fy)) - 0.5) * 2 * RING_HALF_WIDTH,
      };
    };
    this.map.addEventListener('pointermove', (e) => {
      const point = mapPoint(e);
      this.onMinimapPointer?.(point.s, point.z);
    });
    this.map.addEventListener('pointerdown', (e) => {
      const point = mapPoint(e);
      e.preventDefault();
      this.onMinimapPointer?.(point.s, point.z);
      if (e.button === 2) this.onMinimapSecondary?.(point.s, point.z, e.ctrlKey);
      else if (e.button === 0) this.onMinimapPrimary?.(point.s, point.z);
    });
    this.map.addEventListener('contextmenu', (e) => e.preventDefault());
    this.map.addEventListener('keydown', (e) => {
      const stepS = e.shiftKey ? 1_500 : 500;
      const stepZ = e.shiftKey ? 500 : 200;
      if (e.key === 'ArrowLeft') this.cameraS -= stepS;
      else if (e.key === 'ArrowRight') this.cameraS += stepS;
      else if (e.key === 'ArrowUp') this.cameraZ -= stepZ;
      else if (e.key === 'ArrowDown') this.cameraZ += stepZ;
      else if (e.key === 'Enter') this.onMinimapPrimary?.(this.cameraS, this.cameraZ);
      else if (e.code === 'KeyM' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        this.onMinimapMove?.(this.cameraS, this.cameraZ, false);
      } else if (e.code === 'KeyA' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        this.onMinimapMove?.(this.cameraS, this.cameraZ, true);
      } else if (e.key === 'Escape') {
        if (!this.onMinimapCancel?.()) return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key.startsWith('Arrow')) {
        this.cameraS = ((this.cameraS % RING_CIRCUMFERENCE) + RING_CIRCUMFERENCE) % RING_CIRCUMFERENCE;
        this.cameraZ = Math.max(-RING_HALF_WIDTH, Math.min(RING_HALF_WIDTH, this.cameraZ));
        this.onMinimapCamera?.(this.cameraS, this.cameraZ);
      }
    });

    this.alertEl = el('div', 'rww-alert rww-panel');
    this.alertEl.setAttribute('role', 'status');
    this.alertEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.alertEl);

    const hint = el('div', 'rww-hint');
    hint.innerHTML =
      'WASD / edge — pan &nbsp;·&nbsp; wheel — zoom &nbsp;·&nbsp; Q E — rotate<br>' +
      'left click — select &nbsp;·&nbsp; drag — box select &nbsp;·&nbsp; right click — move / attack<br>' +
      'minimap: arrows — focus &nbsp;·&nbsp; Enter — center / fire &nbsp;·&nbsp; M / A — move / attack-move<br>' +
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

  showSelectionRectangle(x0: number, y0: number, x1: number, y1: number): void {
    const left = Math.max(0, Math.min(innerWidth, Math.min(x0, x1)));
    const top = Math.max(0, Math.min(innerHeight, Math.min(y0, y1)));
    const right = Math.max(0, Math.min(innerWidth, Math.max(x0, x1)));
    const bottom = Math.max(0, Math.min(innerHeight, Math.max(y0, y1)));
    this.selectionBoxEl.style.display = 'block';
    this.selectionBoxEl.style.left = `${left}px`;
    this.selectionBoxEl.style.top = `${top}px`;
    this.selectionBoxEl.style.width = `${right - left}px`;
    this.selectionBoxEl.style.height = `${bottom - top}px`;
  }

  hideSelectionRectangle(): void {
    this.selectionBoxEl.style.display = 'none';
  }

  // -------------------------------------------------------------------------

  update(
    dt: number,
    world: World,
    player: Faction,
    selection: Set<number>,
    cameraS: number,
    cameraZ: number,
    artilleryTargeting: boolean,
    artilleryResult: BallisticFireResult | null,
    mission: MissionHudModel | null = null,
    debrief: MissionDebriefModel | null = null,
  ): void {
    this.cameraS = cameraS;
    this.cameraZ = cameraZ;
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) this.alertEl.style.opacity = '0';
    }

    this.drawResources(world, player);
    this.drawSelection(world, player, selection);
    this.drawMinimap(world, player, selection, cameraS, cameraZ, artilleryTargeting, artilleryResult);
    this.drawMission(mission);
    this.drawEnd(world, player, debrief);
  }

  private drawMission(mission: MissionHudModel | null): void {
    const signature = mission ? JSON.stringify(mission) : '';
    if (signature === this.missionSignature) return;
    this.missionSignature = signature;
    this.missionEl.hidden = mission === null;
    if (!mission) return;

    this.missionEl.dataset.missionId = mission.missionId;
    this.missionEl.dataset.missionStatus = mission.status;
    if (mission.objectiveId) this.missionEl.dataset.objectiveId = mission.objectiveId;
    else delete this.missionEl.dataset.objectiveId;
    this.missionEl.classList.toggle('complete', mission.status === 'completed');
    this.missionEl.classList.toggle('failed', mission.status === 'failed');
    this.missionEl.innerHTML = '';

    const head = el('div', 'rww-mission-head');
    const name = document.createElement('span');
    name.textContent = mission.title;
    const progress = document.createElement('span');
    progress.textContent = mission.progressText;
    head.append(name, progress);
    const title = document.createElement('h2');
    title.textContent = mission.objectiveTitle ?? 'Mission complete';
    const body = document.createElement('p');
    body.textContent = mission.objectiveBody ?? 'The forward path is open. The Last Rotation has begun.';
    this.missionEl.append(head, title, body);
    if (mission.hint) {
      const hint = el('p', 'rww-mission-hint');
      hint.textContent = mission.hint;
      this.missionEl.appendChild(hint);
    }
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
      Math.round(world.sensorPowerScale(player) * 1_000),
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
    const directional = this.selectedDirectionalArtillery(world, player, selection);
    const rangeCopy = directional
      ? `<p class="rww-directional-range" data-spinward-range="${directional.profile.spinward.toFixed(0)}" ` +
        `data-antispinward-range="${directional.profile.antispinward.toFixed(0)}">` +
        `◀ ANTISPINWARD ${formatRange(directional.profile.antispinward)} · ` +
        `SPINWARD ${formatRange(directional.profile.spinward)} ▶<br>` +
        `<strong>ANTISPINWARD = LONG SHOT</strong></p>`
      : '';
    const sensorSource = units.length + structs.length === 1 ? units[0] ?? structs[0] : undefined;
    const sensorCopy = sensorSource
      ? this.sensorRangeCopy(world, player, sensorSource)
      : '';

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
        `<h3>${def.name}</h3><p>${def.role}</p>${sensorCopy}${rangeCopy}` +
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
          `<h3>${def.name}</h3><p>${def.role}</p>${sensorCopy}${rangeCopy}` +
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
      if (units.length === 1 && first.faction === player && first.ability?.id === 'siegeMode' &&
          first.ability.active) {
        this.addArtilleryButton(first, 'siegeMortar');
      }
    }
  }

  private sensorRangeCopy(world: World, player: Faction, source: Unit | Structure): string {
    const effective = world.effectiveSensorRange(source.id, player);
    if (effective <= 0) return '';
    const reduction = Math.round((1 - world.sensorPowerScale(player)) * 100);
    return `<p class="rww-sensor-range" data-effective-sensor-range="${effective.toFixed(0)}">` +
      `SENSOR ${formatRange(effective)} EFFECTIVE · POWER REDUCTION ${reduction}%<br>` +
        `NOMINAL RADIUS · EXACT LOS CHECKED SEPARATELY</p>`;
  }

  private addArtilleryButton(source: Structure | Unit, weaponId: string): void {
    const weapons = 'progress' in source ? STRUCTURES[source.kind].weapons : UNITS[source.kind].weapons;
    const weaponIndex = weapons.indexOf(weaponId);
    if (weaponIndex < 0) return;
    const cooldown = source.cd[weaponIndex] ?? 0;
    const ready = cooldown <= 0;
    const label = ARTILLERY_LABEL[weaponId] ?? WEAPONS[weaponId]!.id;
    const target = button('rww-btn' + (ready ? '' : ' off'));
    target.dataset.artilleryWeapon = weaponId;
    target.setAttribute('aria-label', weaponId === 'batteryGun' ? `${label} - Target rocket` : label);
    target.setAttribute('aria-disabled', String(!ready));
    const targetKind = WEAPONS[weaponId]?.flightMode === 'chord' ? 'blind-fire ground target' : 'ground target';
    target.innerHTML = `<u>${label}</u><s>${ready ? targetKind : `${cooldown.toFixed(1)}s reload`}</s>`;
    target.title = 'Preview the ring-physics trajectory, then click to fire';
    target.onclick = (): void => {
      if (ready) this.onArtilleryTarget?.(source.id, weaponId);
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
  private drawMinimap(
    world: World,
    player: Faction,
    selection: Set<number>,
    camS: number,
    camZ: number,
    artilleryTargeting: boolean,
    artilleryResult: BallisticFireResult | null,
  ): void {
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

    this.drawSensorCoverage(g, world, player, X, Y, W, H);

    const directional = this.selectedDirectionalArtillery(world, player, selection);
    if (directional) {
      this.drawDirectionalRangeOverlay(
        g,
        X(directional.source.s),
        Y(directional.source.z),
        directional.profile,
        W,
        H,
      );
    } else {
      delete this.map.dataset.artilleryOverlay;
      delete this.map.dataset.spinwardRange;
      delete this.map.dataset.antispinwardRange;
      delete this.map.dataset.wrapCopies;
      this.map.setAttribute('aria-label', minimapAriaLabel('Ring minimap with nominal sensor coverage.'));
    }

    this.drawTargetStatus(artilleryTargeting, artilleryResult);

    // Rim edges.
    g.strokeStyle = 'rgba(150,180,210,0.16)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Deposits.
    let depositGuidanceCount = 0;
    const placingExtractor = this.placing === 'extractor';
    for (const d of world.deposits) {
      if (!world.isDepositAvailable(d)) continue;
      if (!world.isVisible(player, d.s, d.z)) continue;
      const x = X(d.s);
      const y = Y(d.z);
      if (placingExtractor) {
        g.strokeStyle = 'rgba(255,195,72,0.98)';
        g.lineWidth = 2;
        g.strokeRect(x - 5, y - 5, 10, 10);
        g.fillStyle = 'rgba(255,221,126,0.95)';
        g.fillRect(x - 2, y - 2, 4, 4);
        depositGuidanceCount++;
      } else {
        g.fillStyle = 'rgba(190,170,110,0.55)';
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    if (placingExtractor) this.map.dataset.depositGuidance = String(depositGuidanceCount);
    else delete this.map.dataset.depositGuidance;

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
    let cameraCopies = 0;
    for (const offset of [-W, 0, W]) {
      const left = X(camS) + offset - cw / 2;
      if (left + cw < 0 || left > W) continue;
      g.strokeRect(left, Y(camZ) - ch / 2, cw, ch);
      cameraCopies++;
    }
    this.map.dataset.cameraWrapCopies = String(cameraCopies);
  }

  private drawSensorCoverage(
    g: CanvasRenderingContext2D,
    world: World,
    player: Faction,
    X: (s: number) => number,
    Y: (z: number) => number,
    width: number,
    height: number,
  ): void {
    const sensors: Array<Unit | Structure> = [];
    for (const unit of world.units) {
      if (unit.alive && unit.faction === player && unit.vision > 0) sensors.push(unit);
    }
    for (const structure of world.structures) {
      if (structure.alive && structure.faction === player && structure.progress >= 1 && structure.vision > 0) {
        sensors.push(structure);
      }
    }
    g.fillStyle = 'rgba(1,4,8,0.72)';
    g.fillRect(0, 0, width, height);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.52)';
    for (const sensor of sensors) {
      const range = world.effectiveSensorRange(sensor.id, player);
      const rx = (range / RING_CIRCUMFERENCE) * width;
      const ry = (range / (RING_HALF_WIDTH * 2)) * height;
      for (const offset of [-width, 0, width]) {
        g.beginPath();
        g.ellipse(X(sensor.s) + offset, Y(sensor.z), rx, ry, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
    g.strokeStyle = 'rgba(158,216,255,0.58)';
    g.lineWidth = 1;
    g.setLineDash([5, 4]);
    for (const sensor of sensors) {
      const range = world.effectiveSensorRange(sensor.id, player);
      const rx = (range / RING_CIRCUMFERENCE) * width;
      const ry = (range / (RING_HALF_WIDTH * 2)) * height;
      for (const offset of [-width, 0, width]) {
        g.beginPath();
        g.ellipse(X(sensor.s) + offset, Y(sensor.z), rx, ry, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.setLineDash([]);
    this.map.dataset.sensorCoverage = 'nominal';
    this.map.dataset.sensorCount = String(sensors.length);
  }

  private drawTargetStatus(targeting: boolean, result: BallisticFireResult | null): void {
    let text = '';
    let className = 'rww-target-status';
    if (!targeting) {
      delete this.map.dataset.targetSensorCoverage;
      delete this.map.dataset.targetExactLos;
    } else if (!result) {
      text = 'PREVIEW ONLY · CHECKING TARGET COORDINATES';
      className += ' pending';
      delete this.map.dataset.targetSensorCoverage;
      delete this.map.dataset.targetExactLos;
    } else {
      const nominal = result.sensorCoverage ? 'YES' : 'NO';
      const exact = result.exactLineOfSight ? 'YES' : 'NO';
      this.map.dataset.targetSensorCoverage = String(Boolean(result.sensorCoverage));
      this.map.dataset.targetExactLos = String(Boolean(result.exactLineOfSight));
      text = `${result.ok ? 'READY TO FIRE' : 'PREVIEW ONLY'} · SENSOR COVERAGE: ${nominal} · ` +
        `EXACT LOS: ${exact}${result.ok ? '' : ` · ${ballisticFireMessage(result)}`}`;
      className += result.ok ? ' ready' : ' blocked';
    }
    const hidden = !targeting;
    if (text === this.lastTargetStatusText && className === this.lastTargetStatusClass &&
        hidden === this.lastTargetStatusHidden) return;
    this.lastTargetStatusText = text;
    this.lastTargetStatusClass = className;
    this.lastTargetStatusHidden = hidden;
    this.targetStatusEl.textContent = text;
    this.targetStatusEl.className = className;
    this.targetStatusEl.hidden = hidden;
  }

  private selectedDirectionalArtillery(
    world: World,
    player: Faction,
    selection: Set<number>,
  ): { source: Unit | Structure; weaponId: string; profile: DirectionalReachProfile } | null {
    if (selection.size !== 1) return null;
    const id = selection.values().next().value as number | undefined;
    if (!id) return null;
    const unit = world.unitById(id);
    const structure = unit ? undefined : world.structureById(id);
    const source = unit ?? structure;
    if (!source || source.faction !== player) return null;
    if (unit && !world.canCommandBallistic(unit.id, player, 'siegeMortar')) return null;
    const weapons = unit ? UNITS[unit.kind].weapons : STRUCTURES[structure!.kind].weapons;
    const weaponId = weapons.find((id) => WEAPONS[id]?.kind === 'ballistic' && !WEAPONS[id]?.flightMode);
    if (!weaponId) return null;
    const profile = world.directionalBallisticReach(source.id, player, weaponId);
    return profile ? { source, weaponId, profile } : null;
  }

  private drawDirectionalRangeOverlay(
    g: CanvasRenderingContext2D,
    sourceX: number,
    sourceY: number,
    profile: DirectionalReachProfile,
    width: number,
    height: number,
  ): void {
    const anti = (profile.antispinward / RING_CIRCUMFERENCE) * width;
    const spin = (profile.spinward / RING_CIRCUMFERENCE) * width;
    const half = Math.min(28, Math.max(14, height * 0.16));
    let copies = 0;
    for (const offset of [-width, 0, width]) {
      const x = sourceX + offset;
      if (x + spin < 0 || x - anti > width) continue;
      copies++;
      g.beginPath();
      g.moveTo(x - anti, sourceY);
      g.lineTo(x - anti * 0.72, sourceY - half * 0.55);
      g.lineTo(x, sourceY - half);
      g.lineTo(x + spin * 0.72, sourceY - half * 0.55);
      g.lineTo(x + spin, sourceY);
      g.lineTo(x + spin * 0.72, sourceY + half * 0.55);
      g.lineTo(x, sourceY + half);
      g.lineTo(x - anti * 0.72, sourceY + half * 0.55);
      g.closePath();
      g.fillStyle = 'rgba(240,130,30,0.16)';
      g.fill();
      g.strokeStyle = 'rgba(255,190,105,0.9)';
      g.lineWidth = 2;
      g.setLineDash([8, 4]);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = '#fff0cc';
      g.beginPath();
      g.moveTo(x - 7, sourceY);
      g.lineTo(x + 7, sourceY);
      g.moveTo(x, sourceY - 7);
      g.lineTo(x, sourceY + 7);
      g.stroke();
    }

    g.font = '600 14px Rajdhani, sans-serif';
    g.fillStyle = '#ffd9a3';
    g.textBaseline = 'top';
    g.fillText(`◀ ANTI LONG ${formatRange(profile.antispinward)}`, wrapCanvasX(sourceX - anti + 8, width), 6);
    g.textAlign = 'right';
    g.fillText(`SPIN ${formatRange(profile.spinward)} ▶`, wrapCanvasX(sourceX + spin - 8, width), 6);
    g.textAlign = 'left';

    this.map.dataset.artilleryOverlay = 'directional';
    this.map.dataset.spinwardRange = profile.spinward.toFixed(0);
    this.map.dataset.antispinwardRange = profile.antispinward.toFixed(0);
    this.map.dataset.wrapCopies = String(copies);
    this.map.setAttribute(
      'aria-label',
      minimapAriaLabel(
        `Ring minimap. Directional artillery range: antispinward ${formatRange(profile.antispinward)}, ` +
        `spinward ${formatRange(profile.spinward)}. Antispinward equals long shot.`,
      ),
    );
  }

  private drawEnd(world: World, player: Faction, debrief: MissionDebriefModel | null): void {
    const missionDebrief = world.status === 'running' && debrief?.key !== this.dismissedDebriefKey ? debrief : null;
    if (world.status === 'running' && !missionDebrief) {
      if (this.endEl) {
        this.endEl.remove();
        this.endEl = null;
      }
      return;
    }
    const key = world.status === 'running' ? missionDebrief!.key : `world:${world.status}:${world.endReason}`;
    if (this.endEl?.dataset.debriefKey === key) return;
    this.endEl?.remove();

    const draw = world.winner === null;
    const won = world.winner === player;
    this.endEl = el('div', 'rww-end');
    this.endEl.dataset.debriefKey = key;
    this.endEl.setAttribute('role', 'dialog');
    this.endEl.setAttribute('aria-modal', 'true');
    const h = document.createElement('h1');
    h.textContent = missionDebrief?.title ?? (draw ? 'Draw' : won ? 'Victory' : 'Defeat');
    h.style.color = missionDebrief
      ? missionDebrief.outcome === 'success' ? '#8ce8b0' : '#ff7a5e'
      : draw ? '#dbe3ec' : won ? '#8ce8b0' : '#ff7a5e';
    const p = document.createElement('p');
    p.textContent = missionDebrief?.summary ?? (draw
      ? world.endReason
      : `${world.endReason} — ${FACTION_NAME[world.winner!]} holds the ring`);
    const rows = el('div', 'rww-debrief-rows');
    for (const row of missionDebrief?.rows ?? []) {
      const label = document.createElement('span');
      label.textContent = row.label;
      const value = document.createElement('b');
      value.textContent = row.value;
      rows.append(label, value);
    }
    const b = document.createElement('button');
    b.textContent = missionDebrief ? 'Continue' : 'Fight again';
    b.onclick = (): void => {
      if (missionDebrief) {
        this.dismissedDebriefKey = missionDebrief.key;
        this.endEl?.remove();
        this.endEl = null;
      } else this.restartRequested = true;
    };
    this.endEl.append(h, p);
    if (missionDebrief) this.endEl.appendChild(rows);
    this.endEl.appendChild(b);
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

function formatRange(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

function wrapCanvasX(x: number, width: number): number {
  return ((x % width) + width) % width;
}

export function ballisticFireMessage(result: BallisticFireResult): string {
  switch (result.reason) {
    case 'match-ended': return 'MATCH ENDED';
    case 'invalid-source': return 'INVALID ARTILLERY SOURCE';
    case 'longbow-not-deployed': return 'LONG BOW MUST DEPLOY';
    case 'longbow-transitioning': return 'LONG BOW MUST FINISH DEPLOYING';
    case 'reloading': return `RELOADING — ${(result.remainingSeconds ?? 0).toFixed(1)}s`;
    case 'insufficient-power':
      return `NEED ${formatPower(result.requiredPower)} POWER — ${formatPower(result.availablePower)} AVAILABLE`;
    case 'outside-sensor-range': return 'NO SENSOR COVERAGE';
    case 'sensor-los-blocked': return 'SENSOR LOS BLOCKED';
    case 'no-ballistic-solution': return 'NO VALID TRAJECTORY FROM THIS SIDE';
    case 'success': return 'READY TO FIRE';
  }
}

function minimapAriaLabel(description: string): string {
  return `${description} Arrow keys move camera focus. Enter centers or fires. M moves selected units. ` +
    'A attack-moves selected units. Escape cancels artillery targeting.';
}

function formatPower(value: number | undefined): string {
  const safe = value ?? 0;
  return Number.isInteger(safe) ? safe.toFixed(0) : safe.toFixed(1);
}
