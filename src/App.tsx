import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  Smartphone,
  Zap,
} from 'lucide-react';
import { CockpitDamageOverlay } from './components/CockpitDamageOverlay';
import { SettingsModal } from './components/SettingsModal';
import { TitleLockup } from './components/TitleLockup';
import { TutorialModal } from './components/TutorialModal';
import { LORE_ENTRIES } from './data/lore';
import { AudioSettings, DEFAULT_AUDIO_SETTINGS, GameAudio } from './game/audio';
import { SolarisEngine } from './game/engine';
import { DEFAULT_GAMEPLAY_SETTINGS, GameplaySettings, HudSnapshot } from './game/types';

const GAMEPLAY_SETTINGS_KEY = 'solaris_gameplay_settings_v1';
const TUTORIAL_DISABLED_KEY = 'solaris_tutorial_disabled_v1';

function loadTutorialDisabled(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadGameplaySettings(): GameplaySettings {
  try {
    const raw = localStorage.getItem(GAMEPLAY_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_GAMEPLAY_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameplaySettings>;
    return {
      screenShake:
        typeof parsed.screenShake === 'number' && Number.isFinite(parsed.screenShake)
          ? Math.max(0, Math.min(1, parsed.screenShake))
          : DEFAULT_GAMEPLAY_SETTINGS.screenShake,
      offscreenIndicators:
        typeof parsed.offscreenIndicators === 'boolean'
          ? parsed.offscreenIndicators
          : DEFAULT_GAMEPLAY_SETTINGS.offscreenIndicators,
      cockpitDamageFx:
        typeof parsed.cockpitDamageFx === 'boolean'
          ? parsed.cockpitDamageFx
          : DEFAULT_GAMEPLAY_SETTINGS.cockpitDamageFx,
    };
  } catch {
    return { ...DEFAULT_GAMEPLAY_SETTINGS };
  }
}

const INITIAL_HUD: HudSnapshot = {
  state: 'TITLE_MENU',
  score: 0,
  highScore: 0,
  combo: 1,
  comboTimerRatio: 0,
  wave: 1,
  hp: 4,
  maxHp: 4,
  overdriveRatio: 0,
  overdriveActive: false,
  dashReadyRatio: 1,
  kills: 0,
  maxCombo: 1,
  waveBanner: null,
  newRecord: false,
  damageFlashRatio: 0,
  damagePulseId: 0,
  repairAnimRatio: 0,
  repairPulseId: 0,
};

function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

function detectPreviewIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function checkNeedsLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.innerHeight > window.innerWidth &&
    (detectTouchDevice() || window.innerWidth < 900)
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SolarisEngine | null>(null);
  const audioRef = useRef<GameAudio | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [muted, setMuted] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [gameplaySettings, setGameplaySettings] = useState<GameplaySettings>(loadGameplaySettings);
  const [showSettings, setShowSettings] = useState(false);
  const settingsAutoPausedRef = useRef(false);
  const portraitAutoPausedRef = useRef(false);
  const [isTouch, setIsTouch] = useState<boolean>(detectTouchDevice);
  const [needsLandscape, setNeedsLandscape] = useState<boolean>(checkNeedsLandscape);
  const [isPreview] = useState<boolean>(detectPreviewIframe);
  const [showLore, setShowLore] = useState(false);
  const [loreTab, setLoreTab] = useState<'mission' | 'sentinels'>('mission');
  const [showTutorial, setShowTutorial] = useState(false);
  const [disableFutureTutorial, setDisableFutureTutorial] = useState(false);
  const [tutorialEnabled, setTutorialEnabled] = useState<boolean>(() => !loadTutorialDisabled());
  const tutorialDisabledRef = useRef<boolean>(loadTutorialDisabled());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const audio = new GameAudio();
    audioRef.current = audio;
    setMuted(audio.isMuted());
    setAudioSettings(audio.getSettings());

    const engine = new SolarisEngine(
      canvas,
      audio,
      (snapshot) => {
        setHud(snapshot);
      },
      () => {
        if (!tutorialDisabledRef.current) {
          setDisableFutureTutorial(false);
          engine.setTutorialActive(true);
          engine.togglePause();
          setShowTutorial(true);
        }
      }
    );
    engine.setGameplaySettings(loadGameplaySettings());
    engine.setRotated90(false);
    engineRef.current = engine;
    engine.startLoop();

    const onFirstTouch = () => {
      setIsTouch(true);
      setNeedsLandscape(checkNeedsLandscape());
    };
    const onOrientationOrResize = () => {
      setNeedsLandscape(checkNeedsLandscape());
    };
    window.addEventListener('touchstart', onFirstTouch, { passive: true, once: true });
    window.addEventListener('resize', onOrientationOrResize);
    window.addEventListener('orientationchange', onOrientationOrResize);

    return () => {
      window.removeEventListener('touchstart', onFirstTouch);
      window.removeEventListener('resize', onOrientationOrResize);
      window.removeEventListener('orientationchange', onOrientationOrResize);
      audio.stopPauseHum();
      audio.stopWarningVoice();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const tryEnterFullscreen = useCallback(async () => {
    try {
      const rootEl = document.documentElement;
      if (rootEl.requestFullscreen && !document.fullscreenElement) {
        await rootEl.requestFullscreen().catch(() => {});
      }
      const orientation = screen.orientation as { lock?: (mode: string) => Promise<void> } | undefined;
      if (orientation?.lock) {
        await orientation.lock('landscape').catch(() => {});
      }
    } catch {
      // Fullscreen / orientation lock not supported
    }
  }, []);

  const playHover = useCallback(() => {
    audioRef.current?.playUiHover();
  }, []);

  const handleToggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMuted = audioRef.current.toggleMute();
    setMuted(nextMuted);
    if (!nextMuted) {
      audioRef.current.playUiClick('tab');
    }
  }, []);

  const handleAudioSettingsChange = useCallback((partial: Partial<AudioSettings>) => {
    if (!audioRef.current) return;
    const updated = audioRef.current.updateSettings(partial);
    setAudioSettings(updated);
  }, []);

  const handleGameplaySettingsChange = useCallback((partial: Partial<GameplaySettings>) => {
    setGameplaySettings((prev) => {
      const next = { ...prev, ...partial };
      engineRef.current?.setGameplaySettings(next);
      try {
        localStorage.setItem(GAMEPLAY_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures
      }
      return next;
    });
  }, []);

  const handleTestSfx = useCallback(() => {
    audioRef.current?.playShoot(false);
  }, []);

  const handleTestVoice = useCallback(() => {
    audioRef.current?.playWarningVoice(false);
  }, []);

  const handleResetSettings = useCallback(() => {
    audioRef.current?.playUiClick('tab');
    if (audioRef.current) {
      const nextMuted = audioRef.current.setMuted(false);
      setMuted(nextMuted);
      const nextAudio = audioRef.current.updateSettings(DEFAULT_AUDIO_SETTINGS);
      setAudioSettings(nextAudio);
    }
    const nextGameplay = { ...DEFAULT_GAMEPLAY_SETTINGS };
    setGameplaySettings(nextGameplay);
    engineRef.current?.setGameplaySettings(nextGameplay);
    tutorialDisabledRef.current = false;
    setTutorialEnabled(true);
    try {
      localStorage.setItem(GAMEPLAY_SETTINGS_KEY, JSON.stringify(nextGameplay));
      localStorage.setItem(TUTORIAL_DISABLED_KEY, 'false');
    } catch {
      // Ignore storage failures
    }
  }, []);

  const handleToggleTutorialEnabled = useCallback(() => {
    audioRef.current?.playUiClick('tab');
    setTutorialEnabled((prev) => {
      const next = !prev;
      tutorialDisabledRef.current = !next;
      try {
        localStorage.setItem(TUTORIAL_DISABLED_KEY, next ? 'false' : 'true');
      } catch {
        // Ignore storage failures
      }
      return next;
    });
  }, []);

  const handleOpenSettings = useCallback(() => {
    audioRef.current?.playUiClick('secondary');
    if (hud.state === 'PLAYING') {
      settingsAutoPausedRef.current = true;
      engineRef.current?.togglePause();
    } else {
      settingsAutoPausedRef.current = false;
    }
    setShowSettings(true);
  }, [hud.state]);

  const handleCloseSettings = useCallback(() => {
    audioRef.current?.playUiClick('tab');
    setShowSettings(false);
    if (settingsAutoPausedRef.current) {
      settingsAutoPausedRef.current = false;
      engineRef.current?.togglePause();
    }
  }, []);

  const handleDashPress = useCallback(() => {
    engineRef.current?.triggerDash();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') {
        handleToggleMute();
      } else if (e.code === 'Escape' && showSettings) {
        e.preventDefault();
        handleCloseSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleMute, handleCloseSettings, showSettings]);

  const handleStart = useCallback(() => {
    audioRef.current?.playUiClick('primary');
    setShowLore(false);
    setShowSettings(false);
    setShowTutorial(false);
    settingsAutoPausedRef.current = false;
    engineRef.current?.setTutorialActive(false);
    engineRef.current?.startNewGame();
  }, []);

  const handleTogglePause = useCallback(() => {
    audioRef.current?.playUiClick('secondary');
    setShowLore(false);
    engineRef.current?.togglePause();
  }, []);

  const handleReturnToTitle = useCallback(() => {
    audioRef.current?.playUiClick('secondary');
    setShowLore(false);
    setShowTutorial(false);
    engineRef.current?.setTutorialActive(false);
    engineRef.current?.returnToTitle();
  }, []);

  const handleOpenLore = useCallback(() => {
    audioRef.current?.playUiClick('secondary');
    setShowLore(true);
  }, []);

  const handleCloseLore = useCallback(() => {
    audioRef.current?.playUiClick('tab');
    setShowLore(false);
  }, []);

  const handleSelectLoreTab = useCallback((tab: 'mission' | 'sentinels') => {
    audioRef.current?.playUiClick('tab');
    setLoreTab(tab);
  }, []);

  const handleSkipCutscene = useCallback(() => {
    audioRef.current?.playUiClick('tab');
    engineRef.current?.skipCutscene();
  }, []);

  const handleToggleDisableFutureTutorial = useCallback(() => {
    audioRef.current?.playUiClick('tab');
    setDisableFutureTutorial((prev) => !prev);
  }, []);

  const handleConfirmTutorial = useCallback(() => {
    audioRef.current?.playUiClick('primary');
    if (disableFutureTutorial) {
      tutorialDisabledRef.current = true;
      setTutorialEnabled(false);
      try {
        localStorage.setItem(TUTORIAL_DISABLED_KEY, 'true');
      } catch {
        // Ignore storage failures
      }
    }
    setShowTutorial(false);
    engineRef.current?.setTutorialActive(false);
    engineRef.current?.togglePause();
  }, [disableFutureTutorial]);

  const isPlaying = hud.state === 'PLAYING';
  const isTitle = hud.state === 'TITLE_MENU';
  const isCutscene = hud.state === 'INTRO_CUTSCENE';
  const isPaused = hud.state === 'PAUSED';
  const isGameOver = hud.state === 'GAME_OVER';
  const warningActive = isPlaying && hud.hp > 0 && hud.hp <= 2;

  // Astrolabic pause transition & subtle continuous pause hum (suppressed while tutorial overlay is open)
  const prevPausedRef = useRef(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const effectivelyPaused = isPaused && !showTutorial && !needsLandscape;
    if (effectivelyPaused !== prevPausedRef.current) {
      prevPausedRef.current = effectivelyPaused;
      if (!muted) {
        audio.playPauseTransition(effectivelyPaused);
      }
    }

    if (effectivelyPaused && !muted) {
      audio.startPauseHum();
    } else {
      audio.stopPauseHum();
    }
  }, [isPaused, showTutorial, needsLandscape, muted]);

  // Auto-pause active combat when rotated to portrait and resume when turned back to horizontal
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (needsLandscape) {
      if (engine.getState() === 'PLAYING') {
        portraitAutoPausedRef.current = true;
        engine.togglePause();
      }
    } else if (portraitAutoPausedRef.current) {
      portraitAutoPausedRef.current = false;
      if (engine.getState() === 'PAUSED' && !showSettings && !showTutorial) {
        engine.togglePause();
      }
    }
  }, [needsLandscape, showSettings, showTutorial]);

  // Periodic deep male ship-computer "Warning" voice while HP <= 2 until death, repair, pause, or mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!warningActive || muted) {
      audio.stopWarningVoice();
      return;
    }

    const isCritical = hud.hp === 1;
    audio.playWarningVoice(isCritical);
    const intervalMs = isCritical ? 3800 : 4200;
    const id = window.setInterval(() => {
      audioRef.current?.playWarningVoice(isCritical);
    }, intervalMs);

    return () => {
      window.clearInterval(id);
      audioRef.current?.stopWarningVoice();
    };
  }, [warningActive, muted, hud.hp]);

  const dashReady = hud.dashReadyRatio >= 0.99;
  const dashRadius = 29;
  const dashCircumference = 2 * Math.PI * dashRadius;
  const dashOffset = dashCircumference * (1 - Math.max(0, Math.min(1, hud.dashReadyRatio)));

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0B1320]">
      <div className="relative h-[100dvh] w-screen overflow-hidden bg-[#0B1320] text-[#F4EFE6]">
      {/* Isolated 60fps Game Canvas */}
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className={`block h-full w-full touch-none ${isPlaying && !isTouch ? 'cursor-none' : 'cursor-default'}`}
        />
      </div>

      {/* TITLE SCREEN OVERLAY */}
      {isTitle && (
        <div className="absolute inset-0 z-20 flex flex-col justify-between pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(0.85rem,env(safe-area-inset-top))] pb-[max(0.85rem,env(safe-area-inset-bottom))] sm:px-10 sm:py-8 md:p-14">
          {/* Subtle directional scrim for crisp typography over the live 60fps warp-jump canvas */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0B1320]/90 via-[#0B1320]/42 to-transparent"
          />

          {/* Top-left settings button & preview-only fullscreen control (>= 44px touch target) */}
          <div className="relative z-10 flex items-center justify-start gap-2">
            <button
              type="button"
              onClick={handleOpenSettings}
              onMouseEnter={playHover}
              aria-label="Configurações"
              className="group flex h-11 w-11 items-center justify-center rounded-md border border-[#E8B84B]/30 bg-[#0B1320]/75 text-[#E8B84B] transition-colors duration-150 hover:border-[#E8B84B] hover:bg-[#132035] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8B84B] cursor-pointer"
            >
              <Settings className="h-5 w-5 transition-transform duration-200 group-hover:rotate-45" />
            </button>
            {isPreview && (
              <button
                type="button"
                onClick={() => {
                  audioRef.current?.playUiClick('tab');
                  void tryEnterFullscreen();
                }}
                aria-label="Tela cheia"
                className="flex h-11 items-center gap-1.5 rounded-md border border-[#E8B84B]/30 bg-[#0B1320]/75 px-3 text-xs font-medium text-[#E8B84B] transition-colors duration-150 hover:border-[#E8B84B] hover:bg-[#132035] whitespace-nowrap cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Tela Cheia</span>
              </button>
            )}
          </div>

          {/* Focal Title Lockup & Primary CTA over calm left negative space */}
          <div className="relative z-10 max-w-md lg:max-w-xl space-y-3 sm:space-y-5">
            <TitleLockup />

            <p className="max-w-sm sm:max-w-md text-xs sm:text-base leading-relaxed text-[#F4EFE6]/80">
              Pilote a sonda Solaris, esquive de investidas inimigas e colete centelhas para ativar a Sobrecarga.
            </p>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-0.5">
              <button
                type="button"
                onClick={handleStart}
                onMouseEnter={playHover}
                className="inline-flex h-11 sm:h-12 items-center justify-center gap-3 rounded-md bg-[#E8B84B] px-7 sm:px-8 text-sm font-semibold tracking-wide text-[#0B1320] transition-transform duration-150 hover:bg-[#F3C966] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F4EFE6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                Jogar
              </button>

              {hud.highScore > 0 && (
                <div className="text-xs sm:text-sm text-[#F4EFE6]/70">
                  <span>Recorde</span>
                  <span aria-hidden="true" className="mx-2 text-[#E8B84B]/50">
                    ·
                  </span>
                  <span className="font-mono font-semibold text-[#E8B84B] tabular-nums">
                    {hud.highScore.toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Single flat control-hint line adapted to touch vs desktop */}
          <div className="relative z-10 flex items-center justify-between text-[11px] sm:text-xs text-[#F4EFE6]/65">
            <p className="tracking-wide">
              {isTouch
                ? 'Esquerda Mover · Direita Mirar/Disparar · Botão Impulso'
                : 'WASD Mover · Mouse/Espaço Disparar · Shift Impulso · Esc Pausar · M Som'}
            </p>
          </div>
        </div>
      )}

      {/* CINEMATIC INTRO CUTSCENE SKIP BUTTON */}
      {isCutscene && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-end pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(0.9rem,env(safe-area-inset-bottom))] sm:p-6">
          <button
            type="button"
            onClick={handleSkipCutscene}
            onMouseEnter={playHover}
            className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-md border border-[#E8B84B]/45 bg-[#0B1320]/80 px-4 text-xs font-medium tracking-wider text-[#F4EFE6]/90 transition-colors duration-150 hover:border-[#E8B84B] hover:bg-[#132035] hover:text-[#E8B84B] cursor-pointer"
          >
            <span>Pular</span>
            <span aria-hidden="true" className="text-[#E8B84B]">
              ››
            </span>
          </button>
        </div>
      )}

      {/* CRACKED COCKPIT GLASS, BLUISH PRESSURIZATION & PULSING RED WARNING LIGHT */}
      {!isTitle && !isCutscene && gameplaySettings.cockpitDamageFx && (
        <CockpitDamageOverlay
          hp={hud.hp}
          maxHp={hud.maxHp}
          warningActive={warningActive}
          repairAnimRatio={hud.repairAnimRatio}
          repairPulseId={hud.repairPulseId}
        />
      )}

      {/* ACTIVE GAMEPLAY HUD (Low-occlusion, pointer-events-none, landscape safe-area insets) */}
      {!isTitle && !isCutscene && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.65rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6">
          {/* Top Perimeter HUD (3-column grid keeps Wave & Overdrive mathematically centered, never remounted on damage) */}
          <div className="grid grid-cols-3 items-start gap-2 sm:gap-4">
            {/* Top-Left: Score & Combo */}
            <div className="justify-self-start flex flex-col gap-1 min-w-0">
              <div className="flex items-baseline gap-2 sm:gap-3">
                <span className="font-mono text-xl sm:text-3xl font-semibold tracking-tight text-[#F4EFE6] tabular-nums">
                  {hud.score.toLocaleString('pt-BR')}
                </span>
                {hud.combo > 1 && (
                  <span className="font-mono text-xs sm:text-sm font-semibold text-[#E8B84B] tabular-nums">
                    x{hud.combo}
                  </span>
                )}
              </div>

              <div className="h-0.5 w-20 sm:w-28 overflow-hidden bg-[#F4EFE6]/10">
                <div
                  className="h-full origin-left bg-[#E8B84B] transition-transform duration-75"
                  style={{ transform: `scaleX(${hud.comboTimerRatio})` }}
                />
              </div>

              {hud.highScore > 0 && (
                <div className="hidden sm:block text-xs text-[#F4EFE6]/55 tabular-nums">
                  Recorde {hud.highScore.toLocaleString('pt-BR')}
                </div>
              )}
            </div>

            {/* Top-Center: Wave & Overdrive */}
            <div className="justify-self-center flex flex-col items-center gap-1 sm:gap-1.5">
              <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-medium tracking-wide text-[#F4EFE6]/85 whitespace-nowrap">
                <span className="font-display text-xs sm:text-sm text-[#E8B84B]">Onda {hud.wave}</span>
                <span aria-hidden="true" className="hidden sm:inline text-[#E8B84B]/40">
                  ·
                </span>
                <span
                  className={`hidden sm:inline ${
                    hud.overdriveActive ? 'text-[#FF7B66] font-semibold' : 'text-[#F4EFE6]/65'
                  }`}
                >
                  {hud.overdriveActive ? 'Sobrecarga Ativa' : 'Sobrecarga'}
                </span>
              </div>
              <div
                className={`h-1.5 w-24 sm:w-44 overflow-hidden rounded-xs bg-[#132035] border ${
                  hud.overdriveActive ? 'border-[#FF7B66]/70' : 'border-[#E8B84B]/25'
                }`}
              >
                <div
                  className={`h-full origin-left transition-transform duration-100 ${
                    hud.overdriveActive ? 'bg-[#FF7B66]' : 'bg-[#E8B84B]'
                  }`}
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, hud.overdriveRatio))})` }}
                />
              </div>
              {warningActive && (
                <div
                  role="status"
                  className={`mt-0.5 flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] font-semibold tracking-wider whitespace-nowrap ${
                    hud.hp === 1
                      ? 'text-[#FF6B5A] animate-warning-pulse-fast'
                      : 'text-[#FFB347] animate-warning-pulse-slow'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      hud.hp === 1 ? 'bg-[#FF4B3A]' : 'bg-[#FF9F43]'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{hud.hp === 1 ? 'WARNING · CASCO CRÍTICO' : 'CAUTION · CASCO BAIXO'}</span>
                </div>
              )}
            </div>

            {/* Top-Right: Shields + Progressive Repair Indicator + Audio/Pause controls (>= 44px touch targets on mobile) */}
            <div className="justify-self-end flex items-center gap-2 sm:gap-3">
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5" aria-label={`Escudos: ${hud.hp} de ${hud.maxHp}`}>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: hud.maxHp }).map((_, idx) => {
                      const active = idx < hud.hp;
                      const flashing = hud.damageFlashRatio > 0.15;
                      const repairActive = hud.repairAnimRatio > 0.01;
                      const repairProgress = Math.max(0, Math.min(1, 1 - hud.repairAnimRatio));
                      const isJustRepaired = repairActive && idx === hud.hp - 1;
                      const clipTop = Math.round((1 - repairProgress) * 14);
                      return (
                        <svg
                          key={isJustRepaired ? `${idx}-repair-${hud.repairPulseId}` : idx}
                          viewBox="0 0 16 16"
                          className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${
                            isJustRepaired ? 'animate-hull-diamond-repair' : ''
                          }`}
                          aria-hidden="true"
                        >
                          {isJustRepaired && (
                            <defs>
                              <clipPath id={`repair-fill-${idx}-${hud.repairPulseId}`}>
                                <rect x="0" y={clipTop} width="16" height={16 - clipTop} />
                              </clipPath>
                            </defs>
                          )}
                          <polygon
                            points="8,1 15,8 8,15 1,8"
                            fill={
                              isJustRepaired
                                ? 'rgba(92, 225, 255, 0.24)'
                                : active
                                  ? flashing
                                    ? '#FF7B66'
                                    : repairActive
                                      ? '#7AE4FF'
                                      : '#E8B84B'
                                  : 'transparent'
                            }
                            stroke={
                              flashing
                                ? '#FF7B66'
                                : isJustRepaired || (repairActive && active)
                                  ? '#7AE4FF'
                                  : active
                                    ? '#F4EFE6'
                                    : 'rgba(244,239,230,0.28)'
                            }
                            strokeWidth="1.4"
                          />
                          {isJustRepaired && (
                            <polygon
                              points="8,1 15,8 8,15 1,8"
                              fill={repairProgress > 0.8 ? '#E8B84B' : '#5CE1FF'}
                              clipPath={`url(#repair-fill-${idx}-${hud.repairPulseId})`}
                            />
                          )}
                        </svg>
                      );
                    })}
                  </div>
                  <span
                    className={`hidden sm:inline font-mono text-xs tabular-nums transition-colors duration-100 ${
                      hud.damageFlashRatio > 0.15
                        ? 'text-[#FF7B66] font-semibold'
                        : hud.repairAnimRatio > 0.01
                          ? 'text-[#7AE4FF] font-semibold'
                          : 'text-[#F4EFE6]/75'
                    }`}
                  >
                    {hud.hp}/{hud.maxHp}
                  </span>
                </div>
                {hud.repairAnimRatio > 0.01 && (
                  <div className="flex items-center gap-1.5" role="status">
                    <span className="font-mono text-[9px] sm:text-[10px] font-semibold tracking-wider text-[#7AE4FF]">
                      REPARANDO CASCO
                    </span>
                    <div className="h-1 w-12 sm:w-16 overflow-hidden rounded-xs bg-[#0E2438] border border-[#5CE1FF]/35">
                      <div
                        className="h-full origin-left bg-[#7AE4FF] transition-transform duration-75"
                        style={{
                          transform: `scaleX(${Math.max(0.05, Math.min(1, 1 - hud.repairAnimRatio))})`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pointer-events-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleOpenSettings}
                  onMouseEnter={playHover}
                  aria-label="Configurações"
                  className="group flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-md border border-[#E8B84B]/25 bg-[#0B1320]/80 text-[#F4EFE6]/85 transition-colors duration-150 hover:border-[#E8B84B] hover:text-[#E8B84B] cursor-pointer"
                >
                  <Settings className="h-4 w-4 transition-transform duration-200 group-hover:rotate-45" />
                </button>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  onMouseEnter={playHover}
                  aria-label={isPaused ? 'Continuar' : 'Pausar'}
                  className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-md border border-[#E8B84B]/25 bg-[#0B1320]/80 text-[#F4EFE6]/85 transition-colors duration-150 hover:border-[#E8B84B] hover:text-[#E8B84B] cursor-pointer"
                >
                  {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Non-blocking Wave Transition Banner */}
          {hud.waveBanner && isPlaying && (
            <div className="self-center text-center">
              <div className="font-display text-2xl sm:text-3xl tracking-[0.22em] text-[#E8B84B]">
                {hud.waveBanner}
              </div>
            </div>
          )}

          {/* Mobile Thumb-Zone Controls (Only shown on touch devices during active play) */}
          {isTouch && isPlaying ? (
            <div className="flex items-end justify-between pb-1">
              {/* Left thumb subtle guide */}
              <div className="pl-1 pb-2 text-[11px] tracking-wide text-[#F4EFE6]/35">
                Esquerda mover · Direita mirar
              </div>

              {/* Right thumb action: Dash button */}
              <div className="pointer-events-auto flex items-end pr-1">
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDashPress();
                  }}
                  onClick={handleDashPress}
                  aria-label="Impulso"
                  className={`relative flex h-16 w-16 flex-col items-center justify-center rounded-full border transition-transform duration-100 active:scale-95 cursor-pointer ${
                    dashReady
                      ? 'border-[#E8B84B] bg-[#132035]/90 text-[#E8B84B]'
                      : 'border-[#E8B84B]/25 bg-[#0B1320]/75 text-[#F4EFE6]/45'
                  }`}
                >
                  <svg
                    viewBox="0 0 64 64"
                    className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="32"
                      cy="32"
                      r={dashRadius}
                      fill="none"
                      stroke="rgba(232, 184, 75, 0.16)"
                      strokeWidth="2.5"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r={dashRadius}
                      fill="none"
                      stroke={dashReady ? '#E8B84B' : '#B98D34'}
                      strokeWidth="2.5"
                      strokeDasharray={dashCircumference}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                    />
                  </svg>
                  <Zap className="h-5 w-5" />
                  <span className="mt-0.5 text-[10px] font-medium tracking-wide">Impulso</span>
                </button>
              </div>
            </div>
          ) : (
            <div />
          )}
        </div>
      )}

      {/* PAUSE MODAL */}
      {isPaused && !showSettings && !showTutorial && (
        <div className="animate-modal-backdrop absolute inset-0 z-30 flex items-center justify-center bg-[#0B1320]/78 p-3 sm:p-4">
          {!showLore ? (
            <div
              key="pause-main"
              className="animate-modal-panel max-h-[88dvh] w-full max-w-sm overflow-y-auto touch-pan-y rounded-lg border border-[#E8B84B]/35 bg-[#101B2D] p-5 sm:p-7 text-center shadow-2xl"
            >
              <h2 className="font-display text-2xl font-semibold tracking-[0.16em] text-[#F4EFE6]">
                PAUSADO
              </h2>
              <p className="mt-2 text-sm text-[#F4EFE6]/65">
                Onda {hud.wave} · {hud.score.toLocaleString('pt-BR')} pontos
              </p>

              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleTogglePause}
                  onMouseEnter={playHover}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#E8B84B] px-5 text-sm font-semibold text-[#0B1320] transition-colors duration-150 hover:bg-[#F3C966] whitespace-nowrap cursor-pointer"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Continuar
                </button>
                <button
                  type="button"
                  onClick={handleOpenLore}
                  onMouseEnter={playHover}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-[#E8B84B]/35 bg-[#132035] px-5 text-sm font-medium text-[#E8B84B] transition-colors duration-150 hover:border-[#E8B84B] hover:bg-[#182942] whitespace-nowrap cursor-pointer"
                >
                  <BookOpen className="h-4 w-4" />
                  Registros de Bordo
                </button>
                <button
                  type="button"
                  onClick={handleStart}
                  onMouseEnter={playHover}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-[#E8B84B]/25 bg-transparent px-5 text-sm font-medium text-[#F4EFE6] transition-colors duration-150 hover:border-[#E8B84B] hover:text-[#E8B84B] whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reiniciar
                </button>
                <button
                  type="button"
                  onClick={handleReturnToTitle}
                  onMouseEnter={playHover}
                  className="inline-flex h-11 w-full items-center justify-center text-xs font-medium text-[#F4EFE6]/65 transition-colors duration-150 hover:text-[#F4EFE6] whitespace-nowrap cursor-pointer"
                >
                  Voltar ao Início
                </button>
              </div>
            </div>
          ) : (
            <div
              key="pause-lore"
              className="animate-modal-panel flex max-h-[86dvh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-[#E8B84B]/35 bg-[#101B2D] p-4 sm:p-6 shadow-2xl"
            >
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E8B84B]/18 pb-3 sm:pb-4">
                <button
                  type="button"
                  onClick={handleCloseLore}
                  onMouseEnter={playHover}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#F4EFE6]/75 transition-colors duration-150 hover:text-[#E8B84B] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </button>
                <h2 className="font-display text-sm sm:text-lg font-semibold tracking-[0.12em] sm:tracking-[0.14em] text-[#F4EFE6] text-center truncate">
                  REGISTROS DE BORDO
                </h2>
                <div className="w-12 sm:w-16 shrink-0" aria-hidden="true" />
              </div>

              {/* Segmented Filter Tabs */}
              <div className="mt-3 sm:mt-4 grid shrink-0 grid-cols-2 gap-1 rounded-md bg-[#0B1320] p-1 border border-[#E8B84B]/18">
                <button
                  type="button"
                  onClick={() => handleSelectLoreTab('mission')}
                  onMouseEnter={playHover}
                  className={`h-9 sm:h-10 rounded-sm text-xs font-semibold tracking-wide transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                    loreTab === 'mission'
                      ? 'bg-[#E8B84B] text-[#0B1320]'
                      : 'text-[#F4EFE6]/70 hover:text-[#F4EFE6]'
                  }`}
                >
                  Missão Solaris
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectLoreTab('sentinels')}
                  onMouseEnter={playHover}
                  className={`h-9 sm:h-10 rounded-sm text-xs font-semibold tracking-wide transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                    loreTab === 'sentinels'
                      ? 'bg-[#E8B84B] text-[#0B1320]'
                      : 'text-[#F4EFE6]/70 hover:text-[#F4EFE6]'
                  }`}
                >
                  Naves Sentinelas
                </button>
              </div>

              {/* Scrollable Lore Entries */}
              <div className="mt-3 sm:mt-4 min-h-0 flex-1 space-y-3 sm:space-y-4 overflow-y-auto pr-1 touch-pan-y">
                {LORE_ENTRIES.filter((entry) => entry.category === loreTab).map((entry) => (
                  <article
                    key={entry.id}
                    className="flex gap-3 sm:gap-4 border-b border-[#E8B84B]/12 pb-3 sm:pb-4 last:border-b-0 last:pb-0"
                  >
                    <div className="h-14 w-14 sm:h-20 sm:w-20 shrink-0 overflow-hidden rounded-md border border-[#E8B84B]/25 bg-black">
                      <img
                        src={entry.imageSrc}
                        alt={entry.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-sm sm:text-base font-semibold tracking-wide text-[#F4EFE6]">
                        {entry.title}
                      </h3>
                      <p className="mt-0.5 text-[11px] sm:text-xs text-[#E8B84B]/80">
                        {entry.classification}
                      </p>
                      <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm leading-relaxed text-[#F4EFE6]/75">
                        {entry.summary}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* GAME OVER MODAL */}
      {isGameOver && (
        <div className="animate-modal-backdrop absolute inset-0 z-30 flex items-center justify-center bg-[#0B1320]/80 p-3 sm:p-4">
          <div className="animate-modal-panel max-h-[88dvh] w-full max-w-md overflow-y-auto touch-pan-y rounded-lg border border-[#E8B84B]/35 bg-[#101B2D] p-5 sm:p-8 shadow-2xl">
            <div className="text-center">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-[0.14em] text-[#F4EFE6]">
                FIM DE MISSÃO
              </h2>
              {hud.newRecord ? (
                <p className="mt-1.5 text-sm font-medium text-[#E8B84B]">
                  Novo recorde alcançado
                </p>
              ) : (
                <p className="mt-1.5 text-sm text-[#F4EFE6]/65">
                  A sonda Solaris perdeu todos os escudos
                </p>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-[#E8B84B]/18 py-5">
              <div>
                <div className="text-xs text-[#F4EFE6]/55">Pontuação</div>
                <div className="mt-0.5 font-mono text-2xl font-semibold text-[#E8B84B] tabular-nums">
                  {hud.score.toLocaleString('pt-BR')}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#F4EFE6]/55">Recorde</div>
                <div className="mt-0.5 font-mono text-2xl font-semibold text-[#F4EFE6] tabular-nums">
                  {hud.highScore.toLocaleString('pt-BR')}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#F4EFE6]/55">Onda Alcançada</div>
                <div className="mt-0.5 font-mono text-base font-medium text-[#F4EFE6] tabular-nums">
                  Onda {hud.wave}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#F4EFE6]/55">Abates · Maior Combo</div>
                <div className="mt-0.5 font-mono text-base font-medium text-[#F4EFE6] tabular-nums">
                  {hud.kills} · x{hud.maxCombo}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={handleStart}
                onMouseEnter={playHover}
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-[#E8B84B] px-5 text-sm font-semibold text-[#0B1320] transition-colors duration-150 hover:bg-[#F3C966] whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                Jogar Novamente
              </button>
              <button
                type="button"
                onClick={handleReturnToTitle}
                onMouseEnter={playHover}
                className="inline-flex h-12 items-center justify-center rounded-md border border-[#E8B84B]/30 px-4 text-sm font-medium text-[#F4EFE6]/85 transition-colors duration-150 hover:border-[#E8B84B] hover:text-[#E8B84B] whitespace-nowrap cursor-pointer"
              >
                Início
              </button>
            </div>
          </div>
        </div>
      )}
      {/* POST-CUTSCENE CONTROLS TUTORIAL MODAL */}
      <TutorialModal
        open={showTutorial}
        isTouch={isTouch}
        disableFutureTutorial={disableFutureTutorial}
        onToggleDisableFuture={handleToggleDisableFutureTutorial}
        onConfirm={handleConfirmTutorial}
        onHover={playHover}
      />

      {/* SETTINGS MODAL */}
      <SettingsModal
        open={showSettings}
        rotated90={false}
        muted={muted}
        audioSettings={audioSettings}
        gameplaySettings={gameplaySettings}
        tutorialEnabled={tutorialEnabled}
        onToggleMute={handleToggleMute}
        onAudioChange={handleAudioSettingsChange}
        onGameplayChange={handleGameplaySettingsChange}
        onToggleTutorialEnabled={handleToggleTutorialEnabled}
        onTestSfx={handleTestSfx}
        onTestVoice={handleTestVoice}
        onResetDefaults={handleResetSettings}
        onClose={handleCloseSettings}
        onHover={playHover}
      />

      {/* ROTATE TO LANDSCAPE PROMPT */}
      {needsLandscape && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rotate-landscape-title"
          className="animate-modal-backdrop absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0B1320]/96 px-6 text-center backdrop-blur-sm"
        >
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-full border border-[#E8B84B]/30"
            />
            <div
              aria-hidden="true"
              className="absolute inset-2.5 rounded-full border border-dashed border-[#E8B84B]/20"
            />
            <Smartphone className="animate-rotate-landscape h-10 w-10 text-[#E8B84B]" />
            <RotateCw
              aria-hidden="true"
              className="absolute -top-1 -right-1 h-5 w-5 text-[#F4EFE6]/75"
            />
          </div>

          <h2
            id="rotate-landscape-title"
            className="mt-6 font-display text-xl font-semibold tracking-[0.14em] text-[#F4EFE6]"
          >
            VIRE PARA A HORIZONTAL
          </h2>
          <p className="mt-2.5 max-w-xs text-sm leading-relaxed text-[#F4EFE6]/72">
            Gire o aparelho para a posição horizontal para pilotar a Solaris com visão ampla da arena.
          </p>

          {typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen) && (
            <button
              type="button"
              onClick={() => {
                audioRef.current?.playUiClick('primary');
                void tryEnterFullscreen();
              }}
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[#E8B84B]/45 bg-[#132035] px-5 text-xs font-semibold tracking-wide text-[#E8B84B] transition-colors hover:border-[#E8B84B] hover:bg-[#182942] cursor-pointer"
            >
              <Maximize2 className="h-4 w-4" />
              <span>Ativar Tela Cheia na Horizontal</span>
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
