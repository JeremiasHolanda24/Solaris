import { Check, Crosshair, Move, ShieldPlus, Sparkles, Zap } from 'lucide-react';

interface TutorialModalProps {
  open: boolean;
  isTouch: boolean;
  disableFutureTutorial: boolean;
  onToggleDisableFuture: () => void;
  onConfirm: () => void;
  onHover: () => void;
}

export function TutorialModal({
  open,
  isTouch,
  disableFutureTutorial,
  onToggleDisableFuture,
  onConfirm,
  onHover,
}: TutorialModalProps) {
  if (!open) return null;

  return (
    <div
      className="animate-modal-backdrop absolute inset-0 z-30 flex items-center justify-center bg-[#0B1320]/82 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-modal-title"
    >
      <div className="animate-modal-panel flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[#E8B84B]/45 bg-[#101B2D] shadow-2xl">
        {/* Header */}
        <div className="shrink-0 border-b border-[#E8B84B]/20 bg-[#0B1320]/70 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2
                id="tutorial-modal-title"
                className="font-display text-base sm:text-lg font-semibold tracking-[0.14em] text-[#E8B84B]"
              >
                CONTROLES DA SONDA SOLARIS
              </h2>
              <p className="mt-0.5 text-[11px] sm:text-xs text-[#F4EFE6]/65">
                {isTouch
                  ? 'Chegada à zona de combate · Controles táteis ativos'
                  : 'Chegada à zona de combate · Teclado e Mouse'}
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto touch-pan-y px-4 py-3 sm:px-5 sm:py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="flex items-start gap-2.5 rounded-md border border-[#E8B84B]/20 bg-[#0B1320]/65 p-3">
              <Move className="mt-0.5 h-4 w-4 shrink-0 text-[#E8B84B]" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#F4EFE6]">Mover a Nave</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#F4EFE6]/70">
                  {isTouch
                    ? 'Arraste o polegar na metade esquerda da tela para pilotar.'
                    : 'Use WASD ou as Setas para manobrar pela arena.'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-md border border-[#E8B84B]/20 bg-[#0B1320]/65 p-3">
              <Crosshair className="mt-0.5 h-4 w-4 shrink-0 text-[#E8B84B]" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#F4EFE6]">Mirar e Disparar</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#F4EFE6]/70">
                  {isTouch
                    ? 'Arraste na metade direita para mirar e atirar automaticamente.'
                    : 'Mire com o Mouse e segure Clique Esquerdo ou Espaço para disparar.'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-md border border-[#E8B84B]/20 bg-[#0B1320]/65 p-3">
              <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[#E8B84B]" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#F4EFE6]">Impulso (Esquiva)</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#F4EFE6]/70">
                  {isTouch
                    ? 'Toque no botão Impulso para atravessar ataques com invulnerabilidade.'
                    : 'Pressione Shift ou Clique Direito para esquivar com invulnerabilidade.'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-md border border-[#5CE1FF]/25 bg-[#0B1320]/65 p-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#E8B84B]" aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F4EFE6]">
                  <span>Sobrecarga & Reparo</span>
                  <ShieldPlus className="h-3.5 w-3.5 text-[#7AE4FF]" aria-hidden="true" />
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#F4EFE6]/70">
                  Centelhas douradas carregam a Sobrecarga; núcleos azul-ciano raros reparam o casco.
                </p>
              </div>
            </div>
          </div>

          {/* Disable Tutorial Option inside the same tab */}
          <button
            type="button"
            role="checkbox"
            aria-checked={disableFutureTutorial}
            onClick={onToggleDisableFuture}
            onMouseEnter={onHover}
            className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors cursor-pointer ${
              disableFutureTutorial
                ? 'border-[#E8B84B]/65 bg-[#E8B84B]/12'
                : 'border-[#E8B84B]/20 bg-[#0B1320]/55 hover:border-[#E8B84B]/45'
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border transition-colors ${
                disableFutureTutorial
                  ? 'border-[#E8B84B] bg-[#E8B84B] text-[#0B1320]'
                  : 'border-[#F4EFE6]/40 bg-transparent text-transparent'
              }`}
            >
              <Check className="h-3 w-3 stroke-[3]" />
            </span>
            <span className="text-xs font-medium text-[#F4EFE6]/90">
              Desativar tutorial (não mostrar novamente nas próximas partidas)
            </span>
          </button>
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 border-t border-[#E8B84B]/20 bg-[#0B1320]/70 px-4 py-3 sm:px-5 flex justify-end">
          <button
            type="button"
            onClick={onConfirm}
            onMouseEnter={onHover}
            className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-md bg-[#E8B84B] px-6 text-xs sm:text-sm font-semibold tracking-wide text-[#0B1320] transition-colors hover:bg-[#F3C966] cursor-pointer"
          >
            Iniciar Combate
          </button>
        </div>
      </div>
    </div>
  );
}
