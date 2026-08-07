import type { Settings } from '@render/settings';
import { isQualityLevel } from '@render/settings';
import { FACTION_NAME, Faction } from '@sim/data';
import type { PresentationMedia } from '../presentation/media';
import { createCampaignProfile, type CampaignProfile } from '../campaign/campaignProfile';
import {
  CAMPAIGN_MISSIONS,
  campaignMission,
  type CampaignMission,
  type CampaignMissionId,
} from '../campaign/missionRegistry';
import './titleScreen.css';

export type TitleAction =
  | { kind: 'new-skirmish'; playerFaction: Faction }
  | { kind: 'continue' }
  | { kind: 'campaign'; missionId: CampaignMissionId; intent: 'start' | 'continue' | 'replay' };
const INTRO_TIMEOUT_MILLISECONDS = 120_000;

export interface TitleScreenOptions {
  settings: Settings;
  hasSave: boolean;
  campaignProfile?: CampaignProfile;
  media: PresentationMedia;
  statusMessage?: string;
  campaignStatusMessage?: string;
  openCampaign?: boolean;
}

export class TitleScreen {
  readonly root = document.createElement('section');
  private readonly chrome = div('rww-title-chrome');
  private readonly settingsDialog = document.createElement('div');
  private readonly intro = document.createElement('div');
  private readonly introVideo = document.createElement('video');
  private readonly newSkirmish = document.createElement('button');
  private readonly continueGame = document.createElement('button');
  private readonly campaignButton = document.createElement('button');
  private readonly settingsButton = document.createElement('button');
  private readonly faction = document.createElement('select');
  private readonly settingsClose = document.createElement('button');
  private readonly quality = document.createElement('select');
  private readonly volume = document.createElement('input');
  private readonly volumeOutput = document.createElement('output');
  private readonly voiceVolume = document.createElement('input');
  private readonly voiceVolumeOutput = document.createElement('output');
  private readonly status = document.createElement('p');
  private readonly campaignDialog = document.createElement('div');
  private readonly campaignClose = document.createElement('button');
  private readonly campaignBackdrop = document.createElement('img');
  private readonly campaignRecord = document.createElement('section');
  private readonly campaignDetail = document.createElement('aside');
  private readonly campaignArt = document.createElement('div');
  private readonly campaignArtImage = document.createElement('img');
  private readonly campaignDetailKicker = document.createElement('p');
  private readonly campaignDetailTitle = document.createElement('h3');
  private readonly campaignDetailState = document.createElement('span');
  private readonly campaignDetailPurpose = document.createElement('p');
  private readonly campaignDetailProgress = document.createElement('p');
  private readonly campaignDetailHistory = document.createElement('p');
  private readonly campaignPrimaryAction = document.createElement('button');
  private readonly campaignStatus = document.createElement('p');
  private readonly campaignMissionButtons: HTMLButtonElement[] = [];
  private readonly campaignProfile: CampaignProfile;
  private selectedCampaignMissionId: CampaignMissionId;
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
    this.campaignProfile = options.campaignProfile ?? createCampaignProfile();
    this.selectedCampaignMissionId = this.campaignProfile.currentMissionId ?? 'compact-01';
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
    this.faction.id = 'rww-title-faction';
    this.faction.setAttribute('aria-label', 'Player faction');
    for (const [value, faction] of [
      ['compact', Faction.Compact],
      ['choir', Faction.Choir],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = FACTION_NAME[faction];
      this.faction.appendChild(option);
    }
    const factionField = field('Player faction', this.faction);
    factionField.classList.add('rww-title-faction');
    configureButton(this.newSkirmish, 'New Skirmish');
    configureButton(this.continueGame, 'Continue');
    this.continueGame.classList.add('rww-title-continue');
    configureButton(this.campaignButton, 'Campaign');
    configureButton(this.settingsButton, 'Settings');
    this.continueGame.disabled = !options.hasSave;
    actions.append(this.newSkirmish, this.campaignButton, this.continueGame, this.settingsButton);
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
    deck.append(factionField, actions, this.status, footer);
    this.chrome.append(topline, copy, deck);
    this.root.appendChild(this.chrome);

    this.buildSettings();
    this.buildCampaign();
    this.buildIntro();
    this.root.addEventListener('keydown', this.onKeyDown);
    this.newSkirmish.addEventListener('click', this.onNewSkirmish);
    this.continueGame.addEventListener('click', this.onContinue);
    this.campaignButton.addEventListener('click', this.openCampaign);
    this.campaignClose.addEventListener('click', this.closeCampaign);
    this.campaignPrimaryAction.addEventListener('click', this.onCampaignPrimaryAction);
    this.settingsButton.addEventListener('click', this.openSettings);
    this.settingsClose.addEventListener('click', this.closeSettings);
    this.motionPreference.addEventListener('change', this.onMotionPreferenceChange);
    if (options.openCampaign) this.openCampaign();
  }

  show(): Promise<TitleAction> {
    document.body.appendChild(this.root);
    requestAnimationFrame(() => this.faction.focus());
    return new Promise((resolve) => { this.resolveAction = resolve; });
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.newSkirmish.removeEventListener('click', this.onNewSkirmish);
    this.continueGame.removeEventListener('click', this.onContinue);
    this.campaignButton.removeEventListener('click', this.openCampaign);
    this.campaignClose.removeEventListener('click', this.closeCampaign);
    this.campaignPrimaryAction.removeEventListener('click', this.onCampaignPrimaryAction);
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

  private buildCampaign(): void {
    this.campaignDialog.className = 'rww-title-campaign';
    this.campaignDialog.hidden = true;
    this.campaignDialog.setAttribute('role', 'dialog');
    this.campaignDialog.setAttribute('aria-modal', 'true');
    this.campaignDialog.setAttribute('aria-label', 'Campaign archive');
    const atmosphere = div('rww-title-campaign-atmosphere');
    atmosphere.append(div('rww-title-campaign-ring'), div('rww-title-campaign-spine'));
    const backdropSource = this.options.media.menuPoster;
    if (backdropSource) {
      this.campaignBackdrop.className = 'rww-title-campaign-backdrop';
      this.campaignBackdrop.alt = '';
      this.campaignBackdrop.src = backdropSource;
      this.campaignBackdrop.addEventListener('error', () => this.campaignBackdrop.remove(), { once: true });
      atmosphere.prepend(this.campaignBackdrop);
    }
    this.campaignDialog.appendChild(atmosphere);
    const card = document.createElement('section');
    card.className = 'rww-title-campaign-card';
    const header = div('rww-title-campaign-header');
    const headingGroup = document.createElement('div');
    const kicker = document.createElement('p');
    kicker.textContent = 'Last Rotation campaign';
    const heading = document.createElement('h2');
    heading.textContent = 'Mission Archive';
    headingGroup.append(kicker, heading);
    configureButton(this.campaignClose, 'Close');
    header.append(headingGroup, this.campaignClose);

    this.buildCampaignRecord();

    const body = div('rww-title-campaign-body');
    const roster = div('rww-title-campaign-roster');
    const arcs = div('rww-title-campaign-arcs');
    arcs.setAttribute('role', 'listbox');
    arcs.setAttribute('aria-label', 'Campaign missions');
    for (const faction of [Faction.Compact, Faction.Choir]) {
      const arc = document.createElement('section');
      arc.className = faction === Faction.Compact ? 'compact' : 'choir';
      const arcHeading = document.createElement('h3');
      arcHeading.textContent = FACTION_NAME[faction];
      const doctrine = document.createElement('p');
      doctrine.textContent = faction === Faction.Compact ? 'Anchor Protocol' : 'Migration Protocol';
      const list = document.createElement('ol');
      for (const mission of CAMPAIGN_MISSIONS.filter((candidate) => candidate.faction === faction)) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        const state = campaignMissionState(this.campaignProfile, mission.id);
        button.type = 'button';
        button.id = `rww-campaign-option-${mission.id}`;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', 'false');
        button.setAttribute('aria-controls', 'rww-campaign-detail');
        button.dataset.campaignMissionId = mission.id;
        button.dataset.state = state;
        button.dataset.continuation = String(this.campaignProfile.currentMissionId === mission.id);
        button.setAttribute('aria-label', mission.title);
        const node = document.createElement('span');
        node.className = 'rww-title-campaign-node';
        node.setAttribute('aria-hidden', 'true');
        node.textContent = state === 'completed' ? '✓' : '';
        const index = document.createElement('span');
        index.className = 'rww-title-campaign-index';
        index.textContent = String(mission.campaignIndex).padStart(2, '0');
        const name = document.createElement('strong');
        name.textContent = mission.title;
        const stateLabel = document.createElement('span');
        stateLabel.className = 'rww-title-campaign-state';
        stateLabel.textContent = state;
        button.append(node, index, name, stateLabel);
        button.addEventListener('click', () => this.selectCampaignMission(mission.id));
        button.addEventListener('focus', () => this.selectCampaignMission(mission.id));
        this.campaignMissionButtons.push(button);
        item.appendChild(button);
        list.appendChild(item);
      }
      arc.append(arcHeading, doctrine, list);
      arcs.appendChild(arc);
    }

    roster.appendChild(arcs);
    this.campaignDetail.id = 'rww-campaign-detail';
    this.campaignDetail.className = 'rww-title-campaign-detail';
    this.campaignDetail.setAttribute('role', 'region');
    this.campaignDetail.setAttribute('aria-label', 'Selected mission details');
    this.campaignDetail.setAttribute('aria-live', 'polite');
    this.campaignArt.className = 'rww-title-campaign-art';
    this.campaignArtImage.alt = '';
    this.campaignArtImage.addEventListener('error', this.removeCampaignArt);
    this.campaignArt.append(this.campaignArtImage, div('rww-title-campaign-art-scan'));
    this.campaignDetailKicker.className = 'rww-title-campaign-detail-kicker';
    this.campaignDetailTitle.id = 'rww-campaign-detail-title';
    this.campaignDetailState.className = 'rww-title-campaign-detail-state';
    this.campaignDetailPurpose.className = 'rww-title-campaign-purpose';
    this.campaignDetailProgress.className = 'rww-title-campaign-progress';
    this.campaignDetailHistory.className = 'rww-title-campaign-history';
    configureButton(this.campaignPrimaryAction, 'Begin mission');
    this.campaignPrimaryAction.classList.add('rww-title-campaign-primary');
    this.campaignDetail.append(
      this.campaignArt,
      this.campaignDetailKicker,
      this.campaignDetailTitle,
      this.campaignDetailState,
      this.campaignDetailPurpose,
      this.campaignDetailProgress,
      this.campaignDetailHistory,
      this.campaignPrimaryAction,
    );
    body.append(roster, this.campaignDetail);

    const footer = div('rww-title-campaign-footer');
    this.campaignStatus.setAttribute('role', 'status');
    this.campaignStatus.setAttribute('aria-live', 'polite');
    this.campaignStatus.textContent = this.options.campaignStatusMessage ?? '';
    this.campaignStatus.hidden = this.campaignStatus.textContent === '';
    footer.append(this.campaignStatus);
    footer.hidden = this.campaignStatus.hidden;
    card.append(header, this.campaignRecord, body, footer);
    this.campaignDialog.appendChild(card);
    this.root.appendChild(this.campaignDialog);
    this.selectCampaignMission(this.selectedCampaignMissionId);
  }

  private buildCampaignRecord(): void {
    this.campaignRecord.className = 'rww-title-campaign-record';
    this.campaignRecord.setAttribute('role', 'region');
    this.campaignRecord.setAttribute('aria-label', 'Campaign record');
    const heading = document.createElement('h3');
    heading.textContent = 'Campaign record';
    const completed = this.campaignProfile.completedMissionIds.length;
    const compactCompleted = this.campaignProfile.completedMissionIds.filter((id) =>
      campaignMission(id).faction === Faction.Compact).length;
    const choirCompleted = completed - compactCompleted;
    const lastResult = this.campaignProfile.lastResult;
    const current = this.campaignProfile.currentMissionId
      ? campaignMission(this.campaignProfile.currentMissionId)
      : null;
    const entries: Array<[string, string]> = [
      ['Archive completion', `${completed} / ${CAMPAIGN_MISSIONS.length}`],
      ['Compact arc', `${compactCompleted} / 6`],
      ['Choir arc', `${choirCompleted} / 6`],
      ['Last operation', lastResult
        ? `${campaignMission(lastResult.missionId).title} // ${lastResult.outcome}`
        : 'No operation recorded'],
      ['Current continuation', current
        ? `${current.title} // ${current.availability === 'available' ? 'ready' : 'unavailable'}`
        : 'Campaign arcs complete'],
    ];
    const list = document.createElement('dl');
    for (const [label, value] of entries) {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      item.append(term, description);
      list.appendChild(item);
    }
    this.campaignRecord.append(heading, list);
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

  private onNewSkirmish = (): void => {
    if (this.introPlaying) return;
    const action: TitleAction = {
      kind: 'new-skirmish',
      playerFaction: this.faction.value === 'choir' ? Faction.Choir : Faction.Compact,
    };
    if (!this.options.media.introVideo || this.motionPreference.matches) {
      this.finish(action);
      return;
    }
    void this.playIntro().then(() => this.finish(action));
  };

  private onContinue = (): void => this.finish({ kind: 'continue' });

  private onCampaignPrimaryAction = (): void => {
    const intent = this.campaignPrimaryAction.dataset.campaignIntent;
    if (intent !== 'start' && intent !== 'continue' && intent !== 'replay') return;
    this.finish({ kind: 'campaign', missionId: this.selectedCampaignMissionId, intent });
  };

  private selectCampaignMission(missionId: CampaignMissionId): void {
    this.selectedCampaignMissionId = missionId;
    const mission = campaignMission(missionId);
    const state = campaignMissionState(this.campaignProfile, missionId);
    for (const button of this.campaignMissionButtons) {
      const selected = button.dataset.campaignMissionId === missionId;
      button.dataset.selected = String(selected);
      button.setAttribute('aria-selected', String(selected));
    }
    const faction = FACTION_NAME[mission.faction];
    this.campaignDetail.dataset.faction = mission.faction === Faction.Compact ? 'compact' : 'choir';
    const artSource = this.options.media.campaignMissionArt?.[missionId];
    if (artSource) {
      this.campaignArtImage.src = artSource;
      this.campaignArt.hidden = false;
    } else {
      this.campaignArtImage.removeAttribute('src');
      this.campaignArt.hidden = true;
    }
    this.campaignDetailKicker.textContent = `${faction} // Mission ${String(mission.campaignIndex).padStart(2, '0')}`;
    this.campaignDetailTitle.textContent = mission.title;
    this.campaignDetailState.textContent = state;
    this.campaignDetailPurpose.textContent = mission.purpose;
    this.campaignDetailProgress.textContent = campaignProgressionContext(mission, state);
    this.campaignDetailHistory.textContent = campaignMissionHistory(this.campaignProfile, mission, state);
    this.campaignDetailHistory.hidden = this.campaignDetailHistory.textContent === '';
    const action = campaignMissionAction(this.campaignProfile, mission, state);
    this.campaignPrimaryAction.textContent = action.label;
    this.campaignPrimaryAction.setAttribute('aria-label', action.label);
    this.campaignPrimaryAction.disabled = action.intent === null;
    if (action.intent === null) delete this.campaignPrimaryAction.dataset.campaignIntent;
    else this.campaignPrimaryAction.dataset.campaignIntent = action.intent;
  }

  private removeCampaignArt = (): void => {
    this.campaignArtImage.removeAttribute('src');
    this.campaignArt.hidden = true;
  };

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

  private openCampaign = (): void => {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.campaignDialog.hidden = false;
    this.setChromeBlocked(true);
    const focusTarget = this.campaignMissionButtons.find((button) =>
      button.dataset.campaignMissionId === this.selectedCampaignMissionId) ?? this.campaignClose;
    requestAnimationFrame(() => focusTarget.focus());
  };

  private closeCampaign = (): void => {
    this.campaignDialog.hidden = true;
    this.setChromeBlocked(false);
    this.previousFocus?.focus();
    this.previousFocus = null;
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
    if (!this.campaignDialog.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeCampaign();
        return;
      }
      if (event.key === 'Tab') {
        this.trapFocus(event, [
          this.campaignClose,
          ...this.campaignMissionButtons,
          ...(this.campaignPrimaryAction.disabled ? [] : [this.campaignPrimaryAction]),
        ]);
      }
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

type CampaignMissionState = 'locked' | 'unavailable' | 'completed' | 'current' | 'unlocked';

function campaignMissionState(profile: CampaignProfile, missionId: CampaignMissionId): CampaignMissionState {
  const mission = CAMPAIGN_MISSIONS.find((candidate) => candidate.id === missionId)!;
  if (profile.completedMissionIds.includes(missionId)) return 'completed';
  if (!profile.unlockedMissionIds.includes(missionId)) return 'locked';
  if (mission.availability === 'unavailable') return 'unavailable';
  if (profile.currentMissionId === missionId) return 'current';
  return 'unlocked';
}

function campaignProgressionContext(mission: CampaignMission, state: CampaignMissionState): string {
  const previous = CAMPAIGN_MISSIONS.find((candidate) => candidate.nextMissionId === mission.id);
  const next = mission.nextMissionId ? campaignMission(mission.nextMissionId) : null;
  const position = `Mission ${String(mission.campaignIndex).padStart(2, '0')} of 06`;
  if (state === 'locked' && previous) return `${position}. Complete ${previous.title} to unlock this mission.`;
  if (mission.availability === 'unavailable') {
    return `${position}. Unlocked, but its production runtime scenario has not been migrated.`;
  }
  if (next) return `${position}. Completion advances the arc to ${next.title}.`;
  return `${position}. Final operation in this faction arc.`;
}

function campaignMissionAction(
  profile: CampaignProfile,
  mission: CampaignMission,
  state: CampaignMissionState,
): { label: string; intent: 'start' | 'continue' | 'replay' | null } {
  if (state === 'completed') return { label: `Replay ${mission.title}`, intent: 'replay' };
  if (state === 'locked') {
    const previous = CAMPAIGN_MISSIONS.find((candidate) => candidate.nextMissionId === mission.id);
    return { label: `Locked — complete ${previous?.title ?? 'the prior mission'}`, intent: null };
  }
  if (mission.availability === 'unavailable') {
    return { label: 'Unavailable — runtime migration pending', intent: null };
  }
  const continuing = state === 'current' && (profile.revision > 0 || profile.lastResult !== null);
  return {
    label: `${continuing ? 'Continue' : 'Begin'} ${mission.title}`,
    intent: continuing ? 'continue' : 'start',
  };
}

function campaignMissionHistory(
  profile: CampaignProfile,
  mission: CampaignMission,
  state: CampaignMissionState,
): string {
  const lastResult = profile.lastResult;
  if (state === 'completed') {
    return lastResult?.missionId === mission.id
      ? `Completion recorded. Last operation: ${lastResult.outcome}. Replay remains available.`
      : 'Completion recorded in the campaign profile. Replay remains available.';
  }
  if (lastResult?.missionId === mission.id) return `Last operation: ${lastResult.outcome}.`;
  return '';
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
