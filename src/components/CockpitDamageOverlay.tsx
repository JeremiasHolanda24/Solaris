import { memo } from 'react';

interface CockpitDamageOverlayProps {
  hp: number;
  maxHp: number;
  warningActive: boolean;
}

export const CockpitDamageOverlay = memo(function CockpitDamageOverlay({
  hp,
  maxHp,
  warningActive,
}: CockpitDamageOverlayProps) {
  const damageStage = Math.max(0, maxHp - hp); // 0 = intact, 1..4 = progressively more cracked
  const isCriticalOne = warningActive && hp === 1;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-12 overflow-hidden">
      {/* Continuous pulsing red cockpit warning light while HP <= 2 (compositor-only opacity, no box-shadow) */}
      {warningActive && (
        <div
          className={`absolute inset-0 will-change-opacity ${
            isCriticalOne ? 'animate-warning-pulse-fast' : 'animate-warning-pulse-slow'
          }`}
          style={{
            background:
              'radial-gradient(circle at center, rgba(220, 38, 38, 0) 46%, rgba(220, 38, 38, 0.24) 78%, rgba(232, 65, 52, 0.58) 100%)',
          }}
        />
      )}

      {/* Progressive cracked cockpit canopy glass */}
      {damageStage >= 1 && (
        <svg
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="glassCrackTint" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={warningActive ? '#FF9A8B' : '#F4EFE6'} stopOpacity="0.88" />
              <stop offset="100%" stopColor="#E8B84B" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {/* STAGE 1 (HP <= 3): Upper-left corner canopy fracture */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {/* Dark refraction shadow */}
            <g stroke="#050911" strokeOpacity="0.65" transform="translate(2, 2)">
              <path d="M 0,118 L 62,138 L 128,104 L 184,126 L 236,92" strokeWidth="2.4" />
              <path d="M 62,138 L 96,196 L 78,256" strokeWidth="1.8" />
              <path d="M 128,104 L 154,54 L 198,18" strokeWidth="1.6" />
              <path d="M 96,196 L 148,214" strokeWidth="1.3" />
              <path d="M 0,58 L 54,78 L 62,138" strokeWidth="1.5" />
            </g>
            {/* Bright glass edge glint */}
            <g stroke="url(#glassCrackTint)" strokeOpacity="0.72">
              <path d="M 0,118 L 62,138 L 128,104 L 184,126 L 236,92" strokeWidth="1.8" />
              <path d="M 62,138 L 96,196 L 78,256" strokeWidth="1.3" />
              <path d="M 128,104 L 154,54 L 198,18" strokeWidth="1.2" />
              <path d="M 96,196 L 148,214" strokeWidth="1" />
              <path d="M 0,58 L 54,78 L 62,138" strokeWidth="1.1" />
            </g>
          </g>

          {/* STAGE 2 (HP <= 2): Lower-right & Upper-right spider fractures */}
          {damageStage >= 2 && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <g stroke="#050911" strokeOpacity="0.7" transform="translate(2, 2)">
                {/* Lower-right impact cluster */}
                <path d="M 1440,742 L 1352,718 L 1276,766 L 1204,744 L 1142,786" strokeWidth="2.6" />
                <path d="M 1352,718 L 1312,642 L 1344,578" strokeWidth="1.9" />
                <path d="M 1276,766 L 1252,838 L 1218,900" strokeWidth="1.8" />
                <path d="M 1312,642 L 1244,626" strokeWidth="1.3" />
                <path d="M 1440,818 L 1368,802 L 1352,718" strokeWidth="1.6" />
                {/* Upper-right corner crack */}
                <path d="M 1440,146 L 1364,168 L 1316,124 L 1262,138" strokeWidth="2.1" />
                <path d="M 1364,168 L 1348,238" strokeWidth="1.4" />
              </g>
              <g stroke="url(#glassCrackTint)" strokeOpacity="0.82">
                <path d="M 1440,742 L 1352,718 L 1276,766 L 1204,744 L 1142,786" strokeWidth="2" />
                <path d="M 1352,718 L 1312,642 L 1344,578" strokeWidth="1.4" />
                <path d="M 1276,766 L 1252,838 L 1218,900" strokeWidth="1.4" />
                <path d="M 1312,642 L 1244,626" strokeWidth="1" />
                <path d="M 1440,818 L 1368,802 L 1352,718" strokeWidth="1.2" />
                <path d="M 1440,146 L 1364,168 L 1316,124 L 1262,138" strokeWidth="1.6" />
                <path d="M 1364,168 L 1348,238" strokeWidth="1.1" />
              </g>
            </g>
          )}

          {/* STAGE 3 (HP <= 1): Heavy shattered lower-left & creeping perimeter web */}
          {damageStage >= 3 && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <g stroke="#050911" strokeOpacity="0.78" transform="translate(2, 2)">
                {/* Lower-left heavy shatter */}
                <path d="M 0,762 L 88,732 L 154,784 L 246,756 L 318,804" strokeWidth="2.8" />
                <path d="M 88,732 L 124,652 L 86,574 L 124,508" strokeWidth="2.1" />
                <path d="M 154,784 L 176,854 L 222,900" strokeWidth="1.9" />
                <path d="M 124,652 L 194,638 L 248,668" strokeWidth="1.5" />
                <path d="M 0,836 L 78,818 L 88,732" strokeWidth="1.7" />
                {/* Extended upper-left & upper-right stress fractures */}
                <path d="M 236,92 L 314,68 L 372,114 L 442,96" strokeWidth="2.1" />
                <path d="M 314,68 L 338,0" strokeWidth="1.6" />
                <path d="M 1262,138 L 1184,116 L 1126,158" strokeWidth="2" />
                <path d="M 1348,238 L 1388,318 L 1440,352" strokeWidth="1.7" />
                {/* Spiderweb cross-cracks */}
                <path d="M 54,78 L 128,104 M 1368,802 L 1276,766 M 78,818 L 154,784" strokeWidth="1.2" />
              </g>
              <g stroke="url(#glassCrackTint)" strokeOpacity="0.92">
                <path d="M 0,762 L 88,732 L 154,784 L 246,756 L 318,804" strokeWidth="2.2" />
                <path d="M 88,732 L 124,652 L 86,574 L 124,508" strokeWidth="1.6" />
                <path d="M 154,784 L 176,854 L 222,900" strokeWidth="1.4" />
                <path d="M 124,652 L 194,638 L 248,668" strokeWidth="1.1" />
                <path d="M 0,836 L 78,818 L 88,732" strokeWidth="1.3" />
                <path d="M 236,92 L 314,68 L 372,114 L 442,96" strokeWidth="1.6" />
                <path d="M 314,68 L 338,0" strokeWidth="1.2" />
                <path d="M 1262,138 L 1184,116 L 1126,158" strokeWidth="1.5" />
                <path d="M 1348,238 L 1388,318 L 1440,352" strokeWidth="1.3" />
                <path d="M 54,78 L 128,104 M 1368,802 L 1276,766 M 78,818 L 154,784" strokeWidth="0.95" />
              </g>
            </g>
          )}
        </svg>
      )}
    </div>
  );
});
