/**
 * Общие параметры сцены и игрока.
 * Все размеры — в метрах.
 */
export const WORLD = {
  /** Офис квадратный: ширина = глубина. */
  size: 26,
  height: 3.6,
  wallThickness: 0.3,
  /** Нижняя и верхняя полосы витражного остекления. */
  windowSill: 0.18,
  windowHead: 3.42,
  cornerPost: 0.45,
} as const;

export const PLAYER = {
  // Высота глаз = 2 * collisionHalfHeight: низ эллипсоида ровно на полу.
  eyeHeight: 1.7,
  walkSpeed: 4.2,
  sprintSpeed: 6.4,
  acceleration: 14,
  deceleration: 18,
  lookSensitivity: 2000,
  fov: 1.0,
  collisionRadius: 0.32,
  collisionHalfHeight: 0.85,
} as const;

export const SPAWN = {
  x: 0,
  z: 0,
  /** 0 — взгляд в сторону панорамных окон (+Z). */
  yaw: 0,
} as const;

export const GRID_TEXTURE_URL = "textures/prototype/texture_03.png";
