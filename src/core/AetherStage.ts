import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createParticleGlowTexture, detectSoftwareWebGL } from './textures';
import {
  AppState,
  CONFIG,
  InteractionMode,
  SHAPE_PRESETS,
  ShapeMode,
  createInitialAppState,
  fillRadialGradientColors,
  fillShapePositions,
  getResponsiveParticleCount,
  isClickWithinThreshold,
} from './topology';

export interface StageMetrics {
  fps: number;
  particleCount: number;
  isSoftwareGl: boolean;
  currentShape: ShapeMode;
  bloomEnabled: boolean;
}

// 模块顶层预分配可复用数学对象（主渲染循环零 GC 压力）
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _planeNormal = new THREE.Vector3();
const _worldCursor = new THREE.Vector3();
const _localCursor = new THREE.Vector3();
const _originVec = new THREE.Vector3(0, 0, 0);
const _initialCamPos = new THREE.Vector3(...CONFIG.camera.initialPos);

export class AetherStage {
  private readonly container: HTMLElement;
  private readonly onMetrics?: (metrics: StageMetrics) => void;

  public readonly state: AppState;
  public readonly isSoftwareGl: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly envTexture: THREE.Texture;

  private readonly coreGroup: THREE.Group;
  private readonly innerCrystal: THREE.Mesh;
  private readonly crystalMaterial: THREE.MeshPhysicalMaterial;
  private readonly innerWireframe: THREE.LineSegments;
  private readonly ringPrimary: THREE.Mesh;
  private readonly ringSecondary: THREE.Mesh;

  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly particleMaterial: THREE.PointsMaterial;
  private readonly particleCloud: THREE.Points;
  private readonly particleTexture: THREE.CanvasTexture;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly colors: Float32Array;
  private readonly shapeTargets: Record<ShapeMode, Float32Array>;
  private readonly shapeColors: Record<ShapeMode, Float32Array>;
  private activeTarget: Float32Array;
  private activeBaseColors: Float32Array;

  // 指针、多指触控与轨道拖拽冲突隔离状态
  private readonly activePointers = new Set<number>();
  private isPointerActive = false;
  private isOrbitDragging = false;
  private pointerDownOnCanvas = false;
  private wasMultiTouch = false;
  private pointerDownX = 0;
  private pointerDownY = 0;

  // 脉冲能量波状态
  private pulseActive = false;
  private pulseAge = 0;

  // 内核平滑协同目标
  private targetCoreScale = 1.0;
  private targetCoreTiltX = 0.12;
  private targetCoreTiltZ = 0.08;
  private cameraResetActive = false;

  private readonly clock = new THREE.Clock();
  private frameId = 0;
  private isDisposed = false;
  private elapsed = 0;
  private fpsFrameCount = 0;
  private fpsAccumTime = 0;

  constructor(container: HTMLElement, onMetrics?: (metrics: StageMetrics) => void) {
    this.container = container;
    this.onMetrics = onMetrics;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.state = createInitialAppState(width);
    this.isSoftwareGl = detectSoftwareWebGL();
    if (this.isSoftwareGl) {
      this.state.bloomEnabled = false;
    }

    // 1. 渲染器初始化
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CONFIG.renderer.exposure;
    this.renderer.setPixelRatio(
      this.isSoftwareGl
        ? 1
        : Math.min(window.devicePixelRatio || 1, CONFIG.renderer.maxPixelRatio)
    );
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    // 2. 场景与程序化 Studio 环境贴图
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.colors.background);
    this.scene.fog = new THREE.FogExp2(
      CONFIG.colors.background,
      CONFIG.renderer.fogDensity
    );

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    pmrem.dispose();

    // 3. 相机与安全轨道控制
    const aspect = width / height;
    const baseFov =
      aspect < 1
        ? Math.min(
            CONFIG.camera.minPortraitFov,
            Math.round(CONFIG.camera.fov / Math.max(aspect, 0.62))
          )
        : CONFIG.camera.fov;
    this.camera = new THREE.PerspectiveCamera(
      baseFov,
      aspect,
      CONFIG.camera.near,
      CONFIG.camera.far
    );
    this.camera.position.copy(_initialCamPos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = CONFIG.camera.dampingFactor;
    this.controls.enablePan = false;
    this.controls.minDistance = CONFIG.camera.minDistance;
    this.controls.maxDistance = CONFIG.camera.maxDistance;
    this.controls.target.copy(_originVec);
    this.controls.update();

    this.controls.addEventListener('start', () => {
      this.isOrbitDragging = true;
      this.cameraResetActive = false;
    });
    this.controls.addEventListener('end', () => {
      this.isOrbitDragging = false;
    });

    // 4. Studio 光照系统
    this.scene.add(new THREE.HemisphereLight(0x8fe8ff, 0x1e0e38, 0.85));
    const keyLight = new THREE.DirectionalLight(0xeefaff, 1.45);
    keyLight.position.set(5, 6, 5);
    this.scene.add(keyLight);

    const rimCyan = new THREE.PointLight(CONFIG.colors.primary, 2.8, 16, 1.6);
    rimCyan.position.set(-4.2, 2.2, 3.5);
    this.scene.add(rimCyan);

    const rimViolet = new THREE.PointLight(CONFIG.colors.secondary, 2.6, 16, 1.6);
    rimViolet.position.set(4.2, -2.0, -3.5);
    this.scene.add(rimViolet);

    // 5. EffectComposer + UnrealBloomPass + OutputPass
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      this.state.bloomIntensity,
      CONFIG.bloom.radius,
      CONFIG.bloom.threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // 6. 内核复合几何体（二十面体晶体 + 线框 + 双反向金属环）
    this.coreGroup = new THREE.Group();

    this.crystalMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x071a33,
      emissive: CONFIG.colors.primary,
      emissiveIntensity: 0.48,
      metalness: 0.35,
      roughness: 0.16,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.48,
      flatShading: true,
    });
    this.innerCrystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.86, 1),
      this.crystalMaterial
    );
    this.coreGroup.add(this.innerCrystal);

    this.innerWireframe = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.16, 1)),
      new THREE.LineBasicMaterial({
        color: CONFIG.colors.primary,
        transparent: true,
        opacity: 0.65,
      })
    );
    this.coreGroup.add(this.innerWireframe);

    this.ringPrimary = new THREE.Mesh(
      new THREE.TorusGeometry(1.62, 0.024, 16, 128),
      new THREE.MeshStandardMaterial({
        color: 0xc2f8ff,
        emissive: CONFIG.colors.primary,
        emissiveIntensity: 0.55,
        metalness: 0.92,
        roughness: 0.16,
      })
    );
    this.ringPrimary.rotation.set(Math.PI * 0.28, 0, Math.PI * 0.14);
    this.coreGroup.add(this.ringPrimary);

    this.ringSecondary = new THREE.Mesh(
      new THREE.TorusGeometry(1.94, 0.02, 16, 128),
      new THREE.MeshStandardMaterial({
        color: 0xdcc8ff,
        emissive: CONFIG.colors.secondary,
        emissiveIntensity: 0.65,
        metalness: 0.9,
        roughness: 0.2,
      })
    );
    this.ringSecondary.rotation.set(-Math.PI * 0.34, 0, -Math.PI * 0.22);
    this.coreGroup.add(this.ringSecondary);

    this.scene.add(this.coreGroup);

    // 7. 预分配粒子及 4 种拓扑缓冲
    const maxParticles = CONFIG.particles.desktopCount;
    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 3);

    this.shapeTargets = {
      sphere: new Float32Array(maxParticles * 3),
      mobius: new Float32Array(maxParticles * 3),
      helix: new Float32Array(maxParticles * 3),
      nebula: new Float32Array(maxParticles * 3),
    };

    this.shapeColors = {
      sphere: new Float32Array(maxParticles * 3),
      mobius: new Float32Array(maxParticles * 3),
      helix: new Float32Array(maxParticles * 3),
      nebula: new Float32Array(maxParticles * 3),
    };

    this.precomputeAllShapes(this.state.particleCount);
    this.activeTarget = this.shapeTargets[this.state.currentShape];
    this.activeBaseColors = this.shapeColors[this.state.currentShape];
    this.positions.set(this.activeTarget);
    this.colors.set(this.activeBaseColors);

    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3)
    );
    this.particleGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colors, 3)
    );
    this.particleGeometry.setDrawRange(0, this.state.particleCount);

    this.particleTexture = createParticleGlowTexture(CONFIG.particles.textureSize);
    this.particleMaterial = new THREE.PointsMaterial({
      size: this.isSoftwareGl
        ? CONFIG.particles.sizeEco
        : CONFIG.particles.sizeGpu,
      map: this.particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: this.isSoftwareGl
        ? CONFIG.particles.opacityEco
        : CONFIG.particles.opacityGpu,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.particleCloud = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.scene.add(this.particleCloud);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 8. 绑定交互与窗口监听
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('resize', this.handleResize);

    this.emitMetrics();
    this.tick();
  }

  private precomputeAllShapes(count: number): void {
    for (let i = 0; i < SHAPE_PRESETS.length; i++) {
      const id = SHAPE_PRESETS[i].id;
      const targetBuf = this.shapeTargets[id];
      const colorBuf = this.shapeColors[id];
      fillShapePositions(id, targetBuf, count);
      fillRadialGradientColors(colorBuf, targetBuf, count, CONFIG.physics.sphereRadius);
    }
  }

  public setShape(shape: ShapeMode): void {
    if (this.state.currentShape === shape) return;
    this.state.currentShape = shape;
    this.activeTarget = this.shapeTargets[shape];
    this.activeBaseColors = this.shapeColors[shape];

    const preset = SHAPE_PRESETS.find((p) => p.id === shape);
    if (preset) {
      this.targetCoreScale = preset.coreScale;
      this.targetCoreTiltX = preset.coreTiltX;
      this.targetCoreTiltZ = preset.coreTiltZ;
    }

    this.emitMetrics();
  }

  public setBloomIntensity(val: number): void {
    this.state.bloomIntensity = val;
    this.bloomPass.strength = val;
  }

  public setBloomEnabled(enabled: boolean): void {
    this.state.bloomEnabled = enabled;
    const useHighQuality = enabled && !this.isSoftwareGl;
    this.particleMaterial.size = useHighQuality
      ? CONFIG.particles.sizeGpu
      : CONFIG.particles.sizeEco;
    this.particleMaterial.opacity = useHighQuality
      ? CONFIG.particles.opacityGpu
      : CONFIG.particles.opacityEco;
    this.emitMetrics();
  }

  public setRotationSpeed(val: number): void {
    this.state.rotationSpeed = val;
  }

  public setForceRadius(val: number): void {
    this.state.forceRadius = val;
  }

  public setInteractionMode(mode: InteractionMode): void {
    this.state.interactionMode = mode;
  }

  public setPaused(paused: boolean): void {
    this.state.isPaused = paused;
  }

  public triggerPulseWave(): void {
    this.pulseActive = true;
    this.pulseAge = 0;
  }

  public resetCamera(): void {
    this.cameraResetActive = true;
  }

  private updatePointerRay(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.camera.getWorldDirection(_planeNormal);
    _interactionPlane.setFromNormalAndCoplanarPoint(_planeNormal, _originVec);
    _raycaster.setFromCamera(_pointerNdc, this.camera);

    const hit = _raycaster.ray.intersectPlane(_interactionPlane, _worldCursor);
    this.isPointerActive = hit !== null;
  }

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.activePointers.size > 1) {
      this.isPointerActive = false;
      return;
    }
    this.updatePointerRay(e.clientX, e.clientY);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      this.wasMultiTouch = true;
      this.pointerDownOnCanvas = false;
      this.isPointerActive = false;
      return;
    }
    // 仅鼠标左键或单指触控有效
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    this.pointerDownOnCanvas = true;
    this.wasMultiTouch = false;
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    this.updatePointerRay(e.clientX, e.clientY);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    const shouldCheckClick =
      this.pointerDownOnCanvas &&
      !this.wasMultiTouch &&
      this.activePointers.size === 0 &&
      (e.pointerType !== 'mouse' || e.button === 0);

    if (shouldCheckClick) {
      const dx = e.clientX - this.pointerDownX;
      const dy = e.clientY - this.pointerDownY;
      if (isClickWithinThreshold(dx, dy, CONFIG.physics.clickMaxMovePx)) {
        this.triggerPulseWave();
      }
    }

    this.pointerDownOnCanvas = false;
    if (this.activePointers.size === 0) {
      this.wasMultiTouch = false;
      if (e.pointerType === 'touch') {
        this.isPointerActive = false;
      }
    }
  };

  private handlePointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    this.pointerDownOnCanvas = false;
    this.isPointerActive = false;
    if (this.activePointers.size === 0) {
      this.wasMultiTouch = false;
    }
  };

  private handlePointerLeave = (): void => {
    this.isPointerActive = false;
    this.pointerDownOnCanvas = false;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        e.preventDefault();
        this.triggerPulseWave();
      }
    }
  };

  private handleResize = (): void => {
    if (this.isDisposed) return;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    if (width <= 0 || height <= 0) return;

    const pixelRatio = this.isSoftwareGl
      ? 1
      : Math.min(window.devicePixelRatio || 1, CONFIG.renderer.maxPixelRatio);

    const aspect = width / height;
    this.camera.fov =
      aspect < 1
        ? Math.min(
            CONFIG.camera.minPortraitFov,
            Math.round(CONFIG.camera.fov / Math.max(aspect, 0.62))
          )
        : CONFIG.camera.fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);

    const nextCount = getResponsiveParticleCount(width);
    if (nextCount !== this.state.particleCount) {
      this.state.particleCount = nextCount;
      this.precomputeAllShapes(nextCount);
      this.activeTarget = this.shapeTargets[this.state.currentShape];
      this.activeBaseColors = this.shapeColors[this.state.currentShape];
      this.positions.set(this.activeTarget);
      this.colors.set(this.activeBaseColors);
      this.velocities.fill(0);
      this.particleGeometry.attributes.position.needsUpdate = true;
      this.particleGeometry.attributes.color.needsUpdate = true;
      this.particleGeometry.setDrawRange(0, nextCount);
      this.emitMetrics();
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.isDisposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private emitMetrics(): void {
    this.onMetrics?.({
      fps: this.state.fps,
      particleCount: this.state.particleCount,
      isSoftwareGl: this.isSoftwareGl,
      currentShape: this.state.currentShape,
      bloomEnabled: this.state.bloomEnabled,
    });
  }

  private tick = (): void => {
    if (this.isDisposed) return;

    const rawDelta = this.clock.getDelta();
    const dt = Math.min(rawDelta, CONFIG.physics.maxDelta);

    // 切后台恢复时忽略异常超大 rawDelta 对 FPS 采样的污染
    if (rawDelta < 1.0) {
      this.fpsFrameCount += 1;
      this.fpsAccumTime += rawDelta;
      if (this.fpsAccumTime >= 0.5) {
        this.state.fps = Math.max(1, Math.round(this.fpsFrameCount / this.fpsAccumTime));
        this.fpsFrameCount = 0;
        this.fpsAccumTime = 0;
        this.emitMetrics();
      }
    }

    if (this.cameraResetActive) {
      const camAlpha = 1 - Math.exp(-6.5 * dt);
      this.camera.position.lerp(_initialCamPos, camAlpha);
      this.controls.target.lerp(_originVec, camAlpha);
      if (this.camera.position.distanceTo(_initialCamPos) < 0.03) {
        this.camera.position.copy(_initialCamPos);
        this.controls.target.copy(_originVec);
        this.cameraResetActive = false;
      }
    }

    if (!this.state.isPaused) {
      this.elapsed += dt;
      const speed = this.state.rotationSpeed;

      // 1. 内核协同形变与自转
      const coreAlpha = 1 - Math.exp(-5.5 * dt);
      const currentScale = this.coreGroup.scale.x;
      this.coreGroup.scale.setScalar(
        currentScale + (this.targetCoreScale - currentScale) * coreAlpha
      );
      this.coreGroup.rotation.x += (this.targetCoreTiltX - this.coreGroup.rotation.x) * coreAlpha;
      this.coreGroup.rotation.z += (this.targetCoreTiltZ - this.coreGroup.rotation.z) * coreAlpha;

      this.innerCrystal.scale.setScalar(1 + Math.sin(this.elapsed * 1.8) * 0.04);
      this.innerCrystal.rotation.y += dt * 0.45 * speed;
      this.innerCrystal.rotation.x += dt * 0.2 * speed;

      this.innerWireframe.scale.setScalar(1 + Math.sin(this.elapsed * 1.8 + 0.6) * 0.03);
      this.innerWireframe.rotation.y -= dt * 0.32 * speed;
      this.innerWireframe.rotation.z += dt * 0.16 * speed;

      this.ringPrimary.rotation.z += dt * 0.85 * speed;
      this.ringPrimary.rotation.y += dt * 0.28 * speed;
      this.ringSecondary.rotation.z -= dt * 0.72 * speed;
      this.ringSecondary.rotation.x -= dt * 0.22 * speed;

      this.particleCloud.rotation.y += dt * 0.18 * speed;
      this.particleCloud.rotation.x = Math.sin(this.elapsed * 0.25) * 0.08;
      this.particleCloud.updateMatrixWorld();

      // 2. 脉冲能量波推进
      let waveRadius = -1;
      let waveIntensity = 0;
      const waveSigma = CONFIG.pulse.bandWidth;
      if (this.pulseActive) {
        this.pulseAge += dt;
        const progress = this.pulseAge / CONFIG.pulse.duration;
        if (progress >= 1) {
          this.pulseActive = false;
          this.pulseAge = 0;
          this.crystalMaterial.emissiveIntensity = 0.48;
        } else {
          waveRadius = progress * CONFIG.pulse.maxRadius;
          waveIntensity = Math.sin(progress * Math.PI);
          this.crystalMaterial.emissiveIntensity = 0.48 + waveIntensity * 0.9;
        }
      }

      // 3. 仅在非双指/非旋转拖拽时激活 3D 光标力场
      const forceActive =
        this.isPointerActive && !this.isOrbitDragging && this.activePointers.size <= 1;
      if (forceActive) {
        _localCursor.copy(_worldCursor);
        this.particleCloud.worldToLocal(_localCursor);
      }

      const cx = _localCursor.x;
      const cy = _localCursor.y;
      const cz = _localCursor.z;

      const count = this.state.particleCount;
      const pos = this.positions;
      const vel = this.velocities;
      const col = this.colors;
      const tgt = this.activeTarget;
      const baseCol = this.activeBaseColors;

      const frameScale = dt * 60;
      const morphAlpha = 1 - Math.pow(1 - CONFIG.physics.lerpFactor, frameScale);
      const colorAlpha = 1 - Math.pow(1 - CONFIG.physics.colorLerpFactor, frameScale);
      const velDamping = Math.pow(CONFIG.physics.velocityDamping, frameScale);

      const fRadius = this.state.forceRadius;
      const fRadiusSq = fRadius * fRadius;
      const invFRadius = 1 / Math.max(0.01, fRadius);
      const isRepel = this.state.interactionMode === 'repel';
      const strength = CONFIG.physics.repulsionStrength * dt * 16;
      const pullRatio = CONFIG.physics.attractPullRatio;
      const swirlRatio = CONFIG.physics.attractSwirlRatio;
      const velDt = dt * CONFIG.physics.velocityScale;
      const pulsePush = dt * CONFIG.pulse.pushStrength;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        let px = pos[idx];
        let py = pos[idx + 1];
        let pz = pos[idx + 2];

        let vx = vel[idx];
        let vy = vel[idx + 1];
        let vz = vel[idx + 2];

        let glowBoost = 0;

        if (forceActive) {
          const dx = px - cx;
          const dy = py - cy;
          const dz = pz - cz;
          const distSq = dx * dx + dy * dy + dz * dz;

          if (distSq < fRadiusSq && distSq > 1e-5) {
            const dist = Math.sqrt(distSq);
            const falloff = 1 - dist * invFRadius;
            const invDist = 1 / dist;
            const nx = dx * invDist;
            const ny = dy * invDist;
            const nz = dz * invDist;

            if (isRepel) {
              const push = falloff * falloff * strength;
              vx += nx * push;
              vy += ny * push;
              vz += nz * push;
              glowBoost = Math.max(glowBoost, falloff * 0.95);
            } else {
              const pull = falloff * strength * pullRatio;
              const swirl = falloff * strength * swirlRatio;
              vx += -nx * pull - nz * swirl;
              vy += -ny * pull;
              vz += -nz * pull + nx * swirl;
              glowBoost = Math.max(glowBoost, falloff * 0.8);
            }
          }
        }

        if (waveRadius >= 0) {
          const distO = Math.sqrt(px * px + py * py + pz * pz);
          const diff = Math.abs(distO - waveRadius);
          if (diff < waveSigma && distO > 1e-4) {
            const band = (1 - diff / waveSigma) * waveIntensity;
            const invO = 1 / distO;
            const radialPush = band * pulsePush;
            vx += px * invO * radialPush;
            vy += py * invO * radialPush;
            vz += pz * invO * radialPush;
            glowBoost = Math.max(glowBoost, band);
          }
        }

        px += (tgt[idx] - px) * morphAlpha + vx * velDt;
        py += (tgt[idx + 1] - py) * morphAlpha + vy * velDt;
        pz += (tgt[idx + 2] - pz) * morphAlpha + vz * velDt;

        pos[idx] = px;
        pos[idx + 1] = py;
        pos[idx + 2] = pz;

        vel[idx] = vx * velDamping;
        vel[idx + 1] = vy * velDamping;
        vel[idx + 2] = vz * velDamping;

        const br = baseCol[idx];
        const bg = baseCol[idx + 1];
        const bb = baseCol[idx + 2];

        const targetR = glowBoost > 0 ? Math.min(1, br + (1 - br) * glowBoost) : br;
        const targetG = glowBoost > 0 ? Math.min(1, bg + (1 - bg) * glowBoost) : bg;
        const targetB = glowBoost > 0 ? Math.min(1, bb + (1 - bb) * glowBoost) : bb;

        col[idx] += (targetR - col[idx]) * colorAlpha;
        col[idx + 1] += (targetG - col[idx + 1]) * colorAlpha;
        col[idx + 2] += (targetB - col[idx + 2]) * colorAlpha;
      }

      this.particleGeometry.attributes.position.needsUpdate = true;
      this.particleGeometry.attributes.color.needsUpdate = true;
    }

    this.controls.update();

    if (this.state.bloomEnabled && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('resize', this.handleResize);

    this.controls.dispose();
    this.composer.dispose();
    this.envTexture.dispose();
    this.particleTexture.dispose();
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();

    this.coreGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) {
        (obj as THREE.Mesh).geometry.dispose();
      }
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });

    this.renderer.dispose();
    if (canvas.parentNode === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
