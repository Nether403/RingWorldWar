import type { GravityRangeHudModel } from '../arcade/gravityRange';

const CSS = `
.rww-gravity-range{position:fixed;z-index:36;top:78px;right:18px;width:min(360px,calc(100vw - 36px));
padding:16px 18px;border:1px solid rgba(145,205,218,.42);border-top:3px solid #8fcfda;color:#dce6e7;
background:linear-gradient(145deg,rgba(6,14,18,.95),rgba(13,22,26,.92));box-shadow:0 18px 46px rgba(0,0,0,.38);
font:500 12px/1.45 Rajdhani,'Segoe UI',sans-serif;letter-spacing:.04em}
.rww-gravity-range h2{margin:0;color:#9fdae4;font-size:17px;letter-spacing:.2em;text-transform:uppercase}
.rww-gravity-kicker{margin:3px 0 12px;color:rgba(220,230,231,.56);font-size:9px;letter-spacing:.18em;text-transform:uppercase}
.rww-gravity-progress{display:grid;grid-template-columns:1fr auto;gap:10px;margin:0 0 11px;padding:8px 0;
border-block:1px solid rgba(220,230,231,.14);text-transform:uppercase}
.rww-gravity-progress strong{color:#f1b877;font-size:15px;letter-spacing:.08em}
.rww-gravity-progress span{align-self:center;color:#9fdae4;font-size:10px;letter-spacing:.14em}
.rww-gravity-instruction{margin:0 0 10px;font-size:13px}
.rww-gravity-physics{margin:0;color:rgba(220,230,231,.66);font-size:10px;text-transform:uppercase}
.rww-gravity-reload{margin:9px 0 0;color:#f1b877;font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.rww-gravity-actions{display:flex;gap:8px;margin-top:13px}
.rww-gravity-actions{flex-wrap:wrap}
.rww-gravity-actions button{flex:1 1 auto;min-height:36px;padding:7px 11px;border:1px solid rgba(220,230,231,.28);color:#dce6e7;
background:#111c21;font:600 10px/1 Rajdhani,'Segoe UI',sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
.rww-gravity-actions button:focus-visible{outline:2px solid #f1b877;outline-offset:2px}
.rww-root [data-artillery-weapon]:not([data-artillery-weapon='batteryGun']){display:none}
.rww-gravity-live{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.rww-gravity-range[data-status='completed']{border-top-color:#86d8a8}
.rww-gravity-range[data-status='completed'] .rww-gravity-progress strong{color:#86d8a8}
@media(max-width:560px){
.rww-root .rww-mode,.rww-root:not(.whole-ring) .rww-bottom{display:none}
.rww-gravity-range{top:96px;right:8px;width:calc(100vw - 16px);padding:6px 10px}
.rww-gravity-range h2{font-size:13px}.rww-gravity-kicker{display:none}.rww-gravity-progress{margin:4px 0;padding:4px 0}
.rww-gravity-progress strong{font-size:12px}.rww-gravity-instruction{margin-bottom:4px;font-size:10px;line-height:1.3}
.rww-gravity-physics{font-size:9px;line-height:1.3}.rww-gravity-reload{margin-top:4px;font-size:9px}
.rww-gravity-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:5px}
.rww-gravity-actions button{min-width:0;min-height:34px;padding:5px 4px;font-size:9px;letter-spacing:.08em}
.rww-root.whole-ring .rww-strategic-panel{bottom:4px;padding:8px 10px 7px}
.rww-root.whole-ring .rww-strategic-panel h2{margin-bottom:4px;font-size:12px}
.rww-root.whole-ring .rww-strategic-summary{margin-top:4px;line-height:1.3}
.rww-root.whole-ring .rww-strategic-state{margin-top:3px}
.rww-root.whole-ring .rww-strategic-legend{margin-top:4px;gap:3px 10px}
.rww-root.whole-ring .rww-strategic-panel button{margin-top:5px;min-height:34px}
}
`;

export class GravityRangePanel {
  readonly root = document.createElement('aside');
  private readonly style = document.createElement('style');
  private readonly progress = document.createElement('strong');
  private readonly direction = document.createElement('span');
  private readonly instruction = document.createElement('p');
  private readonly reload = document.createElement('p');
  private readonly liveStatus = document.createElement('p');
  private modelSignature = '';
  private reloadText = '';
  private liveSignature = '';

  constructor(onFocusTarget: () => void, onRetry: () => void, onExit: () => void) {
    this.style.textContent = CSS;
    this.style.dataset.rwwGravityRangeStyle = '';
    document.head.appendChild(this.style);
    this.root.className = 'rww-gravity-range';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-labelledby', 'rww-gravity-range-title');
    const title = document.createElement('h2');
    title.id = 'rww-gravity-range-title';
    title.textContent = 'Gravity Range';
    const kicker = document.createElement('p');
    kicker.className = 'rww-gravity-kicker';
    kicker.textContent = 'Canonical ring ballistics / live exercise';
    const progress = document.createElement('div');
    progress.className = 'rww-gravity-progress';
    progress.append(this.progress, this.direction);
    this.instruction.className = 'rww-gravity-instruction';
    const physics = document.createElement('p');
    physics.className = 'rww-gravity-physics';
    physics.textContent = '◀ Antispinward = long shot · Spinward = short shot ▶ · Ring edges join';
    this.reload.className = 'rww-gravity-reload';
    this.liveStatus.className = 'rww-gravity-live';
    this.liveStatus.setAttribute('role', 'status');
    this.liveStatus.setAttribute('aria-live', 'polite');
    this.liveStatus.setAttribute('aria-atomic', 'true');
    const actions = document.createElement('div');
    actions.className = 'rww-gravity-actions';
    actions.append(
      button('Focus marker', onFocusTarget, 'Focus current marker'),
      button('Retry range', onRetry),
      button('Main menu', onExit),
    );
    this.root.append(title, kicker, progress, this.instruction, physics, this.reload, actions, this.liveStatus);
    document.body.appendChild(this.root);
  }

  update(model: GravityRangeHudModel, reloadSeconds: number): void {
    const modelSignature = `${model.status}:${model.stage}:${model.completedImpacts}:${model.distanceMeters}`;
    if (modelSignature !== this.modelSignature) {
      this.modelSignature = modelSignature;
      this.root.dataset.status = model.status;
      this.progress.textContent = model.status === 'completed'
        ? 'Range complete'
        : `${model.completedImpacts + 1} / ${model.totalImpacts} · ${model.distanceMeters.toLocaleString()} m`;
      this.direction.textContent = model.directionLabel;
      this.instruction.textContent = model.instruction;
    }
    const reloadText = model.status === 'completed'
      ? '2 / 2 authoritative impacts confirmed'
      : reloadSeconds > 0.05 ? `Launcher reload · ${reloadSeconds.toFixed(1)}s` : 'Launcher ready · select target command if needed';
    if (reloadText !== this.reloadText) {
      this.reloadText = reloadText;
      this.reload.textContent = reloadText;
    }
    const readyState = model.status === 'completed' ? 'complete' : reloadSeconds > 0.05 ? 'reloading' : 'ready';
    const liveSignature = `${model.stage}:${readyState}`;
    if (liveSignature !== this.liveSignature) {
      this.liveSignature = liveSignature;
      this.liveStatus.textContent = model.status === 'completed'
        ? 'Gravity Range complete. Two authoritative impacts confirmed.'
        : `${model.instruction} Launcher ${readyState}.`;
    }
  }

  setInteractionBlocked(blocked: boolean): void {
    this.root.inert = blocked;
    if (blocked) this.root.setAttribute('aria-hidden', 'true');
    else this.root.removeAttribute('aria-hidden');
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}

function button(label: string, action: () => void, accessibleLabel = label): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('aria-label', accessibleLabel);
  element.addEventListener('click', action);
  return element;
}
