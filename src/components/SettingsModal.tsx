import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Gamepad2,
  Keyboard,
  Move,
  RotateCcw,
  Settings,
  Smartphone,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { AudioSettings } from '../game/audio';
import {
  DEFAULT_KEYBOARD_CONTROL_SETTINGS,
  DEFAULT_MOBILE_CONTROL_SETTINGS,
  GameplaySettings,
  KeyBindingSlot,
  KeyboardAction,
  KeyboardControlSettings,
  MobileControlSettings,
  TouchPoint,
  formatKeyCode,
} from '../game/types';

type SettingsTab = 'general' | 'mobile' | 'keyboard';
type DraggableControlKey = 'movePos' | 'aimPos' | 'dashPos';
type BindingSlotKey = keyof KeyBindingSlot;

type GameplayPatch = Partial<
  Omit<GameplaySettings, 'mobileControls' | 'keyboardControls'>
> & {
  mobileControls?: Partial<MobileControlSettings>;
  keyboardControls?: Partial<KeyboardControlSettings>;
};

interface SettingsModalProps {
  open: boolean;
  rotated90: boolean;
  muted: boolean;
  audioSettings: AudioSettings;
  gameplaySettings: GameplaySettings;
  tutorialEnabled: boolean;
  onToggleMute: () => void;
  onAudioChange: (partial: Partial<AudioSettings>) => void;
  onGameplayChange: (partial: GameplayPatch) => void;
  onToggleTutorialEnabled: () => void;
  onTestSfx: () => void;
  onTestVoice: () => void;
  onResetDefaults: () => void;
  onClose: () => void;
  onHover: () => void;
  onPlayTabSound?: () => void;
  onCaptureKeyChange?: (capturing: boolean) => void;
}

interface SmoothSliderRowProps {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  rotated90: boolean;
  disabled?: boolean;
  formatValue?: (val: number) => string;
  onChange: (next: number) => void;
  onTest?: () => void;
  testLabel?: string;
}

function SmoothSliderRow({
  id,
  label,
  sublabel,
  value,
  min = 0,
  max = 1,
  step,
  rotated90,
  disabled = false,
  formatValue,
  onChange,
  onTest,
  testLabel,
}: SmoothSliderRowProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const clamped = Math.max(min, Math.min(max, value));
  const span = max - min || 1;
  const ratio = Math.max(0, Math.min(1, (clamped - min) / span));
  const pctFloat = ratio * 100;
  const displayPct = Math.round(clamped * 100);
  const displayText = formatValue ? formatValue(clamped) : `${displayPct}%`;

  const snapAndClamp = useCallback(
    (raw: number) => {
      const val = step ? min + Math.round((raw - min) / step) * step : raw;
      return Math.round(Math.max(min, Math.min(max, val)) * 100) / 100;
    },
    [max, min, step]
  );

  const updateFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = trackRef.current;
      if (!el || disabled) return;
      const rect = el.getBoundingClientRect();
      let r: number;
      if (rotated90) {
        // Stage is rotated +90deg clockwise: local left->right maps to screen top->bottom
        r = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
      } else {
        r = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      }
      const norm = Math.max(0, Math.min(1, r));
      const next = min + norm * span;
      onChange(snapAndClamp(next));
    },
    [disabled, min, onChange, rotated90, snapAndClamp, span]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || disabled) return;
    e.preventDefault();
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already released
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const delta = step ? (e.shiftKey ? step * 2 : step) : (e.shiftKey ? 0.1 : 0.05) * span;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(snapAndClamp(clamped + delta));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(snapAndClamp(clamped - delta));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(max);
    }
  };

  return (
    <div className={`space-y-1 ${disabled ? 'opacity-45' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span id={`${id}-label`} className="block text-xs font-medium text-[#F4EFE6] truncate">
            {label}
          </span>
          {sublabel && (
            <span className="block text-[10px] leading-tight text-[#F4EFE6]/50 truncate">
              {sublabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onTest && (
            <button
              type="button"
              onClick={onTest}
              disabled={disabled || displayPct === 0}
              className="rounded border border-[#E8B84B]/30 bg-[#0B1320]/80 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#E8B84B] transition-colors hover:border-[#E8B84B] hover:bg-[#16263E] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
            >
              {testLabel ?? 'Testar'}
            </button>
          )}
          <span className="w-11 text-right font-mono text-[11px] font-semibold text-[#E8B84B] tabular-nums">
            {displayText}
          </span>
        </div>
      </div>

      {/* Smooth 1:1 Pointer-Captured Track (orientation-aware for rotate-90 mobile stage) */}
      <div
        ref={trackRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round(max * 100)}
        aria-valuenow={displayPct}
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="group relative flex h-6 w-full touch-none select-none items-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8B84B] disabled:cursor-not-allowed"
      >
        <div className="pointer-events-none relative h-1.5 w-full overflow-hidden rounded-xs bg-[#0B1320] border border-[#E8B84B]/25">
          <div
            className="h-full bg-gradient-to-r from-[#B98D34] to-[#E8B84B]"
            style={{ width: `${pctFloat}%` }}
          />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#F4EFE6] bg-[#E8B84B] shadow-sm transition-transform duration-75 group-active:scale-115"
          style={{ left: `${pctFloat}%` }}
        />
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  sublabel: string;
  checked: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, sublabel, checked, onToggle }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-2.5 rounded-md border border-[#E8B84B]/20 bg-[#0B1320]/65 px-2.5 py-2 text-left transition-colors hover:border-[#E8B84B]/50 cursor-pointer"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium text-[#F4EFE6] truncate">{label}</div>
        <div className="text-[10px] leading-tight text-[#F4EFE6]/55 truncate">{sublabel}</div>
      </div>
      <div
        className={`relative h-5 w-9 shrink-0 rounded-xs border transition-colors ${
          checked
            ? 'border-[#3EC1B0] bg-[#3EC1B0]/25'
            : 'border-[#F4EFE6]/20 bg-[#132035]'
        }`}
      >
        <div
          className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 transition-all ${
            checked
              ? 'left-[20px] bg-[#3EC1B0]'
              : 'left-[4px] bg-[#F4EFE6]/45'
          }`}
        />
      </div>
    </button>
  );
}

const KEYBOARD_ACTIONS: Array<{ action: KeyboardAction; label: string }> = [
  { action: 'moveUp', label: 'Mover Cima' },
  { action: 'moveDown', label: 'Mover Baixo' },
  { action: 'moveLeft', label: 'Mover Esquerda' },
  { action: 'moveRight', label: 'Mover Direita' },
  { action: 'shoot', label: 'Atirar' },
  { action: 'dash', label: 'Impulso (Esquiva)' },
  { action: 'pause', label: 'Pausar' },
  { action: 'mute', label: 'Silenciar Som' },
];

const IGNORED_KEY_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'ContextMenu',
  'Dead',
  'Unidentified',
]);

function clampTouchPoint(x: number, y: number): TouchPoint {
  return {
    x: Math.round(Math.max(0.06, Math.min(0.94, x)) * 1000) / 1000,
    y: Math.round(Math.max(0.18, Math.min(0.9, y)) * 1000) / 1000,
  };
}

function cloneDefaultMobile(): MobileControlSettings {
  return {
    movePos: { ...DEFAULT_MOBILE_CONTROL_SETTINGS.movePos },
    aimPos: { ...DEFAULT_MOBILE_CONTROL_SETTINGS.aimPos },
    dashPos: { ...DEFAULT_MOBILE_CONTROL_SETTINGS.dashPos },
    stickScale: DEFAULT_MOBILE_CONTROL_SETTINGS.stickScale,
    dashScale: DEFAULT_MOBILE_CONTROL_SETTINGS.dashScale,
    fixedSticks: DEFAULT_MOBILE_CONTROL_SETTINGS.fixedSticks,
    opacity: DEFAULT_MOBILE_CONTROL_SETTINGS.opacity,
  };
}

function cloneDefaultKeyboard(): KeyboardControlSettings {
  return {
    moveUp: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveUp },
    moveDown: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveDown },
    moveLeft: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveLeft },
    moveRight: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveRight },
    shoot: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.shoot },
    dash: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.dash },
    pause: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.pause },
    mute: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.mute },
  };
}

export function SettingsModal({
  open,
  rotated90,
  muted,
  audioSettings,
  gameplaySettings,
  tutorialEnabled,
  onToggleMute,
  onAudioChange,
  onGameplayChange,
  onToggleTutorialEnabled,
  onTestSfx,
  onTestVoice,
  onResetDefaults,
  onClose,
  onHover,
  onPlayTabSound,
  onCaptureKeyChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [draggingMarker, setDraggingMarker] = useState<DraggableControlKey | null>(null);
  const [listening, setListening] = useState<{
    action: KeyboardAction;
    slot: BindingSlotKey;
  } | null>(null);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);
  const suppressNextClickUntilRef = useRef(0);

  // Sync key-capture state to parent so global Escape/mute hotkeys stand down while listening
  useEffect(() => {
    const active = open && listening !== null;
    onCaptureKeyChange?.(active);
    return () => {
      onCaptureKeyChange?.(false);
    };
  }, [listening, onCaptureKeyChange, open]);

  // Clear listening state when modal closes or switches away from keyboard tab
  useEffect(() => {
    if (!open || activeTab !== 'keyboard') {
      setListening(null);
    }
  }, [activeTab, open]);

  // Suppress the synthetic click that follows capturing Mouse0 on mousedown
  useEffect(() => {
    if (!open) return;
    const handleCaptureClick = (e: MouseEvent) => {
      if (Date.now() > suppressNextClickUntilRef.current) return;
      suppressNextClickUntilRef.current = 0;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener('click', handleCaptureClick, true);
    return () => {
      window.removeEventListener('click', handleCaptureClick, true);
    };
  }, [open]);

  const applyBinding = useCallback(
    (action: KeyboardAction, slot: BindingSlotKey, code: string) => {
      const current = gameplaySettings.keyboardControls[action];
      const otherSlot: BindingSlotKey = slot === 'primary' ? 'secondary' : 'primary';
      const nextSlot: KeyBindingSlot = {
        ...current,
        [slot]: code,
        [otherSlot]: current[otherSlot] === code ? '' : current[otherSlot],
      };
      onGameplayChange({
        keyboardControls: {
          ...gameplaySettings.keyboardControls,
          [action]: nextSlot,
        },
      });
    },
    [gameplaySettings.keyboardControls, onGameplayChange]
  );

  // Capture next keyboard key or mouse button when a slot is listening
  useEffect(() => {
    if (!open || !listening) return;

    const handleCaptureKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.code === 'Escape') {
        setListening(null);
        return;
      }
      if (
        IGNORED_KEY_CODES.has(e.code) ||
        e.key === 'Meta' ||
        e.key === 'ContextMenu' ||
        e.key === 'Dead' ||
        e.key === 'Unidentified'
      ) {
        return;
      }
      applyBinding(listening.action, listening.slot, e.code);
      setListening(null);
    };

    const handleCaptureMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-capture-cancel="true"]')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.button >= 0 && e.button <= 4) {
        if (e.button === 0) {
          suppressNextClickUntilRef.current = Date.now() + 1500;
        }
        applyBinding(listening.action, listening.slot, `Mouse${e.button}`);
        setListening(null);
      }
    };

    const handleCaptureContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', handleCaptureKeyDown, true);
    window.addEventListener('mousedown', handleCaptureMouseDown, true);
    window.addEventListener('contextmenu', handleCaptureContextMenu, true);

    return () => {
      window.removeEventListener('keydown', handleCaptureKeyDown, true);
      window.removeEventListener('mousedown', handleCaptureMouseDown, true);
      window.removeEventListener('contextmenu', handleCaptureContextMenu, true);
    };
  }, [applyBinding, listening, open]);

  const updateMarkerFromPointer = useCallback(
    (key: DraggableControlKey, clientX: number, clientY: number) => {
      const area = previewAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      let nx: number;
      let ny: number;
      if (rotated90) {
        nx = (clientY - rect.top) / rect.height;
        ny = 1 - (clientX - rect.left) / rect.width;
      } else {
        nx = (clientX - rect.left) / rect.width;
        ny = (clientY - rect.top) / rect.height;
      }

      const clamped = clampTouchPoint(nx, ny);
      onGameplayChange({
        mobileControls: {
          [key]: clamped,
        },
      });
    },
    [onGameplayChange, rotated90]
  );

  const handleMarkerPointerDown = (
    key: DraggableControlKey,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingMarker(key);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateMarkerFromPointer(key, e.clientX, e.clientY);
  };

  const handleMarkerPointerMove = (
    key: DraggableControlKey,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (draggingMarker !== key) return;
    e.preventDefault();
    updateMarkerFromPointer(key, e.clientX, e.clientY);
  };

  const handleMarkerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingMarker) return;
    setDraggingMarker(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already released
    }
  };

  const handleSelectTab = (tab: SettingsTab) => {
    if (tab !== activeTab) {
      onPlayTabSound?.();
      setActiveTab(tab);
    }
  };

  const handleResetControlsOnly = () => {
    setListening(null);
    onGameplayChange({
      mobileControls: cloneDefaultMobile(),
      keyboardControls: cloneDefaultKeyboard(),
    });
  };

  if (!open) return null;

  const { mobileControls, keyboardControls } = gameplaySettings;
  const stickDiameterPx = Math.round(34 * mobileControls.stickScale);
  const dashDiameterPx = Math.round(32 * mobileControls.dashScale);

  return (
    <div
      className="animate-modal-backdrop absolute inset-0 z-40 flex items-center justify-center bg-[#0B1320]/82 p-2.5 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="animate-modal-panel flex max-h-[94%] w-full max-w-[660px] flex-col overflow-hidden rounded-lg border border-[#E8B84B]/40 bg-[#101B2D] shadow-2xl">
        {/* Compact Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#E8B84B]/20 bg-[#0B1320]/65 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[#E8B84B]" aria-hidden="true" />
            <h2
              id="settings-modal-title"
              className="font-display text-sm sm:text-base font-semibold tracking-[0.16em] text-[#F4EFE6]"
            >
              CONFIGURAÇÕES
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            onMouseEnter={onHover}
            aria-label="Fechar configurações"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E8B84B]/25 bg-[#0B1320]/80 text-[#F4EFE6]/80 transition-colors hover:border-[#E8B84B] hover:text-[#E8B84B] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs: Geral | Celular | Teclado PC */}
        <div
          role="tablist"
          aria-label="Seções de configurações"
          className="grid shrink-0 grid-cols-3 gap-1 border-b border-[#E8B84B]/18 bg-[#0B1320]/45 px-4 py-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'general'}
            onClick={() => handleSelectTab('general')}
            onMouseEnter={onHover}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-sm text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
              activeTab === 'general'
                ? 'bg-[#E8B84B] text-[#0B1320]'
                : 'text-[#F4EFE6]/70 hover:bg-[#132035] hover:text-[#F4EFE6]'
            }`}
          >
            <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Geral</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mobile'}
            onClick={() => handleSelectTab('mobile')}
            onMouseEnter={onHover}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-sm text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
              activeTab === 'mobile'
                ? 'bg-[#E8B84B] text-[#0B1320]'
                : 'text-[#F4EFE6]/70 hover:bg-[#132035] hover:text-[#F4EFE6]'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Celular</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'keyboard'}
            onClick={() => handleSelectTab('keyboard')}
            onMouseEnter={onHover}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-sm text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
              activeTab === 'keyboard'
                ? 'bg-[#E8B84B] text-[#0B1320]'
                : 'text-[#F4EFE6]/70 hover:bg-[#132035] hover:text-[#F4EFE6]'
            }`}
          >
            <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Teclado PC</span>
          </button>
        </div>

        {/* Tab Panel Body */}
        {activeTab === 'general' && (
          <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto touch-pan-y px-4 py-3 sm:gap-6 sm:px-5 sm:py-4">
            {/* Column 1: Audio Mixer */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-[#E8B84B]/15 pb-1.5">
                <h3 className="font-display text-[11px] font-semibold tracking-[0.18em] text-[#E8B84B]">
                  ÁUDIO
                </h3>
                <button
                  type="button"
                  onClick={onToggleMute}
                  onMouseEnter={onHover}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                    muted
                      ? 'border-[#E85D4A]/60 bg-[#E85D4A]/15 text-[#FF7B66]'
                      : 'border-[#E8B84B]/30 bg-[#0B1320]/80 text-[#F4EFE6]/85 hover:border-[#E8B84B]'
                  }`}
                >
                  {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                  <span>{muted ? 'Mudo' : 'Ativo'}</span>
                </button>
              </div>

              <div className="space-y-2">
                <SmoothSliderRow
                  id="audio-master"
                  label="Volume Geral"
                  value={audioSettings.master}
                  rotated90={rotated90}
                  disabled={muted}
                  onChange={(master) => onAudioChange({ master })}
                />
                <SmoothSliderRow
                  id="audio-sfx"
                  label="Efeitos de Combate"
                  sublabel="Disparos, explosões e impulso"
                  value={audioSettings.sfx}
                  rotated90={rotated90}
                  disabled={muted}
                  onChange={(sfx) => onAudioChange({ sfx })}
                  onTest={onTestSfx}
                />
                <SmoothSliderRow
                  id="audio-voice"
                  label="Voz da Nave"
                  sublabel="Alertas de integridade do casco"
                  value={audioSettings.voice}
                  rotated90={rotated90}
                  disabled={muted}
                  onChange={(voice) => onAudioChange({ voice })}
                  onTest={onTestVoice}
                />
                <SmoothSliderRow
                  id="audio-ui"
                  label="Interface & Pausa"
                  sublabel="Cliques de menu e ambiente"
                  value={audioSettings.ui}
                  rotated90={rotated90}
                  disabled={muted}
                  onChange={(ui) => onAudioChange({ ui })}
                />
              </div>
            </section>

            {/* Column 2: Gameplay & Visual */}
            <section className="space-y-2.5">
              <div className="border-b border-[#E8B84B]/15 pb-1.5">
                <h3 className="font-display text-[11px] font-semibold tracking-[0.18em] text-[#E8B84B]">
                  JOGO & VISUAL
                </h3>
              </div>

              <div className="space-y-2.5">
                <SmoothSliderRow
                  id="gameplay-shake"
                  label="Tremor de Câmera"
                  sublabel="Impacto ao disparar ou sofrer dano"
                  value={gameplaySettings.screenShake}
                  rotated90={rotated90}
                  onChange={(screenShake) => onGameplayChange({ screenShake })}
                />

                <SmoothSliderRow
                  id="gameplay-hud-scale"
                  label="Tamanho da HUD"
                  sublabel="Escala dos placares e indicadores"
                  value={gameplaySettings.hudScale}
                  min={0.7}
                  max={1.5}
                  step={0.05}
                  rotated90={rotated90}
                  onChange={(hudScale) => onGameplayChange({ hudScale })}
                />

                <ToggleRow
                  label="Indicadores de Borda"
                  sublabel="Setas para inimigos fora da tela"
                  checked={gameplaySettings.offscreenIndicators}
                  onToggle={() =>
                    onGameplayChange({ offscreenIndicators: !gameplaySettings.offscreenIndicators })
                  }
                />

                <ToggleRow
                  label="Danos na Cabine"
                  sublabel="Vidro rachado e pulso vermelho"
                  checked={gameplaySettings.cockpitDamageFx}
                  onToggle={() =>
                    onGameplayChange({ cockpitDamageFx: !gameplaySettings.cockpitDamageFx })
                  }
                />

                <ToggleRow
                  label="Tutorial de Controles"
                  sublabel="Exibir guia ao iniciar a missão"
                  checked={tutorialEnabled}
                  onToggle={onToggleTutorialEnabled}
                />
              </div>
            </section>
          </div>
        )}

        {activeTab === 'mobile' && (
          <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto touch-pan-y px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-[#F4EFE6]/70">
                Arraste Mover, Mirar e Impulso livremente para qualquer ponto da tela.
              </p>
              <button
                type="button"
                onClick={handleResetControlsOnly}
                onMouseEnter={onHover}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-[#E8B84B]/30 bg-[#0B1320]/80 px-2 py-1 text-[10px] font-medium text-[#E8B84B] transition-colors hover:border-[#E8B84B] hover:bg-[#132035] cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Restaurar Padrões</span>
              </button>
            </div>

            {/* Interactive Mini-Screen Layout Editor */}
            <div
              ref={previewAreaRef}
              className="relative mx-auto aspect-[16/9] w-full max-w-[460px] overflow-hidden rounded-md border border-[#E8B84B]/35 bg-[#0B1320] shadow-inner touch-none select-none"
            >
              {/* Subtle reference grid & top HUD exclusion zone */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[15%] border-b border-dashed border-[#E8B84B]/20 bg-[#132035]/45 flex items-center justify-between px-3 text-[9px] font-mono tracking-wider text-[#F4EFE6]/35"
              >
                <span>PONTUAÇÃO</span>
                <span>ONDA · SOBRECARGA</span>
                <span>ESCUDOS</span>
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-[15%] left-1/2 w-px border-l border-dashed border-[#F4EFE6]/10"
              />

              {/* Draggable Marker: Mover */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Posição do analógico Mover"
                onPointerDown={(e) => handleMarkerPointerDown('movePos', e)}
                onPointerMove={(e) => handleMarkerPointerMove('movePos', e)}
                onPointerUp={handleMarkerPointerUp}
                onPointerCancel={handleMarkerPointerUp}
                style={{
                  left: `${mobileControls.movePos.x * 100}%`,
                  top: `${mobileControls.movePos.y * 100}%`,
                  width: `${stickDiameterPx}px`,
                  height: `${stickDiameterPx}px`,
                  opacity: Math.max(0.45, mobileControls.opacity),
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-[#E8B84B] bg-[#E8B84B]/18 text-[#F4EFE6] shadow-md touch-none select-none cursor-grab active:cursor-grabbing ${
                  draggingMarker === 'movePos' ? 'ring-2 ring-[#F4EFE6]/60 scale-105' : ''
                }`}
              >
                <Move className="h-3.5 w-3.5 text-[#E8B84B]" aria-hidden="true" />
                <span className="pointer-events-none absolute -bottom-4 whitespace-nowrap rounded bg-[#0B1320]/90 px-1 text-[9px] font-semibold tracking-wide text-[#E8B84B]">
                  Mover
                </span>
              </div>

              {/* Draggable Marker: Mirar */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Posição do analógico Mirar"
                onPointerDown={(e) => handleMarkerPointerDown('aimPos', e)}
                onPointerMove={(e) => handleMarkerPointerMove('aimPos', e)}
                onPointerUp={handleMarkerPointerUp}
                onPointerCancel={handleMarkerPointerUp}
                style={{
                  left: `${mobileControls.aimPos.x * 100}%`,
                  top: `${mobileControls.aimPos.y * 100}%`,
                  width: `${stickDiameterPx}px`,
                  height: `${stickDiameterPx}px`,
                  opacity: Math.max(0.45, mobileControls.opacity),
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-[#E85D4A] bg-[#E85D4A]/18 text-[#F4EFE6] shadow-md touch-none select-none cursor-grab active:cursor-grabbing ${
                  draggingMarker === 'aimPos' ? 'ring-2 ring-[#F4EFE6]/60 scale-105' : ''
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-[#E85D4A]" aria-hidden="true" />
                <span className="pointer-events-none absolute -bottom-4 whitespace-nowrap rounded bg-[#0B1320]/90 px-1 text-[9px] font-semibold tracking-wide text-[#FF7B66]">
                  Mirar
                </span>
              </div>

              {/* Draggable Marker: Impulso */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Posição do botão Impulso"
                onPointerDown={(e) => handleMarkerPointerDown('dashPos', e)}
                onPointerMove={(e) => handleMarkerPointerMove('dashPos', e)}
                onPointerUp={handleMarkerPointerUp}
                onPointerCancel={handleMarkerPointerUp}
                style={{
                  left: `${mobileControls.dashPos.x * 100}%`,
                  top: `${mobileControls.dashPos.y * 100}%`,
                  width: `${dashDiameterPx}px`,
                  height: `${dashDiameterPx}px`,
                  opacity: Math.max(0.45, mobileControls.opacity),
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-[#3EC1B0] bg-[#132035]/90 text-[#E8B84B] shadow-md touch-none select-none cursor-grab active:cursor-grabbing ${
                  draggingMarker === 'dashPos' ? 'ring-2 ring-[#F4EFE6]/60 scale-105' : ''
                }`}
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="pointer-events-none absolute -bottom-4 whitespace-nowrap rounded bg-[#0B1320]/90 px-1 text-[9px] font-semibold tracking-wide text-[#3EC1B0]">
                  Impulso
                </span>
              </div>
            </div>

            {/* Sliders & Fixed Sticks Switch */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <SmoothSliderRow
                id="mobile-stick-scale"
                label="Tamanho dos Analógicos"
                sublabel={`Raio base 56px (${Math.round(56 * mobileControls.stickScale)}px)`}
                value={mobileControls.stickScale}
                min={0.65}
                max={1.45}
                rotated90={rotated90}
                onChange={(stickScale) => onGameplayChange({ mobileControls: { stickScale } })}
              />

              <SmoothSliderRow
                id="mobile-dash-scale"
                label="Tamanho do Botão Impulso"
                sublabel={`Tamanho base 64px (${Math.round(64 * mobileControls.dashScale)}px)`}
                value={mobileControls.dashScale}
                min={0.75}
                max={1.45}
                rotated90={rotated90}
                onChange={(dashScale) => onGameplayChange({ mobileControls: { dashScale } })}
              />

              <SmoothSliderRow
                id="mobile-opacity"
                label="Opacidade dos Controles"
                sublabel="Transparência dos controles táteis"
                value={mobileControls.opacity}
                min={0.35}
                max={1}
                rotated90={rotated90}
                onChange={(opacity) => onGameplayChange({ mobileControls: { opacity } })}
              />

              <div className="flex items-end">
                <ToggleRow
                  label="Joysticks fixos"
                  sublabel="Fixa os analógicos nas posições acima"
                  checked={mobileControls.fixedSticks}
                  onToggle={() =>
                    onGameplayChange({
                      mobileControls: { fixedSticks: !mobileControls.fixedSticks },
                    })
                  }
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'keyboard' && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto touch-pan-y px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-[#F4EFE6]/70">
                {listening
                  ? 'Pressione qualquer tecla ou clique com qualquer botão do mouse para vincular.'
                  : 'Clique em um atalho para alterar a tecla ou botão do mouse.'}
              </p>
              <div className="flex items-center gap-2">
                {listening && (
                  <button
                    type="button"
                    data-capture-cancel="true"
                    onClick={() => setListening(null)}
                    className="inline-flex items-center rounded border border-[#E85D4A]/60 bg-[#E85D4A]/15 px-2.5 py-1 text-[10px] font-semibold text-[#FF7B66] transition-colors hover:bg-[#E85D4A]/25 cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetControlsOnly}
                  onMouseEnter={onHover}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-[#E8B84B]/30 bg-[#0B1320]/80 px-2 py-1 text-[10px] font-medium text-[#E8B84B] transition-colors hover:border-[#E8B84B] hover:bg-[#132035] cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Restaurar Padrões</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {KEYBOARD_ACTIONS.map(({ action, label }) => {
                const slot = keyboardControls[action];
                const isPrimaryListening =
                  listening?.action === action && listening.slot === 'primary';
                const isSecondaryListening =
                  listening?.action === action && listening.slot === 'secondary';

                return (
                  <div
                    key={action}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-[#E8B84B]/18 bg-[#0B1320]/65 px-2.5 py-1.5"
                  >
                    <span className="text-xs font-medium text-[#F4EFE6] truncate">{label}</span>

                    {/* Primary Slot */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onPlayTabSound?.();
                          setListening({ action, slot: 'primary' });
                        }}
                        onMouseEnter={onHover}
                        className={`min-w-[84px] sm:min-w-[96px] rounded border px-2 py-1 text-center font-mono text-[11px] font-medium transition-colors cursor-pointer ${
                          isPrimaryListening
                            ? 'border-[#E8B84B] bg-[#E8B84B]/20 text-[#E8B84B] animate-pulse'
                            : slot.primary
                              ? 'border-[#E8B84B]/35 bg-[#132035] text-[#F4EFE6] hover:border-[#E8B84B]'
                              : 'border-[#F4EFE6]/15 bg-[#0B1320] text-[#F4EFE6]/45 hover:border-[#E8B84B]/50'
                        }`}
                      >
                        {isPrimaryListening ? 'Pressione...' : formatKeyCode(slot.primary)}
                      </button>
                      <button
                        type="button"
                        disabled={!slot.primary}
                        onClick={() => applyBinding(action, 'primary', '')}
                        aria-label={`Limpar atalho principal de ${label}`}
                        className="flex h-6 w-6 items-center justify-center rounded border border-[#E8B84B]/15 bg-[#0B1320]/80 text-[#F4EFE6]/50 transition-colors hover:border-[#E85D4A]/60 hover:text-[#FF7B66] disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Secondary Slot */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onPlayTabSound?.();
                          setListening({ action, slot: 'secondary' });
                        }}
                        onMouseEnter={onHover}
                        className={`min-w-[84px] sm:min-w-[96px] rounded border px-2 py-1 text-center font-mono text-[11px] font-medium transition-colors cursor-pointer ${
                          isSecondaryListening
                            ? 'border-[#E8B84B] bg-[#E8B84B]/20 text-[#E8B84B] animate-pulse'
                            : slot.secondary
                              ? 'border-[#E8B84B]/35 bg-[#132035] text-[#F4EFE6] hover:border-[#E8B84B]'
                              : 'border-[#F4EFE6]/15 bg-[#0B1320] text-[#F4EFE6]/45 hover:border-[#E8B84B]/50'
                        }`}
                      >
                        {isSecondaryListening ? 'Pressione...' : formatKeyCode(slot.secondary)}
                      </button>
                      <button
                        type="button"
                        disabled={!slot.secondary}
                        onClick={() => applyBinding(action, 'secondary', '')}
                        aria-label={`Limpar atalho secundário de ${label}`}
                        className="flex h-6 w-6 items-center justify-center rounded border border-[#E8B84B]/15 bg-[#0B1320]/80 text-[#F4EFE6]/50 transition-colors hover:border-[#E85D4A]/60 hover:text-[#FF7B66] disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Compact Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#E8B84B]/20 bg-[#0B1320]/65 px-4 py-2.5">
          <button
            type="button"
            onClick={onResetDefaults}
            onMouseEnter={onHover}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E8B84B]/25 bg-transparent px-3 text-[11px] font-medium text-[#F4EFE6]/75 transition-colors hover:border-[#E8B84B]/60 hover:text-[#F4EFE6] cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Restaurar Padrões</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            onMouseEnter={onHover}
            className="inline-flex h-8 items-center justify-center rounded-md bg-[#E8B84B] px-5 text-xs font-semibold text-[#0B1320] transition-colors hover:bg-[#F3C966] cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
