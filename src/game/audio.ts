const MUTE_KEY = 'solaris_muted_v1';
const AUDIO_SETTINGS_KEY = 'solaris_audio_settings_v1';

export interface AudioSettings {
  master: number;
  sfx: number;
  voice: number;
  ui: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 1,
  sfx: 0.9,
  voice: 0.95,
  ui: 0.85,
};

const PENTATONIC_HZ = [440, 493.88, 554.37, 659.25, 739.99, 880, 987.77, 1108.73];

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 1;
  return Math.max(0, Math.min(1, val));
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private uiBus: GainNode | null = null;

  private muted: boolean = false;
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private saveSettingsTimer: number | null = null;
  private lastHoverTime = 0;
  private pauseHum: {
    osc1: OscillatorNode;
    osc2: OscillatorNode;
    lfo: OscillatorNode;
    masterGain: GainNode;
  } | null = null;

  private voiceBuffers: Partial<Record<'hullLow' | 'hullCritical' | 'welcome' | 'abandon', AudioBuffer>> = {};
  private voiceLoading = false;
  private activeWarningSource: AudioBufferSourceNode | null = null;
  private activeEventVoiceSource: AudioBufferSourceNode | null = null;
  private cutsceneMasterGain: GainNode | null = null;
  private cutsceneStopNodes: Array<{ stop: (when?: number) => void }> = [];

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === 'true';
      const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AudioSettings>;
        this.settings = {
          master: clamp01(parsed.master ?? DEFAULT_AUDIO_SETTINGS.master),
          sfx: clamp01(parsed.sfx ?? DEFAULT_AUDIO_SETTINGS.sfx),
          voice: clamp01(parsed.voice ?? DEFAULT_AUDIO_SETTINGS.voice),
          ui: clamp01(parsed.ui ?? DEFAULT_AUDIO_SETTINGS.ui),
        };
      }
    } catch {
      this.muted = false;
      this.settings = { ...DEFAULT_AUDIO_SETTINGS };
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<AudioSettings>): AudioSettings {
    this.settings = {
      master: clamp01(partial.master ?? this.settings.master),
      sfx: clamp01(partial.sfx ?? this.settings.sfx),
      voice: clamp01(partial.voice ?? this.settings.voice),
      ui: clamp01(partial.ui ?? this.settings.ui),
    };
    this.applyBusGains();
    if (this.saveSettingsTimer !== null) {
      window.clearTimeout(this.saveSettingsTimer);
    }
    this.saveSettingsTimer = window.setTimeout(() => {
      this.saveSettingsTimer = null;
      try {
        localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(this.settings));
      } catch {
        // Ignore storage failures
      }
    }, 200);
    return { ...this.settings };
  }

  public setMuted(nextMuted: boolean): boolean {
    this.muted = nextMuted;
    if (this.muted) {
      this.stopWarningVoice();
      this.stopEventVoice();
      this.stopPauseHum();
      this.stopCutsceneAudio();
    }
    this.applyBusGains();
    try {
      localStorage.setItem(MUTE_KEY, String(this.muted));
    } catch {
      // Ignore storage failures
    }
    return this.muted;
  }

  public toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  private applyBusGains(): void {
    if (!this.ctx || !this.masterBus || !this.sfxBus || !this.voiceBus || !this.uiBus) return;
    const now = this.ctx.currentTime;
    const masterGain = this.muted ? 0 : this.settings.master;
    this.masterBus.gain.setTargetAtTime(masterGain, now, 0.015);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, now, 0.015);
    this.voiceBus.gain.setTargetAtTime(this.settings.voice, now, 0.015);
    this.uiBus.gain.setTargetAtTime(this.settings.ui, now, 0.015);
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || this.settings.master <= 0.001) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.voiceBus = this.ctx.createGain();
      this.uiBus = this.ctx.createGain();

      this.sfxBus.connect(this.masterBus);
      this.voiceBus.connect(this.masterBus);
      this.uiBus.connect(this.masterBus);
      this.masterBus.connect(this.ctx.destination);

      this.masterBus.gain.setValueAtTime(this.muted ? 0 : this.settings.master, this.ctx.currentTime);
      this.sfxBus.gain.setValueAtTime(this.settings.sfx, this.ctx.currentTime);
      this.voiceBus.gain.setValueAtTime(this.settings.voice, this.ctx.currentTime);
      this.uiBus.gain.setValueAtTime(this.settings.ui, this.ctx.currentTime);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.voiceLoading) {
      this.preloadCyclopsVoices(this.ctx);
    }
    return this.ctx;
  }

  private getBus(channel: 'sfx' | 'voice' | 'ui'): AudioNode {
    if (channel === 'sfx' && this.sfxBus) return this.sfxBus;
    if (channel === 'voice' && this.voiceBus) return this.voiceBus;
    if (channel === 'ui' && this.uiBus) return this.uiBus;
    return this.ctx!.destination;
  }

  private preloadCyclopsVoices(ctx: AudioContext): void {
    this.voiceLoading = true;
    const urls: Partial<Record<'hullLow' | 'hullCritical' | 'welcome' | 'abandon', string>> = {
      hullLow: '/assets/audio/cyclops_hull_low.mp3',
      hullCritical: '/assets/audio/cyclops_hull_critical.mp3',
    };

    (Object.keys(urls) as Array<keyof typeof urls>).forEach((key) => {
      const url = urls[key];
      if (!url) return;
      fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('Audio fetch failed'))))
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => {
          this.voiceBuffers[key] = decoded;
        })
        .catch(() => {
          // Ignore failed audio decode
        });
    });
  }

  public unlock(): void {
    this.ensureContext();
  }

  public playShoot(overdrive: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq = overdrive ? 760 : 620;
    const jitter = (Math.random() - 0.5) * 60;

    osc.type = overdrive ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(baseFreq + jitter, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.085);

    gain.gain.setValueAtTime(overdrive ? 0.075 : 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.getBus('sfx'));

    osc.start(now);
    osc.stop(now + 0.095);
  }

  public playDash(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.18);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(700, now);
    filter.Q.setValueAtTime(1.8, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.getBus('sfx'));

    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playHit(heavy: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(heavy ? 240 : 340, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.06);

    gain.gain.setValueAtTime(heavy ? 0.07 : 0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    osc.connect(gain);
    gain.connect(this.getBus('sfx'));

    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playEnemyDestroy(size: 'small' | 'medium' | 'large'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = size === 'large' ? 0.28 : size === 'medium' ? 0.18 : 0.12;
    const startFreq = size === 'large' ? 170 : size === 'medium' ? 230 : 310;

    // Low thump
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(startFreq, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + dur);

    subGain.gain.setValueAtTime(size === 'large' ? 0.16 : 0.11, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    sub.connect(subGain);
    subGain.connect(this.getBus('sfx'));
    sub.start(now);
    sub.stop(now + dur + 0.01);

    // Metallic overtone
    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = 'triangle';
    chime.frequency.setValueAtTime(startFreq * 2.4, now);
    chime.frequency.exponentialRampToValueAtTime(startFreq * 0.9, now + dur * 0.8);

    chimeGain.gain.setValueAtTime(0.055, now);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.85);

    chime.connect(chimeGain);
    chimeGain.connect(this.getBus('sfx'));
    chime.start(now);
    chime.stop(now + dur);
  }

  public playSparkPickup(combo: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const idx = Math.min(Math.max(0, combo - 1), PENTATONIC_HZ.length - 1);
    const freq = PENTATONIC_HZ[idx];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + 0.09);

    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(this.getBus('sfx'));

    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playTelegraph(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.16);

    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    osc.connect(gain);
    gain.connect(this.getBus('sfx'));

    osc.start(now);
    osc.stop(now + 0.18);
  }

  public playOverdrive(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.045;
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

      osc.connect(gain);
      gain.connect(this.getBus('sfx'));
      osc.start(t);
      osc.stop(t + 0.34);
    });
  }

  public playPlayerDamage(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.28);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.getBus('sfx'));

    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playWaveClear(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const chord = [523.25, 659.25, 783.99];
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.06;
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(this.getBus('sfx'));
      osc.start(t);
      osc.stop(t + 0.37);
    });
  }

  public playHullPressurize(isFullHeal = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = 0.85;

    // 1. Subtle pneumatic airlock pressurization hiss (soft bandpass noise sweeping inward)
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.55;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(680, now);
    filter.frequency.exponentialRampToValueAtTime(2150, now + 0.32);
    filter.frequency.exponentialRampToValueAtTime(920, now + dur);
    filter.Q.setValueAtTime(2.6, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.linearRampToValueAtTime(0.036, now + 0.12);
    nGain.gain.linearRampToValueAtTime(0.024, now + 0.45);
    nGain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.getBus('sfx'));
    noise.start(now);
    noise.stop(now + dur + 0.02);

    // 2. Smooth ascending nanite-seal cabin pressure tone
    const sealOsc = ctx.createOscillator();
    const sealGain = ctx.createGain();
    const sealLp = ctx.createBiquadFilter();
    sealOsc.type = 'triangle';
    sealOsc.frequency.setValueAtTime(246.94, now);
    sealOsc.frequency.exponentialRampToValueAtTime(493.88, now + 0.34);
    sealOsc.frequency.exponentialRampToValueAtTime(isFullHeal ? 739.99 : 659.25, now + 0.72);

    sealLp.type = 'lowpass';
    sealLp.frequency.setValueAtTime(1400, now);

    sealGain.gain.setValueAtTime(0.001, now);
    sealGain.gain.linearRampToValueAtTime(0.044, now + 0.08);
    sealGain.gain.exponentialRampToValueAtTime(0.001, now + 0.76);

    sealOsc.connect(sealLp);
    sealLp.connect(sealGain);
    sealGain.connect(this.getBus('sfx'));
    sealOsc.start(now);
    sealOsc.stop(now + 0.78);

    // 3. Delicate crystalline seal confirmation chimes staggered across progressive repair
    const chimes = isFullHeal ? [783.99, 1046.5] : [659.25, 987.77];
    chimes.forEach((freq, idx) => {
      const t = now + 0.16 + idx * 0.24;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.032, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.32);
      osc.connect(g);
      g.connect(this.getBus('sfx'));
      osc.start(t);
      osc.stop(t + 0.34);
    });
  }

  public playDecompression(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = 1.12;

    // Pressurized decompression hiss (bandpass-filtered noise)
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.7;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + dur);
    filter.Q.setValueAtTime(2.2, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.linearRampToValueAtTime(0.11, now + 0.08);
    nGain.gain.linearRampToValueAtTime(0.14, now + dur * 0.85);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.getBus('sfx'));
    noise.start(now);
    noise.stop(now + dur + 0.02);

    // Rising reactor overload whine
    const whine = ctx.createOscillator();
    const wGain = ctx.createGain();
    whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(180, now);
    whine.frequency.exponentialRampToValueAtTime(840, now + dur);

    wGain.gain.setValueAtTime(0.02, now);
    wGain.gain.linearRampToValueAtTime(0.09, now + dur * 0.92);
    wGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    whine.connect(wGain);
    wGain.connect(this.getBus('sfx'));
    whine.start(now);
    whine.stop(now + dur + 0.02);
  }

  public playSubExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.16);

    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    osc.connect(gain);
    gain.connect(this.getBus('sfx'));
    osc.start(now);
    osc.stop(now + 0.18);
  }

  public playPlayerExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Deep resonant bass boom
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(135, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.65);

    subGain.gain.setValueAtTime(0.26, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);

    sub.connect(subGain);
    subGain.connect(this.getBus('sfx'));
    sub.start(now);
    sub.stop(now + 0.7);

    // Filtered explosion blast noise
    const dur = 0.55;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + dur);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.18, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.getBus('sfx'));
    noise.start(now);
    noise.stop(now + dur + 0.02);

    // Celestial brass shimmer ring
    const chime = ctx.createOscillator();
    const cGain = ctx.createGain();
    chime.type = 'triangle';
    chime.frequency.setValueAtTime(520, now);
    chime.frequency.exponentialRampToValueAtTime(140, now + 0.45);

    cGain.gain.setValueAtTime(0.08, now);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    chime.connect(cGain);
    cGain.connect(this.getBus('sfx'));
    chime.start(now);
    chime.stop(now + 0.5);
  }

  private playVoiceClip(
    key: 'hullLow' | 'hullCritical' | 'welcome' | 'abandon',
    volume: number,
    isWarningLoop: boolean
  ): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    const buffer = this.voiceBuffers[key];
    if (!buffer) return false;

    if (isWarningLoop) {
      this.stopWarningVoice();
    } else {
      this.stopEventVoice();
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);

    source.connect(gain);
    gain.connect(this.getBus('voice'));
    source.onended = () => {
      if (isWarningLoop && this.activeWarningSource === source) {
        this.activeWarningSource = null;
      } else if (!isWarningLoop && this.activeEventVoiceSource === source) {
        this.activeEventVoiceSource = null;
      }
    };

    if (isWarningLoop) {
      this.activeWarningSource = source;
    } else {
      this.activeEventVoiceSource = source;
    }

    source.start(ctx.currentTime);
    return true;
  }

  public playWelcomeVoice(): void {
    if (this.muted) return;
    const played = this.playVoiceClip('welcome', 0.85, false);
    if (!played) {
      // Retry shortly once audio buffer finishes decoding on first tap
      window.setTimeout(() => {
        if (!this.muted) {
          this.playVoiceClip('welcome', 0.85, false);
        }
      }, 350);
    }
  }

  public playAbandonShipVoice(): void {
    if (this.muted) return;
    this.stopWarningVoice();
    this.playVoiceClip('abandon', 0.95, false);
  }

  private stopEventVoice(): void {
    if (this.activeEventVoiceSource) {
      try {
        this.activeEventVoiceSource.stop();
      } catch {
        // Ignore already stopped source
      }
      this.activeEventVoiceSource = null;
    }
  }

  public playWarningVoice(critical = false): void {
    if (this.muted) return;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Subtle low Cyclops-style hull alert pulse before the voice line
    const notes = critical ? [138.59, 103.83] : [138.59];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.16;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(380, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.055, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.getBus('voice'));
      osc.start(start);
      osc.stop(start + 0.15);
    });

    // 2. Play exact Cyclops deep male voice clip ("Caution. Hull integrity low." / "Warning. Hull integrity critical.")
    const clipKey = critical ? 'hullCritical' : 'hullLow';
    const played = this.playVoiceClip(clipKey, 0.96, true);
    if (!played) {
      // If still decoding on very first trigger, retry briefly
      window.setTimeout(() => {
        if (!this.muted) {
          this.playVoiceClip(clipKey, 0.96, true);
        }
      }, 320);
    }
  }

  public stopWarningVoice(): void {
    if (this.activeWarningSource) {
      try {
        this.activeWarningSource.stop();
      } catch {
        // Ignore already stopped source
      }
      this.activeWarningSource = null;
    }
  }

  public playUiHover(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastHoverTime < 48) return;
    this.lastHoverTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Delicate brass gear tick
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.024);

    gain.gain.setValueAtTime(0.024, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.028);

    osc.connect(gain);
    gain.connect(this.getBus('ui'));
    osc.start(now);
    osc.stop(now + 0.032);
  }

  public playUiClick(variant: 'primary' | 'secondary' | 'tab' = 'secondary'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Crisp metallic brass click transient
    const clickOsc = ctx.createOscillator();
    const clickFilter = ctx.createBiquadFilter();
    const clickGain = ctx.createGain();

    const clickFreq = variant === 'primary' ? 1180 : variant === 'tab' ? 1560 : 1340;
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(clickFreq, now);
    clickOsc.frequency.exponentialRampToValueAtTime(clickFreq * 0.42, now + 0.032);

    clickFilter.type = 'bandpass';
    clickFilter.frequency.setValueAtTime(2100, now);
    clickFilter.Q.setValueAtTime(3.2, now);

    clickGain.gain.setValueAtTime(0.065, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);

    clickOsc.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.getBus('ui'));
    clickOsc.start(now);
    clickOsc.stop(now + 0.04);

    // 2. Warm astrolabic resonant harmonic tail
    const baseHz = variant === 'primary' ? 440 : variant === 'tab' ? 587.33 : 493.88;
    const tailDur = variant === 'primary' ? 0.19 : 0.12;
    const freqs = variant === 'primary' ? [baseHz, baseHz * 1.498] : [baseHz];

    freqs.forEach((freq, idx) => {
      const hum = ctx.createOscillator();
      const hGain = ctx.createGain();
      hum.type = 'sine';
      hum.frequency.setValueAtTime(freq, now + idx * 0.02);
      hum.frequency.exponentialRampToValueAtTime(freq * 0.985, now + tailDur);

      hGain.gain.setValueAtTime(variant === 'primary' ? 0.045 : 0.032, now + idx * 0.02);
      hGain.gain.exponentialRampToValueAtTime(0.0008, now + tailDur);

      hum.connect(hGain);
      hGain.connect(this.getBus('ui'));
      hum.start(now + idx * 0.02);
      hum.stop(now + tailDur + 0.015);
    });
  }

  public playPauseTransition(opening: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    // Astrolabic brass ring lock / unlock sweep
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(opening ? 520 : 310, now);
    osc.frequency.exponentialRampToValueAtTime(opening ? 290 : 540, now + 0.16);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.getBus('ui'));
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public startPauseHum(): void {
    if (this.muted || this.pauseHum) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const masterGain = ctx.createGain();

    // Warm celestial astrolabe mechanical hum (perfect fifth drone with gentle shimmer)
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(110, now);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(165.4, now);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.75, now);
    lfoGain.gain.setValueAtTime(0.006, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(340, now);

    masterGain.gain.setValueAtTime(0.0005, now);
    masterGain.gain.linearRampToValueAtTime(0.022, now + 0.28);

    lfo.connect(lfoGain);
    lfoGain.connect(masterGain.gain);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(this.getBus('ui'));

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);

    this.pauseHum = { osc1, osc2, lfo, masterGain };
  }

  public stopPauseHum(): void {
    if (!this.pauseHum) return;
    const { osc1, osc2, lfo, masterGain } = this.pauseHum;
    this.pauseHum = null;

    if (this.ctx) {
      const now = this.ctx.currentTime;
      try {
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(Math.max(0.0005, masterGain.gain.value), now);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        osc1.stop(now + 0.18);
        osc2.stop(now + 0.18);
        lfo.stop(now + 0.18);
      } catch {
        // Ignore already stopped oscillators
      }
    }
  }

  public playGameOver(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [392.0, 349.23, 293.66, 220.0];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.1;
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.085, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.36);

      osc.connect(gain);
      gain.connect(this.getBus('sfx'));
      osc.start(t);
      osc.stop(t + 0.38);
    });
  }

  public stopCutsceneAudio(): void {
    if (this.cutsceneMasterGain && this.ctx) {
      const now = this.ctx.currentTime;
      try {
        this.cutsceneMasterGain.gain.cancelScheduledValues(now);
        this.cutsceneMasterGain.gain.setValueAtTime(
          Math.max(0.0005, this.cutsceneMasterGain.gain.value),
          now
        );
        this.cutsceneMasterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      } catch {
        // Ignore gain automation error
      }
    }
    const stopAt = this.ctx ? this.ctx.currentTime + 0.1 : 0;
    for (const node of this.cutsceneStopNodes) {
      try {
        node.stop(stopAt);
      } catch {
        // Ignore already stopped audio nodes
      }
    }
    this.cutsceneStopNodes = [];
    this.cutsceneMasterGain = null;
  }

  public playCutsceneWarpSequence(): void {
    this.stopCutsceneAudio();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(1, now);
    bus.connect(this.getBus('sfx'));
    this.cutsceneMasterGain = bus;

    // 1. Orbit turbine spool-up (0.0s -> 1.75s) + hyper-warp surge (1.75s -> 3.35s)
    const drone = ctx.createOscillator();
    const drone2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const droneGain = ctx.createGain();

    drone.type = 'sawtooth';
    drone.frequency.setValueAtTime(58, now);
    drone.frequency.exponentialRampToValueAtTime(124, now + 1.72);
    drone.frequency.exponentialRampToValueAtTime(420, now + 1.98);
    drone.frequency.exponentialRampToValueAtTime(92, now + 3.32);

    drone2.type = 'triangle';
    drone2.frequency.setValueAtTime(116, now);
    drone2.frequency.exponentialRampToValueAtTime(248, now + 1.72);
    drone2.frequency.exponentialRampToValueAtTime(620, now + 2.02);
    drone2.frequency.exponentialRampToValueAtTime(140, now + 3.32);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(210, now);
    filter.frequency.exponentialRampToValueAtTime(680, now + 1.7);
    filter.frequency.exponentialRampToValueAtTime(2800, now + 1.92);
    filter.frequency.exponentialRampToValueAtTime(340, now + 3.3);
    filter.Q.setValueAtTime(2.4, now);

    droneGain.gain.setValueAtTime(0.001, now);
    droneGain.gain.linearRampToValueAtTime(0.08, now + 0.35);
    droneGain.gain.linearRampToValueAtTime(0.13, now + 1.72);
    droneGain.gain.linearRampToValueAtTime(0.19, now + 1.84);
    droneGain.gain.exponentialRampToValueAtTime(0.001, now + 3.35);

    drone.connect(filter);
    drone2.connect(filter);
    filter.connect(droneGain);
    droneGain.connect(bus);

    drone.start(now);
    drone2.start(now);
    drone.stop(now + 3.4);
    drone2.stop(now + 3.4);

    // 2. Hyper-warp launch bass boom + filtered noise rush at t = +1.75s
    const launchAt = now + 1.75;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, launchAt);
    sub.frequency.exponentialRampToValueAtTime(34, launchAt + 0.72);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.setValueAtTime(0.24, launchAt);
    subGain.gain.exponentialRampToValueAtTime(0.001, launchAt + 0.78);
    sub.connect(subGain);
    subGain.connect(bus);
    sub.start(launchAt);
    sub.stop(launchAt + 0.8);

    const dur = 1.45;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      ch[i] = (Math.random() * 2 - 1) * 0.65;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'bandpass';
    nFilter.frequency.setValueAtTime(1800, launchAt);
    nFilter.frequency.exponentialRampToValueAtTime(280, launchAt + dur);
    nFilter.Q.setValueAtTime(1.1, launchAt);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.001, launchAt);
    nGain.gain.linearRampToValueAtTime(0.14, launchAt + 0.06);
    nGain.gain.exponentialRampToValueAtTime(0.001, launchAt + dur);
    noise.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(bus);
    noise.start(launchAt);
    noise.stop(launchAt + dur + 0.02);

    this.cutsceneStopNodes = [drone, drone2, sub, noise];
  }

  public playCutsceneRiftExit(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.55);
    subGain.gain.setValueAtTime(0.22, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    sub.connect(subGain);
    subGain.connect(this.getBus('sfx'));
    sub.start(now);
    sub.stop(now + 0.6);

    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = 'triangle';
    chime.frequency.setValueAtTime(523.25, now);
    chime.frequency.exponentialRampToValueAtTime(261.63, now + 0.45);
    chimeGain.gain.setValueAtTime(0.08, now);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    chime.connect(chimeGain);
    chimeGain.connect(this.getBus('sfx'));
    chime.start(now);
    chime.stop(now + 0.5);
  }

  public playSlowMoExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(115, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.85);
    subGain.gain.setValueAtTime(0.24, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.88);
    sub.connect(subGain);
    subGain.connect(this.getBus('sfx'));
    sub.start(now);
    sub.stop(now + 0.9);

    const lowTone = ctx.createOscillator();
    const lowGain = ctx.createGain();
    lowTone.type = 'triangle';
    lowTone.frequency.setValueAtTime(240, now);
    lowTone.frequency.exponentialRampToValueAtTime(64, now + 0.65);
    lowGain.gain.setValueAtTime(0.09, now);
    lowGain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
    lowTone.connect(lowGain);
    lowGain.connect(this.getBus('sfx'));
    lowTone.start(now);
    lowTone.stop(now + 0.7);
  }
}
