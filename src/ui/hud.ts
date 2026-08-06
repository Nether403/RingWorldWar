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
  canFactionFieldUnit,
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
import type { BallisticFireResult, SimEvent, Structure, Unit, World } from '@sim/world';
import type { MissionHudModel } from '../tutorial/mission';
import type { MissionDebriefModel } from '../tutorial/mission';
import type { NarrativeHudModel } from '../tutorial/narrative';
import { PRESENTATION_MEDIA, type PresentationMedia } from '../presentation/media';

const CSS = `
.rww-root { position: fixed; inset: 0; pointer-events: none; z-index: 30;
  font-family: 'Rajdhani','Bahnschrift','DIN Alternate','Segoe UI Semibold',system-ui,sans-serif;
  color: #dbe3ec; letter-spacing: 0.04em; user-select: none;
  --hud-line: rgba(159,192,218,.22); --hud-dark: rgba(7,11,16,.88); --hud-amber:#f0a052; }
.rww-panel { background: linear-gradient(180deg, rgba(12,18,25,.9), rgba(6,10,15,.82));
  border: 1px solid var(--hud-line); box-shadow: inset 0 1px rgba(255,255,255,.025), 0 5px 24px rgba(0,0,0,.18); }
.rww-panel::before { content:''; position:absolute; left:0; top:0; width:26px; height:1px; background:#f0821e; }

/* Resources */
.rww-top { position: absolute; top: max(8px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  display: flex; gap: 0; padding: 0; clip-path: polygon(8px 0,calc(100% - 8px) 0,100% 100%,0 100%); }
.rww-res { padding: 9px 22px; display: flex; align-items: baseline; gap: 9px;
  border-right: 1px solid rgba(150,180,210,0.12); }
.rww-res:last-child { border-right: 0; }
.rww-res b { font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }
.rww-res span { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.24em; opacity: 0.5; }
.rww-warn b { color: #ff7a5e; }
.rww-warn span::before { content:'! '; color:#ff8b73; }

/* Selection + build bar */
.rww-bottom { position: absolute; bottom: max(8px, env(safe-area-inset-bottom)); left: 8px; right: 486px;
  display: grid; grid-template-columns: minmax(250px, 300px) 1fr; align-items: end; gap: 8px; }
.rww-sel { min-width: 0; padding: 11px 14px 12px; position:relative; display:flow-root;
  border-left:2px solid rgba(240,130,30,.72); }
.rww-eyebrow { margin-bottom:4px; color:#9fd8ff; font-size:9px; letter-spacing:.2em; text-transform:uppercase; }
.rww-sel h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; letter-spacing: 0.1em; }
.rww-sel p { margin: 0; font-size: 11px; opacity: 0.6; line-height: 1.45; max-width: 34ch; }
.rww-sel .rww-directional-range { margin-top: 6px; opacity: 0.88; font-variant-numeric: tabular-nums; }
.rww-directional-range strong { color: #f0b26e; font-size: 10px; letter-spacing: 0.12em; }
.rww-sel .rww-sensor-range { margin-top: 5px; color: #9fd8ff; opacity: 0.88;
  font-variant-numeric: tabular-nums; text-transform: uppercase; letter-spacing: 0.1em; }
.rww-sel .rww-hp { margin-top: 7px; height: 3px; background: rgba(255,255,255,0.1); }
.rww-sel .rww-hp i { display: block; height: 100%; background: #6ee7a0; }
.rww-hp-row { display:flex; justify-content:space-between; margin-top:7px; font-size:9px; text-transform:uppercase; opacity:.68; }
.rww-order { margin-top:5px!important; color:#f0b26e; text-transform:uppercase; letter-spacing:.12em; }
.rww-dossier { display:block; float:right; width:clamp(58px,7vw,86px); aspect-ratio:4/5; margin:0 0 8px 12px;
  border:1px solid rgba(159,216,255,.24); object-fit:cover; background:rgba(3,7,11,.72); }

.rww-cmds { display: flex; flex-wrap: wrap; gap: 5px; align-content: flex-end; padding-bottom:1px; }
.rww-btn { pointer-events: auto; cursor: pointer; padding: 7px 11px; min-width: 92px;
  min-height:44px; position:relative; background: rgba(10,15,21,.92); border: 1px solid rgba(150,180,210,0.22);
  color: #dbe3ec; text-align: left; transition: border-color .12s, background .12s; }
.rww-btn:hover { border-color: rgba(240,130,30,0.75); background: rgba(24,20,14,0.9); }
.rww-btn.off { opacity: 0.32; cursor: not-allowed; }
.rww-btn.on { border-color: #f0821e; background: rgba(50,28,8,0.9); }
.rww-btn:focus-visible, .rww-map canvas:focus-visible, .rww-narrative button:focus-visible,
.rww-end button:focus-visible { outline:2px solid #9fd8ff; outline-offset:2px; }
.rww-btn u { display: block; font-size: 12px; font-weight: 600;
  text-decoration: none; letter-spacing: 0.06em; }
.rww-btn s { display: block; font-size: 9.5px; opacity: 0.55;
  text-decoration: none; font-variant-numeric: tabular-nums; }
.rww-btn em { position: absolute; margin-left: -9px; margin-top: -2px;
  font-style: normal; font-size: 9px; opacity: 0.7; }
.rww-btn.rww-with-dossier { min-height:54px; padding-left:54px; }
.rww-btn .rww-command-dossier { position:absolute; left:7px; top:7px; width:38px; height:38px; aspect-ratio:1;
  border:1px solid rgba(159,216,255,.18); object-fit:cover; background:rgba(3,7,11,.72); }
.rww-queue-status { align-self:stretch; padding:7px 10px; border:1px dashed rgba(159,216,255,.25);
  color:#9fd8ff; font-size:9px; text-transform:uppercase; letter-spacing:.12em; }

/* Minimap: the ring, unrolled */
.rww-map { position: absolute; bottom: max(8px, env(safe-area-inset-bottom)); right: 8px; width: 462px; height: 102px; padding: 7px; }
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
.rww-map-legend { position:absolute; left:8px; bottom:4px; display:flex; gap:10px; font-size:7px;
  text-transform:uppercase; letter-spacing:.11em; opacity:.55; pointer-events:none; }
.rww-map.targeting { border-color:rgba(240,178,110,.72); box-shadow:0 0 0 1px rgba(240,130,30,.18); }
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
.rww-mode { position:absolute; top:52px; left:50%; transform:translateX(-50%); min-width:260px;
  padding:5px 14px; text-align:center; color:#9fd8ff; border-top:1px solid rgba(159,216,255,.32);
  font-size:9px; letter-spacing:.22em; text-transform:uppercase; opacity:.86; }
.rww-command-ack { position:absolute; left:50%; top:108px; transform:translateX(-50%);
  padding:5px 12px; color:#f0b26e; background:rgba(6,10,15,.78); border-bottom:1px solid #f0821e;
  font-size:9px; letter-spacing:.18em; text-transform:uppercase; opacity:0; transition:opacity .14s; }
.rww-event-rail { position:absolute; right:8px; bottom:126px; width:300px; display:grid; gap:3px; }
.rww-event-item { padding:5px 8px; background:rgba(6,10,15,.78); border-left:2px solid rgba(159,216,255,.45);
  font-size:9px; letter-spacing:.11em; text-transform:uppercase; animation:rww-event-in .18s ease-out; }
@keyframes rww-event-in { from { opacity:0; transform:translateX(8px) } }
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
.rww-narrative { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  width: min(620px, calc(100vw - 32px)); padding: 22px 26px; pointer-events: auto;
  max-height:calc(100vh - 16px); overflow:auto; box-sizing:border-box;
  border-left: 3px solid #f0821e; background: rgba(7,11,17,.94); }
.rww-narrative.transmission { top: 94px; transform: translateX(-50%); width: min(520px, calc(100vw - 32px)); }
.rww-narrative small { display: block; margin-bottom: 7px; text-transform: uppercase;
  letter-spacing: .22em; opacity: .62; }
.rww-narrative h2 { margin: 0 0 10px; color: #f0b26e; text-transform: uppercase; letter-spacing: .12em; }
.rww-narrative p { margin: 0; line-height: 1.55; font-size: 14px; }
.rww-narrative button { margin-top: 18px; padding: 9px 22px; color: #f0b26e; background: transparent;
  border: 1px solid rgba(240,130,30,.7); text-transform: uppercase; letter-spacing: .16em; cursor: pointer; }
.rww-narrative.has-portrait { display:grid; grid-template-columns:minmax(110px,28%) 1fr; gap:20px; align-items:start; }
.rww-narrative-portrait { display:block; width:100%; aspect-ratio:4/5; border:1px solid rgba(159,216,255,.24);
  object-fit:cover; background:rgba(3,7,11,.72); }

/* Toggleable controls reference */
.rww-help-toggle { position:absolute; top:max(10px,env(safe-area-inset-top)); right:10px; pointer-events:auto;
  min-height:34px; padding:6px 10px; color:#9fd8ff; background:rgba(7,11,16,.82);
  border:1px solid rgba(159,216,255,.28); font:600 9px/1 inherit; letter-spacing:.16em;
  text-transform:uppercase; cursor:pointer; }
.rww-help-toggle:hover,.rww-help-toggle:focus-visible { border-color:#9fd8ff; outline:2px solid rgba(159,216,255,.45); outline-offset:2px; }
.rww-hint { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(520px,calc(100vw - 24px));
  max-height:calc(100vh - 24px); overflow:auto; box-sizing:border-box; padding:18px 20px; pointer-events:auto;
  font-size:11px; line-height:1.5; letter-spacing:.06em; }
.rww-hint[hidden] { display:none; }
.rww-hint h2 { margin:0 0 12px; color:#f0b26e; font-size:16px; letter-spacing:.18em; text-transform:uppercase; }
.rww-help-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px 18px; }
.rww-help-grid span { display:flex; justify-content:space-between; gap:12px; padding-bottom:5px;
  border-bottom:1px solid rgba(159,192,218,.12); }
.rww-help-grid kbd { color:#9fd8ff; font:600 10px/1.4 inherit; white-space:nowrap; }
.rww-hint button { margin-top:14px; padding:7px 14px; color:#f0b26e; background:transparent;
  border:1px solid rgba(240,130,30,.55); text-transform:uppercase; letter-spacing:.14em; cursor:pointer; }
@media (max-width: 900px) {
  .rww-map { width: min(440px, calc(100vw - 20px)); }
  .rww-bottom { right:8px; bottom:108px; grid-template-columns:minmax(180px, 42vw) 1fr; }
  .rww-sel { min-width: 210px; }
}
@media (max-width: 900px), (max-height: 560px) {
  .rww-top { left: 8px; right: 8px; transform: none; }
  .rww-res { flex: 1; padding: 7px 8px; }
  .rww-res b { font-size: 15px; }
  .rww-res span { display: none; }
  .rww-bottom { left:6px; right:6px; bottom:102px; display:flex; flex-wrap:wrap; }
  .rww-sel { min-width: 180px; max-width: 45vw; }
  .rww-cmds { max-height: 104px; overflow-y: auto; }
  .rww-btn { min-width: 78px; padding: 6px 8px; }
  .rww-map { left: 6px; right: 6px; bottom: 6px; width: auto; height: 86px; }
  .rww-alert { top:92px; }
  .rww-command-ack { top:122px; }
  .rww-event-rail { display:grid; top:150px; bottom:auto; left:50%; right:auto; transform:translateX(-50%);
    width:min(420px,calc(100vw - 12px)); overflow:hidden; }
  .rww-bottom { max-height:calc(100vh - 158px); overflow-y:auto; }
  .rww-help-toggle { top:54px; right:6px; }
  .rww-help-grid { grid-template-columns:1fr; }
  .rww-mission { top: 228px; left: 6px; width: min(340px, calc(100vw - 12px));
    max-height: calc(100vh - 234px); }
}
@media (max-height:480px) {
  .rww-mode { display:none; }
  .rww-help-toggle { top:48px; right:6px; }
  .rww-alert { top:82px; max-width:calc(100vw - 12px); padding:5px 8px; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis; box-sizing:border-box; }
  .rww-command-ack { top:112px; }
  .rww-event-rail { top:140px; left:auto; right:6px; transform:none; width:min(220px,calc(100vw - 12px)); }
  .rww-mission { top:140px; left:6px; width:calc(100vw - 238px); max-height:68px; }
  .rww-bottom { bottom:92px; max-height:100px; }
}
@media (max-height:240px) {
  .rww-alert,.rww-command-ack,.rww-event-rail,.rww-mode { display:none; }
  .rww-top { right:48px; }
  .rww-help-toggle { display:block; top:8px; right:6px; width:36px; min-width:36px; min-height:34px;
    padding:0; overflow:hidden; font-size:0; }
  .rww-help-toggle::after { content:'F1'; font-size:9px; }
  .rww-mission { top:46px; left:4px; width:calc(100vw - 8px); max-height:calc(100vh - 52px); }
  .rww-bottom { display:none; }
  .rww-map { opacity:.72; }
  .rww-hint { inset:4px; transform:none; width:auto; max-height:calc(100vh - 8px); padding:9px 12px; }
  .rww-narrative,.rww-narrative.transmission { inset:4px; transform:none; width:auto;
    max-height:calc(100vh - 8px); padding:10px 14px; }
}
@media (prefers-reduced-motion: reduce) { .rww-root *, .rww-root *::before { animation:none!important; transition:none!important; } }
@media (forced-colors: active) { .rww-panel,.rww-btn { border:1px solid CanvasText; } .rww-btn.off { opacity:.7; } }
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
  private readonly style: HTMLStyleElement;
  /** Structure kind the player is currently placing, if any. */
  placing: StructureKind | null = null;
  /** Set when the player clicks Restart. */
  restartRequested = false;

  private readonly resourceNodes = new Map<string, { root: HTMLDivElement; value: HTMLElement }>();
  private selEl: HTMLDivElement;
  private cmdEl: HTMLDivElement;
  private alertEl: HTMLDivElement;
  private endEl: HTMLDivElement | null = null;
  private dismissedDebriefKey = '';
  private narrativeEl: HTMLDivElement | null = null;
  private narrativeSignature = '';
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private targetStatusEl: HTMLDivElement;
  private mapWrap: HTMLDivElement;
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
  private modeEl: HTMLDivElement;
  private commandAckEl: HTMLDivElement;
  private commandAckTimer = 0;
  private eventRailEl: HTMLDivElement;
  private recentEvents: Array<{ key: string; text: string; ttl: number }> = [];
  private directControlMode = false;
  private blockingOverlay = false;
  private previousModalFocus: HTMLElement | null = null;
  private helpEl: HTMLDivElement;
  private helpToggleEl: HTMLButtonElement;

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
  onNarrativeAcknowledge: (() => void) | null = null;
  onBlockingOverlayChange: ((blocked: boolean) => void) | null = null;

  get blocksGameplayInput(): boolean {
    return this.blockingOverlay;
  }

  get controlsOpen(): boolean {
    return !this.helpEl.hidden;
  }

  constructor(
    private readonly playerFaction: Faction = Faction.Compact,
    private readonly media: PresentationMedia = PRESENTATION_MEDIA,
  ) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);

    this.root = el('div', 'rww-root');

    const top = el('div', 'rww-top rww-panel');
    for (const key of ['salvage', 'power', 'command', 'clock']) {
      const root = el('div', 'rww-res');
      root.dataset.resource = key;
      const value = document.createElement('b');
      const label = document.createElement('span');
      label.textContent = key;
      root.append(value, label);
      this.resourceNodes.set(key, { root, value });
      top.appendChild(root);
    }
    this.root.appendChild(top);

    const bottom = el('div', 'rww-bottom');
    this.selEl = el('div', 'rww-sel rww-panel');
    this.selEl.setAttribute('aria-live', 'polite');
    this.cmdEl = el('div', 'rww-cmds');
    bottom.appendChild(this.selEl);
    bottom.appendChild(this.cmdEl);
    this.root.appendChild(bottom);

    const mapWrap = el('div', 'rww-map rww-panel');
    this.mapWrap = mapWrap;
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
    const mapLegend = el('div', 'rww-map-legend');
    mapLegend.innerHTML = '<span>● friendly</span><span>◆ hostile</span><span>□ camera</span><span>○ sensor</span>';
    mapWrap.appendChild(mapLegend);
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
      if (this.directControlMode || this.blockingOverlay) return;
      const point = mapPoint(e);
      e.preventDefault();
      this.onMinimapPointer?.(point.s, point.z);
      if (e.button === 2) this.onMinimapSecondary?.(point.s, point.z, e.ctrlKey);
      else if (e.button === 0) this.onMinimapPrimary?.(point.s, point.z);
    });
    this.map.addEventListener('contextmenu', (e) => e.preventDefault());
    this.map.addEventListener('keydown', (e) => {
      if (this.directControlMode || this.blockingOverlay) return;
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

    this.modeEl = el('div', 'rww-mode');
    this.modeEl.textContent = 'Tactical command';
    this.root.appendChild(this.modeEl);
    this.commandAckEl = el('div', 'rww-command-ack');
    this.commandAckEl.setAttribute('role', 'status');
    this.commandAckEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.commandAckEl);
    this.eventRailEl = el('div', 'rww-event-rail');
    this.eventRailEl.setAttribute('aria-label', 'Recent battlefield events');
    this.root.appendChild(this.eventRailEl);

    this.helpToggleEl = button('rww-help-toggle');
    this.helpToggleEl.textContent = 'F1 Controls';
    this.helpToggleEl.setAttribute('aria-expanded', 'false');
    this.helpToggleEl.setAttribute('aria-controls', 'rww-controls-reference');
    this.helpToggleEl.onclick = (): void => this.toggleControls();
    this.root.appendChild(this.helpToggleEl);

    this.helpEl = el('section', 'rww-hint rww-panel');
    this.helpEl.id = 'rww-controls-reference';
    this.helpEl.hidden = true;
    this.helpEl.setAttribute('role', 'dialog');
    this.helpEl.setAttribute('aria-label', 'Game controls');
    this.helpEl.innerHTML =
      '<h2>Command Reference</h2><div class="rww-help-grid">' +
      '<span><b>Pan camera</b><kbd>WASD / arrows / edge</kbd></span>' +
      '<span><b>Zoom</b><kbd>Wheel / R F</kbd></span>' +
      '<span><b>Rotate camera</b><kbd>Q E / MMB / Shift+RMB</kbd></span>' +
      '<span><b>Select</b><kbd>Left click / drag</kbd></span>' +
      '<span><b>Move / attack</b><kbd>Right click</kbd></span>' +
      '<span><b>Ability</b><kbd>X</kbd></span>' +
      '<span><b>Pilot mech</b><kbd>V</kbd></span>' +
      '<span><b>Control groups</b><kbd>Alt/Ctrl + 1–9</kbd></span>' +
      '<span><b>Minimap focus</b><kbd>Arrows / Enter</kbd></span>' +
      '<span><b>Minimap orders</b><kbd>M / A</kbd></span>' +
      '<span><b>Settings / cancel</b><kbd>Esc</kbd></span>' +
      '<span><b>Performance</b><kbd>F3</kbd></span></div>';
    const closeHelp = button('rww-help-close');
    closeHelp.textContent = 'Close';
    closeHelp.onclick = (): void => this.toggleControls(false);
    this.helpEl.appendChild(closeHelp);
    this.root.appendChild(this.helpEl);

    document.body.appendChild(this.root);
  }

  alert(text: string): void {
    this.alertEl.textContent = text;
    this.alertEl.style.opacity = '1';
    this.alertTimer = 2.6;
  }

  toggleControls(force?: boolean): void {
    const open = force ?? this.helpEl.hidden;
    if (open && this.blockingOverlay) return;
    this.helpEl.hidden = !open;
    this.helpToggleEl.setAttribute('aria-expanded', String(open));
    if (open) this.helpEl.querySelector<HTMLElement>('button')?.focus();
    else this.helpToggleEl.focus();
  }

  command(text: string): void {
    this.commandAckEl.textContent = text;
    this.commandAckEl.style.opacity = '1';
    this.commandAckTimer = 1.35;
  }

  consumePresentation(events: readonly SimEvent[]): void {
    let changed = false;
    for (const event of events) {
      const text = hudEventText(event, this.playerFaction);
      if (!text) continue;
      const key = `${event.kind}:${event.id}:${event.faction}:${event.scale}:${event.entityKind ?? ''}`;
      const existing = this.recentEvents.find((item) => item.key === key);
      if (existing) {
        existing.ttl = 6;
        if (existing.text !== text) existing.text = text;
        continue;
      }
      this.recentEvents.unshift({ key, text, ttl: 6 });
      if (this.recentEvents.length > 3) this.recentEvents.length = 3;
      changed = true;
    }
    if (changed) this.renderEventRail();
  }

  resetTransientState(): void {
    this.recentEvents.length = 0;
    this.renderEventRail();
    this.commandAckTimer = 0;
    this.commandAckEl.textContent = '';
    this.commandAckEl.style.opacity = '0';
    this.alertTimer = 0;
    this.alertEl.textContent = '';
    this.alertEl.style.opacity = '0';
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
    narrative: NarrativeHudModel | null = null,
    directControl = false,
  ): void {
    this.cameraS = cameraS;
    this.cameraZ = cameraZ;
    this.directControlMode = directControl;
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) this.alertEl.style.opacity = '0';
    }
    if (this.commandAckTimer > 0) {
      this.commandAckTimer -= dt;
      if (this.commandAckTimer <= 0) this.commandAckEl.style.opacity = '0';
    }
    let eventChanged = false;
    for (const item of this.recentEvents) {
      item.ttl -= dt;
      if (item.ttl <= 0) eventChanged = true;
    }
    if (eventChanged) {
      this.recentEvents = this.recentEvents.filter((item) => item.ttl > 0);
      this.renderEventRail();
    }
    this.modeEl.textContent = directControl
      ? 'Direct control'
      : artilleryTargeting
        ? 'Artillery targeting — click terrain or minimap'
        : this.placing
          ? `Build mode — ${STRUCTURES[this.placing].name}`
          : 'Tactical command';
    this.mapWrap.classList.toggle('targeting', artilleryTargeting);

    this.drawResources(world, player);
    this.drawSelection(world, player, selection);
    this.drawMinimap(world, player, selection, cameraS, cameraZ, artilleryTargeting, artilleryResult);
    this.drawMission(mission);
    this.drawNarrative(narrative);
    this.drawEnd(world, player, narrative ? null : debrief);
  }

  private drawNarrative(narrative: NarrativeHudModel | null): void {
    const signature = narrative ? JSON.stringify(narrative) : '';
    if (signature === this.narrativeSignature) return;
    this.narrativeSignature = signature;
    if (this.narrativeEl?.getAttribute('aria-modal') === 'true') this.releaseModal(true);
    this.narrativeEl?.remove();
    this.narrativeEl = null;
    if (!narrative) return;
    const panel = el('section', `rww-narrative rww-panel ${narrative.kind}`);
    panel.dataset.narrativeId = narrative.id;
    panel.setAttribute('role', narrative.blocking ? 'dialog' : 'status');
    if (narrative.blocking) panel.setAttribute('aria-modal', 'true');
    const speaker = document.createElement('small');
    speaker.textContent = narrative.speaker;
    const title = document.createElement('h2');
    title.id = `rww-narrative-title-${narrative.id}`;
    title.textContent = narrative.title;
    const body = document.createElement('p');
    body.id = `rww-narrative-body-${narrative.id}`;
    body.textContent = narrative.body;
    panel.setAttribute('aria-labelledby', title.id);
    panel.setAttribute('aria-describedby', body.id);
    const acknowledge = document.createElement('button');
    acknowledge.textContent = narrative.blocking ? 'Begin' : 'Acknowledge';
    acknowledge.onclick = (): void => {
      if (narrative.blocking) {
        this.releaseModal(true);
        panel.remove();
        this.narrativeEl = null;
      }
      this.onNarrativeAcknowledge?.();
    };
    const portraitSource = this.media.narrativePortraits?.[narrative.id];
    if (portraitSource) {
      const copy = el('div', 'rww-narrative-copy');
      copy.append(speaker, title, body, acknowledge);
      panel.classList.add('has-portrait');
      panel.append(
        decorativeImage(portraitSource, 'rww-narrative-portrait', () => panel.classList.remove('has-portrait')),
        copy,
      );
    } else panel.append(speaker, title, body, acknowledge);
    this.root.appendChild(panel);
    this.narrativeEl = panel;
    if (narrative.blocking) this.activateModal(panel, acknowledge);
  }

  private activateModal(panel: HTMLElement, focusTarget: HTMLElement): void {
    if (!this.blockingOverlay) {
      this.previousModalFocus = this.controlsOpen
        ? this.helpToggleEl
        : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (this.controlsOpen) {
      this.helpEl.hidden = true;
      this.helpToggleEl.setAttribute('aria-expanded', 'false');
    }
    this.blockingOverlay = true;
    this.onBlockingOverlayChange?.(true);
    for (const child of this.root.children) {
      if (child !== panel && child instanceof HTMLElement) child.inert = true;
    }
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((control) => control.offsetParent !== null);
      if (controls.length === 0) return;
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const direction = event.shiftKey ? -1 : 1;
      controls[(current < 0 ? 0 : current + direction + controls.length) % controls.length]!.focus();
      event.preventDefault();
    });
    focusTarget.focus();
  }

  private releaseModal(restoreFocus: boolean): void {
    if (!this.blockingOverlay) return;
    this.blockingOverlay = false;
    this.onBlockingOverlayChange?.(false);
    for (const child of this.root.children) {
      if (child instanceof HTMLElement) child.inert = false;
    }
    if (restoreFocus) {
      const target = this.previousModalFocus?.isConnected ? this.previousModalFocus : this.map;
      target.focus();
    }
    this.previousModalFocus = null;
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

    const patch = (key: string, value: string, warn = false, aria = value): void => {
      const node = this.resourceNodes.get(key)!;
      if (node.value.textContent !== value) node.value.textContent = value;
      node.root.classList.toggle('rww-warn', warn);
      if (node.root.getAttribute('aria-label') !== aria) node.root.setAttribute('aria-label', aria);
    };
    patch('salvage', Math.floor(p.salvage).toString(), false, `Salvage: ${Math.floor(p.salvage)}`);
    patch('power', `${net >= 0 ? '+' : ''}${net.toFixed(0)}`, brownout,
      `${brownout ? 'Power deficit' : 'Power surplus'}: ${Math.abs(Math.round(net))}`);
    const committedCommand = p.commandUsed + world.queuedCommand(player);
    patch('command', `${committedCommand}/${p.commandCap}`, committedCommand >= p.commandCap,
      `Command: ${committedCommand} of ${p.commandCap}, including queued units`);

    const mins = Math.floor(world.time / 60);
    const secs = Math.floor(world.time % 60);
    patch('clock', `${mins}:${secs.toString().padStart(2, '0')}`, false,
      `Mission clock: ${mins} minutes ${secs} seconds`);
  }

  private renderEventRail(): void {
    this.eventRailEl.innerHTML = '';
    for (const item of this.recentEvents) {
      const row = el('div', 'rww-event-item');
      row.textContent = item.text;
      this.eventRailEl.appendChild(row);
    }
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

    const focused = this.cmdEl.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedKey = focused?.dataset.commandKey;
    this.cmdEl.innerHTML = '';
    if (focusedKey) {
      queueMicrotask(() => {
        if (this.root.inert || this.blockingOverlay) return;
        const replacement = [...this.cmdEl.querySelectorAll<HTMLElement>('[data-command-key]')]
          .find((control) => control.dataset.commandKey === focusedKey);
        replacement?.focus();
      });
    }
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
        '<div class="rww-eyebrow">Tactical overview</div><h3>No selection</h3>' +
        '<p>Select an engineer to build, or a foundry to produce units.</p>';
      return;
    }

    // --- Structure selected: show its production options --------------------
    if (structs.length === 1 && units.length === 0) {
      const st = structs[0]!;
      const def = STRUCTURES[st.kind];
      const pct = Math.round((st.hp / st.maxHp) * 100);
      const faction = st.faction < 0 ? 'Inherited infrastructure' : FACTION_NAME[st.faction as Faction];
      this.selEl.innerHTML =
        `<div class="rww-eyebrow">${faction} · Structure</div>` +
        `<h3>${def.name}</h3><p>${def.role}</p>${sensorCopy}${rangeCopy}` +
        (st.progress < 1
          ? `<p style="opacity:.8;color:#f0b26e">Under construction — ${Math.round(st.progress * 100)}%</p>`
          : '') +
        `<div class="rww-hp-row"><span>Hull integrity</span><b>${pct}%</b></div>` +
        `<div class="rww-hp" role="meter" aria-label="Hull integrity" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`;

      if (st.faction === player && st.progress >= 1 && def.produces) {
        for (const kind of def.produces) {
          if (canFactionFieldUnit(player, kind)) this.addUnitButton(world, player, st, kind);
        }
        if (st.queue.length > 0) {
          const q = el('div', 'rww-queue-status');
          q.textContent = `Production queue — ${st.queue.length} pending`;
          q.setAttribute('role', 'status');
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
          `<div class="rww-eyebrow">${first.faction < 0 ? 'Neutral' : FACTION_NAME[first.faction]} · ${first.damageState === 2 ? 'Critical' : 'Field unit'}</div>` +
          `<h3>${def.name}</h3><p>${def.role}</p>` +
          `<p class="rww-order">Order — ${formatOrder(first.order.kind)}</p>${sensorCopy}${rangeCopy}` +
          `<div class="rww-hp-row"><span>Hull integrity</span><b>${pct}%</b></div>` +
          `<div class="rww-hp" role="meter" aria-label="Hull integrity" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%;background:${pct > 50 ? '#6ee7a0' : pct > 25 ? '#f0c26e' : '#ff7a5e'}"></i></div>`;
        const dossierSource = this.unitDossier(first.faction, first.kind);
        if (dossierSource) this.selEl.prepend(decorativeImage(dossierSource, 'rww-dossier'));
      } else {
        const counts = new Map<UnitKind, number>();
        for (const u of units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
        const list = [...counts.entries()].map(([k, n]) => `${n}× ${UNITS[k].name}`).join(' · ');
        const damaged = units.filter((unit) => unit.damageState > 0).length;
        this.selEl.innerHTML = `<div class="rww-eyebrow">Selected force</div><h3>${units.length} units</h3>` +
          `<p>${list}</p><p class="rww-order">${damaged} damaged · ${units.filter((unit) => unit.order.kind === 'idle').length} idle</p>`;
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
    target.dataset.commandKey = `artillery:${source.id}:${weaponId}`;
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
    control.dataset.commandKey = `ability:${unit.id}:${ability.id}`;
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
    b.dataset.commandKey = `produce:${st.id}:${kind}`;
    b.setAttribute('aria-disabled', String(!affordable));
    b.innerHTML =
      `<u>${def.name}</u><s>${effective.salvageCost} slv` +
      (def.cost.command ? ` · ${def.cost.command} cmd` : '') +
      `</s>`;
    const dossierSource = this.unitDossier(player, kind);
    if (dossierSource) {
      b.classList.add('rww-with-dossier');
      b.prepend(decorativeImage(dossierSource, 'rww-command-dossier', () => {
        b.classList.remove('rww-with-dossier');
      }));
    }
    b.title = def.role;
    b.onclick = (): void => {
      if (!world.tryQueueUnit(st.id, kind)) {
        this.alert(
          p.salvage < effective.salvageCost ? 'Not enough salvage' : 'Command cap reached',
        );
      } else this.command(`${def.name} queued`);
    };
    this.cmdEl.appendChild(b);
  }

  private unitDossier(faction: number, kind: UnitKind): string | undefined {
    if (faction !== Faction.Compact && faction !== Faction.Choir) return undefined;
    return this.media.unitDossiers?.[faction]?.[kind];
  }

  private addBuildButton(world: World, player: Faction, kind: StructureKind): void {
    const def = STRUCTURES[kind];
    const effective = effectiveStructureStats(player, kind);
    const p = world.players[player];

    const locked = Boolean(def.requires && !p.unlocked.has(def.requires));
    const affordable = p.salvage >= effective.salvageCost;
    const usable = affordable && !locked;

    const b = button('rww-btn' + (usable ? '' : ' off') + (this.placing === kind ? ' on' : ''));
    b.dataset.commandKey = `build:${kind}`;
    b.setAttribute('aria-disabled', String(!usable));
    b.setAttribute('aria-pressed', String(this.placing === kind));
    const state = locked
      ? `LOCKED · REQUIRES ${STRUCTURES[def.requires!].name.toUpperCase()}`
      : this.placing === kind
        ? 'ACTIVE · CLICK TO CANCEL'
        : usable
          ? `READY · ${effective.salvageCost} SLV · ${def.energy >= 0 ? '+' : ''}${def.energy} PWR`
          : `INSUFFICIENT SALVAGE · ${effective.salvageCost} SLV`;
    b.innerHTML =
      (def.hotkey ? `<em>${def.hotkey}</em>` : '') +
      `<u>${def.name}</u><s>${state}</s>`;
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
      const next = this.placing === kind ? null : kind;
      this.onBuildRequest?.(next);
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
        this.releaseModal(true);
        this.endEl.remove();
        this.endEl = null;
      }
      return;
    }
    const key = world.status === 'running' ? missionDebrief!.key : `world:${world.status}:${world.endReason}`;
    if (this.endEl?.dataset.debriefKey === key) return;
    if (this.endEl) this.releaseModal(false);
    this.endEl?.remove();

    const draw = world.winner === null;
    const won = world.winner === player;
    this.endEl = el('div', 'rww-end');
    this.endEl.dataset.debriefKey = key;
    this.endEl.setAttribute('role', 'dialog');
    this.endEl.setAttribute('aria-modal', 'true');
    const h = document.createElement('h1');
    h.id = `rww-end-title-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    h.textContent = missionDebrief?.title ?? (draw ? 'Draw' : won ? 'Victory' : 'Defeat');
    h.style.color = missionDebrief
      ? missionDebrief.outcome === 'success' ? '#8ce8b0' : '#ff7a5e'
      : draw ? '#dbe3ec' : won ? '#8ce8b0' : '#ff7a5e';
    const p = document.createElement('p');
    p.id = `rww-end-body-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
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
        this.releaseModal(true);
      } else this.restartRequested = true;
    };
    this.endEl.append(h, p);
    if (missionDebrief) this.endEl.appendChild(rows);
    this.endEl.appendChild(b);
    this.root.appendChild(this.endEl);
    this.endEl.setAttribute('aria-labelledby', h.id);
    this.endEl.setAttribute('aria-describedby', p.id);
    this.activateModal(this.endEl, b);
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
    this.endEl = null;
    this.narrativeEl = null;
    this.previousModalFocus = null;
    this.recentEvents.length = 0;
    this.resourceNodes.clear();
    this.onMinimapPointer = null;
    this.onMinimapPrimary = null;
    this.onMinimapSecondary = null;
    this.onMinimapMove = null;
    this.onMinimapCancel = null;
    this.onMinimapCamera = null;
    this.onArtilleryTarget = null;
    this.onAbilityToggle = null;
    this.onBuildRequest = null;
    this.onNarrativeAcknowledge = null;
    this.onBlockingOverlayChange = null;
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

function decorativeImage(src: string, className: string, onError?: () => void): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => {
    image.remove();
    onError?.();
  }, { once: true });
  image.src = src;
  return image;
}

/** Shortest signed screen-space delta, used for minimap camera boxes. */
export function mapDelta(a: number, b: number): number {
  return deltaS(a, b);
}

function formatOrder(kind: Unit['order']['kind']): string {
  switch (kind) {
    case 'idle': return 'Holding';
    case 'move': return 'Moving';
    case 'attackMove': return 'Attack move';
    case 'attack': return 'Engaging target';
    case 'build': return 'Construction assist';
    case 'capture': return 'Capturing node';
  }
}

export function hudEventText(event: SimEvent, playerFaction: Faction): string | null {
  switch (event.kind) {
    case 'unitComplete': return `${event.faction === playerFaction ? 'FRIENDLY' : 'HOSTILE'} ` +
      `${event.entityKind ? String(event.entityKind).toUpperCase() : 'UNIT'} READY`;
    case 'structureComplete': return `${event.faction === playerFaction ? 'FRIENDLY' : 'HOSTILE'} ` +
      `${event.entityKind ? String(event.entityKind).toUpperCase() : 'STRUCTURE'} ONLINE`;
    case 'nodeCaptured': return event.faction === playerFaction ? 'SPINAL NODE SECURED' : 'SPINAL NODE LOST';
    case 'intercepted': return event.faction === playerFaction
      ? 'HOSTILE ORDNANCE INTERCEPTED'
      : 'FRIENDLY ORDNANCE INTERCEPTED';
    case 'damageStateChanged': return event.scale >= 2
      ? `${event.faction === playerFaction ? 'FRIENDLY' : 'HOSTILE'} UNIT CRITICAL`
      : null;
    case 'unitDied': return event.faction === playerFaction ? 'FRIENDLY UNIT LOST' : 'HOSTILE UNIT DESTROYED';
    case 'structureDied': return event.faction === playerFaction
      ? 'FRIENDLY STRUCTURE LOST'
      : 'HOSTILE STRUCTURE DESTROYED';
    default: return null;
  }
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
