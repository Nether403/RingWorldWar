import type { Settings } from '@render/settings';
import { isQualityLevel } from '@render/settings';
import type { PresentationMedia } from '../presentation/media';
import './titleScreen.css';

export type TitleAction = 'new-campaign' | 'continue';
const INTRO_TIMEOUT_MILLISECONDS = 120_000;

export interface TitleScreenOptions {
  settings: Settings;
  hasSave: boolean;
  media: PresentationMedia;
  statusMessage?: string;
}

export class TitleScreen {
  readonly root = document.createElement('section');
  private readonly chrome = div('rww-title-chrome');
  private readonly settingsDialog = document.createElement('div');
  private readonly intro = document.createElement('div');
  private readonly introVideo = document.createElement('video');
  private readonly newCampaign = document.createElement('button');
  private readonly continueGame = document.createElement('button');
  private readonly settingsButton = document.createElement('button');
  private readonly settingsClose = document.createElement('button');
  private readonly quality = document.createElement('select');
  private readonly volume = document.createElement('input');
  private readonly volumeOutput = document.createElement('output');
  private readonly voiceVolume = document.createElement('input');
  private readonly voiceVolumeOutput = document.createElement('output');
  private readonly status = document.createElement('p');
  private readonly skipIntro = document.createElement('button');
  private readonly muteIntro = document.createElement('button');
  private readonly captionsIntro = document.createElement('button');
  private readonly introElapsed = document.createElement('output');
  private menuMedia: HTMLDivElement | null = null;
  private menuVideo: HTMLVideoElement | null = null;
  private menuImage: HTMLImageElement | null = null;
  private resolveAction: ((action: TitleAction) => void) | null = null;
  private introFinish: (() => void) | null = null;
  private introTimeout = 0;
  private introPlaying = false;
  private previousFocus: HTMLElement | null = null;
  private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly options: TitleScreenOptions) {
    this.root.className = 'rww-title-screen';
    this.root.dataset.rwwTitleScreen = '';
    this.root.setAttribute('aria-label', 'Ring World War main menu');

    const fallback = div('rww-title-fallback');
    fallback.append(div('rww-title-shadow-grid'), div('rww-title-horizon'));
    this.root.appendChild(fallback);
    this.addMenuMedia();
    this.root.appendChild(div('rww-title-noise'));

    const topline = div('rww-title-topline');
    const archive = document.createElement('span');
    archive.textContent = 'SPINAL ARCHIVE // OBSERVATION TERMINAL 04';
    const status = document.createElement('span');
    const statusLabel = document.createElement('strong');
    statusLabel.textContent = 'STATUS '; 
    status.append(statusLabel, 'LAST ROTATION');
    topline.append(archive, status);

    const copy = div('rww-title-copy');
    const kicker = document.createElement('p');
    kicker.className = 'rww-title-kicker';
    kicker.textContent = 'The Last Rotation';
    const heading = document.createElement('h1');
    heading.textContent = 'Ring World';
    const war = document.createElement('span');
    war.textContent = 'War';
    heading.appendChild(war);
    copy.append(kicker, heading);

    const deck = div('rww-title-deck');
    const actions = div('rww-title-actions');
    configureButton(this.newCampaign, 'New Campaign');
    configureButton(this.continueGame, 'Continue');
    this.continueGame.classList.add('rww-title-continue');
    configureButton(this.settingsButton, 'Settings');
    this.continueGame.disabled = !options.hasSave;
    actions.append(this.newCampaign, this.continueGame, this.settingsButton);
    const footer = div('rww-title-footer');
    const location = document.createElement('span');
    location.textContent = 'HABITAT CONTROL: DEGRADED';
    const version = document.createElement('span');
    version.textContent = 'ARCHIVE REV 01';
    footer.append(location, version);
    this.status.className = 'rww-title-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.textContent = options.statusMessage ? `ARCHIVE REJECTED // ${options.statusMessage}` : '';
    this.status.hidden = !options.statusMessage;
    deck.append(actions, this.status, footer);
    this.chrome.append(topline, copy, deck);
    this.root.appendChild(this.chrome);

    this.buildSettings();
    this.buildIntro();
    this.root.addEventListener('keydown', this.onKeyDown);
    this.newCampaign.addEventListener('click', this.onNewCampaign);
    this.continueGame.addEventListener('click', this.onContinue);
    this.settingsButton.addEventListener('click', this.openSettings);
    this.settingsClose.addEventListener('click', this.closeSettings);
    this.motionPreference.addEventListener('change', this.onMotionPreferenceChange);
  }

  show(): Promise<TitleAction> {
    document.body.appendChild(this.root);
    requestAnimationFrame(() => this.newCampaign.focus());
    return new Promise((resolve) => { this.resolveAction = resolve; });
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.newCampaign.removeEventListener('click', this.onNewCampaign);
    this.continueGame.removeEventListener('click', this.onContinue);
    this.settingsButton.removeEventListener('click', this.openSettings);
    this.settingsClose.removeEventListener('click', this.closeSettings);
    this.motionPreference.removeEventListener('change', this.onMotionPreferenceChange);
    this.stopIntro();
    this.removeMenuMedia();
    this.root.remove();
    this.resolveAction = null;
    this.previousFocus = null;
  }

  private addMenuMedia(): void {
    if (
      this.menuMedia ||
      this.options.settings.quality === 'low' ||
      this.motionPreference.matches
    ) return;
    const { menuLoop, menuPoster } = this.options.media;
    if (!menuLoop && !menuPoster) return;
    const media = div('rww-title-media');
    if (menuLoop) {
      const video = document.createElement('video');
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = menuLoop;
      if (menuPoster) video.poster = menuPoster;
      video.addEventListener('error', this.removeMenuMedia, { once: true });
      media.appendChild(video);
      this.menuVideo = video;
    } else {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', this.removeMenuMedia, { once: true });
      image.src = menuPoster!;
      media.appendChild(image);
      this.menuImage = image;
    }
    this.root.appendChild(media);
    this.menuMedia = media;
  }

  private removeMenuMedia = (): void => {
    this.menuVideo?.pause();
    this.menuVideo?.removeAttribute('src');
    this.menuVideo?.load();
    this.menuImage?.removeAttribute('src');
    this.menuMedia?.remove();
    this.menuMedia = null;
    this.menuVideo = null;
    this.menuImage = null;
  }

  private buildSettings(): void {
    this.settingsDialog.className = 'rww-title-settings';
    this.settingsDialog.hidden = true;
    this.settingsDialog.setAttribute('role', 'dialog');
    this.settingsDialog.setAttribute('aria-modal', 'true');
    this.settingsDialog.setAttribute('aria-label', 'Presentation settings');
    const card = document.createElement('section');
    card.className = 'rww-title-settings-card';
    const heading = document.createElement('h2');
    heading.textContent = 'Settings';
    const note = document.createElement('p');
    note.textContent = 'Applied before habitat simulation begins';

    this.quality.id = 'rww-title-quality';
    this.quality.setAttribute('aria-label', 'Graphics quality');
    for (const [value, label] of [
      ['auto', 'Adaptive'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.quality.appendChild(option);
    }
    this.quality.value = this.options.settings.adaptiveQuality ? 'auto' : this.options.settings.quality;
    this.quality.addEventListener('change', this.onQualityChange);
    const qualityField = field('Graphics quality', this.quality);

    this.volume.id = 'rww-title-volume';
    this.volume.type = 'range';
    this.volume.min = '0';
    this.volume.max = '100';
    this.volume.step = '1';
    this.volume.value = String(Math.round(this.options.settings.volume * 100));
    this.volume.setAttribute('aria-label', 'Master volume');
    this.volumeOutput.htmlFor = this.volume.id;
    this.updateVolumeOutput();
    this.volume.addEventListener('input', this.onVolumeChange);
    const volumeControl = div('rww-title-volume');
    volumeControl.append(this.volume, this.volumeOutput);
    const volumeField = field('Master volume', volumeControl, this.volume.id);

    this.voiceVolume.id = 'rww-title-voice-volume';
    this.voiceVolume.type = 'range';
    this.voiceVolume.min = '0';
    this.voiceVolume.max = '100';
    this.voiceVolume.step = '1';
    this.voiceVolume.value = String(Math.round(this.options.settings.voiceVolume * 100));
    this.voiceVolume.setAttribute('aria-label', 'Voice volume');
    this.voiceVolumeOutput.htmlFor = this.voiceVolume.id;
    this.voiceVolumeOutput.value = `${this.voiceVolume.value}%`;
    this.voiceVolume.addEventListener('input', this.onVoiceVolumeChange);
    const voiceVolumeControl = div('rww-title-volume');
    voiceVolumeControl.append(this.voiceVolume, this.voiceVolumeOutput);
    const voiceVolumeField = field('Voice volume', voiceVolumeControl, this.voiceVolume.id);

    configureButton(this.settingsClose, 'Close settings');
    card.append(heading, note, qualityField, volumeField, voiceVolumeField, this.settingsClose);
    this.settingsDialog.appendChild(card);
    this.root.appendChild(this.settingsDialog);
  }

  private buildIntro(): void {
    this.intro.className = 'rww-title-intro';
    this.intro.hidden = true;
    this.intro.setAttribute('role', 'dialog');
    this.intro.setAttribute('aria-modal', 'true');
    this.intro.setAttribute('aria-label', 'The Last Rotation introduction');
    this.introVideo.playsInline = true;
    this.introVideo.preload = 'auto';
    if (this.options.media.introPoster) this.introVideo.poster = this.options.media.introPoster;
    const controls = div('rww-title-intro-controls');
    this.introElapsed.setAttribute('aria-label', 'Intro elapsed time');
    this.introElapsed.value = '0:00';
    configureButton(this.captionsIntro, 'Captions on');
    configureButton(this.muteIntro, 'Mute');
    configureButton(this.skipIntro, 'Skip intro');
    controls.append(this.introElapsed, this.captionsIntro, this.muteIntro, this.skipIntro);
    this.intro.append(this.introVideo, controls);
    this.root.appendChild(this.intro);
  }

  private onNewCampaign = (): void => {
    if (this.introPlaying) return;
    if (!this.options.media.introVideo || this.motionPreference.matches) {
      this.finish('new-campaign');
      return;
    }
    void this.playIntro().then(() => this.finish('new-campaign'));
  };

  private onContinue = (): void => this.finish('continue');

  private finish(action: TitleAction): void {
    const resolve = this.resolveAction;
    if (!resolve) return;
    this.resolveAction = null;
    this.dispose();
    resolve(action);
  }

  private playIntro(): Promise<void> {
    this.introPlaying = true;
    this.setChromeBlocked(true);
    this.intro.hidden = false;
    this.introVideo.src = this.options.media.introVideo!;
    this.introVideo.volume = this.options.settings.volume;
    this.introVideo.muted = this.options.settings.volume === 0;
    this.muteIntro.disabled = this.options.settings.volume === 0;
    this.introVideo.replaceChildren();
    this.updateMuteLabel();
    if (this.options.media.introCaptions) {
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'English';
      track.srclang = 'en';
      track.src = this.options.media.introCaptions;
      track.default = true;
      this.introVideo.appendChild(track);
      this.introVideo.textTracks[0]!.mode = 'showing';
      this.captionsIntro.textContent = 'Captions on';
    } else {
      this.captionsIntro.hidden = true;
    }
    return new Promise((resolve) => {
      this.introFinish = resolve;
      this.introVideo.addEventListener('ended', this.stopIntro, { once: true });
      this.introVideo.addEventListener('error', this.stopIntro, { once: true });
      this.introVideo.addEventListener('timeupdate', this.updateIntroElapsed);
      this.skipIntro.addEventListener('click', this.stopIntro, { once: true });
      this.muteIntro.addEventListener('click', this.toggleIntroMute);
      this.captionsIntro.addEventListener('click', this.toggleCaptions);
      this.introTimeout = window.setTimeout(this.stopIntro, INTRO_TIMEOUT_MILLISECONDS);
      this.skipIntro.focus();
      void this.introVideo.play().catch(this.stopIntro);
    });
  }

  private stopIntro = (): void => {
    if (this.introTimeout) window.clearTimeout(this.introTimeout);
    this.introTimeout = 0;
    this.introVideo.pause();
    this.introVideo.removeEventListener('timeupdate', this.updateIntroElapsed);
    this.introVideo.removeAttribute('src');
    this.introVideo.load();
    this.intro.hidden = true;
    this.introPlaying = false;
    this.setChromeBlocked(false);
    this.skipIntro.removeEventListener('click', this.stopIntro);
    this.muteIntro.removeEventListener('click', this.toggleIntroMute);
    this.captionsIntro.removeEventListener('click', this.toggleCaptions);
    const finish = this.introFinish;
    this.introFinish = null;
    finish?.();
  };

  private updateIntroElapsed = (): void => {
    const seconds = Math.max(0, Math.floor(this.introVideo.currentTime));
    this.introElapsed.value = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  private toggleIntroMute = (): void => {
    this.introVideo.muted = !this.introVideo.muted;
    this.updateMuteLabel();
  };

  private updateMuteLabel(): void {
    this.muteIntro.textContent = this.options.settings.volume === 0
      ? 'Volume 0%'
      : this.introVideo.muted ? 'Sound on' : 'Mute';
  }

  private toggleCaptions = (): void => {
    const track = this.introVideo.textTracks[0];
    if (!track) return;
    track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
    this.captionsIntro.textContent = track.mode === 'showing' ? 'Captions on' : 'Captions off';
  };

  private openSettings = (): void => {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.settingsDialog.hidden = false;
    this.setChromeBlocked(true);
    this.quality.focus();
  };

  private closeSettings = (): void => {
    this.settingsDialog.hidden = true;
    this.setChromeBlocked(false);
    this.previousFocus?.focus();
    this.previousFocus = null;
  };

  private onQualityChange = (): void => {
    if (this.quality.value === 'auto') {
      this.options.settings.setAdaptiveQuality(true, this.options.settings.quality);
    } else if (isQualityLevel(this.quality.value)) {
      this.options.settings.setQuality(this.quality.value);
    }
    if (this.options.settings.quality === 'low') this.removeMenuMedia();
    else this.addMenuMedia();
  };

  private onVolumeChange = (): void => {
    this.options.settings.setVolume(Number(this.volume.value) / 100);
    this.updateVolumeOutput();
  };

  private onVoiceVolumeChange = (): void => {
    this.options.settings.setVoiceVolume(Number(this.voiceVolume.value) / 100);
    this.voiceVolumeOutput.value = `${this.voiceVolume.value}%`;
  };

  private onMotionPreferenceChange = (): void => {
    if (this.motionPreference.matches) {
      if (this.introPlaying) this.stopIntro();
      this.removeMenuMedia();
    }
    else this.addMenuMedia();
  };

  private updateVolumeOutput(): void {
    this.volumeOutput.value = `${this.volume.value}%`;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.intro.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.stopIntro();
        return;
      }
      if (event.key !== 'Tab') return;
      this.trapFocus(event, [this.captionsIntro, this.muteIntro, this.skipIntro]
        .filter((control) => !control.hidden && !control.disabled));
      return;
    }
    if (this.settingsDialog.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSettings();
      return;
    }
    if (event.key !== 'Tab') return;
    this.trapFocus(event, [this.quality, this.volume, this.voiceVolume, this.settingsClose]);
  };

  private trapFocus(event: KeyboardEvent, controls: HTMLElement[]): void {
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const direction = event.shiftKey ? -1 : 1;
    const next = current < 0
      ? event.shiftKey ? controls.length - 1 : 0
      : (current + direction + controls.length) % controls.length;
    controls[next]!.focus();
    event.preventDefault();
  }

  private setChromeBlocked(blocked: boolean): void {
    this.chrome.inert = blocked;
    this.chrome.setAttribute('aria-hidden', String(blocked));
    if (!blocked) this.chrome.removeAttribute('aria-hidden');
  }
}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function configureButton(button: HTMLButtonElement, label: string): void {
  button.type = 'button';
  button.className = 'rww-title-action';
  button.textContent = label;
}

function field(labelText: string, control: HTMLElement, labelFor = control.id): HTMLDivElement {
  const wrapper = div('rww-title-field');
  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = labelFor;
  wrapper.append(label, control);
  return wrapper;
}
