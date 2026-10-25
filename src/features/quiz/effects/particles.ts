// The quiz's particle system (plan §7.7), our own and small: confetti for a right answer, sparks
// for a streak, a ring for a level up. Pure simulation (positions in CSS pixels, time in
// seconds), drawn by `EffectsCanvas`; at most `MAX_PARTICLES` alive, the oldest dropped first.

export const MAX_PARTICLES = 400;
const GRAVITY = 900;
const DRAG = 1.6;

export type ParticleShape = 'rect' | 'dot' | 'ring';

export interface Particle {
  shape: ParticleShape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left, and the total (the fade). */
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
  /** Whether gravity pulls it (confetti falls, sparks and rings float). */
  falls: boolean;
}

export class ParticleSystem {
  particles: Particle[] = [];

  /** `random` in [0, 1); injectable so the tests are deterministic. */
  constructor(private readonly random: () => number = Math.random) {}

  get alive(): number {
    return this.particles.length;
  }

  private add(p: Particle) {
    this.particles.push(p);
    if (this.particles.length > MAX_PARTICLES)
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  private pick<T>(items: readonly T[], fallback: T): T {
    return items[Math.floor(this.random() * items.length)] ?? fallback;
  }

  /** A burst of paper confetti from (x, y), mostly upwards. */
  confetti(x: number, y: number, count: number, colors: readonly string[]) {
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (this.random() - 0.5) * Math.PI * 0.9;
      const speed = 260 + this.random() * 420;
      const life = 1.1 + this.random() * 0.7;
      this.add({
        shape: this.random() < 0.7 ? 'rect' : 'dot',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: 5 + this.random() * 5,
        color: this.pick(colors, '#888'),
        rotation: this.random() * Math.PI,
        spin: (this.random() - 0.5) * 14,
        falls: true,
      });
    }
  }

  /** Short sparks around (x, y): the streak. */
  sparks(x: number, y: number, colors: readonly string[], count = 18) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.random() * 0.3;
      const speed = 120 + this.random() * 160;
      const life = 0.45 + this.random() * 0.35;
      this.add({
        shape: 'dot',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life,
        maxLife: life,
        size: 2 + this.random() * 2.5,
        color: this.pick(colors, '#f80'),
        rotation: 0,
        spin: 0,
        falls: false,
      });
    }
  }

  /** An expanding ring at (x, y): the level up. */
  ring(x: number, y: number, color: string) {
    this.add({
      shape: 'ring',
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.7,
      maxLife: 0.7,
      size: 8,
      color,
      rotation: 0,
      spin: 0,
      falls: false,
    });
  }

  /** Advances by `dt` seconds; returns whether anything is still alive. */
  step(dt: number): boolean {
    const d = Math.min(dt, 0.05);
    const drag = Math.exp(-DRAG * d);
    let kept = 0;
    for (const p of this.particles) {
      p.life -= d;
      if (p.life <= 0) continue;
      if (p.shape === 'ring') {
        p.size += 160 * d;
      } else {
        p.vx *= drag;
        p.vy = p.vy * drag + (p.falls ? GRAVITY * d : 0);
        p.x += p.vx * d;
        p.y += p.vy * d;
        p.rotation += p.spin * d;
      }
      this.particles[kept++] = p;
    }
    this.particles.length = kept;
    return kept > 0;
  }

  clear() {
    this.particles = [];
  }
}
