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
  hullHealProgress: number; // 0..1
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

export interface TouchPoint {
  x: number;
  y: number;
}

export interface MobileControlSettings {
  movePos: TouchPoint;
  aimPos: TouchPoint;
  dashPos: TouchPoint;
  stickScale: number; // 0.65..1.45
  dashScale: number; // 0.75..1.45
  fixedSticks: boolean;
  opacity: number; // 0.35..1.0
}

export const DEFAULT_MOBILE_CONTROL_SETTINGS: MobileControlSettings = {
  movePos: { x: 0.16, y: 0.72 },
  aimPos: { x: 0.76, y: 0.72 },
  dashPos: { x: 0.91, y: 0.82 },
  stickScale: 1,
  dashScale: 1,
  fixedSticks: false,
  opacity: 0.88,
};

export interface KeyBindingSlot {
  primary: string;
  secondary: string;
}

export type KeyboardAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'shoot'
  | 'dash'
  | 'pause'
  | 'mute';

export interface KeyboardControlSettings {
  moveUp: KeyBindingSlot;
  moveDown: KeyBindingSlot;
  moveLeft: KeyBindingSlot;
  moveRight: KeyBindingSlot;
  shoot: KeyBindingSlot;
  dash: KeyBindingSlot;
  pause: KeyBindingSlot;
  mute: KeyBindingSlot;
}

export const DEFAULT_KEYBOARD_CONTROL_SETTINGS: KeyboardControlSettings = {
  moveUp: { primary: 'KeyW', secondary: 'ArrowUp' },
  moveDown: { primary: 'KeyS', secondary: 'ArrowDown' },
  moveLeft: { primary: 'KeyA', secondary: 'ArrowLeft' },
  moveRight: { primary: 'KeyD', secondary: 'ArrowRight' },
  shoot: { primary: 'Space', secondary: 'Mouse0' },
  dash: { primary: 'ShiftLeft', secondary: 'Mouse2' },
  pause: { primary: 'KeyP', secondary: 'Escape' },
  mute: { primary: 'KeyM', secondary: '' },
};

export interface GameplaySettings {
  screenShake: number;
  hudScale: number;
  offscreenIndicators: boolean;
  cockpitDamageFx: boolean;
  mobileControls: MobileControlSettings;
  keyboardControls: KeyboardControlSettings;
}

export const DEFAULT_GAMEPLAY_SETTINGS: GameplaySettings = {
  screenShake: 1,
  hudScale: 1,
  offscreenIndicators: true,
  cockpitDamageFx: true,
  mobileControls: {
    movePos: { ...DEFAULT_MOBILE_CONTROL_SETTINGS.movePos },
    aimPos: { ...DEFAULT_MOBILE_CONTROL_SETTINGS.aimPos },
    dashPos: { ...DEFAULT_MOBILE_CONTROL_SETTINGS.dashPos },
    stickScale: DEFAULT_MOBILE_CONTROL_SETTINGS.stickScale,
    dashScale: DEFAULT_MOBILE_CONTROL_SETTINGS.dashScale,
    fixedSticks: DEFAULT_MOBILE_CONTROL_SETTINGS.fixedSticks,
    opacity: DEFAULT_MOBILE_CONTROL_SETTINGS.opacity,
  },
  keyboardControls: {
    moveUp: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveUp },
    moveDown: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveDown },
    moveLeft: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveLeft },
    moveRight: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.moveRight },
    shoot: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.shoot },
    dash: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.dash },
    pause: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.pause },
    mute: { ...DEFAULT_KEYBOARD_CONTROL_SETTINGS.mute },
  },
};

export function formatKeyCode(code: string): string {
  if (!code) return '—';
  switch (code) {
    case 'Space':
      return 'Espaço';
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'Shift';
    case 'ControlLeft':
    case 'ControlRight':
      return 'Ctrl';
    case 'AltLeft':
    case 'AltRight':
      return 'Alt';
    case 'Mouse0':
      return 'Mouse Esq.';
    case 'Mouse1':
      return 'Mouse Meio';
    case 'Mouse2':
      return 'Mouse Dir.';
    case 'Mouse3':
      return 'Mouse 4';
    case 'Mouse4':
      return 'Mouse 5';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'Escape':
      return 'Esc';
    case 'Enter':
    case 'NumpadEnter':
      return 'Enter';
    case 'Tab':
      return 'Tab';
    case 'Backspace':
      return 'Backspace';
    case 'CapsLock':
      return 'Caps';
    case 'Comma':
      return ',';
    case 'Period':
      return '.';
    case 'Slash':
      return '/';
    case 'Semicolon':
      return ';';
    case 'Quote':
      return "'";
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Backslash':
      return '\\';
    case 'Minus':
      return '-';
    case 'Equal':
      return '=';
    default:
      if (code.startsWith('Key') && code.length === 4) {
        return code.slice(3);
      }
      if (code.startsWith('Digit') && code.length === 6) {
        return code.slice(5);
      }
      if (code.startsWith('Numpad') && code.length > 6) {
        return `Num ${code.slice(6)}`;
      }
      return code;
  }
}

export function formatBindingPair(slot: KeyBindingSlot): string {
  const first = slot.primary ? formatKeyCode(slot.primary) : '';
  const second = slot.secondary ? formatKeyCode(slot.secondary) : '';
  if (first && second) return `${first}/${second}`;
  if (first) return first;
  if (second) return second;
  return '—';
}

function slotHasCode(slot: KeyBindingSlot, code: string): boolean {
  return slot.primary === code || slot.secondary === code;
}

export function formatMovementLabel(keyboardControls: KeyboardControlSettings): string {
  const hasWasd =
    slotHasCode(keyboardControls.moveUp, 'KeyW') &&
    slotHasCode(keyboardControls.moveDown, 'KeyS') &&
    slotHasCode(keyboardControls.moveLeft, 'KeyA') &&
    slotHasCode(keyboardControls.moveRight, 'KeyD');

  const hasArrows =
    slotHasCode(keyboardControls.moveUp, 'ArrowUp') &&
    slotHasCode(keyboardControls.moveDown, 'ArrowDown') &&
    slotHasCode(keyboardControls.moveLeft, 'ArrowLeft') &&
    slotHasCode(keyboardControls.moveRight, 'ArrowRight');

  if (hasWasd) return 'WASD';
  if (hasArrows) return 'Setas';

  const up = formatKeyCode(keyboardControls.moveUp.primary || keyboardControls.moveUp.secondary);
  const left = formatKeyCode(keyboardControls.moveLeft.primary || keyboardControls.moveLeft.secondary);
  const down = formatKeyCode(keyboardControls.moveDown.primary || keyboardControls.moveDown.secondary);
  const right = formatKeyCode(keyboardControls.moveRight.primary || keyboardControls.moveRight.secondary);
  return `${up}/${left}/${down}/${right}`;
}
