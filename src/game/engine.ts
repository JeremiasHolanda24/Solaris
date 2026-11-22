import playerFrontSpriteUrl from '../assets/images/solaris_cockpit_closeup.png';
import { GameAudio } from './audio';
import {
  Bullet,
  Enemy,
  EnemyType,
  FloatingText,
  GameState,
  HudSnapshot,
  Particle,
  ParticleKind,
  Shockwave,
  Spark,
  Star,
} from './types';

const HIGH_SCORE_KEY = 'solaris_highscore_v1';
const PARTICLE_POOL_SIZE = 440;
const SHOCKWAVE_POOL_SIZE = 32;
const ENEMY_POOL_SIZE = 64;
const BULLET_POOL_SIZE = 160;
const SPARK_POOL_SIZE = 96;
const FLOATING_TEXT_POOL_SIZE = 48;
const BASTION_SPREAD = [-0.26, 0, 0.26] as const;

const SPRITE_URLS = {
  PLAYER: '/src/assets/images/solaris_player_ship_1795180787643.jpg',
  PLAYER_FRONT: playerFrontSpriteUrl,
  SCOUT: '/src/assets/images/solaris_enemy_scout_1795181299986.jpg',
  STRIKER: '/src/assets/images/solaris_enemy_striker_1795181300757.jpg',
  BASTION: '/src/assets/images/solaris_enemy_bastion_1795181300327.jpg',
  SPLITTER: '/src/assets/images/solaris_enemy_splitter.png',
} as const;

type SpritePair = {
  normal: HTMLCanvasElement;
  flash: HTMLCanvasElement;
};

const PALETTE = {
  bgDeep: '#0B1320',
  bgRadial: '#132035',
  brass: '#E8B84B',
  brassSoft: '#B98D34',
  ivory: '#F4EFE6',
  coral: '#E85D4A',
  coralBright: '#FF7B66',
  teal: '#3EC1B0',
  bronze: '#D99B38',
  smokeLight: '#D6D0C4',
  smokeDark: '#6A7587',
};

// Hull breach points in player ship local space (+X = nose, +Y = starboard)
const DECOMPRESSION_VENTS = [
  { x: 10, y: -4, angle: -2.1 },   // Forward port breach
  { x: -4, y: 15, angle: 1.45 },   // Starboard wing pod
  { x: -6, y: -15, angle: -1.65 }, // Port wing pod
  { x: -19, y: 2, angle: 2.85 },   // Rear thruster housing
];

export class SolarisEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: GameAudio;
  private onHudUpdate: (snapshot: HudSnapshot) => void;
  private onCutsceneComplete?: () => void;
  private tutorialActive = false;

  private rafId: number | null = null;
  private lastTime = 0;
  private width = 1280;
  private height = 720;
  private dpr = 1;

  // Game state
  private state: GameState = 'TITLE_MENU';
  private score = 0;
  private highScore = 0;
  private newRecord = false;
  private combo = 1;
  private maxCombo = 1;
  private comboTimer = 0;
  private readonly comboDuration = 4.2;

  private wave = 1;
  private waveSpawnQueue: EnemyType[] = [];
  private spawnTimer = 0;
  private waveCooldown = 0;
  private waveBanner: string | null = null;
  private waveBannerTimer = 0;
  private kills = 0;
  private arenaZoom = 1;

  // Juice
  private hitstopTimer = 0;
  private shakeIntensity = 0;
  private shakePhase = 0;
  private damageFlashTimer = 0;
  private readonly damageFlashDuration = 0.38;
  private damagePulseId = 0;
  private repairAnimTimer = 0;
  private readonly repairAnimDuration = 1.4;
  private repairPulseId = 0;
  private repairMoteAccum = 0;
  private hullHealProgress = 0;
  private ambientTime = 0;

  // Dramatic Player Destruction Sequence
  private playerDying = false;
  private playerDetonated = false;
  private playerDeathTimer = 0;
  private playerVentAccum = 0;
  private playerSubBlastIndex = 0;
  private playerDeathSpinVel = 0;
  private resizeObserver: ResizeObserver | null = null;
  private rotated90 = false;

  // Player
  private player = {
    x: 640,
    y: 360,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    radius: 15,
    hp: 4,
    maxHp: 4,
    invulnTimer: 0,
    fireTimer: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashMaxCooldown: 1.3,
    dashBufferTimer: 0,
    dashDirX: 0,
    dashDirY: -1,
    overdriveCharge: 0, // 0..100
    overdriveTimer: 0,
    overdriveDuration: 5.5,
    scaleX: 1,
    scaleY: 1,
    recoil: 0,
  };

  // Input state
  private heldKeys = new Set<string>();
  private mouseX = 640;
  private mouseY = 360;
  private mouseDown = false;
  private mouseMovedRecently = false;

  // Touch twin-stick state
  private touchMode = false;
  private readonly stickMaxRadius = 56;
  private moveTouch: {
    id: number;
    originX: number;
    originY: number;
    currX: number;
    currY: number;
    dx: number;
    dy: number;
  } | null = null;
  private aimTouch: {
    id: number;
    originX: number;
    originY: number;
    currX: number;
    currY: number;
    dx: number;
    dy: number;
  } | null = null;

  // Cached transparent sprites (normal + ivory hit-flash silhouette)
  private sprites: Partial<Record<keyof typeof SPRITE_URLS, SpritePair>> = {};

  // Entities & Object Pools (pre-allocated to eliminate runtime GC pauses)
  private nextEnemyId = 1;
  private enemies: Enemy[] = [];
  private freeEnemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private freeBullets: Bullet[] = [];
  private sparks: Spark[] = [];
  private freeSparks: Spark[] = [];
  private floatingTexts: FloatingText[] = [];
  private freeFloatingTexts: FloatingText[] = [];
  private particles: Particle[] = [];
  private particleCursor = 0;
  private shockwaves: Shockwave[] = [];
  private shockwaveCursor = 0;
  private pointerScratch = { x: 0, y: 0 };
  private stars: Star[] = [];
  private warpStreaks: Array<{
    angle: number;
    z: number;
    speed: number;
    color: string;
    thickness: number;
    foreground: boolean;
  }> = [];

  private hudSyncTimer = 0;
  private screenShakeScale = 1;
  private showOffscreenIndicators = true;

  // Cinematic Intro Cutscene state
  private cutsceneTime = 0;
  private readonly cutsceneDuration = 6.35;
  private cutsceneTimeScale = 1;
  private cutsceneFlash = 0;
  private cutsceneFlags = {
    launched: false,
    riftEntered: false,
    shot1: false,
    shot2: false,
    boom1: false,
    boom2: false,
  };
  private cutsceneSquadron: Array<{
    enemy: Enemy;
    alive: boolean;
    alpha: number;
    startX: number;
    startY: number;
    hoverX: number;
    hoverY: number;
    exitX: number;
    exitY: number;
  }> = [];
  private cutsceneBolts: Array<{
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    tx: number;
    ty: number;
  }> = [
    { active: false, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
    { active: false, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
  ];

  // Randomized per-match Combat Zone Scenery (guaranteed dispersed & non-overlapping)
  private combatNebula: {
    normX: number;
    normY: number;
    scale: number;
    rotation: number;
    coreRgb: string;
    midRgb: string;
    accentRgb: string;
    lobes: Array<{
      dx: number;
      dy: number;
      rx: number;
      ry: number;
      rot: number;
      colorIdx: 0 | 1 | 2;
      alpha: number;
    }>;
  } = {
    normX: 0.25,
    normY: 0.3,
    scale: 0.44,
    rotation: 0.3,
    coreRgb: '109, 40, 217',
    midRgb: '217, 70, 239',
    accentRgb: '56, 189, 248',
    lobes: [],
  };

  private sceneryBodies: Array<
    | {
        kind: 'planet';
        normX: number;
        normY: number;
        scale: number;
        clearance: number;
        lightAngle: number;
        litHex: string;
        midHex: string;
        darkHex: string;
        rimRgb: string;
        bandRgb: string;
        hasRings: boolean;
        ringTilt: number;
      }
    | {
        kind: 'moon';
        normX: number;
        normY: number;
        scale: number;
        clearance: number;
        lightAngle: number;
        litHex: string;
        midHex: string;
        darkHex: string;
        rimRgb: string;
        craters: Array<{ dx: number; dy: number; r: number }>;
      }
    | {
        kind: 'star_body';
        normX: number;
        normY: number;
        scale: number;
        clearance: number;
        coreHex: string;
        coronaRgb: string;
        rayAngle: number;
        pulseOffset: number;
      }
    | {
        kind: 'black_hole';
        normX: number;
        normY: number;
        scale: number;
        clearance: number;
        diskTilt: number;
        accretionRgb: string;
        secondaryRgb: string;
        hotRgb: string;
        spinDir: 1 | -1;
        flareSide: 1 | -1;
        debris: Array<{
          angleOffset: number;
          orbitMul: number;
          speed: number;
          sizeMul: number;
          rotOffset: number;
          rotSpeed: number;
          pts: Array<{ a: number; r: number }>;
        }>;
      }
  > = [];

  constructor(
    canvas: HTMLCanvasElement,
    audio: GameAudio,
    onHudUpdate: (snapshot: HudSnapshot) => void,
    onCutsceneComplete?: () => void
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = context;
    this.audio = audio;
    this.onHudUpdate = onHudUpdate;
    this.onCutsceneComplete = onCutsceneComplete;
    this.generateCombatScenery();

    try {
      const saved = Number(localStorage.getItem(HIGH_SCORE_KEY) || '0');
      if (Number.isFinite(saved) && saved > 0) this.highScore = saved;
    } catch {
      this.highScore = 0;
    }

    // Initialize fixed-size object pools (zero runtime allocations during combat)
    for (let i = 0; i < ENEMY_POOL_SIZE; i++) {
      this.freeEnemies.push({
        id: 0,
        type: 'SCOUT',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angle: 0,
        radius: 16,
        hp: 1,
        maxHp: 1,
        hitFlash: 0,
        aiState: 'APPROACH',
        aiTimer: 0,
        targetAngle: 0,
        spin: 0,
      });
    }
    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      this.freeBullets.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 4,
        damage: 1,
        fromPlayer: true,
        life: 0,
        color: PALETTE.brass,
      });
    }
    for (let i = 0; i < SPARK_POOL_SIZE; i++) {
      this.freeSparks.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        value: 15,
        kind: 'overdrive',
      });
    }
    for (let i = 0; i < FLOATING_TEXT_POOL_SIZE; i++) {
      this.freeFloatingTexts.push({
        x: 0,
        y: 0,
        vy: -38,
        text: '',
        color: PALETTE.ivory,
        life: 0,
        maxLife: 0.7,
      });
    }
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        kind: 'spark',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 2,
        growth: 0,
        angle: 0,
        vAngle: 0,
        life: 0,
        maxLife: 1,
        color: PALETTE.brass,
        drag: 0.94,
      });
    }
    for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
      this.shockwaves.push({
        active: false,
        x: 0,
        y: 0,
        radius: 0,
        maxRadius: 80,
        life: 0,
        maxLife: 0.4,
        color: PALETTE.brass,
        lineWidth: 2,
        astrolabe: false,
        rotation: 0,
      });
    }

    this.resize();
    this.initStars();
    this.initWarpStreaks();
    this.loadAllSprites();
    this.bindEvents();
    this.emitHud();
  }

  private initWarpStreaks(): void {
    this.warpStreaks = [];
    const warpPalette = [
      '#FFFFFF',
      '#F4EFE6',
      '#F6D379',
      '#E888FF',
      '#FF6B9D',
      '#6EE7E0',
      '#C084FC',
    ];
    for (let i = 0; i < 280; i++) {
      this.warpStreaks.push({
        angle: Math.random() * Math.PI * 2,
        z: 0.03 + Math.random() * 0.97,
        speed: 0.9 + Math.random() * 1.55,
        color: warpPalette[Math.floor(Math.random() * warpPalette.length)],
        thickness: 0.75 + Math.random() * 1.85,
        foreground: i % 5 === 0,
      });
    }
  }

  private loadAllSprites(): void {
    (Object.keys(SPRITE_URLS) as Array<keyof typeof SPRITE_URLS>).forEach((key) => {
      const targetSize = key === 'PLAYER_FRONT' ? 768 : 256;
      this.loadSpritePair(key, SPRITE_URLS[key], targetSize);
    });
  }

  private loadSpritePair(key: keyof typeof SPRITE_URLS, src: string, maxDim: number): void {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      const outW = aspect >= 1 ? maxDim : Math.max(1, Math.round(maxDim * aspect));
      const outH = aspect >= 1 ? Math.max(1, Math.round(maxDim / aspect)) : maxDim;

      const normal = document.createElement('canvas');
      normal.width = outW;
      normal.height = outH;
      const nctx = normal.getContext('2d');
      if (!nctx) return;

      nctx.drawImage(img, 0, 0, outW, outH);
      const imgData = nctx.getImageData(0, 0, outW, outH);
      const data = imgData.data;

      // Preserve pre-cut RGBA PNG transparency (e.g. cleaned Núcleo sprite) without eating dark outlines
      const hasNativeAlpha =
        data[3] < 245 || data[(outW - 1) * 4 + 3] < 245 || data[(outW * (outH - 1)) * 4 + 3] < 245;

      if (!hasNativeAlpha) {
        // Auto-detect background color from top-left corner (supports pure black or pure white backdrops)
        const bgR = data[0];
        const bgG = data[1];
        const bgB = data[2];
        const isLightBg = bgR > 200 && bgG > 200 && bgB > 200;
        const threshold = isLightBg ? 46 : 30;

        const totalPixels = outW * outH;
        const visited = new Uint8Array(totalPixels);
        const queue = new Int32Array(totalPixels);
        let head = 0;
        let tail = 0;

        const isBg = (idx: number): boolean => {
          const o = idx * 4;
          const dr = Math.abs(data[o] - bgR);
          const dg = Math.abs(data[o + 1] - bgG);
          const db = Math.abs(data[o + 2] - bgB);
          return dr < threshold && dg < threshold && db < threshold;
        };

        const enqueue = (x: number, y: number) => {
          if (x < 0 || x >= outW || y < 0 || y >= outH) return;
          const idx = y * outW + x;
          if (visited[idx]) return;
          if (!isBg(idx)) return;
          visited[idx] = 1;
          queue[tail++] = idx;
        };

        for (let x = 0; x < outW; x++) {
          enqueue(x, 0);
          enqueue(x, outH - 1);
        }
        for (let y = 0; y < outH; y++) {
          enqueue(0, y);
          enqueue(outW - 1, y);
        }

        while (head < tail) {
          const idx = queue[head++];
          data[idx * 4 + 3] = 0;
          const x = idx % outW;
          const y = (idx - x) / outW;
          enqueue(x + 1, y);
          enqueue(x - 1, y);
          enqueue(x, y + 1);
          enqueue(x, y - 1);
        }

        // Soften 1px anti-alias fringe touching transparent exterior
        for (let y = 1; y < outH - 1; y++) {
          for (let x = 1; x < outW - 1; x++) {
            const idx = y * outW + x;
            if (visited[idx]) continue;
            const touchesBg =
              visited[idx - 1] || visited[idx + 1] || visited[idx - outW] || visited[idx + outW];
            if (touchesBg) {
              const o = idx * 4;
              const dist =
                (Math.abs(data[o] - bgR) + Math.abs(data[o + 1] - bgG) + Math.abs(data[o + 2] - bgB)) /
                3;
              if (dist < threshold + 28) {
                data[o + 3] = Math.round(Math.min(255, (dist / (threshold + 28)) * 210));
              }
            }
          }
        }

        nctx.putImageData(imgData, 0, 0);
      }

      // Create cached ivory hit-flash silhouette
      const flash = document.createElement('canvas');
      flash.width = outW;
      flash.height = outH;
      const fctx = flash.getContext('2d');
      if (fctx) {
        fctx.drawImage(normal, 0, 0);
        fctx.globalCompositeOperation = 'source-in';
        fctx.fillStyle = PALETTE.ivory;
        fctx.fillRect(0, 0, outW, outH);
      }

      this.sprites[key] = { normal, flash };
    };
    img.src = src;
  }

  private initStars(): void {
    this.stars = [];
    const count = 130;
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.8 + Math.random() * 1.6,
        depth: 0.15 + Math.random() * 0.7,
        alpha: 0.25 + Math.random() * 0.65,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  public startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      this.update(dt);
      this.render();

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.unbindEvents();
  }

  public startNewGame(): void {
    this.audio.unlock();
    this.score = 0;
    this.newRecord = false;
    this.combo = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.wave = 1;
    this.kills = 0;
    this.arenaZoom = 1;
    this.hitstopTimer = 0;
    this.shakeIntensity = 0;
    this.damageFlashTimer = 0;
    this.repairAnimTimer = 0;
    this.repairMoteAccum = 0;
    this.hullHealProgress = 0;

    this.playerDying = false;
    this.playerDetonated = false;
    this.playerDeathTimer = 0;
    this.playerVentAccum = 0;
    this.playerSubBlastIndex = 0;

    this.player.x = this.width / 2;
    this.player.y = this.height / 2;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.angle = -Math.PI / 2;
    this.player.hp = this.player.maxHp;
    this.player.invulnTimer = 1.0;
    this.player.fireTimer = 0;
    this.player.dashTimer = 0;
    this.player.dashCooldown = 0;
    this.player.dashBufferTimer = 0;
    this.player.overdriveCharge = 0;
    this.player.overdriveTimer = 0;
    this.player.scaleX = 1;
    this.player.scaleY = 1;
    this.player.recoil = 0;

    this.releaseAllEntities();
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) this.particles[i].active = false;
    for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) this.shockwaves[i].active = false;

    this.generateCombatScenery();
    this.initIntroCutscene();
    this.state = 'INTRO_CUTSCENE';
    this.audio.playCutsceneWarpSequence();
    this.emitHud();
  }

  public setTutorialActive(active: boolean): void {
    this.tutorialActive = active;
  }

  private generateCombatScenery(): void {
    const nebulaPalettes = [
      { coreRgb: '124, 58, 237', midRgb: '217, 70, 239', accentRgb: '56, 189, 248' },
      { coreRgb: '13, 148, 136', midRgb: '62, 193, 176', accentRgb: '96, 165, 250' },
      { coreRgb: '217, 119, 6', midRgb: '225, 29, 72', accentRgb: '245, 158, 11' },
      { coreRgb: '29, 78, 216', midRgb: '6, 182, 212', accentRgb: '167, 139, 250' },
      { coreRgb: '190, 24, 93', midRgb: '124, 58, 237', accentRgb: '244, 114, 182' },
      { coreRgb: '180, 83, 9', midRgb: '192, 132, 252', accentRgb: '56, 189, 248' },
    ];
    const nebPal = nebulaPalettes[Math.floor(Math.random() * nebulaPalettes.length)];
    const nebX = 0.14 + Math.random() * 0.72;
    const nebY = 0.16 + Math.random() * 0.68;
    const nebScale = 0.34 + Math.random() * 0.24;
    const lobes: typeof this.combatNebula.lobes = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist = i === 0 ? 0.04 : 0.16 + Math.random() * 0.24;
      lobes.push({
        dx: Math.cos(a) * dist,
        dy: Math.sin(a) * dist,
        rx: 0.45 + Math.random() * 0.45,
        ry: 0.28 + Math.random() * 0.34,
        rot: Math.random() * Math.PI,
        colorIdx: (i % 3) as 0 | 1 | 2,
        alpha: i === 0 ? 0.16 : 0.08 + Math.random() * 0.08,
      });
    }
    this.combatNebula = {
      normX: nebX,
      normY: nebY,
      scale: nebScale,
      rotation: Math.random() * Math.PI * 2,
      coreRgb: nebPal.coreRgb,
      midRgb: nebPal.midRgb,
      accentRgb: nebPal.accentRgb,
      lobes,
    };

    const planetPalettes = [
      { litHex: '#FB923C', midHex: '#C2410C', darkHex: '#250F06', rimRgb: '253, 186, 116', bandRgb: '255, 237, 213' },
      { litHex: '#38BDF8', midHex: '#1D4ED8', darkHex: '#0A152E', rimRgb: '125, 211, 252', bandRgb: '224, 242, 254' },
      { litHex: '#34D399', midHex: '#065F46', darkHex: '#04241B', rimRgb: '110, 231, 183', bandRgb: '209, 250, 229' },
      { litHex: '#F87171', midHex: '#991B1B', darkHex: '#24090A', rimRgb: '252, 165, 165', bandRgb: '254, 226, 226' },
      { litHex: '#C084FC', midHex: '#5B21B6', darkHex: '#170B33', rimRgb: '221, 214, 254', bandRgb: '243, 232, 255' },
      { litHex: '#E8B84B', midHex: '#92400E', darkHex: '#241305', rimRgb: '253, 230, 138', bandRgb: '254, 243, 199' },
    ];
    const moonPalettes = [
      { litHex: '#CBD5E1', midHex: '#64748B', darkHex: '#1E293B', rimRgb: '226, 232, 240' },
      { litHex: '#E7D6BE', midHex: '#9C8364', darkHex: '#2B2219', rimRgb: '245, 232, 211' },
      { litHex: '#BAE6FD', midHex: '#3B82F6', darkHex: '#0F1D3A', rimRgb: '186, 230, 253' },
      { litHex: '#FCA5A5', midHex: '#9F3A3A', darkHex: '#2A1014', rimRgb: '254, 202, 202' },
    ];
    const starPalettes = [
      { coreHex: '#FFF9E6', coronaRgb: '251, 191, 36' },
      { coreHex: '#F0F9FF', coronaRgb: '56, 189, 248' },
      { coreHex: '#FFF1F2', coronaRgb: '251, 113, 133' },
      { coreHex: '#FEFCE8', coronaRgb: '244, 239, 230' },
    ];
    const blackHolePalettes = [
      { accretionRgb: '59, 130, 246', secondaryRgb: '168, 85, 247', hotRgb: '235, 248, 255' },
      { accretionRgb: '56, 189, 248', secondaryRgb: '129, 140, 248', hotRgb: '240, 249, 255' },
      { accretionRgb: '245, 158, 11', secondaryRgb: '234, 88, 12', hotRgb: '255, 247, 224' },
    ];

    // Aspect-safe non-overlapping placement across standard & Wave 10+ expanded space
    const placed: Array<{ x: number; y: number; clearance: number }> = [];
    const bodies: typeof this.sceneryBodies = [];

    const isClear = (cx: number, cy: number, clearance: number, avoidNebulaCore = false): boolean => {
      if (avoidNebulaCore && Math.hypot(cx - nebX, cy - nebY) < clearance + 0.24) {
        return false;
      }
      for (let i = 0; i < placed.length; i++) {
        const o = placed[i];
        // Check both landscape & square aspect distances so objects never touch on any screen ratio
        const dMin = Math.hypot((cx - o.x) * 0.85, cy - o.y);
        if (dMin < clearance + o.clearance + 0.065) {
          return false;
        }
      }
      return true;
    };

    const pickDispersedPos = (
      clearance: number,
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
      avoidNebulaCore: boolean
    ): { x: number; y: number } | null => {
      for (let attempt = 0; attempt < 96; attempt++) {
        const cx = minX + Math.random() * (maxX - minX);
        const cy = minY + Math.random() * (maxY - minY);
        if (isClear(cx, cy, clearance, avoidNebulaCore)) {
          return { x: cx, y: cy };
        }
      }
      return null;
    };

    // 1. Place 1-2 Planets (avoiding Nebula core)
    const planetCount = Math.random() < 0.55 ? 2 : 1;
    const planetPositions: Array<{ x: number; y: number; clearance: number; scale: number }> = [];
    for (let i = 0; i < planetCount; i++) {
      const plPal = planetPalettes[Math.floor(Math.random() * planetPalettes.length)];
      const scale = (i === 0 ? 0.066 : 0.05) + Math.random() * 0.045;
      const hasRings = Math.random() < 0.56;
      const clearance = scale * (hasRings ? 2.18 : 1.52);
      const pos =
        i === 0
          ? pickDispersedPos(clearance, 0.12, 0.88, 0.14, 0.86, true)
          : pickDispersedPos(clearance, -0.08, 1.08, -0.06, 1.06, true);
      if (!pos) continue;

      placed.push({ x: pos.x, y: pos.y, clearance });
      planetPositions.push({ x: pos.x, y: pos.y, clearance, scale });
      bodies.push({
        kind: 'planet',
        normX: pos.x,
        normY: pos.y,
        scale,
        clearance,
        lightAngle: Math.random() * Math.PI * 2,
        litHex: plPal.litHex,
        midHex: plPal.midHex,
        darkHex: plPal.darkHex,
        rimRgb: plPal.rimRgb,
        bandRgb: plPal.bandRgb,
        hasRings,
        ringTilt: (Math.random() - 0.5) * 1.15,
      });
    }

    // 2. Place 1-2 Black Holes (well separated from planets, nebula core & each other)
    const bhCount = Math.random() < 0.45 ? 2 : 1;
    for (let i = 0; i < bhCount; i++) {
      const bhPal = blackHolePalettes[Math.floor(Math.random() * blackHolePalettes.length)];
      const scale = 0.044 + Math.random() * 0.022;
      const clearance = scale * 2.8;
      const pos =
        i === 0
          ? pickDispersedPos(clearance, 0.1, 0.9, 0.12, 0.88, true)
          : pickDispersedPos(clearance, -0.08, 1.08, -0.06, 1.06, true);
      if (!pos) continue;

      const debrisCount = 11 + Math.floor(Math.random() * 5);
      const debris: Array<{
        angleOffset: number;
        orbitMul: number;
        speed: number;
        sizeMul: number;
        rotOffset: number;
        rotSpeed: number;
        pts: Array<{ a: number; r: number }>;
      }> = [];
      for (let d = 0; d < debrisCount; d++) {
        const verts = 6 + (d % 2);
        const pts: Array<{ a: number; r: number }> = [];
        for (let v = 0; v < verts; v++) {
          pts.push({
            a: (v / verts) * Math.PI * 2 + (Math.random() - 0.5) * 0.25,
            r: 0.65 + Math.random() * 0.48,
          });
        }
        const orbitMul = 1.48 + Math.random() * 1.18;
        debris.push({
          angleOffset: Math.random() * Math.PI * 2,
          orbitMul,
          speed: (0.28 + (2.7 - orbitMul) * 0.24) * (0.85 + Math.random() * 0.3),
          sizeMul: 0.055 + Math.random() * 0.095,
          rotOffset: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 1.2,
          pts,
        });
      }

      placed.push({ x: pos.x, y: pos.y, clearance });
      bodies.push({
        kind: 'black_hole',
        normX: pos.x,
        normY: pos.y,
        scale,
        clearance,
        diskTilt: (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.36),
        accretionRgb: bhPal.accretionRgb,
        secondaryRgb: bhPal.secondaryRgb,
        hotRgb: bhPal.hotRgb,
        spinDir: Math.random() < 0.5 ? 1 : -1,
        flareSide: Math.random() < 0.5 ? 1 : -1,
        debris,
      });
    }

    // 3. Place 1-2 Luminous Stars (dispersed across arena & outer expanded space)
    const starCount = 1 + (Math.random() < 0.65 ? 1 : 0);
    for (let i = 0; i < starCount; i++) {
      const stPal = starPalettes[Math.floor(Math.random() * starPalettes.length)];
      const scale = 0.024 + Math.random() * 0.018;
      const clearance = scale * 2.4;
      const pos =
        i === 0
          ? pickDispersedPos(clearance, 0.06, 0.94, 0.08, 0.92, false)
          : pickDispersedPos(clearance, -0.12, 1.12, -0.1, 1.1, false);
      if (!pos) continue;
      placed.push({ x: pos.x, y: pos.y, clearance });
      bodies.push({
        kind: 'star_body',
        normX: pos.x,
        normY: pos.y,
        scale,
        clearance,
        coreHex: stPal.coreHex,
        coronaRgb: stPal.coronaRgb,
        rayAngle: Math.random() * Math.PI * 0.5,
        pulseOffset: Math.random() * Math.PI * 2,
      });
    }

    // 4. Place 2-3 Natural Satellites (moons — at least one orbiting near a planet without overlapping, others dispersed)
    const moonCount = 2 + (Math.random() < 0.55 ? 1 : 0);
    for (let i = 0; i < moonCount; i++) {
      const mPal = moonPalettes[Math.floor(Math.random() * moonPalettes.length)];
      const scale = 0.016 + Math.random() * 0.012;
      const clearance = scale * 1.45;
      let pos: { x: number; y: number } | null = null;

      if (i === 0 && planetPositions.length > 0) {
        const host = planetPositions[0];
        const orbitDist = host.clearance + clearance + 0.09 + Math.random() * 0.06;
        for (let aTry = 0; aTry < 32; aTry++) {
          const ang = Math.random() * Math.PI * 2;
          const cx = host.x + Math.cos(ang) * orbitDist;
          const cy = host.y + Math.sin(ang) * orbitDist;
          if (cx >= -0.08 && cx <= 1.08 && cy >= -0.06 && cy <= 1.06 && isClear(cx, cy, clearance, false)) {
            pos = { x: cx, y: cy };
            break;
          }
        }
      }
      if (!pos) {
        pos = pickDispersedPos(clearance, -0.08, 1.08, -0.06, 1.06, false);
      }
      if (!pos) continue;

      placed.push({ x: pos.x, y: pos.y, clearance });
      const craters: Array<{ dx: number; dy: number; r: number }> = [];
      for (let c = 0; c < 4; c++) {
        const ca = Math.random() * Math.PI * 2;
        const cd = 0.16 + Math.random() * 0.44;
        craters.push({
          dx: Math.cos(ca) * cd,
          dy: Math.sin(ca) * cd,
          r: 0.14 + Math.random() * 0.16,
        });
      }
      bodies.push({
        kind: 'moon',
        normX: pos.x,
        normY: pos.y,
        scale,
        clearance,
        lightAngle: Math.random() * Math.PI * 2,
        litHex: mPal.litHex,
        midHex: mPal.midHex,
        darkHex: mPal.darkHex,
        rimRgb: mPal.rimRgb,
        craters,
      });
    }

    this.sceneryBodies = bodies;
  }

  public skipCutscene(): void {
    if (this.state !== 'INTRO_CUTSCENE') return;
    this.audio.stopCutsceneAudio();
    this.finishCutsceneToGameplay(true);
  }

  private initIntroCutscene(): void {
    const w = this.width;
    const h = this.height;
    this.cutsceneTime = 0;
    this.cutsceneTimeScale = 1;
    this.cutsceneFlash = 0;
    this.cutsceneFlags = {
      launched: false,
      riftEntered: false,
      shot1: false,
      shot2: false,
      boom1: false,
      boom2: false,
    };
    this.cutsceneBolts[0].active = false;
    this.cutsceneBolts[1].active = false;

    const specs: Array<{
      id: number;
      type: EnemyType;
      sx: number;
      sy: number;
      hx: number;
      hy: number;
      ex: number;
      ey: number;
      r: number;
    }> = [
      { id: 901, type: 'SCOUT', sx: 1.06, sy: 0.16, hx: 0.67, hy: 0.34, ex: 0.67, ey: 0.34, r: 16 },
      { id: 902, type: 'SCOUT', sx: 1.12, sy: 0.30, hx: 0.74, hy: 0.44, ex: 0.74, ey: 0.44, r: 16 },
      { id: 903, type: 'STRIKER', sx: 1.16, sy: 0.12, hx: 0.80, hy: 0.27, ex: 1.16, ey: 0.14, r: 18 },
      { id: 904, type: 'BASTION', sx: 1.22, sy: 0.44, hx: 0.86, hy: 0.56, ex: 1.18, ey: 0.66, r: 25 },
    ];

    this.cutsceneSquadron = specs.map((s) => ({
      enemy: {
        id: s.id,
        type: s.type,
        x: w * s.sx,
        y: h * s.sy,
        vx: -180,
        vy: 90,
        angle: Math.PI * 0.82,
        radius: s.r,
        hp: 3,
        maxHp: 3,
        hitFlash: 0,
        aiState: 'APPROACH',
        aiTimer: 1,
        targetAngle: Math.PI * 0.82,
        spin: 0,
      },
      alive: true,
      alpha: 1,
      startX: w * s.sx,
      startY: h * s.sy,
      hoverX: w * s.hx,
      hoverY: h * s.hy,
      exitX: w * s.ex,
      exitY: h * s.ey,
    }));
  }

  private finishCutsceneToGameplay(skipped: boolean): void {
    this.state = 'PLAYING';
    this.arenaZoom = 1;
    this.cutsceneTimeScale = 1;
    this.cutsceneFlash = 0;
    this.cutsceneBolts[0].active = false;
    this.cutsceneBolts[1].active = false;
    this.cutsceneSquadron = [];

    this.player.x = this.width / 2;
    this.player.y = this.height / 2;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.angle = -Math.PI / 2;
    this.player.invulnTimer = 1.1;
    this.player.scaleX = 1;
    this.player.scaleY = 1;
    this.player.recoil = 0;

    if (skipped) {
      this.shakeIntensity = 0;
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) this.particles[i].active = false;
      for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) this.shockwaves[i].active = false;
      this.spawnShockwave(this.player.x, this.player.y, 120, PALETTE.brass, 2.5, 0.45, true);
    }

    this.prepareWave(1);
    this.emitHud();
    this.onCutsceneComplete?.();
  }

  public togglePause(): void {
    if (this.playerDying) return;
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.clearAllInputs();
      this.emitHud();
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.lastTime = performance.now();
      this.emitHud();
    }
  }

  public returnToTitle(): void {
    this.audio.stopCutsceneAudio();
    this.state = 'TITLE_MENU';
    this.playerDying = false;
    this.playerDetonated = false;
    this.hullHealProgress = 0;
    this.cutsceneSquadron = [];
    this.clearAllInputs();
    this.releaseAllEntities();
    this.waveBanner = null;
    this.emitHud();
  }

  private releaseAllEntities(): void {
    while (this.enemies.length > 0) {
      this.freeEnemies.push(this.enemies.pop()!);
    }
    while (this.bullets.length > 0) {
      this.freeBullets.push(this.bullets.pop()!);
    }
    while (this.sparks.length > 0) {
      this.freeSparks.push(this.sparks.pop()!);
    }
    while (this.floatingTexts.length > 0) {
      this.freeFloatingTexts.push(this.floatingTexts.pop()!);
    }
  }

  private releaseEnemyAt(index: number): void {
    const lastIdx = this.enemies.length - 1;
    const removed = this.enemies[index];
    if (index !== lastIdx) {
      this.enemies[index] = this.enemies[lastIdx];
    }
    this.enemies.pop();
    this.freeEnemies.push(removed);
  }

  private releaseBulletAt(index: number): void {
    const lastIdx = this.bullets.length - 1;
    const removed = this.bullets[index];
    if (index !== lastIdx) {
      this.bullets[index] = this.bullets[lastIdx];
    }
    this.bullets.pop();
    this.freeBullets.push(removed);
  }

  private releaseSparkAt(index: number): void {
    const lastIdx = this.sparks.length - 1;
    const removed = this.sparks[index];
    if (index !== lastIdx) {
      this.sparks[index] = this.sparks[lastIdx];
    }
    this.sparks.pop();
    this.freeSparks.push(removed);
  }

  private releaseFloatingTextAt(index: number): void {
    const lastIdx = this.floatingTexts.length - 1;
    const removed = this.floatingTexts[index];
    if (index !== lastIdx) {
      this.floatingTexts[index] = this.floatingTexts[lastIdx];
    }
    this.floatingTexts.pop();
    this.freeFloatingTexts.push(removed);
  }

  private spawnBullet(
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    damage: number,
    fromPlayer: boolean,
    life: number,
    color: string
  ): void {
    const b = this.freeBullets.pop();
    if (!b) return;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.radius = radius;
    b.damage = damage;
    b.fromPlayer = fromPlayer;
    b.life = life;
    b.color = color;
    this.bullets.push(b);
  }

  private spawnSpark(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    value: number,
    kind: 'overdrive' | 'repair' = 'overdrive'
  ): void {
    const s = this.freeSparks.pop();
    if (!s) return;
    s.x = x;
    s.y = y;
    s.vx = vx;
    s.vy = vy;
    s.life = life;
    s.value = value;
    s.kind = kind;
    this.sparks.push(s);
  }

  private spawnFloatingText(x: number, y: number, vy: number, text: string, color: string, maxLife: number): void {
    const ft = this.freeFloatingTexts.pop();
    if (!ft) return;
    ft.x = x;
    ft.y = y;
    ft.vy = vy;
    ft.text = text;
    ft.color = color;
    ft.life = maxLife;
    ft.maxLife = maxLife;
    this.floatingTexts.push(ft);
  }

  public triggerDash(): void {
    if (this.state !== 'PLAYING' || this.playerDying) return;
    this.audio.unlock();
    this.player.dashBufferTimer = 0.16;
  }

  public getState(): GameState {
    return this.state;
  }

  private clearAllInputs(): void {
    this.heldKeys.clear();
    this.mouseDown = false;
    this.moveTouch = null;
    this.aimTouch = null;
  }

  private vibrate(pattern: number | number[]): void {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore unsupported vibration
    }
  }

  public setRotated90(rotated: boolean): void {
    if (this.rotated90 === rotated) return;
    this.rotated90 = rotated;
    this.clearAllInputs();
    this.resize();
  }

  public setGameplaySettings(settings: { screenShake: number; offscreenIndicators: boolean }): void {
    this.screenShakeScale = Math.max(0, Math.min(1, settings.screenShake));
    this.showOffscreenIndicators = settings.offscreenIndicators;
  }

  private toCanvasCoords(
    clientX: number,
    clientY: number,
    rect: DOMRect
  ): { x: number; y: number } {
    if (this.rotated90) {
      const rx = clientX - rect.left;
      const ry = clientY - rect.top;
      this.pointerScratch.x = rect.height > 0 ? (ry / rect.height) * this.width : ry;
      this.pointerScratch.y =
        rect.width > 0 ? this.height - (rx / rect.width) * this.height : this.height - rx;
      return this.pointerScratch;
    }
    this.pointerScratch.x = clientX - rect.left;
    this.pointerScratch.y = clientY - rect.top;
    return this.pointerScratch;
  }

  private resize = (): void => {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, Math.floor(parent ? parent.clientWidth : window.innerWidth));
    const h = Math.max(1, Math.floor(parent ? parent.clientHeight : window.innerHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = w;
    this.height = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;

    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (code === 'Escape' || code === 'KeyP') {
      if (this.tutorialActive) return;
      if (this.state === 'PLAYING' || this.state === 'PAUSED') {
        this.togglePause();
      }
      return;
    }

    if (this.state === 'INTRO_CUTSCENE') {
      if (
        (code === 'Space' || code === 'Enter' || code === 'Escape') &&
        this.cutsceneTime > 0.25
      ) {
        this.skipCutscene();
      }
      return;
    }

    if (this.state === 'TITLE_MENU' || this.state === 'GAME_OVER') {
      if (code === 'Enter' || code === 'Space') {
        this.startNewGame();
      }
      return;
    }

    if (this.state === 'PLAYING' && !this.playerDying) {
      const wasHeld = this.heldKeys.has(code);
      this.heldKeys.add(code);

      if (!wasHeld && (code === 'ShiftLeft' || code === 'ShiftRight')) {
        this.player.dashBufferTimer = 0.14;
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const pt = this.toCanvasCoords(e.clientX, e.clientY, rect);
    this.mouseX = pt.x;
    this.mouseY = pt.y;
    this.mouseMovedRecently = true;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.state !== 'PLAYING' || this.playerDying) return;
    this.audio.unlock();
    const rect = this.canvas.getBoundingClientRect();
    const pt = this.toCanvasCoords(e.clientX, e.clientY, rect);
    this.mouseX = pt.x;
    this.mouseY = pt.y;
    this.mouseMovedRecently = true;

    if (e.button === 0) {
      this.mouseDown = true;
    } else if (e.button === 2) {
      this.player.dashBufferTimer = 0.14;
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseDown = false;
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    if (this.state === 'PLAYING') {
      e.preventDefault();
    }
  };

  private handleTouchStart = (e: TouchEvent): void => {
    if (this.state !== 'PLAYING' || this.playerDying) return;
    e.preventDefault();
    this.audio.unlock();
    this.touchMode = true;
    this.mouseMovedRecently = false;

    const rect = this.canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const { x: tx, y: ty } = this.toCanvasCoords(t.clientX, t.clientY, rect);

      if (tx < this.width * 0.5 && this.moveTouch === null) {
        this.moveTouch = {
          id: t.identifier,
          originX: tx,
          originY: ty,
          currX: tx,
          currY: ty,
          dx: 0,
          dy: 0,
        };
      } else if (tx >= this.width * 0.5 && this.aimTouch === null) {
        this.aimTouch = {
          id: t.identifier,
          originX: tx,
          originY: ty,
          currX: tx,
          currY: ty,
          dx: 0,
          dy: 0,
        };
      }
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (this.state !== 'PLAYING' || this.playerDying) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const maxR = this.stickMaxRadius;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const { x: tx, y: ty } = this.toCanvasCoords(t.clientX, t.clientY, rect);

      if (this.moveTouch && t.identifier === this.moveTouch.id) {
        const rawX = tx - this.moveTouch.originX;
        const rawY = ty - this.moveTouch.originY;
        const dist = Math.hypot(rawX, rawY);
        const clamped = Math.min(dist, maxR);
        const angle = Math.atan2(rawY, rawX);
        this.moveTouch.currX = this.moveTouch.originX + Math.cos(angle) * clamped;
        this.moveTouch.currY = this.moveTouch.originY + Math.sin(angle) * clamped;
        this.moveTouch.dx = dist > 6 ? (Math.cos(angle) * clamped) / maxR : 0;
        this.moveTouch.dy = dist > 6 ? (Math.sin(angle) * clamped) / maxR : 0;
      } else if (this.aimTouch && t.identifier === this.aimTouch.id) {
        const rawX = tx - this.aimTouch.originX;
        const rawY = ty - this.aimTouch.originY;
        const dist = Math.hypot(rawX, rawY);
        const clamped = Math.min(dist, maxR);
        const angle = Math.atan2(rawY, rawX);
        this.aimTouch.currX = this.aimTouch.originX + Math.cos(angle) * clamped;
        this.aimTouch.currY = this.aimTouch.originY + Math.sin(angle) * clamped;
        this.aimTouch.dx = dist > 8 ? Math.cos(angle) : 0;
        this.aimTouch.dy = dist > 8 ? Math.sin(angle) : 0;
      }
    }
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const id = e.changedTouches[i].identifier;
      if (this.moveTouch && this.moveTouch.id === id) {
        this.moveTouch = null;
      }
      if (this.aimTouch && this.aimTouch.id === id) {
        this.aimTouch = null;
      }
    }
  };

  private handleBlur = (): void => {
    this.clearAllInputs();
    if (this.state === 'PLAYING' && !this.playerDying) {
      this.state = 'PAUSED';
      this.emitHud();
    }
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    document.addEventListener('fullscreenchange', this.resize);
    if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    window.addEventListener('touchend', this.handleTouchEnd);
    window.addEventListener('touchcancel', this.handleTouchEnd);
  }

  private unbindEvents(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    document.removeEventListener('fullscreenchange', this.resize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    window.removeEventListener('touchend', this.handleTouchEnd);
    window.removeEventListener('touchcancel', this.handleTouchEnd);
  }

  private getTargetArenaZoom(): number {
    if (this.wave < 10) return 1;
    return Math.max(0.68, 0.76 - Math.floor((this.wave - 10) / 5) * 0.04);
  }

  private prepareWave(waveNum: number): void {
    this.wave = waveNum;
    const queue: EnemyType[] = [];

    // Controlled gradual ramp for Waves 1-9, clear escalation starting at Wave 10
    const totalCount =
      waveNum < 10 ? 2 + Math.round(waveNum * 1.5) : 19 + (waveNum - 9) * 3;

    for (let i = 0; i < totalCount; i++) {
      const r = Math.random();
      if (waveNum === 1) {
        queue.push('SCOUT');
      } else if (waveNum === 2) {
        queue.push(r < 0.78 ? 'SCOUT' : 'STRIKER');
      } else if (waveNum === 3) {
        queue.push(r < 0.65 ? 'SCOUT' : 'STRIKER');
      } else if (waveNum === 4) {
        if (i === totalCount - 1) queue.push('BASTION');
        else queue.push(r < 0.56 ? 'SCOUT' : 'STRIKER');
      } else if (waveNum === 5) {
        if (r < 0.48) queue.push('SCOUT');
        else if (r < 0.82) queue.push('STRIKER');
        else queue.push('BASTION');
      } else if (waveNum < 10) {
        if (r < 0.4) queue.push('SCOUT');
        else if (r < 0.7) queue.push('STRIKER');
        else if (r < 0.87) queue.push('BASTION');
        else queue.push('SPLITTER');
      } else {
        // Wave 10+: noticeably higher Striker, Bastion & Splitter density
        if (r < 0.2) queue.push('SCOUT');
        else if (r < 0.52) queue.push('STRIKER');
        else if (r < 0.78) queue.push('BASTION');
        else queue.push('SPLITTER');
      }
    }

    this.waveSpawnQueue = queue;
    this.spawnTimer = waveNum === 1 ? 0.85 : waveNum >= 10 ? 0.45 : 0.65;
    if (waveNum === 10) {
      this.waveBanner = 'Onda 10 · Zona Expandida';
      this.waveBannerTimer = 2.6;
      this.spawnShockwave(this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.75, PALETTE.brass, 2.8, 0.75, true);
    } else {
      this.waveBanner = `Onda ${waveNum}`;
      this.waveBannerTimer = 1.9;
    }
    this.emitHud();
  }

  private spawnEnemy(type: EnemyType, overrideX?: number, overrideY?: number): void {
    let x = overrideX ?? 0;
    let y = overrideY ?? 0;

    if (overrideX === undefined || overrideY === undefined) {
      const zoom = Math.max(0.55, this.arenaZoom);
      const cx = this.width * 0.5;
      const cy = this.height * 0.5;
      const halfW = (this.width * 0.5) / zoom;
      const halfH = (this.height * 0.5) / zoom;
      const margin = 92 / zoom;

      // If player flew far outside visible zone, spawn near a ring around player so combat remains active
      const playerFarOffscreen =
        Math.abs(this.player.x - cx) > halfW + 140 || Math.abs(this.player.y - cy) > halfH + 140;

      if (playerFarOffscreen) {
        const ang = Math.random() * Math.PI * 2;
        const spawnDist = Math.max(halfW, halfH) * 0.65 + 140;
        x = this.player.x + Math.cos(ang) * spawnDist;
        y = this.player.y + Math.sin(ang) * spawnDist;
      } else {
        const minX = cx - halfW;
        const maxX = cx + halfW;
        const minY = cy - halfH;
        const maxY = cy + halfH;
        const side = Math.floor(Math.random() * 4);
        if (side === 0) {
          x = minX + Math.random() * (maxX - minX);
          y = minY - margin;
        } else if (side === 1) {
          x = maxX + margin;
          y = minY + Math.random() * (maxY - minY);
        } else if (side === 2) {
          x = minX + Math.random() * (maxX - minX);
          y = maxY + margin;
        } else {
          x = minX - margin;
          y = minY + Math.random() * (maxY - minY);
        }
      }
    }

    const hpScale =
      this.wave < 10
        ? 1 + Math.floor((this.wave - 1) / 4)
        : 3 + Math.floor((this.wave - 10) / 2);
    let radius = 16;
    let hp = 2;

    switch (type) {
      case 'SCOUT':
        radius = 16;
        hp = 2 + Math.floor((hpScale - 1) * 0.5);
        break;
      case 'MINI_SCOUT':
        radius = 11;
        hp = 1;
        break;
      case 'STRIKER':
        radius = 18;
        hp = 3 + Math.floor((hpScale - 1) * 0.65);
        break;
      case 'BASTION':
        radius = 25;
        hp = 6 + hpScale;
        break;
      case 'SPLITTER':
        radius = 21;
        hp = 4 + Math.floor(hpScale * 0.75);
        break;
    }

    const enemy = this.freeEnemies.pop();
    if (!enemy) return;
    enemy.id = this.nextEnemyId++;
    enemy.type = type;
    enemy.x = x;
    enemy.y = y;
    enemy.vx = 0;
    enemy.vy = 0;
    enemy.angle = Math.atan2(this.player.y - y, this.player.x - x);
    enemy.radius = radius;
    enemy.hp = hp;
    enemy.maxHp = hp;
    enemy.hitFlash = 0;
    enemy.aiState = 'APPROACH';
    enemy.aiTimer = 1.0 + Math.random() * 1.1;
    enemy.targetAngle = 0;
    enemy.spin = Math.random() * Math.PI * 2;
    this.enemies.push(enemy);
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    maxLife: number,
    color: string,
    drag = 0.93,
    kind: ParticleKind = 'spark',
    growth = 0,
    angle = Math.random() * Math.PI * 2,
    vAngle = 0
  ): void {
    // O(1) amortized ring-cursor scan; recycles oldest slot cleanly if saturated
    let slot: Particle | null = null;
    for (let n = 0; n < PARTICLE_POOL_SIZE; n++) {
      const idx = (this.particleCursor + n) % PARTICLE_POOL_SIZE;
      const candidate = this.particles[idx];
      if (!candidate.active) {
        slot = candidate;
        this.particleCursor = (idx + 1) % PARTICLE_POOL_SIZE;
        break;
      }
    }
    if (!slot) {
      slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    }

    slot.active = true;
    slot.kind = kind;
    slot.x = x;
    slot.y = y;
    slot.vx = vx;
    slot.vy = vy;
    slot.size = size;
    slot.growth = growth;
    slot.angle = angle;
    slot.vAngle = vAngle;
    slot.life = maxLife;
    slot.maxLife = maxLife;
    slot.color = color;
    slot.drag = drag;
  }

  private spawnBurst(x: number, y: number, count: number, color: string, speed = 220, size = 3): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = speed * (0.35 + Math.random() * 0.85);
      this.spawnParticle(
        x,
        y,
        Math.cos(a) * spd,
        Math.sin(a) * spd,
        size * (0.6 + Math.random() * 0.8),
        0.28 + Math.random() * 0.35,
        color,
        0.92,
        'spark'
      );
    }
  }

  private spawnAstrolabeExplosion(
    x: number,
    y: number,
    primaryColor: string,
    secondaryColor: string,
    scale: 'small' | 'medium' | 'large' | 'supernova'
  ): void {
    const mult =
      scale === 'supernova' ? 2.15 : scale === 'large' ? 1.35 : scale === 'medium' ? 1.0 : 0.72;

    // 1. Astrolabe compass shockwave rings
    this.spawnShockwave(
      x,
      y,
      (scale === 'supernova' ? 195 : 74) * mult,
      primaryColor,
      scale === 'supernova' ? 3.5 : 2.2,
      scale === 'supernova' ? 0.68 : 0.38,
      true
    );
    if (scale === 'large' || scale === 'supernova') {
      this.spawnShockwave(
        x,
        y,
        (scale === 'supernova' ? 125 : 46) * mult,
        PALETTE.ivory,
        scale === 'supernova' ? 2.6 : 1.6,
        scale === 'supernova' ? 0.45 : 0.25,
        false
      );
    }
    if (scale === 'supernova') {
      this.spawnShockwave(x, y, 270, PALETTE.coral, 2.4, 0.85, true);
    }

    // 2. Rotating hull & brass armor shards
    const shardCount = Math.round(9 * mult);
    for (let i = 0; i < shardCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (110 + Math.random() * 210) * mult;
      this.spawnParticle(
        x + (Math.random() - 0.5) * 10,
        y + (Math.random() - 0.5) * 10,
        Math.cos(a) * spd,
        Math.sin(a) * spd,
        (4.5 + Math.random() * 4.5) * (scale === 'supernova' ? 1.25 : 1),
        0.45 + Math.random() * 0.45,
        i % 3 === 0 ? PALETTE.brass : i % 3 === 1 ? primaryColor : secondaryColor,
        0.94,
        'shard',
        0,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 13
      );
    }

    // 3. Fractured golden astrolabe ring arcs spinning outward
    const arcCount = scale === 'supernova' ? 10 : scale === 'large' ? 5 : 3;
    for (let i = 0; i < arcCount; i++) {
      const a = (i / arcCount) * Math.PI * 2 + Math.random() * 0.4;
      const spd = (75 + Math.random() * 110) * mult;
      this.spawnParticle(
        x,
        y,
        Math.cos(a) * spd,
        Math.sin(a) * spd,
        (11 + Math.random() * 8) * (scale === 'supernova' ? 1.35 : 1),
        0.42 + Math.random() * 0.35,
        i % 2 === 0 ? PALETTE.brass : PALETTE.ivory,
        0.92,
        'arc',
        12,
        a,
        (Math.random() - 0.5) * 5
      );
    }

    // 4. 4-point celestial star glints
    const starCount = Math.round(6 * mult);
    for (let i = 0; i < starCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (90 + Math.random() * 190) * mult;
      this.spawnParticle(
        x,
        y,
        Math.cos(a) * spd,
        Math.sin(a) * spd,
        (5 + Math.random() * 5) * (scale === 'supernova' ? 1.3 : 1),
        0.35 + Math.random() * 0.35,
        i % 2 === 0 ? PALETTE.ivory : PALETTE.brass,
        0.9,
        'star',
        0,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 4
      );
    }

    // 5. Billowing stylized smoke clouds
    const smokeCount = scale === 'supernova' ? 16 : scale === 'large' ? 7 : 4;
    for (let i = 0; i < smokeCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (35 + Math.random() * 95) * mult;
      this.spawnParticle(
        x + (Math.random() - 0.5) * 14,
        y + (Math.random() - 0.5) * 14,
        Math.cos(a) * spd,
        Math.sin(a) * spd,
        (8 + Math.random() * 7) * (scale === 'supernova' ? 1.3 : 1),
        0.65 + Math.random() * 0.55,
        i % 2 === 0 ? PALETTE.smokeDark : PALETTE.smokeLight,
        0.91,
        'smoke',
        22
      );
    }

    // 6. Hot ember sparks
    this.spawnBurst(x, y, Math.round(12 * mult), primaryColor, 240 * mult, 2.8);
  }

  private spawnShockwave(
    x: number,
    y: number,
    maxRadius: number,
    color: string,
    lineWidth = 2,
    maxLife = 0.38,
    astrolabe = false
  ): void {
    let slot: Shockwave | null = null;
    for (let n = 0; n < SHOCKWAVE_POOL_SIZE; n++) {
      const idx = (this.shockwaveCursor + n) % SHOCKWAVE_POOL_SIZE;
      const candidate = this.shockwaves[idx];
      if (!candidate.active) {
        slot = candidate;
        this.shockwaveCursor = (idx + 1) % SHOCKWAVE_POOL_SIZE;
        break;
      }
    }
    if (!slot) {
      slot = this.shockwaves[this.shockwaveCursor];
      this.shockwaveCursor = (this.shockwaveCursor + 1) % SHOCKWAVE_POOL_SIZE;
    }

    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.radius = 8;
    slot.maxRadius = maxRadius;
    slot.life = maxLife;
    slot.maxLife = maxLife;
    slot.color = color;
    slot.lineWidth = lineWidth;
    slot.astrolabe = astrolabe;
    slot.rotation = Math.random() * Math.PI * 2;
  }

  private addScore(points: number, x?: number, y?: number): void {
    const gained = Math.round(points * this.combo);
    this.score += gained;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.newRecord = true;
      try {
        localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
      } catch {
        // Ignore storage error
      }
    }
    if (x !== undefined && y !== undefined) {
      this.spawnFloatingText(
        x,
        y - 10,
        -38,
        `+${gained}`,
        this.combo >= 4 ? PALETTE.brass : PALETTE.ivory,
        0.7
      );
    }
  }

  private update(dt: number): void {
    this.ambientTime += dt;

    const targetZoom = this.state === 'PLAYING' || this.state === 'PAUSED' ? this.getTargetArenaZoom() : 1;
    this.arenaZoom += (targetZoom - this.arenaZoom) * Math.min(1, dt * 1.8);

    if (this.shakeIntensity > 0.05) {
      this.shakePhase += dt;
      this.shakeIntensity *= Math.pow(0.0022, dt);
    } else {
      this.shakeIntensity = 0;
    }

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
      if (this.damageFlashTimer === 0) {
        this.emitHud();
      }
    }

    if (this.repairAnimTimer > 0) {
      this.repairAnimTimer = Math.max(0, this.repairAnimTimer - dt);
      if (this.state === 'PLAYING' && !this.playerDying) {
        this.repairMoteAccum += dt;
        while (this.repairMoteAccum >= 0.055) {
          this.repairMoteAccum -= 0.055;
          const ang = Math.random() * Math.PI * 2;
          const r = 18 + Math.random() * 14;
          const px = this.player.x + Math.cos(ang) * r;
          const py = this.player.y + Math.sin(ang) * r;
          this.spawnParticle(
            px,
            py,
            -Math.cos(ang) * 28 + this.player.vx * 0.45,
            -Math.sin(ang) * 28 + this.player.vy * 0.45,
            2.1 + Math.random() * 1.4,
            0.38,
            Math.random() < 0.5 ? '#7AE4FF' : '#38BDF8',
            0.94,
            'star',
            -1.5
          );
        }
      }
      if (this.repairAnimTimer === 0) {
        this.emitHud();
      }
    }

    if (this.state === 'TITLE_MENU') {
      for (const ws of this.warpStreaks) {
        ws.z -= ws.speed * dt;
        if (ws.z <= 0.02) {
          ws.z = 0.95 + Math.random() * 0.08;
          ws.angle = Math.random() * Math.PI * 2;
        }
      }
      this.updateParticlesAndWaves(dt);
      return;
    }

    if (this.state === 'INTRO_CUTSCENE') {
      this.updateIntroCutscene(dt);
      return;
    }

    if (this.state === 'PAUSED' || this.state === 'GAME_OVER') {
      this.updateParticlesAndWaves(dt);
      return;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      this.updateParticlesAndWaves(dt * 0.35);
      return;
    }

    // Dramatic multi-stage player decompression & explosion sequence
    if (this.playerDying) {
      this.updatePlayerDeathSequence(dt);
      this.updateParticlesAndWaves(dt);
      this.updateFloatingTexts(dt);
      if (this.damageFlashTimer > 0) {
        this.hudSyncTimer += dt;
        if (this.hudSyncTimer >= 0.03) {
          this.hudSyncTimer = 0;
          this.emitHud();
        }
      }
      return;
    }

    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer -= dt;
      if (this.waveBannerTimer <= 0) {
        this.waveBanner = null;
        this.emitHud();
      }
    }

    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.comboTimer = 0;
      }
    }

    this.updatePlayer(dt);
    this.updateWaveSpawner(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateSparks(dt);
    this.updateParticlesAndWaves(dt);
    this.updateFloatingTexts(dt);

    this.hudSyncTimer += dt;
    if (this.hudSyncTimer >= 0.06) {
      this.hudSyncTimer = 0;
      this.emitHud();
    }
  }

  private updatePlayerDeathSequence(dt: number): void {
    const p = this.player;
    this.playerDeathTimer += dt;

    // Slow ambient enemy drift during cinematic sequence
    for (const e of this.enemies) {
      e.x += e.vx * dt * 0.25;
      e.y += e.vy * dt * 0.25;
      e.vx *= Math.pow(0.25, dt);
      e.vy *= Math.pow(0.25, dt);
    }

    const detonateAt = 1.15;
    const finishAt = 1.88;

    if (!this.playerDetonated) {
      // Phase 1: Hull breach, spin out of control, pressurized decompression smoke jets
      p.vx *= Math.pow(0.18, dt);
      p.vy *= Math.pow(0.18, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += this.playerDeathSpinVel * dt;
      this.playerDeathSpinVel *= 1 + dt * 1.45;
      this.shakeIntensity = Math.max(this.shakeIntensity, 2.2 + (this.playerDeathTimer / detonateAt) * 5.5);

      // Continuous pressurized decompression smoke vents from specific points on the hull
      this.playerVentAccum += dt;
      while (this.playerVentAccum >= 0.028) {
        this.playerVentAccum -= 0.028;
        const vent = DECOMPRESSION_VENTS[Math.floor(Math.random() * DECOMPRESSION_VENTS.length)];
        const cos = Math.cos(p.angle);
        const sin = Math.sin(p.angle);
        const wx = p.x + vent.x * cos - vent.y * sin;
        const wy = p.y + vent.x * sin + vent.y * cos;
        const jetAngle = p.angle + vent.angle + (Math.random() - 0.5) * 0.38;
        const jetSpeed = 115 + Math.random() * 95;

        // Decompression vapor puff
        this.spawnParticle(
          wx,
          wy,
          Math.cos(jetAngle) * jetSpeed,
          Math.sin(jetAngle) * jetSpeed,
          5 + Math.random() * 4,
          0.55 + Math.random() * 0.4,
          Math.random() < 0.65 ? PALETTE.smokeLight : PALETTE.smokeDark,
          0.91,
          'smoke',
          26
        );

        // Hot electrical & coral sparks spraying from the breach
        if (Math.random() < 0.72) {
          const sparkSpeed = 150 + Math.random() * 140;
          this.spawnParticle(
            wx,
            wy,
            Math.cos(jetAngle) * sparkSpeed,
            Math.sin(jetAngle) * sparkSpeed,
            2.4 + Math.random() * 1.6,
            0.22 + Math.random() * 0.25,
            Math.random() < 0.55 ? PALETTE.brass : PALETTE.coralBright,
            0.9,
            'spark'
          );
        }
      }

      // Staggered internal hull ruptures before main detonation
      const ruptureTimes = [0.32, 0.66, 0.94];
      if (
        this.playerSubBlastIndex < ruptureTimes.length &&
        this.playerDeathTimer >= ruptureTimes[this.playerSubBlastIndex]
      ) {
        const vent = DECOMPRESSION_VENTS[this.playerSubBlastIndex % DECOMPRESSION_VENTS.length];
        const cos = Math.cos(p.angle);
        const sin = Math.sin(p.angle);
        const rx = p.x + vent.x * cos - vent.y * sin;
        const ry = p.y + vent.x * sin + vent.y * cos;

        this.playerSubBlastIndex += 1;
        this.audio.playSubExplosion();
        this.vibrate(22);
        this.shakeIntensity = Math.max(this.shakeIntensity, 9);
        this.spawnShockwave(rx, ry, 58, PALETTE.coralBright, 2.2, 0.28, false);
        this.spawnBurst(rx, ry, 10, PALETTE.brass, 200, 3);
        for (let s = 0; s < 4; s++) {
          const a = Math.random() * Math.PI * 2;
          this.spawnParticle(
            rx,
            ry,
            Math.cos(a) * 165,
            Math.sin(a) * 165,
            5,
            0.45,
            PALETTE.ivory,
            0.93,
            'shard',
            0,
            a,
            (Math.random() - 0.5) * 14
          );
        }
      }

      // Phase 2: Main Astrolabic Supernova Detonation
      if (this.playerDeathTimer >= detonateAt) {
        this.playerDetonated = true;
        this.hitstopTimer = 0.075;
        this.shakeIntensity = 22;
        this.audio.playPlayerExplosion();
        this.vibrate([45, 30, 95]);
        this.spawnAstrolabeExplosion(p.x, p.y, PALETTE.brass, PALETTE.coral, 'supernova');
      }
    } else if (this.playerDeathTimer >= finishAt) {
      // Phase 3: Transition cleanly to Game Over modal
      this.playerDying = false;
      this.state = 'GAME_OVER';
      this.audio.playGameOver();
      this.emitHud();
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;

    if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    if (p.fireTimer > 0) p.fireTimer = Math.max(0, p.fireTimer - dt);
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    if (p.dashBufferTimer > 0) p.dashBufferTimer = Math.max(0, p.dashBufferTimer - dt);
    if (p.recoil > 0) p.recoil = Math.max(0, p.recoil - dt * 10);

    if (p.overdriveTimer > 0) {
      p.overdriveTimer -= dt;
      p.overdriveCharge = Math.max(0, (p.overdriveTimer / p.overdriveDuration) * 100);
      if (p.overdriveTimer <= 0) {
        p.overdriveTimer = 0;
        p.overdriveCharge = 0;
      }
    }

    p.scaleX += (1 - p.scaleX) * Math.min(1, dt * 14);
    p.scaleY += (1 - p.scaleY) * Math.min(1, dt * 14);

    // Movement vector (keyboard + analog virtual left stick)
    let ix = 0;
    let iy = 0;
    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) iy -= 1;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) iy += 1;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) ix -= 1;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) ix += 1;

    if (this.moveTouch) {
      ix += this.moveTouch.dx;
      iy += this.moveTouch.dy;
    }

    const ilen = Math.hypot(ix, iy);
    if (ilen > 1) {
      ix /= ilen;
      iy /= ilen;
    }

    // Buffered Dash execution
    if (p.dashBufferTimer > 0 && p.dashCooldown <= 0 && p.dashTimer <= 0) {
      p.dashBufferTimer = 0;
      p.dashTimer = 0.16;
      p.dashCooldown = p.dashMaxCooldown;
      p.invulnTimer = Math.max(p.invulnTimer, 0.24);
      if (ilen > 0.15) {
        p.dashDirX = ix / Math.min(1, ilen);
        p.dashDirY = iy / Math.min(1, ilen);
      } else {
        p.dashDirX = Math.cos(p.angle);
        p.dashDirY = Math.sin(p.angle);
      }
      p.scaleX = 1.38;
      p.scaleY = 0.72;
      this.shakeIntensity = Math.max(this.shakeIntensity, 4.5);
      this.audio.playDash();
      this.vibrate(14);
      this.spawnShockwave(p.x, p.y, 64, PALETTE.brass, 2, 0.28, false);
      this.spawnBurst(p.x, p.y, 12, PALETTE.brass, 170, 2.8);
    }

    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      const dashSpeed = 860;
      p.vx = p.dashDirX * dashSpeed;
      p.vy = p.dashDirY * dashSpeed;

      this.spawnParticle(
        p.x + (Math.random() - 0.5) * 10,
        p.y + (Math.random() - 0.5) * 10,
        -p.dashDirX * 80,
        -p.dashDirY * 80,
        3.2,
        0.22,
        PALETTE.brass,
        0.9,
        'spark'
      );
    } else {
      const accel = 1950;
      p.vx += ix * accel * dt;
      p.vy += iy * accel * dt;

      const damping = Math.pow(0.00075, dt);
      p.vx *= damping;
      p.vy *= damping;

      const maxSpeed = p.overdriveTimer > 0 ? 410 : 350;
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > maxSpeed) {
        p.vx = (p.vx / spd) * maxSpeed;
        p.vy = (p.vy / spd) * maxSpeed;
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Unbounded free flight in open space (no perimeter walls).
    // Convert screen-space mouse pointer into expanded world-space coordinates for accurate aiming.
    const worldMouseX = (this.mouseX - this.width * 0.5) / this.arenaZoom + this.width * 0.5;
    const worldMouseY = (this.mouseY - this.height * 0.5) / this.arenaZoom + this.height * 0.5;

    // Aiming: right touch stick > mouse cursor > movement direction
    if (this.aimTouch && (this.aimTouch.dx !== 0 || this.aimTouch.dy !== 0)) {
      p.angle = Math.atan2(this.aimTouch.dy, this.aimTouch.dx);
    } else if (this.mouseMovedRecently) {
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
    } else if (ilen > 0.1) {
      p.angle = Math.atan2(iy, ix);
    }

    if (ilen > 0.1 && p.dashTimer <= 0 && Math.random() < 0.6) {
      const backX = p.x - Math.cos(p.angle) * 20;
      const backY = p.y - Math.sin(p.angle) * 20;
      this.spawnParticle(
        backX + (Math.random() - 0.5) * 4,
        backY + (Math.random() - 0.5) * 4,
        -ix * 90 + (Math.random() - 0.5) * 30,
        -iy * 90 + (Math.random() - 0.5) * 30,
        2.1,
        0.2,
        p.overdriveTimer > 0 ? PALETTE.coralBright : PALETTE.brassSoft,
        0.9,
        'spark'
      );
    }

    // Manual shooting
    const wantsFire = this.mouseDown || this.heldKeys.has('Space') || this.aimTouch !== null;
    if (wantsFire && p.fireTimer <= 0) {
      const isOverdrive = p.overdriveTimer > 0;
      p.fireTimer = isOverdrive ? 0.115 : 0.155;
      p.recoil = 1;
      p.scaleX = 0.88;
      p.scaleY = 1.12;

      const muzzleX = p.x + Math.cos(p.angle) * 22;
      const muzzleY = p.y + Math.sin(p.angle) * 22;
      const bulletSpeed = isOverdrive ? 820 : 740;

      const bulletRadius = isOverdrive ? 4.5 : 4;
      const bulletColor = isOverdrive ? PALETTE.coralBright : PALETTE.brass;
      if (isOverdrive) {
        for (let k = -1; k <= 1; k++) {
          const a = p.angle + k * 0.14;
          this.spawnBullet(
            muzzleX,
            muzzleY,
            Math.cos(a) * bulletSpeed,
            Math.sin(a) * bulletSpeed,
            bulletRadius,
            1,
            true,
            1.3,
            bulletColor
          );
        }
      } else {
        this.spawnBullet(
          muzzleX,
          muzzleY,
          Math.cos(p.angle) * bulletSpeed,
          Math.sin(p.angle) * bulletSpeed,
          bulletRadius,
          1,
          true,
          1.3,
          bulletColor
        );
      }

      this.audio.playShoot(isOverdrive);
      this.spawnParticle(
        muzzleX,
        muzzleY,
        Math.cos(p.angle) * 120 + (Math.random() - 0.5) * 60,
        Math.sin(p.angle) * 120 + (Math.random() - 0.5) * 60,
        2.4,
        0.12,
        PALETTE.ivory,
        0.85,
        'spark'
      );
    }
  }

  private updateWaveSpawner(dt: number): void {
    if (this.waveSpawnQueue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const nextType = this.waveSpawnQueue.shift()!;
        this.spawnEnemy(nextType);
        const baseInterval =
          this.wave < 10
            ? Math.max(0.74, 1.28 - (this.wave - 1) * 0.065)
            : Math.max(0.32, 0.56 - (this.wave - 10) * 0.028);
        this.spawnTimer = baseInterval * (0.78 + Math.random() * 0.42);
      }
    } else if (this.enemies.length === 0) {
      if (this.waveCooldown <= 0) {
        this.waveCooldown = 1.25;
        this.audio.playWaveClear();
        this.addScore(150 * this.wave, this.player.x, this.player.y - 26);
        this.spawnShockwave(this.player.x, this.player.y, 180, PALETTE.teal, 2.5, 0.5, true);
      } else {
        this.waveCooldown -= dt;
        if (this.waveCooldown <= 0) {
          this.prepareWave(this.wave + 1);
        }
      }
    }
  }

  private updateEnemies(dt: number): void {
    const px = this.player.x;
    const py = this.player.y;
    const highIntensity = this.wave >= 10;
    const speedMult = highIntensity
      ? 1.22 + Math.min(0.68, (this.wave - 10) * 0.05)
      : 0.88 + (this.wave - 1) * 0.025;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.spin += dt * (e.type === 'BASTION' ? 1.1 : 2.1);

      const dx = px - e.x;
      const dy = py - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const angleToPlayer = Math.atan2(dy, dx);

      if (e.type === 'SCOUT' || e.type === 'MINI_SCOUT') {
        const speed = (e.type === 'MINI_SCOUT' ? 215 : 155) * speedMult;
        const targetVx = (dx / dist) * speed;
        const targetVy = (dy / dist) * speed;
        e.vx += (targetVx - e.vx) * Math.min(1, dt * 4.2);
        e.vy += (targetVy - e.vy) * Math.min(1, dt * 4.2);
        e.angle = Math.atan2(e.vy, e.vx);
      } else if (e.type === 'SPLITTER') {
        const speed = 105 * speedMult;
        e.vx += ((dx / dist) * speed - e.vx) * Math.min(1, dt * 2.5);
        e.vy += ((dy / dist) * speed - e.vy) * Math.min(1, dt * 2.5);
        e.angle = angleToPlayer;
      } else if (e.type === 'STRIKER') {
        if (e.aiState === 'APPROACH') {
          const speed = 135 * speedMult;
          e.vx += ((dx / dist) * speed - e.vx) * Math.min(1, dt * 3.5);
          e.vy += ((dy / dist) * speed - e.vy) * Math.min(1, dt * 3.5);
          e.angle = angleToPlayer;
          e.aiTimer -= dt;
          if (e.aiTimer <= 0 && dist < 440) {
            e.aiState = 'WINDUP';
            e.aiTimer = highIntensity ? 0.52 : 0.68;
            e.targetAngle = angleToPlayer;
            this.audio.playTelegraph();
          }
        } else if (e.aiState === 'WINDUP') {
          e.vx *= Math.pow(0.01, dt);
          e.vy *= Math.pow(0.01, dt);
          if (e.aiTimer > 0.25) {
            e.targetAngle = angleToPlayer;
          }
          e.angle = e.targetAngle;
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            e.aiState = 'ACTION';
            e.aiTimer = 0.42;
            const lungeSpeed = 560 * Math.min(1.36, speedMult);
            e.vx = Math.cos(e.targetAngle) * lungeSpeed;
            e.vy = Math.sin(e.targetAngle) * lungeSpeed;
            this.spawnBurst(e.x, e.y, 8, PALETTE.coral, 140, 2.5);
          }
        } else if (e.aiState === 'ACTION') {
          e.aiTimer -= dt;
          if (Math.random() < 0.7) {
            this.spawnParticle(e.x, e.y, -e.vx * 0.15, -e.vy * 0.15, 2.6, 0.2, PALETTE.coral, 0.9, 'spark');
          }
          if (e.aiTimer <= 0) {
            e.aiState = 'COOLDOWN';
            e.aiTimer = highIntensity ? 0.55 : 0.78;
          }
        } else {
          e.vx *= Math.pow(0.04, dt);
          e.vy *= Math.pow(0.04, dt);
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            e.aiState = 'APPROACH';
            e.aiTimer = (highIntensity ? 0.9 : 1.25) + Math.random() * 0.8;
          }
        }
      } else if (e.type === 'BASTION') {
        const desiredDist = 270;
        const radial = dist > desiredDist ? 1 : -0.45;
        const speed = 95 * speedMult;
        const tangX = -dy / dist;
        const tangY = dx / dist;
        const tvx = ((dx / dist) * radial + tangX * 0.7) * speed;
        const tvy = ((dy / dist) * radial + tangY * 0.7) * speed;
        e.vx += (tvx - e.vx) * Math.min(1, dt * 2.5);
        e.vy += (tvy - e.vy) * Math.min(1, dt * 2.5);
        e.angle = angleToPlayer;

        if (e.aiState === 'APPROACH') {
          e.aiTimer -= dt;
          if (e.aiTimer <= 0 && dist < 560) {
            e.aiState = 'WINDUP';
            e.aiTimer = highIntensity ? 0.68 : 0.82;
            this.audio.playTelegraph();
          }
        } else if (e.aiState === 'WINDUP') {
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            const orbSpeed = 245 * Math.min(1.32, speedMult);
            for (let s = 0; s < BASTION_SPREAD.length; s++) {
              const a = angleToPlayer + BASTION_SPREAD[s];
              this.spawnBullet(
                e.x + Math.cos(a) * e.radius,
                e.y + Math.sin(a) * e.radius,
                Math.cos(a) * orbSpeed,
                Math.sin(a) * orbSpeed,
                5.5,
                1,
                false,
                3.4,
                PALETTE.coralBright
              );
            }
            this.spawnShockwave(e.x, e.y, 44, PALETTE.coral, 2, 0.25, false);
            e.aiState = 'APPROACH';
            e.aiTimer = (highIntensity ? 1.65 : 2.25) + Math.random() * 0.85;
          }
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Subtle propulsion exhaust particles behind moving Sentinel ships
      const speedMag = Math.hypot(e.vx, e.vy);
      if (speedMag > 45 && Math.random() < (e.type === 'STRIKER' && e.aiState === 'ACTION' ? 0.55 : 0.16)) {
        const backX = e.x - Math.cos(e.angle) * (e.radius * 0.95);
        const backY = e.y - Math.sin(e.angle) * (e.radius * 0.95);
        const exhaustColor =
          e.type === 'STRIKER'
            ? PALETTE.coralBright
            : e.type === 'SPLITTER'
              ? PALETTE.teal
              : PALETTE.brass;
        const spreadAngle = e.angle + Math.PI + (Math.random() - 0.5) * 0.45;
        const exhaustSpd = 55 + Math.random() * 55;
        this.spawnParticle(
          backX + (Math.random() - 0.5) * 5,
          backY + (Math.random() - 0.5) * 5,
          Math.cos(spreadAngle) * exhaustSpd,
          Math.sin(spreadAngle) * exhaustSpd,
          e.type === 'BASTION' ? 2.6 : 1.9,
          0.22 + Math.random() * 0.14,
          exhaustColor,
          0.9,
          'spark'
        );
      }

      for (let j = i - 1; j >= 0; j--) {
        const other = this.enemies[j];
        const sdx = e.x - other.x;
        const sdy = e.y - other.y;
        const sdist = Math.hypot(sdx, sdy);
        const minDist = e.radius + other.radius + 4;
        if (sdist > 0 && sdist < minDist) {
          const push = (minDist - sdist) * 0.35;
          const nx = sdx / sdist;
          const ny = sdy / sdist;
          e.x += nx * push;
          e.y += ny * push;
          other.x -= nx * push;
          other.y -= ny * push;
        }
      }

      const pdist = Math.hypot(e.x - px, e.y - py);
      if (pdist < e.radius + this.player.radius - 3) {
        if (this.player.invulnTimer <= 0 && !this.playerDying) {
          this.damagePlayer(e.x, e.y);
          if (this.playerDying) break;
        }
      }
    }
  }

  private updateBullets(dt: number): void {
    const p = this.player;

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      if (
        b.life <= 0 ||
        Math.hypot(b.x - p.x, b.y - p.y) > 4000
      ) {
        this.releaseBulletAt(i);
        continue;
      }

      if (b.fromPlayer) {
        let hit = false;
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          const dist = Math.hypot(b.x - e.x, b.y - e.y);
          if (dist < b.radius + e.radius) {
            e.hp -= b.damage;
            e.hitFlash = 0.095;
            e.vx += b.vx * 0.08;
            e.vy += b.vy * 0.08;
            this.spawnBurst(b.x, b.y, 4, PALETTE.ivory, 130, 2);

            if (e.hp <= 0) {
              this.destroyEnemy(j);
            } else {
              this.audio.playHit(e.type === 'BASTION');
            }
            hit = true;
            break;
          }
        }
        if (hit) {
          this.releaseBulletAt(i);
        }
      } else {
        const dist = Math.hypot(b.x - p.x, b.y - p.y);
        if (dist < b.radius + p.radius - 3) {
          if (p.invulnTimer <= 0 && !this.playerDying) {
            const bx = b.x;
            const by = b.y;
            this.releaseBulletAt(i);
            this.damagePlayer(bx, by);
            // damagePlayer mutates this.bullets in-place; exit loop to avoid stale indices
            break;
          }
        }
      }
    }
  }

  private destroyEnemy(index: number): void {
    const e = this.enemies[index];
    const ex = e.x;
    const ey = e.y;
    const etype = e.type;
    this.releaseEnemyAt(index);
    this.kills += 1;

    const isHeavy = etype === 'BASTION' || etype === 'SPLITTER';
    const basePoints =
      etype === 'BASTION'
        ? 120
        : etype === 'SPLITTER'
          ? 90
          : etype === 'STRIKER'
            ? 75
            : etype === 'MINI_SCOUT'
              ? 30
              : 50;

    this.addScore(basePoints, ex, ey);

    const primaryColor =
      etype === 'STRIKER'
        ? PALETTE.coral
        : etype === 'SPLITTER'
          ? PALETTE.teal
          : PALETTE.brass;
    const secondaryColor =
      etype === 'STRIKER'
        ? PALETTE.brass
        : etype === 'SPLITTER'
          ? PALETTE.brass
          : PALETTE.coral;

    const scale = isHeavy ? 'large' : etype === 'MINI_SCOUT' ? 'small' : 'medium';
    this.spawnAstrolabeExplosion(ex, ey, primaryColor, secondaryColor, scale);

    this.audio.playEnemyDestroy(scale);
    this.shakeIntensity = Math.max(this.shakeIntensity, isHeavy ? 8.5 : 4.5);
    if (isHeavy) {
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.042);
    }

    const sparkCount = etype === 'BASTION' ? 3 : etype === 'MINI_SCOUT' ? 1 : 2;
    for (let s = 0; s < sparkCount; s++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 70 + Math.random() * 80;
      this.spawnSpark(ex, ey, Math.cos(a) * spd, Math.sin(a) * spd, 8.0, 15, 'overdrive');
    }

    if (this.player.hp < this.player.maxHp) {
      let activeRepairCores = 0;
      for (let i = 0; i < this.sparks.length; i++) {
        if (this.sparks[i].kind === 'repair') activeRepairCores++;
      }
      // Probabilistic repair core drop — never guaranteed even when damaged
      if (activeRepairCores < 1) {
        const criticalBonus = this.player.hp <= 1 ? 0.08 : 0;
        const repairChance =
          etype === 'BASTION' || etype === 'SPLITTER'
            ? 0.26 + criticalBonus
            : etype === 'STRIKER'
              ? 0.12 + criticalBonus * 0.75
              : etype === 'SCOUT'
                ? 0.05 + criticalBonus * 0.5
                : 0;
        if (Math.random() < repairChance) {
          const a = Math.random() * Math.PI * 2;
          const spd = 42 + Math.random() * 44;
          this.spawnSpark(ex, ey, Math.cos(a) * spd, Math.sin(a) * spd, 11.5, 50, 'repair');
        }
      }
    }

    if (etype === 'SPLITTER') {
      const offset = 18;
      this.spawnEnemy('MINI_SCOUT', ex - offset, ey);
      this.spawnEnemy('MINI_SCOUT', ex + offset, ey);
    }

    this.emitHud();
  }

  private damagePlayer(sourceX: number, sourceY: number): void {
    const p = this.player;
    p.hp -= 1;
    p.invulnTimer = 1.25;
    this.combo = 1;
    this.comboTimer = 0;

    const angle = Math.atan2(p.y - sourceY, p.x - sourceX);
    p.vx = Math.cos(angle) * 300;
    p.vy = Math.sin(angle) * 300;

    this.shakeIntensity = 12;
    this.shakePhase = 0;
    this.damageFlashTimer = this.damageFlashDuration;
    this.damagePulseId += 1;
    this.audio.playPlayerDamage();
    this.vibrate(45);
    this.spawnBurst(p.x, p.y, 20, PALETTE.coralBright, 260, 3.2);
    this.spawnShockwave(p.x, p.y, 165, PALETTE.coral, 3.0, 0.4, false);

    // Defensive pulse pushes nearby enemies and clears immediate bullets
    for (const e of this.enemies) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 190) {
        e.vx += (dx / d) * 340;
        e.vy += (dy / d) * 340;
      }
    }
    // Clear nearby enemy bullets in-place without allocating a new array
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b.fromPlayer && Math.hypot(b.x - p.x, b.y - p.y) <= 190) {
        this.releaseBulletAt(i);
      }
    }

    if (p.hp <= 0) {
      p.hp = 0;
      this.playerDying = true;
      this.playerDetonated = false;
      this.playerDeathTimer = 0;
      this.playerVentAccum = 0;
      this.playerSubBlastIndex = 0;
      this.playerDeathSpinVel = (Math.random() < 0.5 ? -1 : 1) * 2.4;
      this.clearAllInputs();
      while (this.bullets.length > 0) {
        this.freeBullets.push(this.bullets.pop()!);
      }
      this.audio.playDecompression();
    }

    this.emitHud();
  }

  private updateSparks(dt: number): void {
    const p = this.player;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.releaseSparkAt(i);
        continue;
      }

      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;

      const pullRadius = s.kind === 'repair' ? 205 : 185;
      if (dist < pullRadius) {
        const pull = (1 - dist / pullRadius) * 1450;
        s.vx += (dx / dist) * pull * dt;
        s.vy += (dy / dist) * pull * dt;
      }

      const drag = Math.pow(0.08, dt);
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      if (dist < p.radius + 14) {
        const val = s.value;
        const kind = s.kind;
        this.releaseSparkAt(i);
        this.combo = Math.min(8, this.combo + 1);
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.comboTimer = this.comboDuration;

        if (kind === 'repair') {
          this.triggerHullRepair(val);
        } else {
          this.addScore(val);
          this.audio.playSparkPickup(this.combo);

          if (p.overdriveTimer <= 0) {
            p.overdriveCharge = Math.min(100, p.overdriveCharge + 7.5);
            if (p.overdriveCharge >= 100) {
              this.activateOverdrive();
            }
          } else if (p.hp < p.maxHp) {
            this.hullHealProgress += 0.2;
            if (this.hullHealProgress >= 1) {
              this.hullHealProgress -= 1;
              if (p.hp + 1 >= p.maxHp) {
                this.hullHealProgress = 0;
              }
              this.triggerHullRepair(0);
            } else {
              this.spawnBurst(p.x, p.y, 4, '#7AE4FF', 110, 1.8);
              this.emitHud();
            }
          }
        }
      }
    }
  }

  private triggerHullRepair(bonusValue: number): void {
    const p = this.player;
    const healed = p.hp < p.maxHp;
    if (healed) {
      p.hp = Math.min(p.maxHp, p.hp + 1);
      if (p.hp >= p.maxHp) {
        this.hullHealProgress = 0;
      }
      this.repairAnimTimer = this.repairAnimDuration;
      if (bonusValue > 0) {
        this.addScore(bonusValue);
      }
      this.spawnFloatingText(p.x, p.y - 24, -42, '+1 CASCO', '#7AE4FF', 1.15);
      this.spawnShockwave(p.x, p.y, 148, '#5CE1FF', 2.4, 0.56, true);
      this.spawnBurst(p.x, p.y, 16, '#7AE4FF', 210, 2.5);
    } else {
      this.hullHealProgress = 0;
      this.repairAnimTimer = 0.65;
      this.addScore(150);
      this.spawnFloatingText(p.x, p.y - 24, -42, '+150 ESCUDO', '#7AE4FF', 0.95);
      this.spawnShockwave(p.x, p.y, 112, '#5CE1FF', 2.0, 0.42, false);
    }
    this.repairPulseId += 1;
    this.repairMoteAccum = 0;
    this.audio.playHullPressurize(p.hp >= p.maxHp);
    this.vibrate([12, 22, 14]);
    this.emitHud();
  }

  private activateOverdrive(): void {
    const p = this.player;
    p.overdriveTimer = p.overdriveDuration;
    p.overdriveCharge = 100;
    this.audio.playOverdrive();
    this.vibrate([16, 20, 24]);
    this.hitstopTimer = Math.max(this.hitstopTimer, 0.035);
    this.shakeIntensity = Math.max(this.shakeIntensity, 8);

    // Clean Solaris-palette shockwaves and radial sparks
    this.spawnShockwave(p.x, p.y, 175, PALETTE.coralBright, 2.8, 0.44, true);
    this.spawnShockwave(p.x, p.y, 125, PALETTE.brass, 2.0, 0.36, false);
    this.spawnBurst(p.x, p.y, 16, PALETTE.coralBright, 240, 2.8);
    this.spawnBurst(p.x, p.y, 8, PALETTE.ivory, 180, 2.2);

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (!this.bullets[i].fromPlayer) {
        this.releaseBulletAt(i);
      }
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 340) {
        e.vx += (dx / d) * 380;
        e.vy += (dy / d) * 380;
      }
    }
    this.emitHud();
  }

  private updateParticlesAndWaves(dt: number): void {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        continue;
      }
      const d = Math.pow(pt.drag, dt * 60);
      pt.vx *= d;
      pt.vy *= d;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.angle += pt.vAngle * dt;
      if (pt.growth !== 0) {
        pt.size += pt.growth * dt;
      }
    }

    for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
      const s = this.shockwaves[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }
      const progress = 1 - s.life / s.maxLife;
      const eased = 1 - Math.pow(1 - progress, 3);
      s.radius = 8 + (s.maxRadius - 8) * eased;
      if (s.astrolabe) {
        s.rotation += dt * 1.1;
      }
    }
  }

  private updateFloatingTexts(dt: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      ft.y += ft.vy * dt;
      if (ft.life <= 0) {
        this.releaseFloatingTextAt(i);
      }
    }
  }

  private emitHud(): void {
    const p = this.player;
    this.onHudUpdate({
      state: this.state,
      score: this.score,
      highScore: this.highScore,
      combo: this.combo,
      comboTimerRatio: this.combo > 1 ? Math.max(0, this.comboTimer / this.comboDuration) : 0,
      wave: this.wave,
      hp: p.hp,
      maxHp: p.maxHp,
      overdriveRatio: p.overdriveCharge / 100,
      overdriveActive: p.overdriveTimer > 0,
      dashReadyRatio: 1 - p.dashCooldown / p.dashMaxCooldown,
      kills: this.kills,
      maxCombo: this.maxCombo,
      waveBanner: this.waveBanner,
      newRecord: this.newRecord,
      damageFlashRatio: Math.max(0, Math.min(1, this.damageFlashTimer / this.damageFlashDuration)),
      damagePulseId: this.damagePulseId,
      repairAnimRatio: Math.max(0, Math.min(1, this.repairAnimTimer / this.repairAnimDuration)),
      repairPulseId: this.repairPulseId,
      hullHealProgress: p.hp < p.maxHp ? Math.max(0, Math.min(1, this.hullHealProgress)) : 0,
    });
  }

  private syncCanvasSize(): void {
    const parent = this.canvas.parentElement;
    const targetW = Math.max(1, Math.floor(parent ? parent.clientWidth : window.innerWidth));
    const targetH = Math.max(1, Math.floor(parent ? parent.clientHeight : window.innerHeight));
    const targetDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      targetW !== this.width ||
      targetH !== this.height ||
      targetDpr !== this.dpr ||
      this.canvas.width !== Math.floor(targetW * targetDpr) ||
      this.canvas.height !== Math.floor(targetH * targetDpr)
    ) {
      this.resize();
    }
  }

  private render(): void {
    this.syncCanvasSize();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Always clear the entire physical backing buffer first to prevent stale frame artifacts
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.bgDeep;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.save();

    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.55, 30, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    bgGrad.addColorStop(0, PALETTE.bgRadial);
    bgGrad.addColorStop(1, PALETTE.bgDeep);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    if (this.shakeIntensity > 0) {
      // Smooth damped harmonic screen shake
      const t = this.shakePhase;
      const sx =
        (Math.sin(t * 46) * 0.72 + Math.cos(t * 73) * 0.28) * this.shakeIntensity * this.screenShakeScale;
      const sy =
        (Math.cos(t * 41) * 0.72 + Math.sin(t * 67) * 0.28) * this.shakeIntensity * this.screenShakeScale;
      ctx.translate(sx, sy);
    }

    if (this.state === 'TITLE_MENU') {
      this.renderTitleWarpJump(ctx, w, h);
      ctx.restore();
      return;
    }

    if (this.state === 'INTRO_CUTSCENE') {
      this.renderIntroCutscene(ctx, w, h);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    const effectiveZoom = Math.max(0.5, this.arenaZoom);
    ctx.scale(effectiveZoom, effectiveZoom);
    ctx.translate(-w * 0.5, -h * 0.5);

    this.renderBackdrop(ctx, w, h);

    this.renderSparks(ctx);
    this.renderEnemies(ctx);
    this.renderBullets(ctx);
    if (this.player.hp > 0 || (this.playerDying && !this.playerDetonated)) {
      this.renderPlayer(ctx);
    }
    this.renderParticlesAndWaves(ctx);
    this.renderFloatingTexts(ctx);

    ctx.restore();

    if (this.state === 'PLAYING' && !this.playerDying) {
      if (this.showOffscreenIndicators) {
        this.renderOffscreenIndicators(ctx, w, h);
      }
      this.renderOffscreenPlayerIndicator(ctx, w, h);
      if (this.mouseMovedRecently && !this.touchMode) {
        this.renderReticle(ctx);
      }
      if (this.moveTouch || this.aimTouch) {
        this.renderTouchSticks(ctx);
      }
    } else if (this.playerDying && !this.playerDetonated) {
      this.renderOffscreenPlayerIndicator(ctx, w, h);
    }

    ctx.restore();

    // 60fps GPU-fast red damage impact vignette (avoids DOM/React repaints on mobile)
    if (this.damageFlashTimer > 0) {
      const ratio = Math.max(0, Math.min(1, this.damageFlashTimer / this.damageFlashDuration));
      const rOuter = Math.hypot(w * 0.5, h * 0.5);
      const rInner = Math.min(w, h) * 0.34;
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, rInner, w * 0.5, h * 0.5, rOuter);
      grad.addColorStop(0, 'rgba(220, 48, 38, 0)');
      grad.addColorStop(0.68, `rgba(220, 48, 38, ${(ratio * 0.24).toFixed(3)})`);
      grad.addColorStop(1, `rgba(232, 65, 52, ${(ratio * 0.58).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private renderBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const rawDx = this.player.x - w * 0.5;
    const rawDy = this.player.y - h * 0.5;
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);

    // Bounded deep-space parallax preserves strict non-overlap between celestial bodies at any flight distance
    const deepOffsetX = Math.tanh(rawDx / Math.max(600, w * 1.4)) * 72;
    const deepOffsetY = Math.tanh(rawDy / Math.max(450, h * 1.4)) * 56;
    const astrolabeOffsetX = Math.tanh(rawDx / Math.max(500, w)) * 22;
    const astrolabeOffsetY = Math.tanh(rawDy / Math.max(400, h)) * 18;
    const starScrollX = rawDx * 0.14;
    const starScrollY = rawDy * 0.14;

    // Expanded view coverage so zoomed-out Wave 10+ and starfields fill the full canvas edge-to-edge
    const zoom = Math.max(0.55, this.arenaZoom);
    const spanW = w / zoom;
    const spanH = h / zoom;
    const originX = w * 0.5 - spanW * 0.5;
    const originY = h * 0.5 - spanH * 0.5;

    // 1. Randomized Cosmic Nebula (unique position, scale & palette per match)
    const neb = this.combatNebula;
    const nebX = neb.normX * w - deepOffsetX * 0.85;
    const nebY = neb.normY * h - deepOffsetY * 0.85;
    const nebBaseR = maxDim * neb.scale;

    ctx.save();
    ctx.translate(nebX, nebY);
    ctx.rotate(neb.rotation);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < neb.lobes.length; i++) {
      const lobe = neb.lobes[i];
      const rgb =
        lobe.colorIdx === 0 ? neb.coreRgb : lobe.colorIdx === 1 ? neb.midRgb : neb.accentRgb;
      const lx = lobe.dx * nebBaseR;
      const ly = lobe.dy * nebBaseR;
      const lrX = lobe.rx * nebBaseR;
      const lrY = lobe.ry * nebBaseR;
      const pulse = 0.94 + 0.06 * Math.sin(this.ambientTime * 0.45 + i * 1.4);

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(lobe.rot);
      ctx.scale(1, lrY / lrX);
      const nGrad = ctx.createRadialGradient(0, 0, lrX * 0.04, 0, 0, lrX * pulse);
      nGrad.addColorStop(0, `rgba(${rgb}, ${(lobe.alpha * 1.15).toFixed(3)})`);
      nGrad.addColorStop(0.42, `rgba(${rgb}, ${(lobe.alpha * 0.6).toFixed(3)})`);
      nGrad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = nGrad;
      ctx.beginPath();
      ctx.arc(0, 0, lrX * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // 2. Dispersed Non-Overlapping Cosmic Scenery (Planets, Luminous Stars, Natural Satellites, Black Holes)
    for (let i = 0; i < this.sceneryBodies.length; i++) {
      const body = this.sceneryBodies[i];
      const bx = body.normX * w - deepOffsetX;
      const by = body.normY * h - deepOffsetY;
      const br = Math.max(10, minDim * body.scale);

      if (body.kind === 'star_body') {
        const pulse = 0.92 + 0.08 * Math.sin(this.ambientTime * 1.6 + body.pulseOffset);
        const coronaR = br * 2.35 * pulse;

        ctx.save();
        ctx.translate(bx, by);
        ctx.globalCompositeOperation = 'screen';

        const halo = ctx.createRadialGradient(0, 0, br * 0.12, 0, 0, coronaR);
        halo.addColorStop(0, body.coreHex);
        halo.addColorStop(0.24, `rgba(${body.coronaRgb}, 0.72)`);
        halo.addColorStop(0.55, `rgba(${body.coronaRgb}, 0.22)`);
        halo.addColorStop(1, `rgba(${body.coronaRgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, coronaR, 0, Math.PI * 2);
        ctx.fill();

        // Crisp 4-point stellar diffraction spikes
        ctx.rotate(body.rayAngle);
        ctx.fillStyle = `rgba(${body.coronaRgb}, 0.48)`;
        for (let r = 0; r < 2; r++) {
          ctx.rotate(Math.PI * 0.5);
          ctx.beginPath();
          ctx.ellipse(0, 0, coronaR * 0.92, Math.max(1.2, br * 0.09), 0, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = body.coreHex;
        ctx.beginPath();
        ctx.arc(0, 0, br * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      if (body.kind === 'black_hole') {
        const t = this.ambientTime;
        const spin = t * 0.48 * body.spinDir;
        const horizonR = br * 0.84;
        const diskRx = br * 2.75;
        const diskRy = br * 0.46;

        const drawAsteroidChunk = (
          ax: number,
          ay: number,
          rad: number,
          rot: number,
          pts: Array<{ a: number; r: number }>
        ) => {
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(rot);
          ctx.beginPath();
          for (let pIdx = 0; pIdx < pts.length; pIdx++) {
            const px = Math.cos(pts[pIdx].a) * rad * pts[pIdx].r;
            const py = Math.sin(pts[pIdx].a) * rad * pts[pIdx].r;
            if (pIdx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();

          // Lit rim facing the photon core, dark rocky far side
          const toCoreA = Math.atan2(-ay, -ax) - rot;
          const gx = Math.cos(toCoreA) * rad;
          const gy = Math.sin(toCoreA) * rad;
          const rockGrad = ctx.createLinearGradient(gx, gy, -gx, -gy);
          rockGrad.addColorStop(0, '#64748B');
          rockGrad.addColorStop(0.55, '#1E293B');
          rockGrad.addColorStop(1, '#090E1A');
          ctx.fillStyle = rockGrad;
          ctx.fill();

          ctx.strokeStyle = `rgba(${body.hotRgb}, 0.36)`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
          ctx.restore();
        };

        ctx.save();
        ctx.translate(bx, by);

        // 1. Deep gravitational halo (secondary violet/indigo + primary electric glow)
        const lensR = br * 2.95;
        const lensGrad = ctx.createRadialGradient(0, 0, horizonR * 0.85, 0, 0, lensR);
        lensGrad.addColorStop(0, `rgba(${body.secondaryRgb}, 0.36)`);
        lensGrad.addColorStop(0.32, `rgba(${body.accretionRgb}, 0.24)`);
        lensGrad.addColorStop(0.66, `rgba(${body.secondaryRgb}, 0.07)`);
        lensGrad.addColorStop(1, 'rgba(11, 19, 32, 0)');
        ctx.fillStyle = lensGrad;
        ctx.beginPath();
        ctx.arc(0, 0, lensR, 0, Math.PI * 2);
        ctx.fill();

        // Rotate disk plane for relativistic lensing arches + back accretion plane
        ctx.save();
        ctx.rotate(body.diskTilt);

        // 2. Gargantua-style gravitational lensing arcs wrapping over & under the shadow
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let lIdx = 0; lIdx < 6; lIdx++) {
          const frac = lIdx / 5;
          const archR = horizonR * (1.03 + frac * 0.48);
          const stretchX = archR * (1.04 + frac * 0.16);
          const alpha = (0.48 - frac * 0.34).toFixed(3);
          ctx.strokeStyle =
            lIdx < 2 ? `rgba(${body.hotRgb}, ${alpha})` : `rgba(${body.accretionRgb}, ${alpha})`;
          ctx.lineWidth = Math.max(0.85, br * (0.048 - frac * 0.025));

          // Upper warped halo stream
          ctx.beginPath();
          ctx.ellipse(0, -horizonR * 0.05, stretchX, archR * 1.06, 0, Math.PI * 1.02, Math.PI * 1.98);
          ctx.stroke();

          // Lower warped halo stream
          ctx.beginPath();
          ctx.ellipse(0, horizonR * 0.05, stretchX * 0.96, archR * 0.94, 0, Math.PI * 0.04, Math.PI * 0.96);
          ctx.stroke();
        }

        // 3. Back half of accretion disk & swirling plasma filaments
        const backGlow = ctx.createRadialGradient(0, 0, horizonR * 0.95, 0, 0, diskRx);
        backGlow.addColorStop(0, `rgba(${body.hotRgb}, 0.62)`);
        backGlow.addColorStop(0.32, `rgba(${body.accretionRgb}, 0.45)`);
        backGlow.addColorStop(0.7, `rgba(${body.secondaryRgb}, 0.18)`);
        backGlow.addColorStop(1, `rgba(${body.secondaryRgb}, 0)`);
        ctx.strokeStyle = backGlow;
        ctx.lineWidth = Math.max(4, br * 0.32);
        ctx.beginPath();
        ctx.ellipse(0, 0, diskRx * 0.88, diskRy, 0, Math.PI, Math.PI * 2);
        ctx.stroke();

        // Animated swirling inner accretion streaks (back half)
        ctx.save();
        ctx.lineCap = 'round';
        for (let sIdx = 0; sIdx < 4; sIdx++) {
          const sFrac = sIdx / 3;
          const rx = horizonR * (1.28 + sFrac * 1.48);
          const ry = diskRy * (0.42 + sFrac * 0.58);
          ctx.strokeStyle =
            sIdx === 0
              ? `rgba(${body.hotRgb}, 0.68)`
              : `rgba(${body.accretionRgb}, ${(0.42 - sFrac * 0.22).toFixed(2)})`;
          ctx.lineWidth = Math.max(0.9, br * (0.065 - sFrac * 0.032));
          ctx.setLineDash([br * (0.55 + sFrac * 0.4), br * (0.35 + sFrac * 0.35)]);
          ctx.lineDashOffset = -spin * br * (1.6 - sFrac * 0.5);
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, Math.PI * 1.02, Math.PI * 1.98);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
        ctx.restore(); // end screen blend for back lensing/disk

        // Back orbiting rocky asteroids (behind the event horizon)
        for (let d = 0; d < body.debris.length; d++) {
          const deb = body.debris[d];
          const orbA = deb.angleOffset + t * deb.speed * body.spinDir;
          if (Math.sin(orbA) >= 0) continue;
          const ax = Math.cos(orbA) * br * deb.orbitMul;
          const ay = Math.sin(orbA) * diskRy * (deb.orbitMul / 2.2);
          drawAsteroidChunk(ax, ay, Math.max(1.6, br * deb.sizeMul), deb.rotOffset + t * deb.rotSpeed, deb.pts);
        }

        ctx.restore(); // restore unrotated before sphere

        // 4. Event Horizon Sphere (pitch-black void with subtle internal warped void contour)
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, horizonR, 0, Math.PI * 2);
        ctx.clip();

        const voidGrad = ctx.createRadialGradient(
          -body.flareSide * horizonR * 0.28,
          horizonR * 0.2,
          horizonR * 0.1,
          0,
          0,
          horizonR * 1.05
        );
        voidGrad.addColorStop(0, '#0C1322');
        voidGrad.addColorStop(0.55, '#03060E');
        voidGrad.addColorStop(1, '#010205');
        ctx.fillStyle = voidGrad;
        ctx.fillRect(-horizonR - 2, -horizonR - 2, horizonR * 2 + 4, horizonR * 2 + 4);

        // Subtle warped interior void swirl (inspired by reference dark sphere depth)
        ctx.strokeStyle = `rgba(${body.accretionRgb}, 0.09)`;
        ctx.lineWidth = Math.max(1, br * 0.05);
        ctx.beginPath();
        ctx.arc(body.flareSide * horizonR * 0.16, -horizonR * 0.1, horizonR * 0.62, 0.4, 3.6);
        ctx.stroke();
        ctx.restore();

        // Crisp luminous photon ring around the event horizon
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const rimGrad = ctx.createLinearGradient(
          -horizonR * body.flareSide,
          horizonR * 0.5,
          horizonR * body.flareSide,
          -horizonR * 0.5
        );
        rimGrad.addColorStop(0, `rgba(${body.secondaryRgb}, 0.42)`);
        rimGrad.addColorStop(0.52, `rgba(${body.accretionRgb}, 0.78)`);
        rimGrad.addColorStop(1, `rgba(${body.hotRgb}, 0.96)`);
        ctx.strokeStyle = rimGrad;
        ctx.lineWidth = Math.max(1.5, br * 0.07);
        ctx.beginPath();
        ctx.arc(0, 0, horizonR + 0.6, 0, Math.PI * 2);
        ctx.stroke();

        // Thin bright crescent photon edge on Doppler-boosted side
        ctx.strokeStyle = `rgba(${body.hotRgb}, 0.85)`;
        ctx.lineWidth = Math.max(1, br * 0.04);
        const crescentBase = body.flareSide > 0 ? -0.45 : Math.PI - 0.45;
        ctx.beginPath();
        ctx.arc(0, 0, horizonR + 1.2, crescentBase - 0.85, crescentBase + 0.85);
        ctx.stroke();
        ctx.restore();

        // 5. Front Accretion Disk & Debris crossing across the black hole face
        ctx.save();
        ctx.rotate(body.diskTilt);

        ctx.save();
        ctx.globalCompositeOperation = 'screen';

        // Outer electric plasma band crossing front
        const frontGrad = ctx.createRadialGradient(0, 0, horizonR * 0.8, 0, 0, diskRx);
        frontGrad.addColorStop(0, `rgba(${body.hotRgb}, 0.86)`);
        frontGrad.addColorStop(0.36, `rgba(${body.accretionRgb}, 0.68)`);
        frontGrad.addColorStop(0.75, `rgba(${body.secondaryRgb}, 0.24)`);
        frontGrad.addColorStop(1, `rgba(${body.secondaryRgb}, 0)`);
        ctx.strokeStyle = frontGrad;
        ctx.lineWidth = Math.max(3.6, br * 0.26);
        ctx.beginPath();
        ctx.ellipse(0, 0, diskRx * 0.9, diskRy, 0, 0.02, Math.PI - 0.02);
        ctx.stroke();

        // Razor-sharp inner white-hot accretion ribbon crossing front
        ctx.strokeStyle = `rgba(${body.hotRgb}, 0.88)`;
        ctx.lineWidth = Math.max(1.4, br * 0.085);
        ctx.beginPath();
        ctx.ellipse(0, 0, br * 1.85, diskRy * 0.62, 0, 0.08, Math.PI - 0.08);
        ctx.stroke();

        // Diagonal relativistic plasma jet / disk wing streaks extending outward
        const wingGrad = ctx.createLinearGradient(-diskRx * 1.12, 0, diskRx * 1.12, 0);
        wingGrad.addColorStop(0, 'rgba(0,0,0,0)');
        wingGrad.addColorStop(0.24, `rgba(${body.accretionRgb}, 0.48)`);
        wingGrad.addColorStop(0.5, `rgba(${body.hotRgb}, 0.72)`);
        wingGrad.addColorStop(0.76, `rgba(${body.accretionRgb}, 0.48)`);
        wingGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = wingGrad;
        ctx.beginPath();
        ctx.ellipse(0, diskRy * 0.16, diskRx * 1.12, Math.max(1.2, br * 0.06), 0, 0, Math.PI * 2);
        ctx.fill();

        // Animated foreground plasma flow lines
        ctx.lineCap = 'round';
        for (let fIdx = 0; fIdx < 3; fIdx++) {
          const rx = horizonR * (1.24 + fIdx * 0.56);
          const ry = diskRy * (0.48 + fIdx * 0.28);
          ctx.strokeStyle =
            fIdx === 0 ? `rgba(${body.hotRgb}, 0.76)` : `rgba(${body.accretionRgb}, 0.48)`;
          ctx.lineWidth = Math.max(0.9, br * (0.052 - fIdx * 0.014));
          ctx.setLineDash([br * (0.48 + fIdx * 0.25), br * (0.34 + fIdx * 0.22)]);
          ctx.lineDashOffset = spin * br * (1.7 - fIdx * 0.35);
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, 0.05, Math.PI - 0.05);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();

        // Front orbiting rocky asteroids & shredded debris fragments
        for (let d = 0; d < body.debris.length; d++) {
          const deb = body.debris[d];
          const orbA = deb.angleOffset + t * deb.speed * body.spinDir;
          if (Math.sin(orbA) < 0) continue;
          const ax = Math.cos(orbA) * br * deb.orbitMul;
          const ay = Math.sin(orbA) * diskRy * (deb.orbitMul / 2.2);
          drawAsteroidChunk(ax, ay, Math.max(1.8, br * deb.sizeMul), deb.rotOffset + t * deb.rotSpeed, deb.pts);
        }

        // 6. Relativistic Doppler Hotspot & Anamorphic Lens-Flare Glint (as in reference images)
        const flareX = body.flareSide * horizonR * 1.06;
        const flareY = -horizonR * 0.26;
        const flarePulse = 0.88 + 0.12 * Math.sin(t * 2.2);

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const hotspot = ctx.createRadialGradient(flareX, flareY, 0, flareX, flareY, br * 0.92 * flarePulse);
        hotspot.addColorStop(0, `rgba(${body.hotRgb}, 0.95)`);
        hotspot.addColorStop(0.28, `rgba(${body.accretionRgb}, 0.56)`);
        hotspot.addColorStop(1, `rgba(${body.accretionRgb}, 0)`);
        ctx.fillStyle = hotspot;
        ctx.beginPath();
        ctx.arc(flareX, flareY, br * 0.92 * flarePulse, 0, Math.PI * 2);
        ctx.fill();

        // Razor-thin anamorphic flare streak piercing across the Doppler hotspot
        const streakLen = br * 2.55 * flarePulse;
        const streakGrad = ctx.createLinearGradient(flareX - streakLen, flareY, flareX + streakLen, flareY);
        streakGrad.addColorStop(0, `rgba(${body.accretionRgb}, 0)`);
        streakGrad.addColorStop(0.35, `rgba(${body.accretionRgb}, 0.45)`);
        streakGrad.addColorStop(0.5, `rgba(${body.hotRgb}, 0.92)`);
        streakGrad.addColorStop(0.65, `rgba(${body.accretionRgb}, 0.45)`);
        streakGrad.addColorStop(1, `rgba(${body.accretionRgb}, 0)`);
        ctx.fillStyle = streakGrad;
        ctx.beginPath();
        ctx.ellipse(flareX, flareY, streakLen, Math.max(1.1, br * 0.042), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.restore(); // end diskTilt
        ctx.restore(); // end black_hole translate
        continue;
      }

      if (body.kind === 'moon') {
        const lx = Math.cos(body.lightAngle);
        const ly = Math.sin(body.lightAngle);

        ctx.save();
        ctx.translate(bx, by);
        ctx.beginPath();
        ctx.arc(0, 0, br, 0, Math.PI * 2);
        ctx.clip();

        const moonGrad = ctx.createRadialGradient(
          lx * br * 0.42,
          ly * br * 0.42,
          br * 0.06,
          -lx * br * 0.25,
          -ly * br * 0.25,
          br * 1.32
        );
        moonGrad.addColorStop(0, body.litHex);
        moonGrad.addColorStop(0.5, body.midHex);
        moonGrad.addColorStop(0.88, body.darkHex);
        moonGrad.addColorStop(1, '#060A13');
        ctx.fillStyle = moonGrad;
        ctx.fillRect(-br - 1, -br - 1, br * 2 + 2, br * 2 + 2);

        // Natural satellite impact craters
        for (let c = 0; c < body.craters.length; c++) {
          const cr = body.craters[c];
          const cx0 = cr.dx * br;
          const cy0 = cr.dy * br;
          const cRad = cr.r * br;
          ctx.fillStyle = 'rgba(7, 11, 20, 0.26)';
          ctx.beginPath();
          ctx.arc(cx0, cy0, cRad, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = `rgba(${body.rimRgb}, 0.22)`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(cx0, cy0, cRad, body.lightAngle - 1.1, body.lightAngle + 1.1);
          ctx.stroke();
        }

        // Terminator shadow
        const mNight = ctx.createRadialGradient(
          lx * br * 0.55,
          ly * br * 0.55,
          br * 0.3,
          0,
          0,
          br * 1.04
        );
        mNight.addColorStop(0, 'rgba(7, 11, 20, 0)');
        mNight.addColorStop(0.76, 'rgba(7, 11, 20, 0.42)');
        mNight.addColorStop(1, 'rgba(7, 11, 20, 0.84)');
        ctx.fillStyle = mNight;
        ctx.fillRect(-br - 1, -br - 1, br * 2 + 2, br * 2 + 2);
        ctx.restore();
        continue;
      }

      // Planet
      const plR = br;
      const lx = Math.cos(body.lightAngle);
      const ly = Math.sin(body.lightAngle);

      ctx.save();
      ctx.translate(bx, by);

      const atmoHalo = ctx.createRadialGradient(
        lx * plR * 0.28,
        ly * plR * 0.28,
        plR * 0.85,
        0,
        0,
        plR * 1.48
      );
      atmoHalo.addColorStop(0, `rgba(${body.rimRgb}, 0.22)`);
      atmoHalo.addColorStop(0.55, `rgba(${body.rimRgb}, 0.07)`);
      atmoHalo.addColorStop(1, `rgba(${body.rimRgb}, 0)`);
      ctx.fillStyle = atmoHalo;
      ctx.beginPath();
      ctx.arc(0, 0, plR * 1.48, 0, Math.PI * 2);
      ctx.fill();

      if (body.hasRings) {
        ctx.save();
        ctx.rotate(body.ringTilt);
        ctx.strokeStyle = `rgba(${body.rimRgb}, 0.28)`;
        ctx.lineWidth = Math.max(2.2, plR * 0.14);
        ctx.beginPath();
        ctx.ellipse(0, 0, plR * 2.05, plR * 0.46, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${body.bandRgb}, 0.14)`;
        ctx.lineWidth = Math.max(1.2, plR * 0.06);
        ctx.beginPath();
        ctx.ellipse(0, 0, plR * 1.72, plR * 0.38, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, plR, 0, Math.PI * 2);
      ctx.clip();

      const sphereGrad = ctx.createRadialGradient(
        lx * plR * 0.45,
        ly * plR * 0.45,
        plR * 0.08,
        -lx * plR * 0.25,
        -ly * plR * 0.25,
        plR * 1.38
      );
      sphereGrad.addColorStop(0, body.litHex);
      sphereGrad.addColorStop(0.46, body.midHex);
      sphereGrad.addColorStop(0.86, body.darkHex);
      sphereGrad.addColorStop(1, '#070B14');
      ctx.fillStyle = sphereGrad;
      ctx.fillRect(-plR - 2, -plR - 2, plR * 2 + 4, plR * 2 + 4);

      ctx.save();
      ctx.rotate(body.ringTilt * 0.65);
      ctx.fillStyle = `rgba(${body.bandRgb}, 0.11)`;
      ctx.fillRect(-plR * 1.1, -plR * 0.38, plR * 2.2, plR * 0.14);
      ctx.fillStyle = `rgba(${body.bandRgb}, 0.07)`;
      ctx.fillRect(-plR * 1.1, plR * 0.1, plR * 2.2, plR * 0.18);
      ctx.restore();

      const nightGrad = ctx.createRadialGradient(
        lx * plR * 0.55,
        ly * plR * 0.55,
        plR * 0.35,
        0,
        0,
        plR * 1.05
      );
      nightGrad.addColorStop(0, 'rgba(7, 11, 20, 0)');
      nightGrad.addColorStop(0.75, 'rgba(7, 11, 20, 0.38)');
      nightGrad.addColorStop(1, 'rgba(7, 11, 20, 0.82)');
      ctx.fillStyle = nightGrad;
      ctx.fillRect(-plR - 2, -plR - 2, plR * 2 + 4, plR * 2 + 4);

      ctx.strokeStyle = `rgba(${body.rimRgb}, 0.45)`;
      ctx.lineWidth = Math.max(1.2, plR * 0.04);
      ctx.beginPath();
      ctx.arc(0, 0, plR - 0.5, body.lightAngle - 1.15, body.lightAngle + 1.15);
      ctx.stroke();
      ctx.restore();

      if (body.hasRings) {
        ctx.save();
        ctx.rotate(body.ringTilt);
        ctx.strokeStyle = `rgba(${body.rimRgb}, 0.36)`;
        ctx.lineWidth = Math.max(2.2, plR * 0.14);
        ctx.beginPath();
        ctx.ellipse(0, 0, plR * 2.05, plR * 0.46, 0, 0, Math.PI);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${body.bandRgb}, 0.18)`;
        ctx.lineWidth = Math.max(1.2, plR * 0.06);
        ctx.beginPath();
        ctx.ellipse(0, 0, plR * 1.72, plR * 0.38, 0, 0, Math.PI);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    // 3. Endless Deep-Space Starfield
    for (const star of this.stars) {
      const sx = originX + (((star.x * spanW - starScrollX * star.depth) % spanW + spanW) % spanW);
      const sy = originY + (((star.y * spanH - starScrollY * star.depth) % spanH + spanH) % spanH);
      const twinkle = 0.72 + 0.28 * Math.sin(this.ambientTime * 1.8 + star.twinklePhase);
      ctx.fillStyle = `rgba(244, 239, 230, ${(star.alpha * twinkle).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size / Math.sqrt(zoom), 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Prominent Spinning Great Astrolabe Meridian Rings beneath the Battlefield
    const cx = w * 0.5 - astrolabeOffsetX;
    const cy = h * 0.5 - astrolabeOffsetY;
    const zoneScale = 1 / zoom;

    ctx.save();
    ctx.translate(cx, cy);

    // Wide outer astrolabe meridian ring & equatorial axis for landscape viewports
    if (w > h * 1.15) {
      ctx.strokeStyle = 'rgba(232, 184, 75, 0.18)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, maxDim * 0.36 * zoneScale, 0, Math.PI * 2);
      ctx.stroke();

      const axisSpan = w * 0.46 * zoneScale;
      const innerGap = minDim * 0.43 * zoneScale;
      if (axisSpan > innerGap + 24) {
        ctx.strokeStyle = 'rgba(232, 184, 75, 0.19)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-axisSpan, 0);
        ctx.lineTo(-innerGap, 0);
        ctx.moveTo(innerGap, 0);
        ctx.lineTo(axisSpan, 0);
        ctx.stroke();

        const tickOffsets = [innerGap + (axisSpan - innerGap) * 0.45, axisSpan];
        for (const tx of tickOffsets) {
          ctx.beginPath();
          ctx.moveTo(-tx, -7);
          ctx.lineTo(-tx, 7);
          ctx.moveTo(tx, -7);
          ctx.lineTo(tx, 7);
          ctx.stroke();
        }
      }
    }

    // Expanded Level 10+ outer perimeter ring
    if (zoom < 0.98) {
      const expandAlpha = Math.min(1, (1 - zoom) / 0.22);
      ctx.save();
      ctx.rotate(-this.ambientTime * 0.03);
      ctx.strokeStyle = `rgba(232, 184, 75, ${(0.25 * expandAlpha).toFixed(3)})`;
      ctx.lineWidth = 2.0;
      ctx.setLineDash([16, 12]);
      ctx.beginPath();
      ctx.arc(0, 0, minDim * 0.56 * zoneScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Outer calibrated meridian ring (slow clockwise rotation + 12 astrolabe degree notches)
    ctx.save();
    ctx.rotate(this.ambientTime * 0.032);
    const outerR = minDim * 0.42 * zoneScale;
    ctx.strokeStyle = 'rgba(232, 184, 75, 0.26)';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(244, 239, 230, 0.12)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 0, outerR - 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(232, 184, 75, 0.34)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI * 2) / 12;
      const tickIn = i % 3 === 0 ? outerR - 12 : outerR - 6;
      const tickOut = i % 3 === 0 ? outerR + 8 : outerR + 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * tickIn, Math.sin(a) * tickIn);
      ctx.lineTo(Math.cos(a) * tickOut, Math.sin(a) * tickOut);
      ctx.stroke();
    }
    ctx.restore();

    // Middle counter-rotating dashed meridian ring + orbiting brass pips
    ctx.save();
    ctx.rotate(-this.ambientTime * 0.065);
    const midR = minDim * 0.285 * zoneScale;
    ctx.strokeStyle = 'rgba(232, 184, 75, 0.28)';
    ctx.lineWidth = 1.9;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, midR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.strokeStyle = 'rgba(232, 184, 75, 0.32)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (midR - 9), Math.sin(a) * (midR - 9));
      ctx.lineTo(Math.cos(a) * (midR + 9), Math.sin(a) * (midR + 9));
      ctx.stroke();

      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(232, 184, 75, 0.48)';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * midR, Math.sin(a) * midR, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Inner compass dial ring
    ctx.save();
    ctx.rotate(this.ambientTime * 0.1);
    const innerR = minDim * 0.135 * zoneScale;
    ctx.strokeStyle = 'rgba(232, 184, 75, 0.22)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(244, 239, 230, 0.14)';
    ctx.setLineDash([4, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, innerR * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.restore();
  }

  private renderTitleWarpJump(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const t = this.ambientTime;
    const minDim = Math.min(w, h);
    const maxRadius = Math.hypot(w, h) * 1.15;

    // Ship dimensions & clean top-right framing (fits entire nose + upper wing cleanly across aspect ~1.46)
    const frontPair = this.sprites.PLAYER_FRONT;
    const imgAspect = frontPair ? frontPair.normal.width / frontPair.normal.height : 819 / 559;
    const isNarrow = w < h * 1.15;
    const shipH = isNarrow
      ? Math.min(h * 0.46, (w * 0.84) / imgAspect)
      : Math.min(h * 0.66, (w * 0.55) / imgAspect);
    const shipW = shipH * imgAspect;
    const bobX = Math.sin(t * 1.5) * 3.5 + Math.cos(t * 3.7) * 1.0;
    const bobY = Math.cos(t * 2.0) * 3.5 + Math.sin(t * 4.9) * 0.9;
    const pitchMicro = Math.sin(t * 1.2) * 0.012 + Math.cos(t * 3.1) * 0.003;
    const breathScale = 1 + Math.sin(t * 2.6) * 0.007;

    const rightBleed = Math.max(24, shipW * 0.08);
    const topPad = Math.max(18, h * 0.045);
    const shipCenterX = w - shipW * 0.5 + rightBleed + bobX;
    const shipCenterY = topPad + shipH * 0.5 + bobY;

    // Exact measured ship fuselage centerline vector from artwork (nose lower-left -> tail upper-right = -26.4 deg)
    // Coupled live to pitchMicro so warp lines stay 100% locked to the ship's current heading vector
    const baseFuselageAngle = -0.46;
    const axisAngle = baseFuselageAngle + pitchMicro;
    const axisCos = Math.cos(axisAngle); // backward along fuselage (toward upper-right)
    const axisSin = Math.sin(axisAngle);

    // Exact nose tip in screen space (measured from artwork at [-0.494 * shipW, +0.368 * shipH])
    const cosP = Math.cos(pitchMicro);
    const sinP = Math.sin(pitchMicro);
    const localNoseX = -0.494 * shipW * breathScale;
    const localNoseY = 0.368 * shipH * breathScale;
    const noseTipX = shipCenterX + localNoseX * cosP - localNoseY * sinP;
    const noseTipY = shipCenterY + localNoseX * sinP + localNoseY * cosP;

    // Distant forward vanishing point strictly along the ship's forward nose ray (lower-left, off-frame)
    // Placing the vanishing point further ahead keeps all tunnel rays tightly parallel/perspective-aligned with the ship's flight vector
    const vpDist = Math.hypot(w, h) * 0.92;
    const vpX = noseTipX - axisCos * vpDist;
    const vpY = noseTipY - axisSin * vpDist;
    const fullTunnelLen = vpDist + maxRadius * 1.15;

    // Smoothly shifting cosmic hue cycle (No Man's Sky palette: violet/magenta -> crimson/rose -> solar gold -> cyan)
    const hueCycle = t * 0.34;
    const magentaPhase = 0.5 + 0.5 * Math.sin(hueCycle);
    const crimsonPhase = 0.5 + 0.5 * Math.sin(hueCycle + 2.1);
    const goldPhase = 0.5 + 0.5 * Math.sin(hueCycle + 4.2);

    // 1. Deep cosmic warp base wash spilling from ahead of the ship's nose along the flight vector
    const glowOriginX = noseTipX - axisCos * (minDim * 0.35);
    const glowOriginY = noseTipY - axisSin * (minDim * 0.35);
    const baseGrad = ctx.createRadialGradient(glowOriginX, glowOriginY, 12, glowOriginX, glowOriginY, maxRadius * 1.25);
    baseGrad.addColorStop(0, '#FFFDF7');
    baseGrad.addColorStop(
      0.1,
      `rgba(${Math.round(230 + 25 * goldPhase)}, ${Math.round(145 + 65 * goldPhase)}, ${Math.round(220 - 60 * crimsonPhase)}, 0.88)`
    );
    baseGrad.addColorStop(
      0.32,
      `rgba(${Math.round(138 + 68 * crimsonPhase)}, ${Math.round(38 + 42 * goldPhase)}, ${Math.round(145 + 65 * magentaPhase)}, 0.72)`
    );
    baseGrad.addColorStop(
      0.66,
      `rgba(${Math.round(36 + 52 * crimsonPhase)}, ${Math.round(20 + 24 * magentaPhase)}, ${Math.round(68 + 42 * magentaPhase)}, 0.9)`
    );
    baseGrad.addColorStop(1, '#090D1A');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Volumetric Translucent Nebula Light Curtains tightly aligned with the ship's exact movement vector
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(vpX, vpY);

    const beamCount = 26;
    const coneHalfSpan = 0.32; // tight perspective fan aligned directly with fuselage axis
    for (let i = 0; i < beamCount; i++) {
      const normalized = (i / (beamCount - 1)) * 2 - 1; // -1 .. +1
      const sway = Math.sin(t * (0.55 + (i % 5) * 0.1) + i * 1.7) * 0.018;
      const angle = axisAngle + normalized * coneHalfSpan + sway;
      const halfSpread = 0.018 + (i % 4) * 0.009 + 0.006 * Math.sin(t * 1.4 + i);
      const beamLen = fullTunnelLen * (0.88 + 0.16 * Math.sin(t * 0.9 + i * 2.3));

      const paletteIdx = (i + Math.floor(t * 0.25)) % 5;
      let rgb = '216, 110, 245'; // luminous violet-magenta
      if (paletteIdx === 1) rgb = '240, 82, 118'; // cosmic crimson-rose
      else if (paletteIdx === 2) rgb = '246, 198, 96'; // radiant solar gold
      else if (paletteIdx === 3) rgb = '104, 214, 220'; // ethereal cyan-teal
      else if (paletteIdx === 4) rgb = '244, 232, 255'; // soft starlight white

      const pulse = 0.58 + 0.42 * Math.sin(t * 1.9 + i * 1.35);
      const peakAlpha = (0.12 + (i % 3) * 0.045) * pulse;

      const gx = Math.cos(angle) * beamLen;
      const gy = Math.sin(angle) * beamLen;
      const beamGrad = ctx.createLinearGradient(0, 0, gx, gy);
      beamGrad.addColorStop(0, `rgba(255, 252, 245, ${(peakAlpha * 1.3).toFixed(3)})`);
      beamGrad.addColorStop(0.45, `rgba(${rgb}, ${peakAlpha.toFixed(3)})`);
      beamGrad.addColorStop(0.82, `rgba(${rgb}, ${(peakAlpha * 0.35).toFixed(3)})`);
      beamGrad.addColorStop(1, `rgba(${rgb}, 0)`);

      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle - halfSpread) * beamLen, Math.sin(angle - halfSpread) * beamLen);
      ctx.lineTo(Math.cos(angle + halfSpread) * beamLen, Math.sin(angle + halfSpread) * beamLen);
      ctx.closePath();
      ctx.fill();
    }

    // 3. Soft Expanding Volumetric Nebula Clouds sweeping strictly along the ship's heading
    const cloudWaves = 6;
    for (let i = 0; i < cloudWaves; i++) {
      const progress = (t * 0.46 + i / cloudWaves) % 1;
      const rOuter = vpDist * 0.45 + Math.pow(progress, 1.25) * fullTunnelLen * 0.95;
      const rInner = rOuter * 0.72;
      const fadeIn = Math.min(1, progress * 3.5);
      const fadeOut = Math.min(1, (1 - progress) * 2.2);
      const alpha = fadeIn * fadeOut * 0.22;
      if (alpha <= 0.006) continue;

      const waveRgb =
        i % 3 === 0 ? '210, 96, 245' : i % 3 === 1 ? '245, 185, 92' : '235, 78, 112';
      const cloudGrad = ctx.createRadialGradient(0, 0, rInner, 0, 0, rOuter);
      cloudGrad.addColorStop(0, `rgba(${waveRgb}, 0)`);
      cloudGrad.addColorStop(0.55, `rgba(${waveRgb}, ${alpha.toFixed(3)})`);
      cloudGrad.addColorStop(1, `rgba(${waveRgb}, 0)`);

      ctx.fillStyle = cloudGrad;
      ctx.beginPath();
      ctx.arc(0, 0, rOuter, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 4. Radiant Warp-Core Glow spilling into the lower-left ahead of the ship's nose
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const corePulse = 1 + 0.08 * Math.sin(t * 6.5);
    const coreR = minDim * 0.52 * corePulse;
    const coreGrad = ctx.createRadialGradient(glowOriginX, glowOriginY, 0, glowOriginX, glowOriginY, coreR);
    coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    coreGrad.addColorStop(0.24, 'rgba(255, 248, 232, 0.78)');
    coreGrad.addColorStop(0.52, 'rgba(246, 178, 255, 0.36)');
    coreGrad.addColorStop(0.8, 'rgba(232, 184, 75, 0.14)');
    coreGrad.addColorStop(1, 'rgba(232, 184, 75, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(glowOriginX, glowOriginY, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Helper: fast starlight & plasma streaks tightly aligned to the ship's exact movement vector
    const renderRadialWarpStreaks = (foregroundPass: boolean) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      for (let i = 0; i < this.warpStreaks.length; i++) {
        const ws = this.warpStreaks[i];
        if (ws.foreground !== foregroundPass) continue;

        const progress = 1 - ws.z; // 0 (ahead of nose) -> 1 (past upper-right)
        // Tight perspective cone centered strictly on axisAngle so every streak aligns with the ship's heading
        const rayAngle = axisAngle + Math.sin(ws.angle * 3.7) * 0.34;
        const cosA = Math.cos(rayAngle);
        const sinA = Math.sin(rayAngle);

        const rHead = vpDist * 0.38 + Math.pow(progress, 1.32) * fullTunnelLen * 0.92;
        const streakLen = (36 + ws.speed * 95) * (0.25 + Math.pow(progress, 1.05) * 1.25);
        const rTail = Math.max(0, rHead - streakLen);

        const x1 = vpX + cosA * rTail;
        const y1 = vpY + sinA * rTail;
        const x2 = vpX + cosA * rHead;
        const y2 = vpY + sinA * rHead;

        const fadeIn = Math.min(1, progress * 4.2);
        const fadeOut = Math.min(1, (1 - progress) * 2.6);
        const alpha = fadeIn * fadeOut * (foregroundPass ? 0.9 : 0.74);
        if (alpha <= 0.012) continue;

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = ws.color;
        ctx.lineWidth = ws.thickness * (0.45 + progress * 1.15);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();
    };

    // 5. All speed streaks rushing past strictly behind the Solaris ship
    renderRadialWarpStreaks(false);
    ctx.save();
    ctx.globalAlpha = 0.55;
    renderRadialWarpStreaks(true);
    ctx.restore();

    // 6. Solaris Ship — Dramatic 3/4 Front-Side Close-Up + Live Warp Reflections on the Cockpit Canopy Glass
    ctx.save();
    ctx.translate(shipCenterX, shipCenterY);
    ctx.rotate(pitchMicro);
    ctx.scale(breathScale, breathScale);

    // Subtle cosmic warp light reflection across the nose & cockpit side
    const rimHalo = ctx.createRadialGradient(-shipW * 0.34, shipH * 0.24, shipH * 0.04, -shipW * 0.08, shipH * 0.06, shipW * 0.72);
    rimHalo.addColorStop(0, `rgba(248, ${Math.round(165 + 55 * goldPhase)}, 235, 0.34)`);
    rimHalo.addColorStop(0.45, 'rgba(232, 184, 75, 0.16)');
    rimHalo.addColorStop(1, 'rgba(11, 19, 32, 0)');
    ctx.fillStyle = rimHalo;
    ctx.beginPath();
    ctx.arc(-shipW * 0.08, shipH * 0.06, shipW * 0.72, 0, Math.PI * 2);
    ctx.fill();

    if (frontPair) {
      ctx.drawImage(frontPair.normal, -shipW / 2, -shipH / 2, shipW, shipH);

      // 6b. Live Hyperspace Warp Reflections clipped strictly to the curved cockpit canopy glass
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-0.002 * shipW, -0.098 * shipH);
      ctx.bezierCurveTo(
        0.065 * shipW, -0.235 * shipH,
        0.22 * shipW, -0.278 * shipH,
        0.335 * shipW, -0.165 * shipH
      );
      ctx.bezierCurveTo(
        0.36 * shipW, -0.105 * shipH,
        0.348 * shipW, -0.015 * shipH,
        0.275 * shipW, 0.042 * shipH
      );
      ctx.bezierCurveTo(
        0.175 * shipW, 0.078 * shipH,
        0.045 * shipW, 0.02 * shipH,
        -0.002 * shipW, -0.098 * shipH
      );
      ctx.closePath();
      ctx.clip();

      ctx.globalCompositeOperation = 'screen';

      // Shifting cosmic nebula sheen reflected across the curved dome
      const upperReflGrad = ctx.createRadialGradient(
        0.15 * shipW, -0.17 * shipH, shipH * 0.015,
        0.175 * shipW, -0.105 * shipH, shipW * 0.25
      );
      upperReflGrad.addColorStop(
        0,
        `rgba(255, ${Math.round(215 + 35 * goldPhase)}, ${Math.round(238 + 17 * magentaPhase)}, 0.52)`
      );
      upperReflGrad.addColorStop(
        0.45,
        `rgba(${Math.round(215 + 35 * crimsonPhase)}, ${Math.round(115 + 65 * goldPhase)}, ${Math.round(235 - 45 * crimsonPhase)}, 0.3)`
      );
      upperReflGrad.addColorStop(0.85, 'rgba(104, 214, 220, 0.12)');
      upperReflGrad.addColorStop(1, 'rgba(11, 19, 32, 0)');
      ctx.fillStyle = upperReflGrad;
      ctx.fillRect(-0.02 * shipW, -0.29 * shipH, 0.4 * shipW, 0.38 * shipH);

      // Animated warp light streaks gliding backward across the curved glass
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const localCos = Math.cos(baseFuselageAngle);
      const localSin = Math.sin(baseFuselageAngle);
      const localPerpX = -localSin;
      const localPerpY = localCos;
      const canopyCenterX = 0.175 * shipW;
      const canopyCenterY = -0.105 * shipH;

      for (let r = 0; r < 12; r++) {
        const speed = 1.45 + (r % 4) * 0.52;
        const p = (t * speed + r * 0.23) % 1;
        const along = (p - 0.5) * shipW * 0.38;
        const across = ((r / 11) - 0.5) * shipH * 0.24;
        const len = shipW * (0.075 + (r % 3) * 0.038);

        const sx = canopyCenterX + localCos * along + localPerpX * across;
        const sy = canopyCenterY + localSin * along + localPerpY * across;
        const ex = sx + localCos * len;
        const ey = sy + localSin * len;

        const midX = (sx + ex) * 0.5 + localPerpX * (across * 0.24);
        const midY = (sy + ey) * 0.5 + localPerpY * (across * 0.24);

        const fade = Math.sin(p * Math.PI);
        const streakAlpha = fade * (r % 3 === 0 ? 0.54 : 0.36);
        const streakColor =
          r % 4 === 0
            ? '#FFFFFF'
            : r % 4 === 1
              ? '#F6D379'
              : r % 4 === 2
                ? '#E888FF'
                : '#6EE7E0';

        ctx.globalAlpha = streakAlpha;
        ctx.strokeStyle = streakColor;
        ctx.lineWidth = r % 3 === 0 ? 2.4 : 1.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(midX, midY, ex, ey);
        ctx.stroke();
      }

      // Crisp upper-crest Fresnel highlight rim along the top arch of the glass canopy
      ctx.globalAlpha = 0.42 + 0.14 * Math.sin(t * 5.2);
      ctx.strokeStyle = '#FFF7E8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0.018 * shipW, -0.115 * shipH);
      ctx.bezierCurveTo(
        0.085 * shipW, -0.225 * shipH,
        0.22 * shipW, -0.258 * shipH,
        0.32 * shipW, -0.155 * shipH
      );
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    const dying = this.playerDying;
    const blink = !dying && p.invulnTimer > 0 && Math.floor(p.invulnTimer * 18) % 2 === 0;
    const dyingFlash = dying && Math.floor(this.playerDeathTimer * 24) % 3 === 0;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Violent structural micro-jitter during decompression sequence
    if (dying) {
      const intensity = 2.5 + (this.playerDeathTimer / 1.15) * 4.5;
      ctx.translate((Math.random() - 0.5) * intensity, (Math.random() - 0.5) * intensity);

      // Unstable collapsing astrolabe containment ring
      const ratio = Math.min(1, this.playerDeathTimer / 1.15);
      ctx.strokeStyle = `rgba(232, 93, 74, ${(0.35 + ratio * 0.55).toFixed(2)})`;
      ctx.lineWidth = 1.6 + ratio * 1.6;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 34 - ratio * 12, this.ambientTime * 8, this.ambientTime * 8 + Math.PI * 1.7);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!dying && p.dashCooldown > 0) {
      const ratio = 1 - p.dashCooldown / p.dashMaxCooldown;
      ctx.strokeStyle = 'rgba(232, 184, 75, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke();
    }

    if (!dying && p.overdriveTimer > 0) {
      const pulse = 1 + Math.sin(this.ambientTime * 12) * 0.06;
      ctx.strokeStyle = 'rgba(255, 123, 102, 0.65)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 26 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!dying && this.repairAnimTimer > 0) {
      const ratio = this.repairAnimTimer / this.repairAnimDuration;
      const progress = 1 - ratio;
      const envelope = Math.min(1, progress * 5) * Math.min(1, ratio * 2.4);
      const auraR = 36 - progress * 8;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, auraR);
      glow.addColorStop(0, `rgba(156, 242, 255, ${(0.34 * envelope).toFixed(3)})`);
      glow.addColorStop(0.55, `rgba(56, 189, 248, ${(0.24 * envelope).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, auraR, 0, Math.PI * 2);
      ctx.fill();

      // Contracting astrolabe pressurization & nanite seal ring
      ctx.strokeStyle = `rgba(122, 228, 255, ${(0.72 * envelope).toFixed(2)})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 34 - progress * 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress * 1.25));
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(p.angle);
    ctx.translate(-p.recoil * 3.5, 0);
    ctx.scale(p.scaleX, p.scaleY);

    if (blink) {
      ctx.globalAlpha = 0.45;
    }

    this.drawShipHull(ctx, p.overdriveTimer > 0 || dying, dying ? 0.3 : p.dashTimer > 0 ? 1.4 : 1, dyingFlash);

    // Progressive bluish scan-wave sweeping across the cockpit & hull during repair
    if (!dying && this.repairAnimTimer > 0) {
      const ratio = this.repairAnimTimer / this.repairAnimDuration;
      const progress = 1 - ratio;
      const envelope = Math.min(1, progress * 5) * Math.min(1, ratio * 2.4);
      const scanX = -22 + progress * 46;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hullSweep = ctx.createLinearGradient(scanX - 10, 0, scanX + 10, 0);
      hullSweep.addColorStop(0, 'rgba(56, 189, 248, 0)');
      hullSweep.addColorStop(0.5, `rgba(156, 242, 255, ${(0.62 * envelope).toFixed(3)})`);
      hullSweep.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = hullSweep;
      ctx.beginPath();
      ctx.ellipse(0, 0, 23, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(122, 228, 255, ${(0.55 * envelope).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 24, 17, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawShipHull(
    ctx: CanvasRenderingContext2D,
    overdrive: boolean,
    thrustScale: number,
    flashWhite: boolean
  ): void {
    const pair = this.sprites.PLAYER;

    // Thruster flame behind engine nozzle
    if (thrustScale > 0.1) {
      const flameLen = (11 + Math.sin(this.ambientTime * 42) * 3.5) * thrustScale;
      const nozzleX = pair ? -20 : -11;
      ctx.fillStyle = overdrive ? PALETTE.coralBright : PALETTE.brass;
      ctx.beginPath();
      ctx.moveTo(nozzleX, -4.5);
      ctx.lineTo(nozzleX - flameLen, 0);
      ctx.lineTo(nozzleX, 4.5);
      ctx.closePath();
      ctx.fill();
    }

    if (pair) {
      const drawSize = 54;
      ctx.save();
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(flashWhite ? pair.flash : pair.normal, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.restore();
      return;
    }

    // Vector fallback while sprite loads
    ctx.fillStyle = PALETTE.ivory;
    ctx.strokeStyle = overdrive ? PALETTE.coralBright : PALETTE.brass;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-11, -12);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-11, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private renderEnemies(ctx: CanvasRenderingContext2D): void {
    for (const e of this.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);

      // Telegraph line for STRIKER windup
      if (e.type === 'STRIKER' && e.aiState === 'WINDUP') {
        const pulse = 0.45 + 0.55 * Math.sin(this.ambientTime * 36);
        ctx.save();
        ctx.rotate(e.targetAngle);
        ctx.strokeStyle = `rgba(232, 93, 74, ${(0.58 * pulse).toFixed(2)})`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(e.radius, 0);
        ctx.lineTo(360, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Charging telegraph aura for BASTION windup
      if (e.type === 'BASTION' && e.aiState === 'WINDUP') {
        const chargeRatio = 1 - e.aiTimer / 0.8;
        ctx.strokeStyle = `rgba(255, 123, 102, ${(0.45 + chargeRatio * 0.5).toFixed(2)})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 10 - chargeRatio * 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      const isFlashing = e.hitFlash > 0;
      const shake = e.aiState === 'WINDUP' ? (Math.random() - 0.5) * 3.5 : 0;
      ctx.translate(shake, shake);

      const spriteKey: keyof typeof SPRITE_URLS =
        e.type === 'MINI_SCOUT' ? 'SCOUT' : e.type;
      const pair = this.sprites[spriteKey];

      const drawSize =
        e.type === 'BASTION'
          ? 68
          : e.type === 'SPLITTER'
            ? 56
            : e.type === 'STRIKER'
              ? 54
              : e.type === 'MINI_SCOUT'
                ? 32
                : 46;

      // Enemy propulsion / thruster plumes rendered behind hull in ship-local space
      this.renderEnemyThrusters(ctx, e, drawSize);

      if (pair) {
        ctx.save();
        ctx.rotate(e.angle + Math.PI / 2);
        ctx.drawImage(
          isFlashing ? pair.flash : pair.normal,
          -drawSize / 2,
          -drawSize / 2,
          drawSize,
          drawSize
        );
        ctx.restore();

        // HP arc for heavy enemies when damaged
        if ((e.type === 'BASTION' || e.type === 'SPLITTER') && e.hp < e.maxHp) {
          ctx.strokeStyle = e.type === 'SPLITTER' ? PALETTE.teal : PALETTE.brass;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(0, 0, e.radius + 7, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * e.hp) / e.maxHp);
          ctx.stroke();
        }
      } else {
        // Fallback geometric render while sprites load
        ctx.rotate(e.angle);
        ctx.fillStyle = isFlashing ? PALETTE.ivory : '#241E16';
        ctx.strokeStyle =
          e.type === 'STRIKER'
            ? PALETTE.coral
            : e.type === 'SPLITTER'
              ? PALETTE.teal
              : PALETTE.brass;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private renderEnemyThrusters(
    ctx: CanvasRenderingContext2D,
    e: Enemy,
    drawSize: number
  ): void {
    const speedMag = Math.hypot(e.vx, e.vy);
    const flicker = 0.82 + 0.18 * Math.sin(this.ambientTime * 48 + e.id * 3.7);
    const boost =
      e.type === 'STRIKER' && e.aiState === 'ACTION'
        ? 1.95
        : e.type === 'STRIKER' && e.aiState === 'WINDUP'
          ? 1.35
          : Math.min(1.25, 0.7 + speedMag / 220);

    const drawPlume = (
      nozzleX: number,
      nozzleY: number,
      length: number,
      halfWidth: number,
      outerColor: string,
      coreColor: string,
      glowColor: string
    ) => {
      // Soft thruster exhaust halo
      const halo = ctx.createRadialGradient(
        nozzleX - length * 0.25,
        nozzleY,
        1,
        nozzleX - length * 0.25,
        nozzleY,
        length * 0.85
      );
      halo.addColorStop(0, glowColor);
      halo.addColorStop(1, 'rgba(11, 19, 32, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(nozzleX - length * 0.25, nozzleY, length * 0.85, 0, Math.PI * 2);
      ctx.fill();

      // Outer plasma cone
      ctx.fillStyle = outerColor;
      ctx.beginPath();
      ctx.moveTo(nozzleX, nozzleY - halfWidth);
      ctx.lineTo(nozzleX - length, nozzleY);
      ctx.lineTo(nozzleX, nozzleY + halfWidth);
      ctx.closePath();
      ctx.fill();

      // Bright incandescent inner core
      ctx.fillStyle = coreColor;
      ctx.beginPath();
      ctx.moveTo(nozzleX, nozzleY - halfWidth * 0.45);
      ctx.lineTo(nozzleX - length * 0.56, nozzleY);
      ctx.lineTo(nozzleX, nozzleY + halfWidth * 0.45);
      ctx.closePath();
      ctx.fill();
    };

    ctx.save();
    ctx.rotate(e.angle);

    if (e.type === 'STRIKER') {
      const nozzleX = -drawSize * 0.34;
      const mainLen = (15 * boost) * flicker;
      drawPlume(nozzleX, 0, mainLen, 4.6, PALETTE.coral, PALETTE.ivory, 'rgba(232, 93, 74, 0.42)');
      // Twin side stabilizer vents
      drawPlume(nozzleX + 4, -drawSize * 0.17, mainLen * 0.55, 2.4, PALETTE.coralBright, PALETTE.ivory, 'rgba(255, 123, 102, 0.28)');
      drawPlume(nozzleX + 4, drawSize * 0.17, mainLen * 0.55, 2.4, PALETTE.coralBright, PALETTE.ivory, 'rgba(255, 123, 102, 0.28)');
    } else if (e.type === 'BASTION') {
      const nozzleX = -drawSize * 0.35;
      const len = (14 * boost) * (0.9 + 0.1 * Math.sin(this.ambientTime * 26 + e.id));
      const offsetY = drawSize * 0.16;
      drawPlume(nozzleX, -offsetY, len, 4.8, PALETTE.brass, PALETTE.ivory, 'rgba(232, 184, 75, 0.38)');
      drawPlume(nozzleX, offsetY, len, 4.8, PALETTE.brass, PALETTE.ivory, 'rgba(232, 184, 75, 0.38)');

      // Astrolabic engine stabilizer pulse ring behind Bastion
      const ringPulse = (this.ambientTime * 1.8 + e.id * 0.3) % 1;
      ctx.strokeStyle = `rgba(232, 184, 75, ${((1 - ringPulse) * 0.35).toFixed(2)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(nozzleX - 4 - ringPulse * 10, 0, 2.2, offsetY * (0.8 + ringPulse * 0.35), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (e.type === 'SPLITTER') {
      const nozzleX = -drawSize * 0.34;
      const len = (12.5 * boost) * flicker;
      drawPlume(nozzleX, 0, len * 1.1, 3.6, PALETTE.teal, PALETTE.ivory, 'rgba(62, 193, 176, 0.4)');
      drawPlume(nozzleX + 3, -drawSize * 0.18, len * 0.75, 2.5, PALETTE.teal, PALETTE.ivory, 'rgba(62, 193, 176, 0.3)');
      drawPlume(nozzleX + 3, drawSize * 0.18, len * 0.75, 2.5, PALETTE.teal, PALETTE.ivory, 'rgba(62, 193, 176, 0.3)');
    } else {
      // SCOUT & MINI_SCOUT twin amber ion thrusters
      const nozzleX = -drawSize * 0.33;
      const len = (e.type === 'MINI_SCOUT' ? 8.5 : 12) * boost * flicker;
      const halfW = e.type === 'MINI_SCOUT' ? 2.2 : 3.1;
      const offsetY = drawSize * 0.13;
      drawPlume(nozzleX, -offsetY, len, halfW, PALETTE.brass, PALETTE.ivory, 'rgba(232, 184, 75, 0.34)');
      drawPlume(nozzleX, offsetY, len, halfW, PALETTE.brass, PALETTE.ivory, 'rgba(232, 184, 75, 0.34)');
    }

    ctx.restore();
  }

  private renderBullets(ctx: CanvasRenderingContext2D): void {
    for (const b of this.bullets) {
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.fromPlayer) {
        const a = Math.atan2(b.vy, b.vx);
        ctx.rotate(a);
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.roundRect(-8, -2.2, 16, 4.4, 2.2);
        ctx.fill();

        ctx.fillStyle = PALETTE.ivory;
        ctx.beginPath();
        ctx.roundRect(-3, -1.2, 9, 2.4, 1.2);
        ctx.fill();
      } else {
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.ivory;
        ctx.beginPath();
        ctx.arc(0, 0, b.radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private renderSparks(ctx: CanvasRenderingContext2D): void {
    for (const s of this.sparks) {
      const alpha = s.life < 1.5 ? Math.max(0.2, s.life / 1.5) : 1;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = alpha;

      if (s.kind === 'repair') {
        const pulse = 1 + Math.sin(this.ambientTime * 7 + s.x * 0.05) * 0.14;
        const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 17 * pulse);
        glow.addColorStop(0, 'rgba(156, 242, 255, 0.72)');
        glow.addColorStop(0.55, 'rgba(56, 189, 248, 0.32)');
        glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 17 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Outer rotating astrolabe cyan & brass ring
        ctx.save();
        ctx.rotate(this.ambientTime * 2.4);
        ctx.strokeStyle = PALETTE.brass;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -10.5);
        ctx.lineTo(10.5, 0);
        ctx.lineTo(0, 10.5);
        ctx.lineTo(-10.5, 0);
        ctx.closePath();
        ctx.fillStyle = '#0D263B';
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Luminous cyan-blue repair cross core
        ctx.fillStyle = '#7AE4FF';
        ctx.fillRect(-5.2, -1.7, 10.4, 3.4);
        ctx.fillRect(-1.7, -5.2, 3.4, 10.4);
        ctx.fillStyle = '#E8FCFF';
        ctx.fillRect(-3.6, -0.9, 7.2, 1.8);
        ctx.fillRect(-0.9, -3.6, 1.8, 7.2);
      } else {
        ctx.rotate(this.ambientTime * 4);
        ctx.fillStyle = PALETTE.brass;
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4.5, 0);
        ctx.lineTo(0, 6);
        ctx.lineTo(-4.5, 0);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private renderParticlesAndWaves(ctx: CanvasRenderingContext2D): void {
    // 1. Expanding astrolabe & standard shockwave rings
    for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
      const s = this.shockwaves[i];
      if (!s.active) continue;
      const alpha = Math.max(0, s.life / s.maxLife);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(0.8, s.lineWidth * alpha);

      ctx.beginPath();
      ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
      ctx.stroke();

      if (s.astrolabe) {
        ctx.rotate(s.rotation);
        // Inner dashed astrolabe meridian ring
        ctx.lineWidth = Math.max(0.6, s.lineWidth * 0.55 * alpha);
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.arc(0, 0, s.radius * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // 8 cardinal & ordinal astrolabe ticks
        const tickCount = 8;
        for (let t = 0; t < tickCount; t++) {
          const a = (t * Math.PI * 2) / tickCount;
          const inner = t % 2 === 0 ? s.radius * 0.82 : s.radius * 0.9;
          const outer = t % 2 === 0 ? s.radius * 1.12 : s.radius * 1.05;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 2. Pooled particles (smoke first so sparks & stars pop cleanly above)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
        const pt = this.particles[i];
        if (!pt.active) continue;
        const isSmoke = pt.kind === 'smoke';
        if ((pass === 0 && !isSmoke) || (pass === 1 && isSmoke)) continue;

        const alpha = Math.max(0, pt.life / pt.maxLife);
        ctx.save();
        ctx.translate(pt.x, pt.y);

        if (pt.kind === 'smoke') {
          ctx.globalAlpha = alpha * 0.42;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(1, pt.size), 0, Math.PI * 2);
          ctx.fill();
        } else if (pt.kind === 'shard') {
          ctx.rotate(pt.angle);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = pt.color;
          ctx.strokeStyle = PALETTE.ivory;
          ctx.lineWidth = 0.8;
          const r = pt.size;
          ctx.beginPath();
          ctx.moveTo(r * 1.2, 0);
          ctx.lineTo(-r * 0.7, -r * 0.65);
          ctx.lineTo(-r * 0.4, r * 0.75);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (pt.kind === 'star') {
          ctx.rotate(pt.angle);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = pt.color;
          const r = pt.size * (0.45 + 0.55 * alpha);
          const inner = r * 0.28;
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.lineTo(inner, -inner);
          ctx.lineTo(r, 0);
          ctx.lineTo(inner, inner);
          ctx.lineTo(0, r);
          ctx.lineTo(-inner, inner);
          ctx.lineTo(-r, 0);
          ctx.lineTo(-inner, -inner);
          ctx.closePath();
          ctx.fill();
        } else if (pt.kind === 'arc') {
          ctx.rotate(pt.angle);
          ctx.globalAlpha = alpha * 0.9;
          ctx.strokeStyle = pt.color;
          ctx.lineWidth = Math.max(1, 2.2 * alpha);
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(2, pt.size), -0.55, 0.55);
          ctx.stroke();
        } else {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(0.6, pt.size * (0.4 + 0.6 * alpha)), 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      const alpha = Math.max(0, ft.life / ft.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.restore();
  }

  private renderOffscreenIndicators(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const padX = 24;
    const padY = 24;
    const zoom = this.arenaZoom;
    const halfW = w * 0.5;
    const halfH = h * 0.5;

    for (const e of this.enemies) {
      const sx = (e.x - halfW) * zoom + halfW;
      const sy = (e.y - halfH) * zoom + halfH;
      // Only show for enemies outside (or just breaching) the visible screen bounds
      if (sx >= 8 && sx <= w - 8 && sy >= 8 && sy <= h - 8) continue;

      const ix = Math.max(padX, Math.min(w - padX, sx));
      const iy = Math.max(padY, Math.min(h - padY, sy));
      const dx = sx - ix;
      const dy = sy - iy;
      const offDist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      // Proximity 0 (far) -> 1 (about to enter viewport)
      const proximity = Math.max(0, Math.min(1, 1 - offDist / 160));
      const isStriker = e.type === 'STRIKER';
      const isHeavy = e.type === 'BASTION';
      const pulseSpeed = isStriker ? 15 : 9 + proximity * 5;
      const pulse = 0.62 + 0.38 * Math.sin(this.ambientTime * pulseSpeed + e.id * 1.7);

      const accent = isStriker
        ? PALETTE.coralBright
        : e.type === 'SPLITTER'
          ? PALETTE.teal
          : PALETTE.brass;
      const glowRgba = isStriker
        ? `rgba(255, 123, 102, ${(0.22 + proximity * 0.28) * pulse})`
        : e.type === 'SPLITTER'
          ? `rgba(62, 193, 176, ${(0.2 + proximity * 0.24) * pulse})`
          : `rgba(232, 184, 75, ${(0.2 + proximity * 0.24) * pulse})`;

      const scale = (isHeavy ? 1.18 : 0.92) + proximity * 0.28;
      const alpha = (0.48 + proximity * 0.5) * pulse;

      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(angle);

      // 1. Subtle peripheral edge warning glow
      const glowRadius = 22 * scale;
      const glow = ctx.createRadialGradient(4, 0, 2, 4, 0, glowRadius);
      glow.addColorStop(0, glowRgba);
      glow.addColorStop(1, 'rgba(11, 19, 32, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(4, 0, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = Math.min(1, alpha);

      // 2. Delicate astrolabic meridian bracket arc facing the incoming threat
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.arc(-2, 0, 12.5 * scale, -0.78, 0.78);
      ctx.stroke();

      // 3. Sharp directional chevron pointer
      ctx.fillStyle = accent;
      ctx.strokeStyle = PALETTE.ivory;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(10.5 * scale, 0);
      ctx.lineTo(-2.5 * scale, -6.5 * scale);
      ctx.lineTo(0.8 * scale, 0);
      ctx.lineTo(-2.5 * scale, 6.5 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 4. Secondary warning chevron for high-threat Striker / Bastion
      if (isStriker || isHeavy) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-4.5 * scale, -5 * scale);
        ctx.lineTo(-0.5 * scale, 0);
        ctx.lineTo(-4.5 * scale, 5 * scale);
        ctx.stroke();
      }

      // 5. Incandescent ivory proximity core pip
      ctx.fillStyle = PALETTE.ivory;
      ctx.beginPath();
      ctx.arc(-6.5 * scale, 0, (1.6 + proximity * 1.1) * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private renderOffscreenPlayerIndicator(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const p = this.player;
    const zoom = this.arenaZoom;
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const screenPx = (p.x - halfW) * zoom + halfW;
    const screenPy = (p.y - halfH) * zoom + halfH;

    if (screenPx >= 12 && screenPx <= w - 12 && screenPy >= 12 && screenPy <= h - 12) {
      return;
    }

    const lensR = 27;
    const padX = 48;
    const padTop = 76;
    const padBottom = 52;
    const bx = Math.max(padX, Math.min(w - padX, screenPx));
    const by = Math.max(padTop, Math.min(h - padBottom, screenPy));
    const dirAngle = Math.atan2(screenPy - by, screenPx - bx);
    const outDistMeters = Math.max(1, Math.round(Math.hypot(screenPx - bx, screenPy - by) / 8));

    const rimColor =
      this.repairAnimTimer > 0
        ? '#7AE4FF'
        : p.overdriveTimer > 0 || p.hp <= 1
          ? PALETTE.coralBright
          : PALETTE.brass;

    ctx.save();

    // 1. Soft outer lens glow
    const halo = ctx.createRadialGradient(bx, by, lensR * 0.7, bx, by, lensR * 1.55);
    halo.addColorStop(0, p.overdriveTimer > 0 ? 'rgba(255, 123, 102, 0.34)' : 'rgba(232, 184, 75, 0.3)');
    halo.addColorStop(1, 'rgba(11, 19, 32, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(bx, by, lensR * 1.55, 0, Math.PI * 2);
    ctx.fill();

    // 2. Clipped live miniature viewport showing Solaris & nearby threats/shots
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, lensR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 19, 32, 0.92)';
    ctx.fill();
    ctx.clip();

    // Subtle astrolabe reticle inside mini lens
    ctx.strokeStyle = 'rgba(232, 184, 75, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(bx, by, lensR * 0.56, 0, Math.PI * 2);
    ctx.stroke();

    // Nearby enemies & bullets mapped into local mini-radar view
    const miniScale = 0.22;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      const relX = (e.x - p.x) * miniScale;
      const relY = (e.y - p.y) * miniScale;
      if (Math.hypot(relX, relY) < lensR - 3) {
        ctx.fillStyle = e.type === 'STRIKER' ? PALETTE.coralBright : PALETTE.brass;
        ctx.beginPath();
        ctx.arc(bx + relX, by + relY, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      const relX = (b.x - p.x) * miniScale;
      const relY = (b.y - p.y) * miniScale;
      if (Math.hypot(relX, relY) < lensR - 2) {
        ctx.fillStyle = b.fromPlayer ? PALETTE.ivory : PALETTE.coralBright;
        ctx.beginPath();
        ctx.arc(bx + relX, by + relY, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Live miniature Solaris ship rotated to actual heading
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(p.angle);
    ctx.scale(0.55, 0.55);
    const isMoving = Math.hypot(p.vx, p.vy) > 40 || p.dashTimer > 0;
    this.drawShipHull(ctx, p.overdriveTimer > 0, isMoving ? 1.15 : 0.45, false);
    ctx.restore();

    ctx.restore(); // end lens clip

    // 3. Crisp rim border & cardinal degree ticks
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, lensR, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Outward directional chevrons pointing toward ship's true space position (Astervoid style)
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(dirAngle);
    const pulse = 0.72 + 0.28 * Math.sin(this.ambientTime * 8);
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let c = 0; c < 2; c++) {
      const tipX = lensR + 7 + c * 6;
      ctx.globalAlpha = pulse * (c === 0 ? 0.95 : 0.62);
      ctx.beginPath();
      ctx.moveTo(tipX - 5, -5.5);
      ctx.lineTo(tipX, 0);
      ctx.lineTo(tipX - 5, 5.5);
      ctx.stroke();
    }
    ctx.restore();

    // 5. Compact distance readout positioned on the inward side of the lens
    const labelY = by > h * 0.5 ? by - lensR - 10 : by + lensR + 17;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ivory;
    ctx.fillText(`SOLARIS · ${outDistMeters}m`, bx, labelY);

    ctx.restore();
  }

  private renderReticle(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.mouseX, this.mouseY);
    ctx.strokeStyle = 'rgba(232, 184, 75, 0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-6, 0);
    ctx.moveTo(6, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -6);
    ctx.moveTo(0, 6);
    ctx.lineTo(0, 14);
    ctx.stroke();
    ctx.restore();
  }

  private renderTouchSticks(ctx: CanvasRenderingContext2D): void {
    const drawStick = (
      stick: { originX: number; originY: number; currX: number; currY: number },
      accentColor: string
    ) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(232, 184, 75, 0.34)';
      ctx.fillStyle = 'rgba(11, 19, 32, 0.35)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(stick.originX, stick.originY, this.stickMaxRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(244, 239, 230, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(stick.originX, stick.originY, this.stickMaxRadius * 0.48, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = accentColor;
      ctx.strokeStyle = PALETTE.ivory;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(stick.currX, stick.currY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    if (this.moveTouch) {
      drawStick(this.moveTouch, 'rgba(232, 184, 75, 0.72)');
    }
    if (this.aimTouch) {
      drawStick(this.aimTouch, 'rgba(232, 93, 74, 0.78)');
    }
  }

  private updateIntroCutscene(dt: number): void {
    this.cutsceneTime += dt;
    const t = this.cutsceneTime;
    const w = this.width;
    const h = this.height;

    this.cutsceneFlash = Math.max(0, this.cutsceneFlash - dt * 2.0);

    // Act 1: Orbit around left flank to rear + Hyper-warp launch (0.00s -> 3.35s)
    if (t < 3.35) {
      const warpSpeedMult = t < 1.75 ? 1.0 + (t / 1.75) * 0.65 : 3.85;
      for (const ws of this.warpStreaks) {
        ws.z -= ws.speed * warpSpeedMult * dt;
        if (ws.z <= 0.02) {
          ws.z = 0.95 + Math.random() * 0.08;
          ws.angle = Math.random() * Math.PI * 2;
        }
      }

      if (t >= 1.75 && !this.cutsceneFlags.launched) {
        this.cutsceneFlags.launched = true;
        this.cutsceneFlash = 0.72;
        this.shakeIntensity = 13;
      }
      this.updateParticlesAndWaves(dt);
      return;
    }

    // Act 2: Rift exit into combat zone + squadron approach + slow-motion explosions (3.35s -> 6.35s)
    if (!this.cutsceneFlags.riftEntered) {
      this.cutsceneFlags.riftEntered = true;
      this.cutsceneFlash = 0.95;
      this.shakeIntensity = 10.5;
      this.audio.playCutsceneRiftExit();
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) this.particles[i].active = false;
      for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) this.shockwaves[i].active = false;
      const rx = w * 0.19;
      const ry = h * 0.76;
      this.spawnShockwave(rx, ry, Math.min(w, h) * 0.34, '#E888FF', 3.0, 0.65, true);
      this.spawnShockwave(rx, ry, Math.min(w, h) * 0.22, PALETTE.brass, 2.2, 0.48, false);
    }

    // Smooth slow-motion envelope during squadron engagement (4.50s -> 5.95s)
    if (t < 4.5) {
      this.cutsceneTimeScale = 1;
    } else if (t < 4.72) {
      const u = (t - 4.5) / 0.22;
      this.cutsceneTimeScale = 1 - 0.76 * (u * u * (3 - 2 * u));
    } else if (t < 5.58) {
      this.cutsceneTimeScale = 0.24;
    } else if (t < 5.98) {
      const u = (t - 5.58) / 0.4;
      this.cutsceneTimeScale = 0.24 + 0.76 * (u * u * (3 - 2 * u));
    } else {
      this.cutsceneTimeScale = 1;
    }

    const effDt = dt * this.cutsceneTimeScale;

    // Player arrival flight path from hyperspace rift toward center arena
    if (t < 4.35) {
      const u = Math.min(1, (t - 3.35) / 1.0);
      const ease = 1 - Math.pow(1 - u, 3);
      const p0x = w * 0.16;
      const p0y = h * 0.79;
      const p1x = w * 0.35;
      const p1y = h * 0.62;
      const p2x = w * 0.46;
      const p2y = h * 0.54;
      const inv = 1 - ease;
      this.player.x = inv * inv * p0x + 2 * inv * ease * p1x + ease * ease * p2x;
      this.player.y = inv * inv * p0y + 2 * inv * ease * p1y + ease * ease * p2y;
      this.player.angle = -0.62 + ease * 0.22;

      if (t < 4.18 && Math.random() < 0.85) {
        const backA = this.player.angle + Math.PI + (Math.random() - 0.5) * 0.35;
        const spd = 120 + Math.random() * 140;
        this.spawnParticle(
          this.player.x + Math.cos(this.player.angle + Math.PI) * 18,
          this.player.y + Math.sin(this.player.angle + Math.PI) * 18,
          Math.cos(backA) * spd,
          Math.sin(backA) * spd,
          2.6 + Math.random() * 2.4,
          0.35 + Math.random() * 0.25,
          Math.random() < 0.55 ? PALETTE.brass : '#E888FF',
          0.92,
          'spark'
        );
      }
    } else if (t < 5.65) {
      const u = (t - 4.35) / 1.3;
      this.player.x = w * (0.46 + u * 0.02);
      this.player.y = h * (0.54 - u * 0.02);
      this.player.angle = -0.4 - Math.sin(u * Math.PI) * 0.1;
    } else {
      const u = Math.min(1, (t - 5.65) / 0.7);
      const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.player.x = w * (0.48 + ease * 0.02);
      this.player.y = h * (0.52 - ease * 0.02);
      this.player.angle = -0.4 + ease * (-Math.PI / 2 + 0.4);
    }

    // Update enemy squadron formation
    for (let i = 0; i < this.cutsceneSquadron.length; i++) {
      const m = this.cutsceneSquadron[i];
      if (!m.alive) continue;
      if (t >= 3.72 && t < 5.25) {
        const u = Math.min(1, (t - 3.72) / 1.15);
        const ease = 1 - Math.pow(1 - u, 3);
        m.enemy.x = m.startX + (m.hoverX - m.startX) * ease;
        m.enemy.y = m.startY + (m.hoverY - m.startY) * ease;
        m.enemy.angle = Math.atan2(this.player.y - m.enemy.y, this.player.x - m.enemy.x);
      } else if (t >= 5.25 && i >= 2) {
        const u = Math.min(1, (t - 5.25) / 0.75);
        const ease = u * u * (3 - 2 * u);
        m.enemy.x = m.hoverX + (m.exitX - m.hoverX) * ease;
        m.enemy.y = m.hoverY + (m.exitY - m.hoverY) * ease;
        m.enemy.angle = Math.atan2(m.exitY - m.hoverY, m.exitX - m.hoverX);
        m.alpha = Math.max(0, 1 - ease);
      }
    }

    // Fire two golden plasma bolts in slow motion at 4.60s and 4.78s
    if (t >= 4.6 && !this.cutsceneFlags.shot1 && this.cutsceneSquadron[0]) {
      this.cutsceneFlags.shot1 = true;
      const target = this.cutsceneSquadron[0].enemy;
      const ang = Math.atan2(target.y - this.player.y, target.x - this.player.x);
      this.player.angle = ang;
      this.player.recoil = 1;
      const b = this.cutsceneBolts[0];
      b.active = true;
      b.x = this.player.x + Math.cos(ang) * 20;
      b.y = this.player.y + Math.sin(ang) * 20;
      b.tx = target.x;
      b.ty = target.y;
      const dist = Math.hypot(b.tx - b.x, b.ty - b.y);
      const spd = dist / 0.27;
      b.vx = Math.cos(ang) * spd;
      b.vy = Math.sin(ang) * spd;
      this.audio.playShoot(true);
    }

    if (t >= 4.78 && !this.cutsceneFlags.shot2 && this.cutsceneSquadron[1]) {
      this.cutsceneFlags.shot2 = true;
      const target = this.cutsceneSquadron[1].enemy;
      const ang = Math.atan2(target.y - this.player.y, target.x - this.player.x);
      this.player.angle = ang;
      this.player.recoil = 1;
      const b = this.cutsceneBolts[1];
      b.active = true;
      b.x = this.player.x + Math.cos(ang) * 20;
      b.y = this.player.y + Math.sin(ang) * 20;
      b.tx = target.x;
      b.ty = target.y;
      const dist = Math.hypot(b.tx - b.x, b.ty - b.y);
      const spd = dist / 0.3;
      b.vx = Math.cos(ang) * spd;
      b.vy = Math.sin(ang) * spd;
      this.audio.playShoot(true);
    }

    this.player.recoil = Math.max(0, this.player.recoil - dt * 5);

    for (let i = 0; i < this.cutsceneBolts.length; i++) {
      const b = this.cutsceneBolts[i];
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const m = this.cutsceneSquadron[i];
      if (m && m.alive) {
        const d = Math.hypot(m.enemy.x - b.x, m.enemy.y - b.y);
        if (d < 24 || (i === 0 && t >= 4.88) || (i === 1 && t >= 5.1)) {
          b.active = false;
          m.alive = false;
          if (i === 0) this.cutsceneFlags.boom1 = true;
          else this.cutsceneFlags.boom2 = true;
          this.spawnAstrolabeExplosion(
            m.enemy.x,
            m.enemy.y,
            PALETTE.coralBright,
            PALETTE.brass,
            'large'
          );
          this.audio.playSlowMoExplosion();
          this.shakeIntensity = 9.5;
          this.cutsceneFlash = Math.max(this.cutsceneFlash, 0.36);
        }
      }
    }

    this.updateParticlesAndWaves(effDt);

    if (t >= this.cutsceneDuration) {
      this.finishCutsceneToGameplay(false);
    }
  }

  private renderIntroCutscene(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const t = this.cutsceneTime;
    const minDim = Math.min(w, h);
    const maxRadius = Math.hypot(w, h) * 1.15;

    if (t < 3.35) {
      // ACT 1: Orbit around LEFT flank to rear + Hyper-warp launch leaving camera behind
      const frontPair = this.sprites.PLAYER_FRONT;
      const imgAspect = frontPair ? frontPair.normal.width / frontPair.normal.height : 819 / 559;
      const isNarrow = w < h * 1.15;
      const shipH0 = isNarrow
        ? Math.min(h * 0.46, (w * 0.84) / imgAspect)
        : Math.min(h * 0.66, (w * 0.55) / imgAspect);
      const shipW0 = shipH0 * imgAspect;
      const rightBleed = Math.max(24, shipW0 * 0.08);
      const topPad0 = Math.max(18, h * 0.045);
      const cx0 = w - shipW0 * 0.5 + rightBleed;
      const cy0 = topPad0 + shipH0 * 0.5;
      const baseFuselageAngle = -0.46;
      const axisCos0 = Math.cos(baseFuselageAngle);
      const axisSin0 = Math.sin(baseFuselageAngle);
      const nose0X = cx0 - 0.494 * shipW0;
      const nose0Y = cy0 + 0.368 * shipH0;
      const vpDist0 = Math.hypot(w, h) * 0.92;
      const vp0X = nose0X - axisCos0 * vpDist0;
      const vp0Y = nose0Y - axisSin0 * vpDist0;

      const orbitRaw = Math.min(1, Math.max(0, t / 1.75));
      const orbit =
        orbitRaw < 0.5
          ? 4 * orbitRaw * orbitRaw * orbitRaw
          : 1 - Math.pow(-2 * orbitRaw + 2, 3) / 2;

      const launchRaw = Math.min(1, Math.max(0, (t - 1.75) / 1.32));

      // Camera zoom: subtle push-in during left-flank orbit without clipping wings on narrow screens
      const camZoom =
        t < 1.75
          ? 1 + orbit * 0.12
          : 1.12 - Math.min(1, (t - 1.75) / 0.75) * 0.12;

      // Vanishing point sweeps from lower-left ahead of nose to dead-center ahead of ship
      const targetVpX = w * 0.5;
      const targetVpY = h * 0.47;
      const vpX = vp0X + (targetVpX - vp0X) * orbit;
      const vpY = vp0Y + (targetVpY - vp0Y) * orbit;
      const vpDist = vpDist0 * (1 - orbit) + minDim * 0.06 * orbit;
      const fullTunnelLen = vpDist + maxRadius * 1.15;

      const hueCycle = (this.ambientTime) * 0.34;
      const magentaPhase = 0.5 + 0.5 * Math.sin(hueCycle);
      const crimsonPhase = 0.5 + 0.5 * Math.sin(hueCycle + 2.1);
      const goldPhase = 0.5 + 0.5 * Math.sin(hueCycle + 4.2);

      // Apply camera zoom centered on screen/target
      ctx.save();
      ctx.translate(w * 0.5, h * 0.5);
      ctx.scale(camZoom, camZoom);
      ctx.translate(-w * 0.5, -h * 0.5);

      // 1. Cosmic warp base wash
      const glowOriginX =
        (nose0X - axisCos0 * (minDim * 0.35)) * (1 - orbit) + targetVpX * orbit;
      const glowOriginY =
        (nose0Y - axisSin0 * (minDim * 0.35)) * (1 - orbit) + targetVpY * orbit;
      const baseGrad = ctx.createRadialGradient(
        glowOriginX,
        glowOriginY,
        12,
        glowOriginX,
        glowOriginY,
        maxRadius * 1.25
      );
      baseGrad.addColorStop(0, '#FFFDF7');
      baseGrad.addColorStop(
        0.11,
        `rgba(${Math.round(230 + 25 * goldPhase)}, ${Math.round(145 + 65 * goldPhase)}, ${Math.round(220 - 60 * crimsonPhase)}, 0.88)`
      );
      baseGrad.addColorStop(
        0.34,
        `rgba(${Math.round(138 + 68 * crimsonPhase)}, ${Math.round(38 + 42 * goldPhase)}, ${Math.round(145 + 65 * magentaPhase)}, 0.74)`
      );
      baseGrad.addColorStop(
        0.68,
        `rgba(${Math.round(36 + 52 * crimsonPhase)}, ${Math.round(20 + 24 * magentaPhase)}, ${Math.round(68 + 42 * magentaPhase)}, 0.92)`
      );
      baseGrad.addColorStop(1, '#090D1A');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(-w * 0.25, -h * 0.25, w * 1.5, h * 1.5);

      // 2. Volumetric nebula light curtains expanding from side-cone into full 360° cylindrical tunnel
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(vpX, vpY);
      const beamCount = 28;
      const coneSpan = 0.32 + (Math.PI - 0.32) * orbit;
      for (let i = 0; i < beamCount; i++) {
        const normalized = coneSpan >= Math.PI * 0.95 ? (i / beamCount) * 2 - 1 : (i / (beamCount - 1)) * 2 - 1;
        const sway = Math.sin(this.ambientTime * (0.65 + (i % 5) * 0.1) + i * 1.7) * 0.022;
        const angle = baseFuselageAngle * (1 - orbit) + normalized * coneSpan + sway;
        const halfSpread = 0.024 + (i % 4) * 0.012;
        const beamLen = fullTunnelLen * (0.9 + 0.14 * Math.sin(this.ambientTime + i * 2.1));

        const paletteIdx = (i + Math.floor(this.ambientTime * 0.25)) % 5;
        let rgb = '216, 110, 245';
        if (paletteIdx === 1) rgb = '240, 82, 118';
        else if (paletteIdx === 2) rgb = '246, 198, 96';
        else if (paletteIdx === 3) rgb = '104, 214, 220';
        else if (paletteIdx === 4) rgb = '244, 232, 255';

        const peakAlpha = (0.11 + (i % 3) * 0.04) * (1 + launchRaw * 0.35);
        const gx = Math.cos(angle) * beamLen;
        const gy = Math.sin(angle) * beamLen;
        const beamGrad = ctx.createLinearGradient(0, 0, gx, gy);
        beamGrad.addColorStop(0, `rgba(255, 252, 245, ${Math.min(0.45, peakAlpha * 1.3).toFixed(3)})`);
        beamGrad.addColorStop(0.45, `rgba(${rgb}, ${Math.min(0.4, peakAlpha).toFixed(3)})`);
        beamGrad.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle - halfSpread) * beamLen, Math.sin(angle - halfSpread) * beamLen);
        ctx.lineTo(Math.cos(angle + halfSpread) * beamLen, Math.sin(angle + halfSpread) * beamLen);
        ctx.closePath();
        ctx.fill();
      }

      // 3. Expanding volumetric nebula rings sweeping past camera
      const cloudWaves = 6;
      for (let i = 0; i < cloudWaves; i++) {
        const speed = t < 1.75 ? 0.48 : 1.05;
        const progress = (t * speed + i / cloudWaves) % 1;
        const rOuter = vpDist * 0.4 + Math.pow(progress, 1.3) * fullTunnelLen * 0.92;
        const rInner = rOuter * 0.72;
        const alpha = Math.min(1, progress * 3.5) * Math.min(1, (1 - progress) * 2.2) * 0.24;
        if (alpha <= 0.006) continue;
        const waveRgb =
          i % 3 === 0 ? '210, 96, 245' : i % 3 === 1 ? '245, 185, 92' : '235, 78, 112';
        const cloudGrad = ctx.createRadialGradient(0, 0, rInner, 0, 0, rOuter);
        cloudGrad.addColorStop(0, `rgba(${waveRgb}, 0)`);
        cloudGrad.addColorStop(0.55, `rgba(${waveRgb}, ${alpha.toFixed(3)})`);
        cloudGrad.addColorStop(1, `rgba(${waveRgb}, 0)`);
        ctx.fillStyle = cloudGrad;
        ctx.beginPath();
        ctx.arc(0, 0, rOuter, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 4. Warp core glow at tunnel mouth
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const coreR = minDim * (0.48 - orbit * 0.14 + launchRaw * 0.18);
      const coreGrad = ctx.createRadialGradient(glowOriginX, glowOriginY, 0, glowOriginX, glowOriginY, coreR);
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
      coreGrad.addColorStop(0.24, 'rgba(255, 248, 232, 0.78)');
      coreGrad.addColorStop(0.54, 'rgba(246, 178, 255, 0.36)');
      coreGrad.addColorStop(1, 'rgba(232, 184, 75, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(glowOriginX, glowOriginY, coreR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 5. Radial hyperspace streaks sweeping from side fan into full 360 tunnel
      const drawTunnelStreaks = (foregroundPass: boolean) => {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 0; i < this.warpStreaks.length; i++) {
          const ws = this.warpStreaks[i];
          if (ws.foreground !== foregroundPass) continue;
          const progress = 1 - ws.z;
          const sideAngle = baseFuselageAngle + Math.sin(ws.angle * 3.7) * 0.34;
          // Smoothly blend angle into full 360 tunnel rays as orbit finishes
          const rayAngle = sideAngle * (1 - orbit) + ws.angle * orbit;
          const cosA = Math.cos(rayAngle);
          const sinA = Math.sin(rayAngle);

          const rHead = vpDist * 0.34 + Math.pow(progress, 1.35) * fullTunnelLen * 0.94;
          const streakLen =
            (36 + ws.speed * (95 + launchRaw * 165)) * (0.25 + Math.pow(progress, 1.05) * 1.3);
          const rTail = Math.max(0, rHead - streakLen);
          const alpha =
            Math.min(1, progress * 4.2) *
            Math.min(1, (1 - progress) * 2.6) *
            (foregroundPass ? 0.85 : 0.76);
          if (alpha <= 0.012) continue;

          ctx.globalAlpha = alpha;
          ctx.strokeStyle = ws.color;
          ctx.lineWidth = ws.thickness * (0.45 + progress * (1.15 + launchRaw * 0.9));
          ctx.beginPath();
          ctx.moveTo(vpX + cosA * rTail, vpY + sinA * rTail);
          ctx.lineTo(vpX + cosA * rHead, vpY + sinA * rHead);
          ctx.stroke();
        }
        ctx.restore();
      };

      drawTunnelStreaks(false);
      if (t < 0.18) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        drawTunnelStreaks(true);
        ctx.restore();
      }

      // 6. Ship Orbit & Hyper-Warp Departure
      const shipStartX = isNarrow ? w * 0.58 : w * 0.62;
      const shipStartY = isNarrow
        ? Math.max(cy0 + shipH0 * 0.08, h * 0.36)
        : Math.max(cy0 + shipH0 * 0.04, h * 0.44);
      const shipTargetX = w * 0.5;
      const shipTargetY = h * 0.54;
      const orbitShipX = shipStartX + (shipTargetX - shipStartX) * orbit;
      const orbitShipY = shipStartY + (shipTargetY - shipStartY) * orbit;

      // Phase A: Keep title closeup strictly anchored to top-right while fading out over 0.18s
      if (frontPair && t < 0.18) {
        const frontFade = Math.max(0, 1 - t / 0.18);
        if (frontFade > 0.01) {
          ctx.save();
          ctx.globalAlpha = frontFade;
          ctx.drawImage(frontPair.normal, cx0 - shipW0 / 2, cy0 - shipH0 / 2, shipW0, shipH0);
          ctx.restore();
        }
      }

      // Phase B: Full uncropped 3D-projected Solaris Chase Ship orbiting around left flank to dead-on rear, then blasting into deep tunnel
      const ship3DFade = t < 0.05 ? 0 : Math.min(1, (t - 0.05) / 0.22);
      if (ship3DFade > 0.01 && launchRaw < 0.98) {
        // Yaw sweeps from left-front 3/4 (-1.05 rad, matching PLAYER_FRONT) -> left broadside (-1.57) -> dead-on rear (-Math.PI)
        const yaw = -1.05 + (-Math.PI + 1.05) * Math.min(1, orbit * 1.03);
        const bankRoll = Math.sin(orbit * Math.PI) * 0.16 * (1 - launchRaw);
        const pitchRad = 0.42 * (1 - orbit) + 0.18 * orbit * (1 - launchRaw * 0.72);

        // After 1.75s, camera stays behind while ship blasts down tunnel (depthZ = 1 -> 46)
        const depthZ = t < 1.75 ? 1 : 1 + Math.pow(launchRaw, 2.35) * 45;
        const projU = t < 1.75 ? 0 : 1 - 1 / depthZ;
        const shipDrawX = orbitShipX + (vpX - orbitShipX) * projU;
        const shipDrawY = orbitShipY + (vpY - orbitShipY) * projU;
        const baseScale = isNarrow ? minDim * 0.15 : Math.min(w * 0.14, h * 0.19);
        const shipScale = baseScale / depthZ;
        const engineHeat = t < 1.75 ? 0.65 + orbit * 0.85 : 2.6 - launchRaw * 0.8;
        const disappearAlpha = launchRaw > 0.72 ? Math.max(0, 1 - (launchRaw - 0.72) / 0.24) : 1;

        // Twin ionized warp contrails stretching behind the departing ship toward camera
        if (t >= 1.75 && disappearAlpha > 0.02) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const trailStart = Math.max(0, projU - 0.42);
          const tx0 = orbitShipX + (vpX - orbitShipX) * trailStart;
          const ty0 = orbitShipY + (vpY - orbitShipY) * trailStart;
          const wingHalf = shipScale * 1.15;
          const trailAlpha = (1 - launchRaw * 0.65) * 0.72;
          for (const side of [-1, 1]) {
            const x1 = tx0 + side * minDim * 0.14 * (1 - trailStart);
            const y1 = ty0 + minDim * 0.015;
            const x2 = shipDrawX + side * wingHalf;
            const y2 = shipDrawY + shipScale * 0.08;
            const tGrad = ctx.createLinearGradient(x1, y1, x2, y2);
            tGrad.addColorStop(0, 'rgba(232, 136, 255, 0)');
            tGrad.addColorStop(0.55, `rgba(246, 211, 121, ${(trailAlpha * 0.65).toFixed(2)})`);
            tGrad.addColorStop(1, `rgba(255, 255, 255, ${trailAlpha.toFixed(2)})`);
            ctx.strokeStyle = tGrad;
            ctx.lineWidth = Math.max(1.2, 4.5 * (1 - launchRaw * 0.8));
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }

          // Distant pinpoint star-flash right as the ship vanishes out of camera sight
          if (launchRaw > 0.55) {
            const glintAlpha = Math.sin(((launchRaw - 0.55) / 0.45) * Math.PI) * 0.95;
            const glintR = minDim * (0.06 + (1 - launchRaw) * 0.06);
            const gGrad = ctx.createRadialGradient(shipDrawX, shipDrawY, 0, shipDrawX, shipDrawY, glintR);
            gGrad.addColorStop(0, `rgba(255, 255, 255, ${glintAlpha.toFixed(2)})`);
            gGrad.addColorStop(0.35, `rgba(246, 211, 121, ${(glintAlpha * 0.6).toFixed(2)})`);
            gGrad.addColorStop(1, 'rgba(232, 136, 255, 0)');
            ctx.fillStyle = gGrad;
            ctx.beginPath();
            ctx.arc(shipDrawX, shipDrawY, glintR, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        if (disappearAlpha > 0.01 && shipScale > 1.2) {
          ctx.save();
          ctx.globalAlpha = ship3DFade * disappearAlpha;
          this.renderCutsceneSolaris3D(
            ctx,
            shipDrawX,
            shipDrawY,
            shipScale,
            yaw,
            pitchRad,
            bankRoll,
            engineHeat
          );
          ctx.restore();
        }
      }

      // Expanding warp ignition shockwave ring toward camera at t = 1.75s
      if (t >= 1.75 && t < 2.65) {
        const u = (t - 1.75) / 0.9;
        const ringR = minDim * (0.06 + Math.pow(u, 0.72) * 0.95);
        const alpha = (1 - u) * 0.72;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(246, 211, 121, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 4.5 * (1 - u * 0.65);
        ctx.beginPath();
        ctx.arc(shipTargetX, shipTargetY, ringR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(232, 136, 255, ${(alpha * 0.85).toFixed(2)})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(shipTargetX, shipTargetY, ringR * 0.84, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (t >= 0.18) {
        drawTunnelStreaks(true);
      }
      ctx.restore(); // end camZoom

      // Subtle golden warp pulse during 0 -> 0.26s crossfade from title close-up
      const introPulse = t < 0.26 ? Math.sin((t / 0.26) * Math.PI) * 0.32 : 0;
      // Peak transition flash into Act 2 (3.14s -> 3.35s)
      const endFlash = t > 3.12 ? Math.pow((t - 3.12) / 0.23, 2) * 0.96 : 0;
      const totalFlash = Math.min(1, Math.max(this.cutsceneFlash, endFlash, introPulse));
      if (totalFlash > 0.01) {
        ctx.fillStyle = `rgba(255, 248, 232, ${totalFlash.toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
      this.renderLetterbox(ctx, w, h, t);
      return;
    }

    // ACT 2: Combat zone arrival, enemy squadron approach & slow-motion explosions (3.35s -> 6.35s)
    let camZoom = 1;
    let camFocusX = w * 0.5;
    let camFocusY = h * 0.5;
    if (t < 4.35) {
      const u = (t - 3.35) / 1.0;
      const ease = 1 - Math.pow(1 - u, 2);
      camZoom = 1.2 - ease * 0.12;
      camFocusX = w * (0.36 + ease * 0.16);
      camFocusY = h * (0.62 - ease * 0.12);
    } else if (t < 5.65) {
      const u = Math.min(1, (t - 4.35) / 0.75);
      const ease = u * u * (3 - 2 * u);
      camZoom = 1.08 + ease * 0.16;
      camFocusX = w * (0.52 + ease * 0.07);
      camFocusY = h * (0.5 - ease * 0.06);
    } else {
      const u = Math.min(1, (t - 5.65) / 0.7);
      const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      camZoom = 1.24 - ease * 0.24;
      camFocusX = w * (0.59 - ease * 0.09);
      camFocusY = h * (0.44 + ease * 0.06);
    }

    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camFocusX, -camFocusY);

    this.renderBackdrop(ctx, w, h);

    // Dimensional warp-exit rift behind incoming player ship (3.35s -> 4.35s)
    if (t < 4.45) {
      const riftLife = Math.max(0, 1 - (t - 3.35) / 1.1);
      const rx = w * 0.18;
      const ry = h * 0.76;
      const riftR = minDim * (0.14 + Math.sin((1 - riftLife) * Math.PI) * 0.08) * riftLife;
      if (riftR > 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const rGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, riftR * 2.2);
        rGrad.addColorStop(0, `rgba(255, 252, 245, ${(riftLife * 0.9).toFixed(2)})`);
        rGrad.addColorStop(0.35, `rgba(232, 136, 255, ${(riftLife * 0.65).toFixed(2)})`);
        rGrad.addColorStop(0.7, `rgba(232, 184, 75, ${(riftLife * 0.35).toFixed(2)})`);
        rGrad.addColorStop(1, 'rgba(11, 19, 32, 0)');
        ctx.fillStyle = rGrad;
        ctx.beginPath();
        ctx.arc(rx, ry, riftR * 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(246, 211, 121, ${(riftLife * 0.8).toFixed(2)})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(rx, ry, riftR * 0.65, riftR * 1.15, -0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Render incoming Sentinel Squadron
    for (const m of this.cutsceneSquadron) {
      if (!m.alive || m.alpha <= 0.01) continue;
      const e = m.enemy;
      const spriteKey: keyof typeof SPRITE_URLS = e.type === 'MINI_SCOUT' ? 'SCOUT' : e.type;
      const pair = this.sprites[spriteKey];
      const drawSize =
        e.type === 'BASTION' ? 68 : e.type === 'STRIKER' ? 54 : 46;

      ctx.save();
      ctx.globalAlpha = m.alpha;
      ctx.translate(e.x, e.y);
      this.renderEnemyThrusters(ctx, e, drawSize);
      if (pair) {
        ctx.rotate(e.angle + Math.PI / 2);
        ctx.drawImage(pair.normal, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      }
      ctx.restore();
    }

    // Render slow-motion golden plasma bolts
    for (const b of this.cutsceneBolts) {
      if (!b.active) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const ang = Math.atan2(b.vy, b.vx);
      ctx.translate(b.x, b.y);
      ctx.rotate(ang);
      const bGrad = ctx.createLinearGradient(-22, 0, 10, 0);
      bGrad.addColorStop(0, 'rgba(232, 184, 75, 0)');
      bGrad.addColorStop(0.6, '#E8B84B');
      bGrad.addColorStop(1, '#FFFDF7');
      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.ellipse(-4, 0, 16, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Render Player Solaris ship
    ctx.save();
    ctx.translate(this.player.x, this.player.y);
    ctx.rotate(this.player.angle);
    ctx.translate(-this.player.recoil * 4, 0);
    const arrivalBoost = t < 4.2 ? 1.85 : 1.05;
    this.drawShipHull(ctx, t < 4.1, arrivalBoost, false);
    ctx.restore();

    this.renderParticlesAndWaves(ctx);
    ctx.restore();

    // Subtle slow-motion desaturated edge vignette during slow-mo engagement
    if (this.cutsceneTimeScale < 0.95) {
      const slowIntensity = (1 - this.cutsceneTimeScale) / 0.76;
      const vig = ctx.createRadialGradient(
        w * 0.5,
        h * 0.5,
        minDim * 0.28,
        w * 0.5,
        h * 0.5,
        Math.hypot(w, h) * 0.58
      );
      vig.addColorStop(0, 'rgba(11, 19, 32, 0)');
      vig.addColorStop(1, `rgba(6, 10, 20, ${(slowIntensity * 0.45).toFixed(3)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.cutsceneFlash > 0.01) {
      ctx.fillStyle = `rgba(255, 248, 232, ${Math.min(0.95, this.cutsceneFlash).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    this.renderLetterbox(ctx, w, h, t);
  }

  private renderCutsceneSolaris3D(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number,
    yaw: number,
    pitch: number,
    bank: number,
    engineHeat: number
  ): void {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosB = Math.cos(bank);
    const sinB = Math.sin(bank);
    const focal = 6.4;

    // 3D project ship-local (x = starboard, y = up, z = forward nose) -> screen
    // yaw = 0 faces camera; yaw = -1.05 shows front-left 3/4 matching PLAYER_FRONT; yaw = -Math.PI shows dead-on rear
    const proj = (lx: number, ly: number, lz: number): { x: number; y: number; z: number } => {
      const bx = lx * cosB - ly * sinB;
      const by = lx * sinB + ly * cosB;
      const bz = lz;
      const yx = -bx * cosY + bz * sinY;
      const yz = bx * sinY + bz * cosY;
      const yy = by;
      const py = yy * cosP - yz * sinP;
      const pz = yy * sinP + yz * cosP;
      const denom = Math.max(1.25, focal - pz);
      const f = focal / denom;
      return {
        x: cx + yx * scale * f,
        y: cy - py * scale * f,
        z: pz,
      };
    };

    const drawPoly = (
      pts: Array<{ x: number; y: number }>,
      fill: string | CanvasGradient,
      stroke?: string,
      lineWidth = 1.15
    ) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    };

    const drawThrusterFlame = (
      nozzle: { x: number; y: number },
      radius: number,
      heat: number
    ) => {
      const flicker = 0.88 + 0.12 * Math.sin(this.ambientTime * 52 + nozzle.x);
      const glowR = radius * (1.85 + heat * 1.4) * flicker;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(nozzle.x, nozzle.y, 0, nozzle.x, nozzle.y, glowR);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
      grad.addColorStop(0.28, 'rgba(130, 238, 255, 0.86)');
      grad.addColorStop(0.58, 'rgba(232, 184, 75, 0.56)');
      grad.addColorStop(1, 'rgba(232, 136, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(nozzle.x, nozzle.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFDF7';
      ctx.beginPath();
      ctx.arc(nozzle.x, nozzle.y, Math.max(1.4, radius * 0.65), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawPodRearNozzle = (side: -1 | 1) => {
      const podNozzle = proj(side * 0.52, -0.02, -0.95);
      const podR = Math.max(2, scale * 0.115);
      ctx.save();
      ctx.fillStyle = '#1E2534';
      ctx.strokeStyle = '#DFB047';
      ctx.lineWidth = Math.max(1, scale * 0.024);
      ctx.beginPath();
      ctx.ellipse(podNozzle.x, podNozzle.y, podR * 1.1, podR * 0.95, bank, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawThrusterFlame(podNozzle, podR * 0.88, engineHeat * 0.82);
    };

    const drawMainRearNozzle = () => {
      const rearTopL = proj(-0.24, 0.17, -0.98);
      const rearTopR = proj(0.24, 0.17, -0.98);
      const rearMidL = proj(-0.3, -0.02, -0.99);
      const rearMidR = proj(0.3, -0.02, -0.99);
      const rearBotL = proj(-0.22, -0.17, -0.98);
      const rearBotR = proj(0.22, -0.17, -0.98);
      drawPoly(
        [rearTopL, rearTopR, rearMidR, rearBotR, rearBotL, rearMidL],
        '#202736',
        '#DFB047',
        Math.max(1.2, scale * 0.025)
      );

      // Brushed-gold inverted-U rear arch framing the central thruster
      const archL = proj(-0.2, -0.14, -1.01);
      const archTL = proj(-0.14, 0.15, -1.01);
      const archTR = proj(0.14, 0.15, -1.01);
      const archR = proj(0.2, -0.14, -1.01);
      ctx.strokeStyle = '#F3D372';
      ctx.lineWidth = Math.max(1.4, scale * 0.032);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(archL.x, archL.y);
      ctx.lineTo(archTL.x, archTL.y);
      ctx.lineTo(archTR.x, archTR.y);
      ctx.lineTo(archR.x, archR.y);
      ctx.stroke();

      const mainNozzle = proj(0, -0.02, -1.04);
      const mainR = Math.max(3, scale * 0.185);
      ctx.fillStyle = '#4A5264';
      ctx.strokeStyle = '#DFB047';
      ctx.lineWidth = Math.max(1.2, scale * 0.028);
      ctx.beginPath();
      ctx.ellipse(mainNozzle.x, mainNozzle.y, mainR * 1.12, mainR * 0.96, bank, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#141A24';
      ctx.beginPath();
      ctx.ellipse(mainNozzle.x, mainNozzle.y, mainR * 0.78, mainR * 0.66, bank, 0, Math.PI * 2);
      ctx.fill();

      drawThrusterFlame(mainNozzle, mainR * 1.12, engineHeat);
    };

    const drawWingAndPod = (side: -1 | 1) => {
      const hullLight = side > 0 ? '#EAE3D6' : '#DDD5C7';
      const hullMid = '#C8C0B2';
      const hullDark = '#8A909D';
      const goldMain = '#D6A53E';
      const goldBright = '#F4D478';

      const drawOuterWing = () => {
        // Trapezoidal swept wing with thick brushed-gold leading & outer tip cap
        const wRootF = proj(side * 0.64, 0.01, -0.2);
        const wRootR = proj(side * 0.64, -0.01, -0.84);
        const wTipR = proj(side * 1.38, -0.04, -0.82);
        const wTipF = proj(side * 1.33, -0.02, -0.54);

        const wBotRootF = proj(side * 0.64, -0.07, -0.22);
        const wBotRootR = proj(side * 0.64, -0.08, -0.84);
        const wBotTipR = proj(side * 1.38, -0.09, -0.82);
        const wBotTipF = proj(side * 1.33, -0.08, -0.54);

        // Wing edge thickness / underside bevel
        drawPoly([wRootF, wTipF, wBotTipF, wBotRootF], hullDark, goldMain, 1.0);
        drawPoly([wTipF, wTipR, wBotTipR, wBotTipF], goldMain, goldBright, 1.0);
        drawPoly([wRootR, wTipR, wBotTipR, wBotRootR], hullDark, goldMain, 1.0);

        // Cream upper wing panel
        drawPoly([wRootF, wTipF, wTipR, wRootR], hullLight, '#B58B34', 1.15);

        // Brushed-gold leading-edge & outer tip cap trim (matching PLAYER & PLAYER_FRONT)
        const trimInF = proj(side * 0.66, 0.015, -0.24);
        const trimTipF = proj(side * 1.24, -0.015, -0.53);
        const trimTipR = proj(side * 1.28, -0.035, -0.80);
        const trimOutR = proj(side * 1.38, -0.04, -0.82);
        const trimOutF = proj(side * 1.33, -0.02, -0.54);
        drawPoly([wRootF, trimOutF, trimOutR, trimTipR, trimTipF, trimInF], goldMain, goldBright, 0.9);
      };

      const drawNacellePod = () => {
        // Inner bridge strut connecting fuselage to nacelle pod
        const brInF = proj(side * 0.31, 0.06, -0.24);
        const brOutF = proj(side * 0.41, 0.06, -0.24);
        const brOutR = proj(side * 0.41, 0.04, -0.68);
        const brInR = proj(side * 0.31, 0.04, -0.68);
        drawPoly([brInF, brOutF, brOutR, brInR], hullMid, '#B58B34', 1.0);

        // Chunky faceted nacelle pod housing (front at z=+0.22, rear at z=-0.92)
        const pInTopF = proj(side * 0.39, 0.14, 0.20);
        const pOutTopF = proj(side * 0.65, 0.10, 0.14);
        const pOutBotF = proj(side * 0.65, -0.10, 0.14);
        const pInBotF = proj(side * 0.39, -0.13, 0.20);

        const pInTopR = proj(side * 0.39, 0.13, -0.91);
        const pOutTopR = proj(side * 0.65, 0.09, -0.89);
        const pOutBotR = proj(side * 0.65, -0.09, -0.89);
        const pInBotR = proj(side * 0.39, -0.12, -0.91);

        // Side outer pod flank
        drawPoly([pOutTopF, pOutTopR, pOutBotR, pOutBotF], hullMid, '#B58B34', 1.1);
        // Inner pod flank
        drawPoly([pInTopF, pInTopR, pInBotR, pInBotF], hullDark, '#9A762B', 0.95);
        // Cream upper pod deck
        drawPoly([pInTopF, pOutTopF, pOutTopR, pInTopR], hullLight, '#C4963A', 1.15);

        // Brushed-gold front intake bevel & rear trim collar on pod
        const trimF1 = proj(side * 0.40, 0.145, 0.20);
        const trimF2 = proj(side * 0.65, 0.105, 0.14);
        const trimF3 = proj(side * 0.65, 0.10, 0.05);
        const trimF4 = proj(side * 0.40, 0.14, 0.10);
        drawPoly([trimF1, trimF2, trimF3, trimF4], goldMain, goldBright, 0.9);

        // Forward circular recessed turbine intake (visible from front/side views)
        if (cosY > -0.22) {
          drawPoly([pInTopF, pOutTopF, pOutBotF, pInBotF], '#242B38', goldMain, 1.3);
          const inCenter = proj(side * 0.52, 0.0, 0.17);
          const inR = Math.max(2, scale * 0.095);
          ctx.fillStyle = '#121720';
          ctx.strokeStyle = '#6B7484';
          ctx.lineWidth = Math.max(1, scale * 0.02);
          ctx.beginPath();
          ctx.ellipse(inCenter.x, inCenter.y, inR * 0.95, inR * 0.85, bank, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#D6A53E';
          ctx.beginPath();
          ctx.arc(inCenter.x, inCenter.y, Math.max(1.2, inR * 0.25), 0, Math.PI * 2);
          ctx.fill();
        }
      };

      // Depth-sort outer wing vs nacelle pod relative to camera angle
      const wingDepth = proj(side * 1.0, 0, -0.55).z;
      const podDepth = proj(side * 0.52, 0, -0.35).z;
      if (wingDepth < podDepth) {
        drawOuterWing();
        drawNacellePod();
      } else {
        drawNacellePod();
        drawOuterWing();
      }

      if (cosY < 0.28) {
        drawPodRearNozzle(side);
      }
    };

    const drawFuselage = () => {
      const hullSun = '#F0EAE0';
      const hullMid = '#DFD7C8';
      const hullFlank = '#C5BDB0';
      const hullBelly = '#7B8290';
      const goldMain = '#D6A53E';
      const goldBright = '#F5D67B';
      const crimsonMain = '#BC4A3C';

      // Fuselage hull stations from ogive nose (+1.54) to rear bulkhead (-0.98)
      const noseTip = proj(0, -0.02, 1.54);

      const nCapL = proj(-0.13, 0.04, 1.32);
      const nCapR = proj(0.13, 0.04, 1.32);
      const nCapBL = proj(-0.12, -0.10, 1.30);
      const nCapBR = proj(0.12, -0.10, 1.30);

      const midL = proj(-0.24, 0.12, 0.90);
      const midR = proj(0.24, 0.12, 0.90);
      const midBL = proj(-0.23, -0.16, 0.88);
      const midBR = proj(0.23, -0.16, 0.88);

      const fwdL = proj(-0.31, 0.18, 0.46);
      const fwdR = proj(0.31, 0.18, 0.46);
      const fwdBL = proj(-0.30, -0.20, 0.45);
      const fwdBR = proj(0.30, -0.20, 0.45);

      const cMidL = proj(-0.35, 0.21, 0.02);
      const cMidR = proj(0.35, 0.21, 0.02);
      const cMidBL = proj(-0.34, -0.21, 0.02);
      const cMidBR = proj(0.34, -0.21, 0.02);

      const cRearL = proj(-0.35, 0.23, -0.34);
      const cRearR = proj(0.35, 0.23, -0.34);
      const cRearBL = proj(-0.33, -0.20, -0.34);
      const cRearBR = proj(0.33, -0.20, -0.34);

      const tailL = proj(-0.30, 0.19, -0.98);
      const tailR = proj(0.30, 0.19, -0.98);
      const tailBL = proj(-0.26, -0.17, -0.98);
      const tailBR = proj(0.26, -0.17, -0.98);

      // 1. Shaded underside belly plate
      drawPoly(
        [noseTip, nCapBL, midBL, fwdBL, cMidBL, cRearBL, tailBL, tailBR, cRearBR, cMidBR, fwdBR, midBR, nCapBR],
        hullBelly,
        '#9A762B',
        0.95
      );

      // 2. Camera-facing lateral fuselage flank & gold shoulder rail
      if (sinY <= 0) {
        drawPoly(
          [noseTip, nCapL, midL, fwdL, cMidL, cRearL, tailL, tailBL, cRearBL, cMidBL, fwdBL, midBL, nCapBL],
          hullFlank,
          '#B48B34',
          1.05
        );
        // Brushed-gold lateral waist rail (matches title art!)
        const rail1 = proj(-0.28, 0.10, 0.50);
        const rail2 = proj(-0.35, 0.11, -0.36);
        const rail3 = proj(-0.34, 0.03, -0.36);
        const rail4 = proj(-0.28, 0.03, 0.50);
        drawPoly([rail1, rail2, rail3, rail4], goldMain, goldBright, 0.85);
      } else {
        drawPoly(
          [noseTip, nCapR, midR, fwdR, cMidR, cRearR, tailR, tailBR, cRearBR, cMidBR, fwdBR, midBR, nCapBR],
          hullFlank,
          '#B48B34',
          1.05
        );
        const rail1 = proj(0.28, 0.10, 0.50);
        const rail2 = proj(0.35, 0.11, -0.36);
        const rail3 = proj(0.34, 0.03, -0.36);
        const rail4 = proj(0.28, 0.03, 0.50);
        drawPoly([rail1, rail2, rail3, rail4], goldMain, goldBright, 0.85);
      }

      // 3. Upper cream/ivory hull deck
      drawPoly(
        [noseTip, nCapL, midL, fwdL, cMidL, cRearL, tailL, tailR, cRearR, cMidR, fwdR, midR, nCapR],
        hullSun,
        '#D1A23D',
        1.25
      );

      // Brushed-gold nose tip cap & curved nose collar
      drawPoly([noseTip, nCapL, proj(0, 0.07, 1.34), nCapR], goldMain, goldBright, 1.0);
      const collarL = proj(-0.16, 0.07, 1.24);
      const collarC = proj(0, 0.11, 1.28);
      const collarR = proj(0.16, 0.07, 1.24);
      ctx.strokeStyle = goldMain;
      ctx.lineWidth = Math.max(1.5, scale * 0.034);
      ctx.beginPath();
      ctx.moveTo(collarL.x, collarL.y);
      ctx.quadraticCurveTo(collarC.x, collarC.y, collarR.x, collarR.y);
      ctx.stroke();

      // Forward twin rust-crimson racing stripes (separated by thin cream pinstripe)
      const fSt1A = proj(-0.115, 0.105, 1.22);
      const fSt1B = proj(-0.024, 0.115, 1.24);
      const fSt1C = proj(-0.024, 0.19, 0.52);
      const fSt1D = proj(-0.135, 0.185, 0.52);
      drawPoly([fSt1A, fSt1B, fSt1C, fSt1D], crimsonMain);

      const fSt2A = proj(0.024, 0.115, 1.24);
      const fSt2B = proj(0.115, 0.105, 1.22);
      const fSt2C = proj(0.135, 0.185, 0.52);
      const fSt2D = proj(0.024, 0.19, 0.52);
      drawPoly([fSt2A, fSt2B, fSt2C, fSt2D], crimsonMain);

      // Iconic curved gold collar band right in front of canopy
      const preCanL = proj(-0.30, 0.18, 0.48);
      const preCanC = proj(0, 0.215, 0.54);
      const preCanR = proj(0.30, 0.18, 0.48);
      ctx.strokeStyle = goldMain;
      ctx.lineWidth = Math.max(1.6, scale * 0.038);
      ctx.beginPath();
      ctx.moveTo(preCanL.x, preCanL.y);
      ctx.quadraticCurveTo(preCanC.x, preCanC.y, preCanR.x, preCanR.y);
      ctx.stroke();

      const drawAmberCanopy = () => {
        // Translucent warm amber-bronze bubble canopy matching title art
        const baseF = proj(0, 0.21, 0.43);
        const baseFL = proj(-0.18, 0.21, 0.28);
        const baseL = proj(-0.22, 0.22, -0.02);
        const baseRL = proj(-0.18, 0.23, -0.26);
        const baseR0 = proj(0, 0.24, -0.30);
        const baseRR = proj(0.18, 0.23, -0.26);
        const baseR = proj(0.22, 0.22, -0.02);
        const baseFR = proj(0.18, 0.21, 0.28);

        const domeF = proj(0, 0.31, 0.25);
        const domeApex = proj(0, 0.44, 0.02);
        const domeB = proj(0, 0.37, -0.22);
        const domeL = proj(-0.14, 0.36, -0.02);
        const domeR = proj(0.14, 0.36, -0.02);

        // Outer translucent amber glass envelope
        const glassGrad = ctx.createLinearGradient(domeL.x, domeApex.y, domeR.x, baseF.y);
        glassGrad.addColorStop(0, '#D48638');
        glassGrad.addColorStop(0.45, '#8E4E1E');
        glassGrad.addColorStop(1, '#3B1E0D');
        drawPoly([baseF, baseFL, domeL, domeB, baseR0, domeR, baseFR], glassGrad);
        drawPoly([baseF, baseFL, baseL, baseRL, baseR0, baseRR, baseR, baseFR], glassGrad);
        drawPoly([baseFL, baseL, domeB, domeApex, domeF], '#A65E26');
        drawPoly([baseF, domeF, domeApex, domeR, baseFR], '#733D18');
        drawPoly([domeApex, domeB, baseRL, baseL], '#5B2E11');
        drawPoly([domeApex, domeB, baseRR, baseR], '#4D260E');

        // Subtle interior pilot headrest & console silhouette visible through amber glass
        const seatTopL = proj(-0.07, 0.33, -0.10);
        const seatTopR = proj(0.07, 0.33, -0.10);
        const seatBotR = proj(0.09, 0.24, -0.12);
        const seatBotL = proj(-0.09, 0.24, -0.12);
        drawPoly([seatTopL, seatTopR, seatBotR, seatBotL], 'rgba(182, 102, 42, 0.65)', 'rgba(62, 30, 12, 0.5)', 0.9);

        // Specular sunlight + hyperspace sheen on canopy dome
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const sheenGrad = ctx.createRadialGradient(
          domeF.x,
          domeApex.y,
          1,
          domeApex.x,
          domeApex.y,
          Math.max(4, scale * 0.24)
        );
        sheenGrad.addColorStop(0, 'rgba(255, 245, 224, 0.72)');
        sheenGrad.addColorStop(0.45, 'rgba(240, 172, 255, 0.34)');
        sheenGrad.addColorStop(1, 'rgba(232, 184, 75, 0)');
        ctx.fillStyle = sheenGrad;
        ctx.beginPath();
        ctx.ellipse(
          (domeF.x + domeApex.x) * 0.5,
          (domeF.y + domeApex.y) * 0.5,
          Math.max(3, scale * 0.14),
          Math.max(2, scale * 0.075),
          -0.45,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.restore();

        // Rounded brushed-gold canopy bezel & rear roll-bar arch
        ctx.strokeStyle = goldMain;
        ctx.lineWidth = Math.max(1.6, scale * 0.042);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(baseF.x, baseF.y);
        ctx.lineTo(baseFL.x, baseFL.y);
        ctx.lineTo(baseL.x, baseL.y);
        ctx.lineTo(baseRL.x, baseRL.y);
        ctx.lineTo(baseR0.x, baseR0.y);
        ctx.lineTo(baseRR.x, baseRR.y);
        ctx.lineTo(baseR.x, baseR.y);
        ctx.lineTo(baseFR.x, baseFR.y);
        ctx.closePath();
        ctx.stroke();

        // Canopy rear structural gold arch hoop
        ctx.strokeStyle = goldBright;
        ctx.lineWidth = Math.max(1.2, scale * 0.028);
        ctx.beginPath();
        ctx.moveTo(baseL.x, baseL.y);
        ctx.quadraticCurveTo(domeB.x, domeB.y - scale * 0.04, baseR.x, baseR.y);
        ctx.stroke();
      };

      const drawRearTurtleback = () => {
        // Raised chamfered dorsal spine behind canopy (NO tall airplane tail fin)
        const tbFL = proj(-0.24, 0.27, -0.34);
        const tbFR = proj(0.24, 0.27, -0.34);
        const tbRL = proj(-0.22, 0.21, -0.96);
        const tbRR = proj(0.22, 0.21, -0.96);
        const tbCollarC = proj(0, 0.30, -0.32);

        // Side bevels of dorsal spine
        drawPoly([cRearL, tbFL, tbRL, tailL], hullMid, '#B58B34', 1.0);
        drawPoly([cRearR, tbFR, tbRR, tailR], hullMid, '#B58B34', 1.0);
        // Top turtleback deck
        drawPoly([tbFL, tbCollarC, tbFR, tbRR, tbRL], hullSun, goldMain, 1.2);

        // Rear twin rust-crimson racing stripes
        const rSt1A = proj(-0.11, 0.275, -0.38);
        const rSt1B = proj(-0.024, 0.275, -0.38);
        const rSt1C = proj(-0.024, 0.215, -0.95);
        const rSt1D = proj(-0.105, 0.215, -0.95);
        drawPoly([rSt1A, rSt1B, rSt1C, rSt1D], crimsonMain);

        const rSt2A = proj(0.024, 0.275, -0.38);
        const rSt2B = proj(0.11, 0.275, -0.38);
        const rSt2C = proj(0.105, 0.215, -0.95);
        const rSt2D = proj(0.024, 0.215, -0.95);
        drawPoly([rSt2A, rSt2B, rSt2C, rSt2D], crimsonMain);

        // Brushed-gold arch behind canopy collar
        ctx.strokeStyle = goldMain;
        ctx.lineWidth = Math.max(1.6, scale * 0.038);
        ctx.beginPath();
        ctx.moveTo(tbFL.x, tbFL.y);
        ctx.quadraticCurveTo(tbCollarC.x, tbCollarC.y, tbFR.x, tbFR.y);
        ctx.stroke();
      };

      // Proper 3D occlusion between amber canopy dome & raised rear turtleback
      if (cosY < -0.35) {
        drawAmberCanopy();
        drawRearTurtleback();
      } else {
        drawRearTurtleback();
        drawAmberCanopy();
      }

      if (cosY < 0.22) {
        drawMainRearNozzle();
      }
    };

    // Depth-order far wing/pod -> fuselage -> near wing/pod based on camera yaw side
    if (sinY <= 0) {
      drawWingAndPod(1);
      drawFuselage();
      drawWingAndPod(-1);
    } else {
      drawWingAndPod(-1);
      drawFuselage();
      drawWingAndPod(1);
    }
  }

  private renderLetterbox(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const inEase = 1 - Math.pow(1 - Math.min(1, t / 0.42), 3);
    const outRaw = Math.min(1, Math.max(0, (t - (this.cutsceneDuration - 0.42)) / 0.42));
    const outEase =
      1 - (outRaw < 0.5 ? 4 * outRaw * outRaw * outRaw : 1 - Math.pow(-2 * outRaw + 2, 3) / 2);
    const barH = Math.min(h * 0.11, 64) * inEase * outEase;
    if (barH <= 0.5) return;

    ctx.fillStyle = '#04070E';
    ctx.fillRect(0, 0, w, barH);
    ctx.fillRect(0, h - barH, w, barH);

    ctx.strokeStyle = 'rgba(232, 184, 75, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, barH);
    ctx.lineTo(w, barH);
    ctx.moveTo(0, h - barH);
    ctx.lineTo(w, h - barH);
    ctx.stroke();
  }
}
