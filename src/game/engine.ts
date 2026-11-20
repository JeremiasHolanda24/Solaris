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
  PLAYER_FRONT: '/src/assets/images/solaris_cockpit_closeup_1795192258826.jpg',
  SCOUT: '/src/assets/images/solaris_enemy_scout_1795181299986.jpg',
  STRIKER: '/src/assets/images/solaris_enemy_striker_1795181300757.jpg',
  BASTION: '/src/assets/images/solaris_enemy_bastion_1795181300327.jpg',
  SPLITTER: '/src/assets/images/solaris_enemy_splitter_1795181300379.jpg',
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

  // Juice
  private hitstopTimer = 0;
  private shakeIntensity = 0;
  private shakePhase = 0;
  private damageFlashTimer = 0;
  private readonly damageFlashDuration = 0.38;
  private damagePulseId = 0;
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

  constructor(
    canvas: HTMLCanvasElement,
    audio: GameAudio,
    onHudUpdate: (snapshot: HudSnapshot) => void
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = context;
    this.audio = audio;
    this.onHudUpdate = onHudUpdate;

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

      // Auto-detect background color from top-left corner (supports pure black or pure white backdrops)
      const bgR = data[0];
      const bgG = data[1];
      const bgB = data[2];
      const isLightBg = bgR > 200 && bgG > 200 && bgB > 200;
      const threshold = key === 'PLAYER_FRONT' ? 12 : isLightBg ? 46 : 30;

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
        // For PLAYER_FRONT, avoid seeding inside the dark lower-right wing intake cavity on the right edge
        if (key === 'PLAYER_FRONT' && y >= outH * 0.53 && y <= outH * 0.78) {
          continue;
        }
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
    this.state = 'PLAYING';
    this.score = 0;
    this.newRecord = false;
    this.combo = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.wave = 1;
    this.kills = 0;
    this.hitstopTimer = 0;
    this.shakeIntensity = 0;
    this.damageFlashTimer = 0;

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

    this.prepareWave(1);
    this.spawnShockwave(this.player.x, this.player.y, 120, PALETTE.brass, 2.5, 0.45, true);
    this.emitHud();
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
    this.state = 'TITLE_MENU';
    this.playerDying = false;
    this.playerDetonated = false;
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

  private spawnSpark(x: number, y: number, vx: number, vy: number, life: number, value: number): void {
    const s = this.freeSparks.pop();
    if (!s) return;
    s.x = x;
    s.y = y;
    s.vx = vx;
    s.vy = vy;
    s.life = life;
    s.value = value;
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

    const padX = Math.min(36, this.width * 0.2);
    const padY = Math.min(36, this.height * 0.2);
    this.player.x = Math.min(Math.max(this.player.x, padX), Math.max(padX, this.width - padX));
    this.player.y = Math.min(Math.max(this.player.y, padY), Math.max(padY, this.height - padY));
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
      if (this.state === 'PLAYING' || this.state === 'PAUSED') {
        this.togglePause();
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

  private prepareWave(waveNum: number): void {
    this.wave = waveNum;
    const queue: EnemyType[] = [];
    const totalCount = 5 + waveNum * 3;

    for (let i = 0; i < totalCount; i++) {
      const r = Math.random();
      if (waveNum === 1) {
        queue.push(r < 0.78 ? 'SCOUT' : 'STRIKER');
      } else if (waveNum === 2) {
        if (r < 0.5) queue.push('SCOUT');
        else if (r < 0.82) queue.push('STRIKER');
        else queue.push('BASTION');
      } else {
        if (r < 0.36) queue.push('SCOUT');
        else if (r < 0.62) queue.push('STRIKER');
        else if (r < 0.84) queue.push('BASTION');
        else queue.push('SPLITTER');
      }
    }

    this.waveSpawnQueue = queue;
    this.spawnTimer = 0.65;
    this.waveBanner = `Onda ${waveNum}`;
    this.waveBannerTimer = 1.9;
    this.emitHud();
  }

  private spawnEnemy(type: EnemyType, overrideX?: number, overrideY?: number): void {
    let x = overrideX ?? 0;
    let y = overrideY ?? 0;

    if (overrideX === undefined || overrideY === undefined) {
      const margin = 92;
      const side = Math.floor(Math.random() * 4);
      if (side === 0) {
        x = Math.random() * this.width;
        y = -margin;
      } else if (side === 1) {
        x = this.width + margin;
        y = Math.random() * this.height;
      } else if (side === 2) {
        x = Math.random() * this.width;
        y = this.height + margin;
      } else {
        x = -margin;
        y = Math.random() * this.height;
      }
    }

    const hpScale = 1 + Math.floor((this.wave - 1) / 3);
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
        hp = 3 + Math.floor((hpScale - 1) * 0.6);
        break;
      case 'BASTION':
        radius = 25;
        hp = 6 + hpScale;
        break;
      case 'SPLITTER':
        radius = 21;
        hp = 4 + Math.floor(hpScale * 0.7);
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

    const pad = 26;
    if (p.x < pad) {
      p.x = pad;
      p.vx = Math.max(0, p.vx);
    } else if (p.x > this.width - pad) {
      p.x = this.width - pad;
      p.vx = Math.min(0, p.vx);
    }
    if (p.y < pad) {
      p.y = pad;
      p.vy = Math.max(0, p.vy);
    } else if (p.y > this.height - pad) {
      p.y = this.height - pad;
      p.vy = Math.min(0, p.vy);
    }

    // Aiming: right touch stick > mouse cursor > movement direction
    if (this.aimTouch && (this.aimTouch.dx !== 0 || this.aimTouch.dy !== 0)) {
      p.angle = Math.atan2(this.aimTouch.dy, this.aimTouch.dx);
    } else if (this.mouseMovedRecently) {
      p.angle = Math.atan2(this.mouseY - p.y, this.mouseX - p.x);
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
        const baseInterval = Math.max(0.38, 1.05 - this.wave * 0.065);
        this.spawnTimer = baseInterval * (0.75 + Math.random() * 0.45);
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
    const speedMult = 1 + Math.min(0.65, (this.wave - 1) * 0.055);

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
            e.aiTimer = 0.65;
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
            const lungeSpeed = 560 * Math.min(1.25, speedMult);
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
            e.aiTimer = 0.75;
          }
        } else {
          e.vx *= Math.pow(0.04, dt);
          e.vy *= Math.pow(0.04, dt);
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            e.aiState = 'APPROACH';
            e.aiTimer = 1.2 + Math.random() * 0.8;
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
            e.aiTimer = 0.8;
            this.audio.playTelegraph();
          }
        } else if (e.aiState === 'WINDUP') {
          e.aiTimer -= dt;
          if (e.aiTimer <= 0) {
            const orbSpeed = 245 * Math.min(1.25, speedMult);
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
            e.aiTimer = 2.2 + Math.random() * 0.9;
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
        b.x < -40 ||
        b.x > this.width + 40 ||
        b.y < -40 ||
        b.y > this.height + 40
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
      this.spawnSpark(ex, ey, Math.cos(a) * spd, Math.sin(a) * spd, 8.0, 15);
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

      if (dist < 185) {
        const pull = (1 - dist / 185) * 1450;
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
        this.releaseSparkAt(i);
        this.combo = Math.min(8, this.combo + 1);
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.comboTimer = this.comboDuration;
        this.addScore(val);
        this.audio.playSparkPickup(this.combo);

        if (p.overdriveTimer <= 0) {
          p.overdriveCharge = Math.min(100, p.overdriveCharge + 7.5);
          if (p.overdriveCharge >= 100) {
            this.activateOverdrive();
          }
        }
      }
    }
  }

  private activateOverdrive(): void {
    const p = this.player;
    p.overdriveTimer = p.overdriveDuration;
    p.overdriveCharge = 100;
    this.audio.playOverdrive();
    this.vibrate([18, 28, 18]);
    this.shakeIntensity = Math.max(this.shakeIntensity, 9);
    this.spawnShockwave(p.x, p.y, 260, PALETTE.brass, 3.5, 0.5, true);
    this.spawnBurst(p.x, p.y, 26, PALETTE.brass, 290, 3.4);

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
      if (d < 280) {
        e.vx += (dx / d) * 320;
        e.vy += (dy / d) * 320;
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

    this.renderBackdrop(ctx, w, h);

    this.renderSparks(ctx);
    this.renderEnemies(ctx);
    this.renderBullets(ctx);
    if (this.player.hp > 0 || (this.playerDying && !this.playerDetonated)) {
      this.renderPlayer(ctx);
    }
    this.renderParticlesAndWaves(ctx);
    this.renderFloatingTexts(ctx);

    if (this.state === 'PLAYING' && !this.playerDying) {
      if (this.showOffscreenIndicators) {
        this.renderOffscreenIndicators(ctx, w, h);
      }
      if (this.mouseMovedRecently && !this.touchMode) {
        this.renderReticle(ctx);
      }
      if (this.moveTouch || this.aimTouch) {
        this.renderTouchSticks(ctx);
      }
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
    const offsetX = (this.player.x - w * 0.5) * 0.04;
    const offsetY = (this.player.y - h * 0.5) * 0.04;

    for (const star of this.stars) {
      const sx = ((star.x * w - offsetX * star.depth) % w + w) % w;
      const sy = ((star.y * h - offsetY * star.depth) % h + h) % h;
      const twinkle = 0.72 + 0.28 * Math.sin(this.ambientTime * 1.8 + star.twinklePhase);
      ctx.fillStyle = `rgba(244, 239, 230, ${(star.alpha * twinkle).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
    }

    const cx = w * 0.5 - offsetX * 0.35;
    const cy = h * 0.5 - offsetY * 0.35;
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);

    ctx.save();
    ctx.translate(cx, cy);

    // Wide outer astrolabe meridian ring & equatorial axis for landscape viewports
    if (w > h * 1.15) {
      ctx.strokeStyle = 'rgba(232, 184, 75, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, maxDim * 0.36, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle horizontal equatorial axis spanning the widescreen arena
      const axisSpan = w * 0.44;
      const innerGap = minDim * 0.4;
      if (axisSpan > innerGap + 24) {
        ctx.strokeStyle = 'rgba(232, 184, 75, 0.065)';
        ctx.beginPath();
        ctx.moveTo(-axisSpan, 0);
        ctx.lineTo(-innerGap, 0);
        ctx.moveTo(innerGap, 0);
        ctx.lineTo(axisSpan, 0);
        ctx.stroke();

        // Small astrolabe graduation ticks along the horizontal wings
        const tickOffsets = [innerGap + (axisSpan - innerGap) * 0.45, axisSpan];
        for (const tx of tickOffsets) {
          ctx.beginPath();
          ctx.moveTo(-tx, -5);
          ctx.lineTo(-tx, 5);
          ctx.moveTo(tx, -5);
          ctx.lineTo(tx, 5);
          ctx.stroke();
        }
      }
    }

    ctx.strokeStyle = 'rgba(232, 184, 75, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, minDim * 0.38, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.rotate(this.ambientTime * 0.05);
    ctx.strokeStyle = 'rgba(232, 184, 75, 0.075)';
    ctx.setLineDash([6, 14]);
    ctx.beginPath();
    ctx.arc(0, 0, minDim * 0.26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (minDim * 0.245), Math.sin(a) * (minDim * 0.245));
      ctx.lineTo(Math.cos(a) * (minDim * 0.275), Math.sin(a) * (minDim * 0.275));
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(232, 184, 75, 0.05)';
    ctx.beginPath();
    ctx.arc(0, 0, minDim * 0.12, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private renderTitleWarpJump(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const t = this.ambientTime;
    const minDim = Math.min(w, h);
    const maxRadius = Math.hypot(w, h) * 1.15;

    // Ship dimensions & anchored right-edge framing (kept unchanged)
    const frontPair = this.sprites.PLAYER_FRONT;
    const imgAspect = frontPair ? frontPair.normal.width / frontPair.normal.height : 4 / 3;
    const shipH = Math.min(h * 0.94, w * 0.54);
    const shipW = shipH * imgAspect;
    const bobX = Math.sin(t * 1.5) * 5.5 + Math.cos(t * 3.7) * 1.6;
    const bobY = Math.cos(t * 2.0) * 7 + Math.sin(t * 4.9) * 1.4;
    const pitchMicro = Math.sin(t * 1.2) * 0.02 + Math.cos(t * 3.1) * 0.005;
    const breathScale = 1 + Math.sin(t * 2.6) * 0.01;

    const shipCenterX = w - shipW * 0.44 + bobX;
    const shipCenterY = h * 0.52 + bobY;

    // Exact measured ship fuselage centerline vector from artwork (nose lower-left -> tail upper-right = -37.5 deg)
    // Coupled live to pitchMicro so warp lines stay 100% locked to the ship's current heading vector
    const baseFuselageAngle = -0.655;
    const axisAngle = baseFuselageAngle + pitchMicro;
    const axisCos = Math.cos(axisAngle); // backward along fuselage (toward upper-right)
    const axisSin = Math.sin(axisAngle);

    // Exact nose tip in screen space (measured from artwork at [-0.42 * shipW, +0.40 * shipH])
    const cosP = Math.cos(pitchMicro);
    const sinP = Math.sin(pitchMicro);
    const localNoseX = -0.42 * shipW * breathScale;
    const localNoseY = 0.4 * shipH * breathScale;
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

    // 5. Background speed streaks rushing past behind the Solaris ship
    renderRadialWarpStreaks(false);

    // 6. Solaris Ship — Dramatic 3/4 Front-Side Close-Up + Live Warp Reflections on the Cockpit Canopy Glass
    ctx.save();
    ctx.translate(shipCenterX, shipCenterY);
    ctx.rotate(pitchMicro);
    ctx.scale(breathScale, breathScale);

    // Subtle cosmic warp light reflection across the nose & cockpit side
    const rimHalo = ctx.createRadialGradient(-shipW * 0.3, shipH * 0.22, shipH * 0.04, -shipW * 0.1, shipH * 0.08, shipW * 0.72);
    rimHalo.addColorStop(0, `rgba(248, ${Math.round(165 + 55 * goldPhase)}, 235, 0.34)`);
    rimHalo.addColorStop(0.45, 'rgba(232, 184, 75, 0.16)');
    rimHalo.addColorStop(1, 'rgba(11, 19, 32, 0)');
    ctx.fillStyle = rimHalo;
    ctx.beginPath();
    ctx.arc(-shipW * 0.1, shipH * 0.08, shipW * 0.72, 0, Math.PI * 2);
    ctx.fill();

    if (frontPair) {
      ctx.drawImage(frontPair.normal, -shipW / 2, -shipH / 2, shipW, shipH);

      // 6b. Live Hyperspace Warp Reflections clipped strictly to the full curved cockpit canopy glass (including upper dome)
      ctx.save();
      ctx.beginPath();
      // Full curved dome silhouette of the Solaris glass canopy in ship-centered coordinates
      ctx.moveTo(-0.045 * shipW, -0.115 * shipH);
      ctx.bezierCurveTo(
        0.025 * shipW, -0.295 * shipH,
        0.165 * shipW, -0.355 * shipH,
        0.282 * shipW, -0.255 * shipH
      );
      ctx.bezierCurveTo(
        0.312 * shipW, -0.205 * shipH,
        0.302 * shipW, -0.13 * shipH,
        0.245 * shipW, -0.075 * shipH
      );
      ctx.bezierCurveTo(
        0.145 * shipW, -0.012 * shipH,
        0.015 * shipW, -0.025 * shipH,
        -0.045 * shipW, -0.115 * shipH
      );
      ctx.closePath();
      ctx.clip();

      ctx.globalCompositeOperation = 'screen';

      // Shifting cosmic nebula sheen reflected across the ENTIRE curved dome (especially bright on the upper crest)
      const upperReflGrad = ctx.createRadialGradient(
        0.09 * shipW, -0.26 * shipH, shipH * 0.015,
        0.13 * shipW, -0.19 * shipH, shipW * 0.26
      );
      upperReflGrad.addColorStop(
        0,
        `rgba(255, ${Math.round(215 + 35 * goldPhase)}, ${Math.round(238 + 17 * magentaPhase)}, 0.56)`
      );
      upperReflGrad.addColorStop(
        0.45,
        `rgba(${Math.round(215 + 35 * crimsonPhase)}, ${Math.round(115 + 65 * goldPhase)}, ${Math.round(235 - 45 * crimsonPhase)}, 0.34)`
      );
      upperReflGrad.addColorStop(0.85, 'rgba(104, 214, 220, 0.14)');
      upperReflGrad.addColorStop(1, 'rgba(11, 19, 32, 0)');
      ctx.fillStyle = upperReflGrad;
      ctx.fillRect(-0.08 * shipW, -0.38 * shipH, 0.44 * shipW, 0.38 * shipH);

      // Animated warp light streaks gliding backward across both upper & lower halves of the curved glass
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const localCos = Math.cos(baseFuselageAngle);
      const localSin = Math.sin(baseFuselageAngle);
      const localPerpX = -localSin;
      const localPerpY = localCos;
      const canopyCenterX = 0.13 * shipW;
      const canopyCenterY = -0.185 * shipH;

      for (let r = 0; r < 12; r++) {
        const speed = 1.45 + (r % 4) * 0.52;
        const p = (t * speed + r * 0.23) % 1;
        const along = (p - 0.5) * shipW * 0.44;
        const across = ((r / 11) - 0.5) * shipH * 0.28;
        const len = shipW * (0.08 + (r % 3) * 0.042);

        const sx = canopyCenterX + localCos * along + localPerpX * across;
        const sy = canopyCenterY + localSin * along + localPerpY * across;
        const ex = sx + localCos * len;
        const ey = sy + localSin * len;

        // Parabolic curve mimicking reflections bending over the convex glass dome
        const midX = (sx + ex) * 0.5 + localPerpX * (across * 0.26);
        const midY = (sy + ey) * 0.5 + localPerpY * (across * 0.26);

        const fade = Math.sin(p * Math.PI);
        const streakAlpha = fade * (r % 3 === 0 ? 0.58 : 0.4);
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
        ctx.lineWidth = r % 3 === 0 ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(midX, midY, ex, ey);
        ctx.stroke();
      }

      // Crisp upper-crest Fresnel highlight rim along the full top arch of the curved glass canopy
      ctx.globalAlpha = 0.44 + 0.14 * Math.sin(t * 5.2);
      ctx.strokeStyle = '#FFF7E8';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-0.028 * shipW, -0.135 * shipH);
      ctx.bezierCurveTo(
        0.045 * shipW, -0.275 * shipH,
        0.165 * shipW, -0.325 * shipH,
        0.265 * shipW, -0.245 * shipH
      );
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();

    // 7. Subtle foreground warp streaks passing in front of the scene (low alpha so they never cut harshly through the hull)
    ctx.save();
    ctx.globalAlpha = 0.42;
    renderRadialWarpStreaks(true);
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
      const pulse = 1 + Math.sin(this.ambientTime * 16) * 0.08;
      ctx.strokeStyle = 'rgba(255, 123, 102, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 27 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.rotate(p.angle);
    ctx.translate(-p.recoil * 3.5, 0);
    ctx.scale(p.scaleX, p.scaleY);

    if (blink) {
      ctx.globalAlpha = 0.45;
    }

    this.drawShipHull(ctx, p.overdriveTimer > 0 || dying, dying ? 0.3 : p.dashTimer > 0 ? 1.4 : 1, dyingFlash);
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
      ctx.rotate(this.ambientTime * 4);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE.brass;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 0);
      ctx.lineTo(0, 6);
      ctx.lineTo(-4.5, 0);
      ctx.closePath();
      ctx.fill();
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

    for (const e of this.enemies) {
      // Only show for enemies outside (or just breaching) the visible screen bounds
      if (e.x >= 8 && e.x <= w - 8 && e.y >= 8 && e.y <= h - 8) continue;

      const ix = Math.max(padX, Math.min(w - padX, e.x));
      const iy = Math.max(padY, Math.min(h - padY, e.y));
      const dx = e.x - ix;
      const dy = e.y - iy;
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
}
