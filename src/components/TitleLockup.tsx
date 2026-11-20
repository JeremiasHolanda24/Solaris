export function TitleLockup() {
  return (
    <div className="flex flex-col items-start select-none">
      <svg
        viewBox="0 0 460 124"
        className="w-[240px] sm:w-[340px] lg:w-[440px] h-auto max-h-[22dvh] overflow-visible"
        role="img"
        aria-label="Solaris"
      >
        <defs>
          <linearGradient id="solarisBrass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F6DC93" />
            <stop offset="48%" stopColor="#E8B84B" />
            <stop offset="100%" stopColor="#B8832A" />
          </linearGradient>
          <linearGradient id="solarisIvory" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFFDF8" />
            <stop offset="100%" stopColor="#E5D9C3" />
          </linearGradient>
        </defs>

        {/* Astrolabe Emblem */}
        <g transform="translate(52, 62)">
          <circle cx="0" cy="0" r="42" fill="none" stroke="url(#solarisBrass)" strokeWidth="1.6" opacity="0.85" />
          <circle cx="0" cy="0" r="32" fill="none" stroke="url(#solarisBrass)" strokeWidth="1" strokeDasharray="4 6" opacity="0.65" />
          <ellipse
            cx="0"
            cy="0"
            rx="46"
            ry="16"
            fill="none"
            stroke="url(#solarisBrass)"
            strokeWidth="1.4"
            transform="rotate(-24)"
          />
          <polygon
            points="0,-24 6,-6 24,0 6,6 0,24 -6,6 -24,0 -6,-6"
            fill="url(#solarisBrass)"
          />
          <circle cx="0" cy="0" r="4.5" fill="#0B1320" />
          <circle cx="38" cy="-16" r="3.2" fill="#E85D4A" />
        </g>

        {/* Wordmark */}
        <text
          x="116"
          y="76"
          fill="url(#solarisIvory)"
          fontFamily="'Cinzel', Georgia, serif"
          fontSize="56"
          fontWeight="700"
          letterSpacing="10"
        >
          SOLARIS
        </text>

        {/* Art Deco underline rule */}
        <line x1="118" y1="92" x2="365" y2="92" stroke="url(#solarisBrass)" strokeWidth="1.5" opacity="0.85" />
        <polygon points="376,92 382,88 388,92 382,96" fill="url(#solarisBrass)" />
        <line x1="398" y1="92" x2="438" y2="92" stroke="url(#solarisBrass)" strokeWidth="1" opacity="0.55" />
      </svg>
    </div>
  );
}
