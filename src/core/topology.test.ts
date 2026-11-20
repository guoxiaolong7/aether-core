import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  SHAPE_PRESETS,
  createInitialAppState,
  fillRadialGradientColors,
  fillShapePositions,
  getResponsiveParticleCount,
  isClickWithinThreshold,
} from './topology';

test('getResponsiveParticleCount selects 12000 on desktop and 5000 on mobile', () => {
  assert.equal(getResponsiveParticleCount(1440), 12000);
  assert.equal(getResponsiveParticleCount(768), 12000);
  assert.equal(getResponsiveParticleCount(767), 5000);
  assert.equal(getResponsiveParticleCount(375), 5000);
});

test('createInitialAppState matches consolidated CONFIG defaults', () => {
  const state = createInitialAppState(1440);
  assert.equal(state.currentShape, 'sphere');
  assert.equal(state.bloomIntensity, CONFIG.bloom.strength);
  assert.equal(state.forceRadius, CONFIG.physics.repulsionRadius);
  assert.equal(state.interactionMode, 'repel');
  assert.equal(state.isPaused, false);
  assert.equal(state.particleCount, 12000);
  assert.equal(SHAPE_PRESETS.length, 4);
});

test('isClickWithinThreshold enforces < 5px displacement to prevent orbit drag false pulse', () => {
  assert.equal(isClickWithinThreshold(0, 0), true);
  assert.equal(isClickWithinThreshold(3, 3), true); // sqrt(18) = 4.24 < 5
  assert.equal(isClickWithinThreshold(3, 4), false); // 5px boundary -> drag, not click
  assert.equal(isClickWithinThreshold(10, 0), false);
});

for (const preset of SHAPE_PRESETS) {
  test(`fillShapePositions(${preset.id}) produces finite bounded centered coordinates at 12000 and 5000`, () => {
    for (const count of [12000, 5000]) {
      const positions = new Float32Array(count * 3);
      fillShapePositions(preset.id, positions, count);

      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let maxR = 0;

      for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > maxR) maxR = r;
        sumX += x;
        sumY += y;
        sumZ += z;
      }

      assert.ok(maxR > 2.2 && maxR < 5.5, `${preset.id} maxR=${maxR}`);
      assert.ok(Math.abs(sumX / count) < 0.08, `${preset.id} centroid X`);
      assert.ok(Math.abs(sumY / count) < 0.08, `${preset.id} centroid Y`);
      assert.ok(Math.abs(sumZ / count) < 0.08, `${preset.id} centroid Z`);
    }
  });
}

test('fillRadialGradientColors outputs valid [0, 1] RGB channels transitioning from cyan to violet', () => {
  const count = 2;
  const positions = new Float32Array([
    0.5, 0, 0,
    CONFIG.physics.sphereRadius * 1.15, 0, 0,
  ]);
  const colors = new Float32Array(count * 3);
  fillRadialGradientColors(colors, positions, count, CONFIG.physics.sphereRadius);

  assert.ok(colors[1] > 0.9);
  assert.ok(colors[2] > 0.95);
  assert.ok(Math.abs(colors[3] - 0.541) < 0.03);
  assert.ok(Math.abs(colors[4] - 0.169) < 0.03);
  assert.ok(Math.abs(colors[5] - 0.886) < 0.03);
});
