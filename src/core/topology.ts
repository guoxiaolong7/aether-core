export type ShapeMode = 'sphere' | 'mobius' | 'helix' | 'nebula';
export type InteractionMode = 'repel' | 'attract';

export interface AppState {
  currentShape: ShapeMode;
  bloomIntensity: number;
  rotationSpeed: number;
  forceRadius: number;
  interactionMode: InteractionMode;
  isPaused: boolean;
  bloomEnabled: boolean;
  particleCount: number;
  fps: number;
}

export interface ShapePresetMeta {
  id: ShapeMode;
  label: string;
  enLabel: string;
  coreScale: number;
  coreTiltX: number;
  coreTiltZ: number;
}

/**
 * 全局量化视觉与物理配置常量表（零魔法数字收敛点）
 */
export const CONFIG = {
  colors: {
    background: 0x05070d, // 深空黑蓝背景
    primary: 0x00f0ff,    // 主能量色：电光青
    secondary: 0x8a2be2,  // 次能量色：星云紫
    highlight: 0xffffff,  // 高光脉冲色
  },
  renderer: {
    exposure: 1.15,       // ACESFilmic 色调映射曝光度
    maxPixelRatio: 2,     // 硬件 GPU 像素比上限
    fogDensity: 0.028,    // 指数雾浓度
  },
  bloom: {
    threshold: 0.25,      // 泛光亮度阈值（避免过曝死白）
    strength: 0.85,       // 默认泛光强度
    radius: 0.6,          // 泛光扩散半径
  },
  camera: {
    fov: 48,              // 桌面端默认垂直视场角
    minPortraitFov: 68,   // 窄屏竖屏视场角上限
    near: 0.1,
    far: 100,
    minDistance: 4.5,     // OrbitControls 最近限制，防止穿入核心
    maxDistance: 18,      // OrbitControls 最远限制，防止丢失主体
    dampingFactor: 0.05,
    initialPos: [0, 1.4, 8.8] as const,
  },
  particles: {
    desktopCount: 12000,  // 桌面端固定粒子数
    mobileCount: 5000,    // 移动端自动降级粒子数
    mobileBreakpoint: 768,
    sizeGpu: 0.088,       // 开启后期泛光时的粒子尺寸
    sizeEco: 0.115,       // 软件渲染/关闭泛光时的补偿粒子尺寸
    opacityGpu: 0.88,
    opacityEco: 0.92,
    textureSize: 64,      // 离屏 Canvas 光晕贴图分辨率
  },
  physics: {
    sphereRadius: 3.1,    // 默认量子球体基准半径
    lerpFactor: 0.06,     // 形态演化基础插值速率（已做 dt*60 帧率无关化）
    colorLerpFactor: 0.08,
    velocityDamping: 0.89,// 扰动速度指数阻尼系数
    repulsionRadius: 2.8, // 默认 3D 力场作用半径
    repulsionStrength: 1.4,// 力场作用力度系数
    attractPullRatio: 0.72,// 引力模式向心拉力倍率
    attractSwirlRatio: 0.85,// 引力模式切向漩涡倍率
    velocityScale: 4.2,
    maxDelta: 0.05,       // 最大时间步长钳位，防止切后台瞬移
    clickMaxMovePx: 5,    // 判定为“点击触发脉冲波”的最大允许指针位移（px）
  },
  pulse: {
    duration: 1.2,        // 脉冲能量波持续时间（秒）
    maxRadius: 6.2,       // 脉冲波峰最大扩散半径
    bandWidth: 0.65,      // 波峰影响带厚度
    pushStrength: 14.5,   // 波峰径向推力系数
  },
  shapes: {
    mobius: { majorR: 2.45, halfWidth: 1.15, tilt: 0.48 },
    helix: { radius: 1.38, heightSpan: 4.6, turns: 2.6, rungCount: 18 },
    nebula: { arms: 4, maxR: 4.25, tilt: 0.42 },
  },
} as const;

export const SHAPE_PRESETS: readonly ShapePresetMeta[] = [
  {
    id: 'sphere',
    label: '量子球体',
    enLabel: 'QUANTUM SPHERE',
    coreScale: 1.0,
    coreTiltX: 0.12,
    coreTiltZ: 0.08,
  },
  {
    id: 'mobius',
    label: '莫比乌斯环',
    enLabel: 'MOBIUS TORUS',
    coreScale: 0.76,
    coreTiltX: 0.55,
    coreTiltZ: 0.28,
  },
  {
    id: 'helix',
    label: '双螺旋星链',
    enLabel: 'DNA HELIX',
    coreScale: 0.7,
    coreTiltX: 0.05,
    coreTiltZ: 0.05,
  },
  {
    id: 'nebula',
    label: '超新星坍缩',
    enLabel: 'SUPERNOVA VORTEX',
    coreScale: 0.85,
    coreTiltX: 0.85,
    coreTiltZ: 0.18,
  },
] as const;

export function getResponsiveParticleCount(viewportWidth: number): number {
  return viewportWidth < CONFIG.particles.mobileBreakpoint
    ? CONFIG.particles.mobileCount
    : CONFIG.particles.desktopCount;
}

export function createInitialAppState(viewportWidth: number): AppState {
  return {
    currentShape: 'sphere',
    bloomIntensity: CONFIG.bloom.strength,
    rotationSpeed: 0.35,
    forceRadius: CONFIG.physics.repulsionRadius,
    interactionMode: 'repel',
    isPaused: false,
    bloomEnabled: true,
    particleCount: getResponsiveParticleCount(viewportWidth),
    fps: 60,
  };
}

/**
 * 判断 pointerdown -> pointerup 是否属于“原地点击”（排除镜头拖拽旋转）
 */
export function isClickWithinThreshold(
  dx: number,
  dy: number,
  maxMovePx: number = CONFIG.physics.clickMaxMovePx
): boolean {
  return dx * dx + dy * dy < maxMovePx * maxMovePx;
}

/**
 * 32 位无偏比特混合哈希（避免与黄金螺旋角度发生相位锁定）
 */
function hash01(index: number, salt = 0): number {
  let h = (index + 1 + salt * 1013904223) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/**
 * 1. 量子球体（Quantum Sphere）：Fibonacci 黄金螺旋分布 + 谐波表面涟漪
 */
export function fillFibonacciSpherePositions(
  target: Float32Array,
  count: number,
  maxRadius: number = CONFIG.physics.sphereRadius
): void {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const yNorm = 1 - t * 2;
    const radialSlice = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
    const theta = goldenAngle * i;

    const shellHash = hash01(i, 1);
    const baseScale =
      shellHash < 0.72
        ? 0.87 + 0.11 * hash01(i, 2)
        : 0.44 + 0.4 * shellHash;

    const ripple =
      1 + 0.045 * Math.sin(theta * 3.0 + yNorm * 4.5) * Math.cos(yNorm * 3.2);
    const r = maxRadius * baseScale * ripple;

    const idx = i * 3;
    target[idx] = Math.cos(theta) * radialSlice * r;
    target[idx + 1] = yNorm * r;
    target[idx + 2] = Math.sin(theta) * radialSlice * r;
  }
}

/**
 * 2. 莫比乌斯环（Mobius Torus）：单侧扭曲参数曲面
 */
export function fillMobiusTorusPositions(
  target: Float32Array,
  count: number
): void {
  const { majorR, halfWidth, tilt } = CONFIG.shapes.mobius;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);

  for (let i = 0; i < count; i++) {
    const u = (i / count) * Math.PI * 2 + (hash01(i, 11) - 0.5) * 0.04;
    const vRaw = hash01(i, 12) * 2 - 1;
    const v = Math.sign(vRaw) * Math.pow(Math.abs(vRaw), 0.78) * halfWidth;
    const thickness = (hash01(i, 13) - 0.5) * 0.24;

    const halfU = u * 0.5;
    const ringR = majorR + v * Math.cos(halfU);
    const x0 = ringR * Math.cos(u);
    const y0 = ringR * Math.sin(u);
    const z0 = v * Math.sin(halfU) + thickness;

    const idx = i * 3;
    target[idx] = x0;
    target[idx + 1] = y0 * cosTilt - z0 * sinTilt;
    target[idx + 2] = y0 * sinTilt + z0 * cosTilt;
  }
}

/**
 * 3. 双螺旋星链（DNA Helix）：双股螺旋主干 + 横向碱基连接桥
 */
export function fillDnaHelixPositions(
  target: Float32Array,
  count: number
): void {
  const { radius, heightSpan, turns, rungCount } = CONFIG.shapes.helix;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const role = hash01(i, 21);

    if (role < 0.72) {
      const strand = i % 2 === 0 ? 0 : Math.PI;
      const t = i / count;
      const y = (t - 0.5) * heightSpan + (hash01(i, 22) - 0.5) * 0.08;
      const angle = t * Math.PI * 2 * turns + strand;
      const r = radius + (hash01(i, 23) - 0.5) * 0.34;
      const angleJitter = (hash01(i, 24) - 0.5) * 0.22;

      target[idx] = Math.cos(angle + angleJitter) * r;
      target[idx + 1] = y;
      target[idx + 2] = Math.sin(angle + angleJitter) * r;
    } else {
      const rungIndex = Math.floor(hash01(i, 25) * rungCount);
      const t = (rungIndex + 0.5) / rungCount;
      const y = (t - 0.5) * heightSpan + (hash01(i, 26) - 0.5) * 0.07;
      const angle = t * Math.PI * 2 * turns;

      const xA = Math.cos(angle) * radius;
      const zA = Math.sin(angle) * radius;
      const bridge = hash01(i, 27) * 2 - 1;

      target[idx] = xA * bridge + (hash01(i, 28) - 0.5) * 0.08;
      target[idx + 1] = y;
      target[idx + 2] = zA * bridge + (hash01(i, 29) - 0.5) * 0.08;
    }
  }
}

/**
 * 4. 超新星坍缩（Supernova Vortex）：4 旋臂对数螺旋盘星系
 */
export function fillSupernovaVortexPositions(
  target: Float32Array,
  count: number
): void {
  const { arms, maxR, tilt } = CONFIG.shapes.nebula;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const armIndex = i % arms;
    const u = hash01(i, 31);
    const r = 0.22 + Math.pow(u, 0.78) * (maxR - 0.22);

    const armOffset = (armIndex / arms) * Math.PI * 2;
    const swirl = r * 1.45;
    const scatterAngle = (hash01(i, 32) - 0.5) * (0.65 / (0.35 + r * 0.35));
    const angle = armOffset + swirl + scatterAngle;

    const x0 = Math.cos(angle) * r;
    const z0 = Math.sin(angle) * r;
    const verticalSpread = 0.52 * Math.exp(-r * 0.45) + 0.1;
    const y0 = (hash01(i, 33) - 0.5) * 2 * verticalSpread;

    target[idx] = x0;
    target[idx + 1] = y0 * cosTilt - z0 * sinTilt;
    target[idx + 2] = y0 * sinTilt + z0 * cosTilt;
  }
}

export function fillShapePositions(
  shape: ShapeMode,
  target: Float32Array,
  count: number
): void {
  switch (shape) {
    case 'sphere':
      fillFibonacciSpherePositions(target, count, CONFIG.physics.sphereRadius);
      break;
    case 'mobius':
      fillMobiusTorusPositions(target, count);
      break;
    case 'helix':
      fillDnaHelixPositions(target, count);
      break;
    case 'nebula':
      fillSupernovaVortexPositions(target, count);
      break;
  }
}

/**
 * 按空间距离赋色：内层电光青 (#00f0ff) + 核心高光 -> 外缘星云紫 (#8a2be2)
 */
export function fillRadialGradientColors(
  colors: Float32Array,
  positions: Float32Array,
  count: number,
  maxRadius: number = CONFIG.physics.sphereRadius
): void {
  const pR = 0.0, pG = 0.941176, pB = 1.0;
  const sR = 0.541176, sG = 0.168627, sB = 0.886275;

  const innerEdge = maxRadius * 0.28;
  const span = Math.max(0.001, maxRadius * 1.15 - innerEdge);

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];
    const dist = Math.sqrt(x * x + y * y + z * z);
    const ratio = Math.min(1, Math.max(0, (dist - innerEdge) / span));

    const blend = Math.pow(ratio, 1.1);
    let r = pR + (sR - pR) * blend;
    let g = pG + (sG - pG) * blend;
    let b = pB + (sB - pB) * blend;

    if (ratio < 0.32) {
      const coreBoost = (0.32 - ratio) * 0.95;
      r = Math.min(1, r + coreBoost);
      g = Math.min(1, g + coreBoost * 0.22);
    }

    colors[idx] = r;
    colors[idx + 1] = g;
    colors[idx + 2] = b;
  }
}
