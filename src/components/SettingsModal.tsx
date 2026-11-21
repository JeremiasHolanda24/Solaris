import { useCallback, useRef } from 'react';
import { RotateCcw, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { AudioSettings } from '../game/audio';
import { GameplaySettings } from '../game/types';

interface SettingsModalProps {
  open: boolean;
  rotated90: boolean;
  muted: boolean;
  audioSettings: AudioSettings;
  gameplaySettings: GameplaySettings;
  onToggleMute: () => void;
  onAudioChange: (partial: Partial<AudioSettings>) => void;
  onGameplayChange: (partial: Partial<GameplaySettings>) => void;
  onTestSfx: () => void;
  onTestVoice: () => void;
  onResetDefaults: () => void;
  onClose: () => void;
  onHover: () => void;
}

interface SmoothSliderRowProps {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  rotated90: boolean;
  disabled?: boolean;
  onChange: (next: number) => void;
  onTest?: () => void;
  testLabel?: string;
}

function SmoothSliderRow({
  id,
  label,
  sublabel,
  value,
  rotated90,
  disabled = false,
  onChange,
  onTest,
  testLabel,
}: SmoothSliderRowProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const clamped = Math.max(0, Math.min(1, value));
  const pct = Math.round(clamped * 100);
  const pctFloat = clamped * 100;

  const updateFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = trackRef.current;
      if (!el || disabled) return;
      const rect = el.getBoundingClientRect();
      let ratio: number;
      if (rotated90) {
        // Stage is rotated +90deg clockwise: local left->right maps to screen top->bottom
        ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
      } else {
        ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      }
      const next = Math.max(0, Math.min(1, ratio));
      onChange(next);
    },
    [disabled, onChange, rotated90]
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
    const step = e.shiftKey ? 0.1 : 0.05;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(1, clamped + step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(0, clamped - step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(1);
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
              disabled={disabled || pct === 0}
              className="rounded border border-[#E8B84B]/30 bg-[#0B1320]/80 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#E8B84B] transition-colors hover:border-[#E8B84B] hover:bg-[#16263E] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
            >
              {testLabel ?? 'Testar'}
            </button>
          )}
          <span className="w-9 text-right font-mono text-[11px] font-semibold text-[#E8B84B] tabular-nums">
            {pct}%
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
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
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

export function SettingsModal({
  open,
  rotated90,
  muted,
  audioSettings,
  gameplaySettings,
  onToggleMute,
  onAudioChange,
  onGameplayChange,
  onTestSfx,
  onTestVoice,
  onResetDefaults,
  onClose,
  onHover,
}: SettingsModalProps) {
  if (!open) return null;

  return (
    <div
      className="animate-modal-backdrop absolute inset-0 z-40 flex items-center justify-center bg-[#0B1320]/82 p-2.5 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="animate-modal-panel flex max-h-[94%] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-[#E8B84B]/40 bg-[#101B2D] shadow-2xl">
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

        {/* Responsive 1-column portrait / 2-column landscape layout */}
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
            </div>
          </section>
        </div>

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
