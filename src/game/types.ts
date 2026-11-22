export type GameState = 'TITLE_MENU' | 'INTRO_CUTSCENE' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export type EnemyType = 'SCOUT' | 'STRIKER' | 'BASTION' | 'SPLITTER' | 'MINI_SCOUT';

export type ParticleKind = 'spark' | 'shard' | 'smoke' | 'star' | 'arc';

export interface HudSnapshot {
  state: GameState;
  score: number;
  highScore: number;
  combo: number;
  comboTimerRatio: number; // 0..1
  wave: number;
  hp: number;
  maxHp: number;
  overdriveRatio: number; // 0..1
  overdriveActive: boolean;
  dashReadyRatio: number; // 0..1
  kills: number;
  maxCombo: number;
  waveBanner: string | null;
  newRecord: boolean;
  damageFlashRatio: number; // 0..1
  damagePulseId: number;
  repairAnimRatio: number; // 0..1
  repairPulseId: number;
  overdrivePulseId: number;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  hitFlash: number;
  aiState: 'APPROACH' | 'WINDUP' | 'ACTION' | 'COOLDOWN';
  aiTimer: number;
  targetAngle: number;
  spin: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  fromPlayer: boolean;
  life: number;
  color: string;
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  value: number;
  kind: 'overdrive' | 'repair';
}

export interface Particle {
  active: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  growth: number;
  angle: number;
  vAngle: number;
  life: number;
  maxLife: number;
  color: string;
  drag: number;
}

export interface Shockwave {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  lineWidth: number;
  astrolabe: boolean;
  rotation: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  depth: number;
  alpha: number;
  twinklePhase: number;
}

export interface GameplaySettings {
  screenShake: number;
  offscreenIndicators: boolean;
  cockpitDamageFx: boolean;
}

export const DEFAULT_GAMEPLAY_SETTINGS: GameplaySettings = {
  screenShake: 1,
  offscreenIndicators: true,
  cockpitDamageFx: true,
};

