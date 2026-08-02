import { isQualityLevel, type Settings } from '@render/settings';
import type { Renderer } from '@render/renderer';

const CSS = `
.rww-settings { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center;
  padding: 20px; pointer-events: auto; user-select: none;
  background: rgba(4,7,11,0.72); backdrop-filter: blur(8px); color: #dbe3ec;
  font-family: 'Rajdhani','Bahnschrift','DIN Alternate','Segoe UI Semibold',system-ui,sans-serif; }
.rww-settings[hidden] { display: none; }
.rww-settings-card { width: min(560px, 100%); max-height: min(720px, calc(100vh - 40px)); overflow: auto;
  background: rgba(8,12,18,0.96); border: 1px solid rgba(150,180,210,0.22);
  border-top: 2px solid #f0821e; box-shadow: 0 24px 80px rgba(0,0,0,0.42); }
.rww-settings-head { padding: 22px 26px 18px; border-bottom: 1px solid rgba(150,180,210,0.14); }
.rww-settings-head h2 { margin: 0; font-size: 25px; font-weight: 600; letter-spacing: 0.24em;
  text-transform: uppercase; }
.rww-settings-head p { margin: 6px 0 0; color: rgba(219,227,236,0.52); font-size: 11px;
  letter-spacing: 0.12em; text-transform: uppercase; }
.rww-settings-body { display: grid; gap: 20px; padding: 22px 26px 26px; }
.rww-settings-field { display: grid; grid-template-columns: minmax(130px, 0.7fr) minmax(180px, 1fr);
  align-items: center; gap: 18px; }
.rww-settings-field label { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; }
.rww-settings select { width: 100%; padding: 9px 34px 9px 10px; color: #dbe3ec; color-scheme: dark;
  background: #101720; border: 1px solid rgba(150,180,210,0.28); font: inherit; }
.rww-settings-volume { display: grid; grid-template-columns: 1fr 46px; align-items: center; gap: 12px; }
.rww-settings input[type='range'] { width: 100%; accent-color: #f0821e; }
.rww-settings output { text-align: right; font-variant-numeric: tabular-nums; color: #f0b26e; }
.rww-settings-keys { border-top: 1px solid rgba(150,180,210,0.14); padding-top: 18px; }
.rww-settings-keys h3 { margin: 0 0 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.2em;
  text-transform: uppercase; color: rgba(219,227,236,0.58); }
.rww-settings-keys dl { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 24px; margin: 0; }
.rww-settings-keys div { display: flex; justify-content: space-between; gap: 18px; padding-bottom: 6px;
  border-bottom: 1px solid rgba(150,180,210,0.08); font-size: 11px; }
.rww-settings-keys dt { color: rgba(219,227,236,0.56); }
.rww-settings-keys dd { margin: 0; text-align: right; letter-spacing: 0.08em; }
.rww-settings-resume { width: 100%; margin-top: 2px; padding: 12px; cursor: pointer; color: #f0a052;
  background: rgba(240,130,30,0.08); border: 1px solid rgba(240,130,30,0.72);
  font: 600 12px/1 inherit; letter-spacing: 0.22em; text-transform: uppercase; }
.rww-settings-resume:hover, .rww-settings-resume:focus-visible { background: rgba(240,130,30,0.17); }
.rww-settings-save { display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  border-top: 1px solid rgba(150,180,210,0.14); padding-top: 18px; }
.rww-settings-save button { padding: 10px; cursor: pointer; color: #dbe3ec; background: #101720;
  border: 1px solid rgba(150,180,210,0.28); font: 600 11px/1 inherit;
  letter-spacing: 0.16em; text-transform: uppercase; }
.rww-settings-save button:hover { border-color: rgba(240,130,30,0.72); }
.rww-settings-status { grid-column: 1 / -1; min-height: 1.4em; margin: 0; color: rgba(219,227,236,0.7);
  font-size: 11px; letter-spacing: 0.06em; }
.rww-settings-status.error { color: #ff8b73; }
.rww-settings select:focus-visible, .rww-settings input:focus-visible, .rww-settings button:focus-visible {
  outline: 2px solid #f0a052; outline-offset: 2px; }
@media (max-width: 560px) {
  .rww-settings { padding: 10px; }
  .rww-settings-card { max-height: calc(100vh - 20px); }
  .rww-settings-head, .rww-settings-body { padding-left: 18px; padding-right: 18px; }
  .rww-settings-field { grid-template-columns: 1fr; gap: 8px; }
  .rww-settings-keys dl { grid-template-columns: 1fr; }
}
`;

const KEYBINDINGS: ReadonlyArray<readonly [string, string]> = [
  ['Pan / drive', 'WASD or arrows'],
  ['Zoom', 'Wheel or R / F'],
  ['Rotate camera', 'Q / E or Shift + right drag'],
  ['Select / command', 'Left / right click'],
  ['Minimap focus / primary', 'Arrows / Enter'],
  ['Minimap move / attack-move', 'M / A'],
  ['Pilot selected mech', 'V'],
  ['Toggle selected ability', 'X'],
  ['Control groups', 'Ctrl or Alt + 1-9'],
  ['Select combat units', 'Ctrl + G'],
  ['Cancel / settings', 'Escape'],
  ['Performance overlay', 'F3'],
];

export class SettingsMenu {
  readonly root: HTMLDivElement;
  private readonly quality: HTMLSelectElement;
  private readonly volume: HTMLInputElement;
  private readonly volumeOutput: HTMLOutputElement;
  private readonly save: HTMLButtonElement;
  private readonly load: HTMLButtonElement;
  private readonly saveStatus: HTMLParagraphElement;
  private readonly resume: HTMLButtonElement;
  private previousFocus: HTMLElement | null = null;

  onSave: (() => { ok: boolean; message: string }) | null = null;
  onLoad: (() => { ok: boolean; message: string }) | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly renderer: Renderer,
    private readonly onOpenChange: (open: boolean) => void,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'rww-settings';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'rww-settings-title');

    const card = document.createElement('section');
    card.className = 'rww-settings-card';
    const head = document.createElement('header');
    head.className = 'rww-settings-head';
    const title = document.createElement('h2');
    title.id = 'rww-settings-title';
    title.textContent = 'Settings';
    const note = document.createElement('p');
    note.textContent = 'The war continues while this panel is open';
    head.append(title, note);

    const body = document.createElement('div');
    body.className = 'rww-settings-body';

    this.quality = document.createElement('select');
    this.quality.id = 'rww-quality';
    this.quality.setAttribute('aria-label', 'Graphics quality');
    for (const value of ['low', 'medium', 'high', 'ultra'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value[0]!.toUpperCase() + value.slice(1);
      this.quality.appendChild(option);
    }
    const qualityField = field('Graphics quality', this.quality);

    this.volume = document.createElement('input');
    this.volume.id = 'rww-volume';
    this.volume.type = 'range';
    this.volume.min = '0';
    this.volume.max = '100';
    this.volume.step = '1';
    this.volume.setAttribute('aria-label', 'Master volume');
    this.volumeOutput = document.createElement('output');
    this.volumeOutput.htmlFor = this.volume.id;
    const volumeControl = document.createElement('div');
    volumeControl.className = 'rww-settings-volume';
    volumeControl.append(this.volume, this.volumeOutput);
    const volumeField = field('Master volume', volumeControl, this.volume.id);

    const keys = document.createElement('section');
    keys.className = 'rww-settings-keys';
    const keysTitle = document.createElement('h3');
    keysTitle.textContent = 'Keybindings';
    const list = document.createElement('dl');
    for (const [action, binding] of KEYBINDINGS) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = action;
      const description = document.createElement('dd');
      description.textContent = binding;
      row.append(term, description);
      list.appendChild(row);
    }
    keys.append(keysTitle, list);

    const saveControls = document.createElement('section');
    saveControls.className = 'rww-settings-save';
    this.save = document.createElement('button');
    this.save.type = 'button';
    this.save.textContent = 'Save game';
    this.load = document.createElement('button');
    this.load.type = 'button';
    this.load.textContent = 'Load game';
    this.saveStatus = document.createElement('p');
    this.saveStatus.className = 'rww-settings-status';
    this.saveStatus.setAttribute('role', 'status');
    this.saveStatus.setAttribute('aria-label', 'Save status');
    this.saveStatus.setAttribute('aria-live', 'polite');
    saveControls.append(this.save, this.load, this.saveStatus);

    this.resume = document.createElement('button');
    this.resume.className = 'rww-settings-resume';
    this.resume.type = 'button';
    this.resume.textContent = 'Resume';

    body.append(qualityField, volumeField, keys, saveControls, this.resume);
    card.append(head, body);
    this.root.appendChild(card);
    document.body.appendChild(this.root);

    this.quality.addEventListener('change', () => {
      if (!isQualityLevel(this.quality.value)) return;
      this.settings.setQuality(this.quality.value);
      this.settings.apply(this.renderer);
    });
    this.volume.addEventListener('input', () => {
      this.settings.setVolume(Number(this.volume.value) / 100);
      this.updateVolumeOutput();
    });
    this.save.addEventListener('click', () => this.runSaveAction(this.onSave));
    this.load.addEventListener('click', () => this.runSaveAction(this.onLoad));
    this.resume.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', this.trapFocus);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.quality.value = this.renderer.quality;
    this.volume.value = String(Math.round(this.settings.volume * 100));
    this.updateVolumeOutput();
    this.root.hidden = false;
    this.onOpenChange(true);
    this.quality.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.onOpenChange(false);
    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  private updateVolumeOutput(): void {
    this.volumeOutput.value = `${this.volume.value}%`;
  }

  private runSaveAction(action: (() => { ok: boolean; message: string }) | null): void {
    const result = action?.() ?? { ok: false, message: 'Save controls are not available' };
    this.saveStatus.textContent = result.message;
    this.saveStatus.classList.toggle('error', !result.ok);
  }

  private trapFocus = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const controls = [this.quality, this.volume, this.save, this.load, this.resume];
    const current = controls.indexOf(document.activeElement as HTMLInputElement);
    const direction = event.shiftKey ? -1 : 1;
    const next = (current + direction + controls.length) % controls.length;
    controls[next]!.focus();
    event.preventDefault();
  };
}

function field(labelText: string, control: HTMLElement, labelFor = control.id): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'rww-settings-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = labelFor;
  wrapper.append(label, control);
  return wrapper;
}
