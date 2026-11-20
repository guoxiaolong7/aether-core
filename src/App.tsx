/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AetherStage, StageMetrics } from './core/AetherStage';
import {
  CONFIG,
  InteractionMode,
  SHAPE_PRESETS,
  ShapeMode,
  getResponsiveParticleCount,
} from './core/topology';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<AetherStage | null>(null);

  const [metrics, setMetrics] = useState<StageMetrics>(() => ({
    fps: 60,
    particleCount:
      typeof window !== 'undefined'
        ? getResponsiveParticleCount(window.innerWidth)
        : 12000,
    isSoftwareGl: false,
    currentShape: 'sphere',
    bloomEnabled: true,
  }));

  const [currentShape, setCurrentShape] = useState<ShapeMode>('sphere');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('repel');
  const [bloomIntensity, setBloomIntensity] = useState<number>(CONFIG.bloom.strength);
  const [rotationSpeed, setRotationSpeed] = useState<number>(0.35);
  const [forceRadius, setForceRadius] = useState<number>(CONFIG.physics.repulsionRadius);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [bloomEnabled, setBloomEnabled] = useState<boolean>(true);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= CONFIG.particles.mobileBreakpoint : true
  );
  const userToggledDrawerRef = useRef<boolean>(false);

  useEffect(() => {
    const onResize = () => {
      if (!userToggledDrawerRef.current) {
        setDrawerOpen(window.innerWidth >= CONFIG.particles.mobileBreakpoint);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const stage = new AetherStage(mount, (nextMetrics) => {
      setMetrics(nextMetrics);
      setBloomEnabled(nextMetrics.bloomEnabled);
    });
    stageRef.current = stage;

    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  const handleSelectShape = (shape: ShapeMode) => {
    setCurrentShape(shape);
    stageRef.current?.setShape(shape);
  };

  const handleInteractionMode = (mode: InteractionMode) => {
    setInteractionMode(mode);
    stageRef.current?.setInteractionMode(mode);
  };

  const handleBloomChange = (value: number) => {
    setBloomIntensity(value);
    stageRef.current?.setBloomIntensity(value);
  };

  const handleRotationChange = (value: number) => {
    setRotationSpeed(value);
    stageRef.current?.setRotationSpeed(value);
  };

  const handleForceRadiusChange = (value: number) => {
    setForceRadius(value);
    stageRef.current?.setForceRadius(value);
  };

  const handleTogglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    stageRef.current?.setPaused(next);
  };

  const handleToggleBloom = () => {
    const next = !bloomEnabled;
    setBloomEnabled(next);
    stageRef.current?.setBloomEnabled(next);
  };

  const handlePulse = () => {
    stageRef.current?.triggerPulseWave();
  };

  const handleResetView = () => {
    stageRef.current?.resetCamera();
  };

  const activePreset =
    SHAPE_PRESETS.find((p) => p.id === currentShape) ?? SHAPE_PRESETS[0];

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#05070d] select-none"
      data-shape={currentShape}
      data-interaction={interactionMode}
    >
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={canvasMountRef}
        data-testid="webgl-stage"
        className="absolute inset-0 h-full w-full"
      />

      {/* Top-Left Title & Telemetry Badge */}
      <header className="pointer-events-none fixed top-4 left-4 right-16 z-10 sm:top-6 sm:left-6 sm:right-auto">
        <div className="pointer-events-auto rounded-xl border border-[#00f0ff]/25 bg-[#080c18]/85 px-4 py-3 shadow-2xl">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rotate-45 border border-[#00f0ff] bg-[#00f0ff]/35"
            />
            <h1 className="text-sm font-semibold tracking-[0.22em] text-white sm:text-base">
              AETHER CORE
            </h1>
            <span className="rounded border border-[#8a2be2]/50 bg-[#8a2be2]/20 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[#d8b8ff]">
              LAB v3
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-[#8ab4cc]">
            QUANTUM TOPOLOGY &amp; MORPHING LAB
          </p>

          <div
            data-testid="hud-metrics"
            className="mt-2.5 flex flex-wrap items-center gap-2.5 border-t border-white/10 pt-2 font-mono text-[11px] text-[#bfefff] tabular-nums"
          >
            <span>
              FPS <strong className="text-[#00f0ff]">{metrics.fps}</strong>
            </span>
            <span aria-hidden="true" className="text-white/25">
              |
            </span>
            <span>
              PARTICLES{' '}
              <strong className="text-[#00f0ff]">
                {metrics.particleCount.toLocaleString()}
              </strong>
            </span>
            <span aria-hidden="true" className="hidden text-white/25 sm:inline">
              |
            </span>
            <span className="w-full sm:w-auto">
              MODE <strong className="text-[#d8b8ff]">{activePreset.enLabel}</strong>
            </span>
          </div>
        </div>
      </header>

      {/* Right Collapsible Control Drawer (non-overlapping on 375x667 portrait) */}
      <aside
        className={`pointer-events-none fixed right-3 z-30 flex flex-col items-end sm:top-6 sm:right-6 ${
          drawerOpen ? 'top-[152px] sm:top-6' : 'top-4 sm:top-6'
        }`}
      >
        {!drawerOpen ? (
          <button
            type="button"
            onClick={() => {
              userToggledDrawerRef.current = true;
              setDrawerOpen(true);
            }}
            aria-label="展开控制台"
            aria-expanded={false}
            className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[#00f0ff]/30 bg-[#080c18]/88 px-3 py-2.5 text-xs font-medium tracking-wider text-[#e6f6ff] shadow-xl transition hover:border-[#00f0ff]/70 hover:text-[#00f0ff] sm:px-3.5"
          >
            <SlidersHorizontal className="h-4 w-4 text-[#00f0ff]" />
            <span className="hidden sm:inline">参数控制台</span>
          </button>
        ) : (
          <section
            aria-label="物理场与渲染参数控制台"
            className="pointer-events-auto max-h-[calc(100dvh-272px)] w-[272px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-[#00f0ff]/25 bg-[#080c18]/92 p-3 shadow-2xl sm:max-h-[calc(100dvh-130px)] sm:p-4"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#00f0ff]" />
                <h2 className="text-xs font-semibold tracking-[0.14em] text-white">
                  FIELD CONTROLS
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  userToggledDrawerRef.current = true;
                  setDrawerOpen(false);
                }}
                aria-label="收起控制台"
                aria-expanded={true}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[#8ab4cc] transition hover:border-[#00f0ff]/40 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2.5 space-y-2.5 sm:mt-3.5 sm:space-y-3.5">
              {/* Interaction Mode Segmented Switch */}
              <div>
                <span className="mb-1.5 block font-mono text-[10px] tracking-wider text-[#8ab4cc]">
                  力场交互模式
                </span>
                <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-white/10 bg-[#05070d]/70 p-1">
                  <button
                    type="button"
                    onClick={() => handleInteractionMode('repel')}
                    aria-pressed={interactionMode === 'repel'}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${
                      interactionMode === 'repel'
                        ? 'bg-[#00f0ff]/20 text-[#00f0ff] ring-1 ring-[#00f0ff]/60'
                        : 'text-[#8ab4cc] hover:text-white'
                    }`}
                  >
                    斥力冲击
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInteractionMode('attract')}
                    aria-pressed={interactionMode === 'attract'}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${
                      interactionMode === 'attract'
                        ? 'bg-[#8a2be2]/25 text-[#e4caff] ring-1 ring-[#8a2be2]/70'
                        : 'text-[#8ab4cc] hover:text-white'
                    }`}
                  >
                    引力奇点
                  </button>
                </div>
              </div>

              {/* Bloom Intensity Slider */}
              <div>
                <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                  <label htmlFor="bloom-slider" className="text-[#bfefff]">
                    泛光强度 (Bloom)
                  </label>
                  <span className="text-[#00f0ff] tabular-nums">
                    {bloomIntensity.toFixed(2)}
                  </span>
                </div>
                <input
                  id="bloom-slider"
                  type="range"
                  min={0}
                  max={2.4}
                  step={0.05}
                  value={bloomIntensity}
                  onChange={(e) => handleBloomChange(parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/15 accent-[#00f0ff]"
                />
              </div>

              {/* Rotation Speed Slider */}
              <div>
                <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                  <label htmlFor="rotation-slider" className="text-[#bfefff]">
                    旋转速度
                  </label>
                  <span className="text-[#00f0ff] tabular-nums">
                    {rotationSpeed.toFixed(2)}x
                  </span>
                </div>
                <input
                  id="rotation-slider"
                  type="range"
                  min={0}
                  max={2.0}
                  step={0.05}
                  value={rotationSpeed}
                  onChange={(e) => handleRotationChange(parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/15 accent-[#00f0ff]"
                />
              </div>

              {/* Force Radius Slider */}
              <div>
                <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                  <label htmlFor="radius-slider" className="text-[#bfefff]">
                    力场半径
                  </label>
                  <span className="text-[#00f0ff] tabular-nums">
                    {forceRadius.toFixed(1)}
                  </span>
                </div>
                <input
                  id="radius-slider"
                  type="range"
                  min={1.2}
                  max={5.0}
                  step={0.1}
                  value={forceRadius}
                  onChange={(e) => handleForceRadiusChange(parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/15 accent-[#8a2be2]"
                />
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handlePulse}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-[#00f0ff]/35 bg-[#00f0ff]/10 px-2.5 py-2 text-xs font-medium text-[#00f0ff] transition hover:bg-[#00f0ff]/20"
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>脉冲波</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetView}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-xs font-medium text-[#e6f6ff] transition hover:border-[#00f0ff]/40 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>重置视角</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleTogglePause}
                  aria-pressed={isPaused}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-[#bfefff] transition hover:border-[#00f0ff]/40"
                >
                  {isPaused ? (
                    <>
                      <Play className="h-3 w-3 text-[#00f0ff]" />
                      <span>继续演化</span>
                    </>
                  ) : (
                    <>
                      <Pause className="h-3 w-3 text-[#00f0ff]" />
                      <span>暂停演化</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleToggleBloom}
                  aria-pressed={bloomEnabled}
                  disabled={metrics.isSoftwareGl}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                    metrics.isSoftwareGl
                      ? 'cursor-not-allowed border-white/10 bg-white/5 text-white/35'
                      : bloomEnabled
                        ? 'border-[#8a2be2]/60 bg-[#8a2be2]/20 text-[#e4caff]'
                        : 'border-white/15 bg-white/5 text-[#8ab4cc]'
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{bloomEnabled ? '泛光: 开' : '泛光: 关'}</span>
                </button>
              </div>

              <p className="border-t border-white/10 pt-2 text-center font-mono text-[10px] text-[#7ca4bd]">
                点击空白处或按 SPACE 发射脉冲波
              </p>
            </div>
          </section>
        )}
      </aside>

      {/* Bottom Centered Shape Morphing Capsule Bar */}
      <nav
        aria-label="形态演化切换栏"
        className="pointer-events-none fixed bottom-4 left-1/2 z-20 w-[calc(100vw-1.5rem)] max-w-fit -translate-x-1/2 sm:bottom-6"
      >
        <div className="pointer-events-auto grid grid-cols-2 gap-1.5 rounded-2xl border border-white/15 bg-[#080c18]/90 p-1.5 shadow-2xl sm:flex sm:flex-nowrap sm:items-center sm:justify-center sm:rounded-full">
          {SHAPE_PRESETS.map((preset) => {
            const active = preset.id === currentShape;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleSelectShape(preset.id);
                }}
                aria-pressed={active}
                className={`relative whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-medium tracking-wide transition sm:px-4 sm:text-[13px] ${
                  active
                    ? 'bg-gradient-to-r from-[#00f0ff]/25 to-[#8a2be2]/30 text-white shadow-[0_0_16px_rgba(0,240,255,0.28)] ring-1 ring-[#00f0ff]/75'
                    : 'text-[#8ab4cc] hover:bg-white/5 hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
