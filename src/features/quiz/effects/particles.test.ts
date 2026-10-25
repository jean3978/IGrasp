import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, ParticleSystem } from './particles';

/** A small deterministic generator (the same sequence on every run). */
function seeded(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe('the particle system', () => {
  it('bursts confetti upwards, lets it fall, and dies out', () => {
    const fx = new ParticleSystem(seeded());
    fx.confetti(100, 300, 60, ['#f00', '#0f0']);
    expect(fx.alive).toBe(60);
    expect(fx.particles.every((p) => p.vy < 0)).toBe(true);
    fx.step(0.016);
    expect(fx.particles.every((p) => p.y < 300)).toBe(true);
    // Gravity wins after a while.
    for (let i = 0; i < 40; i++) fx.step(0.016);
    expect(fx.particles.some((p) => p.vy > 0)).toBe(true);
    // Everything ends: the loop can stop (0 frames when idle).
    let frames = 0;
    while (fx.step(0.016)) frames++;
    expect(fx.alive).toBe(0);
    expect(frames).toBeLessThan(200);
    expect(fx.step(0.016)).toBe(false);
  });

  it('never keeps more than the cap, dropping the oldest', () => {
    const fx = new ParticleSystem(seeded());
    fx.ring(0, 0, '#00f');
    fx.confetti(0, 0, MAX_PARTICLES + 50, ['#f00']);
    expect(fx.alive).toBe(MAX_PARTICLES);
    expect(fx.particles.some((p) => p.shape === 'ring')).toBe(false);
  });

  it('floats sparks and grows a ring without gravity', () => {
    const fx = new ParticleSystem(seeded());
    fx.sparks(50, 50, ['#fa0'], 12);
    fx.ring(50, 50, '#0af');
    const ring = fx.particles.find((p) => p.shape === 'ring');
    fx.step(0.1);
    expect(fx.alive).toBe(13);
    expect(ring?.size).toBeGreaterThan(8);
    expect(ring?.x).toBe(50);
    // A long frame (a background tab) is clamped, not a jump.
    const before = fx.particles[0]?.x ?? 0;
    fx.step(5);
    expect(Math.abs((fx.particles[0]?.x ?? before) - before)).toBeLessThan(20);
  });
});
