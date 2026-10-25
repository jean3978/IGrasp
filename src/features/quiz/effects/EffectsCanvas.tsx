// One canvas over the Quiz tab that draws the particle system. The frame loop runs only while
// particles are alive (0 frames when idle), the canvas follows the device pixel ratio, and the
// colours come from the theme tokens at the moment an effect starts.

import { useEffect, useRef } from 'react';
import { onEffect } from './effects';
import type { EffectKind } from './effects';
import { ParticleSystem } from './particles';
import type { Particle } from './particles';

function tokens(el: Element, names: string[]): string[] {
  const style = getComputedStyle(el);
  return names.map((n) => style.getPropertyValue(n).trim()).filter((c) => c !== '');
}

function draw(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.5)));
  if (p.shape === 'ring') {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3 * (p.life / p.maxLife) + 0.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = p.color;
  if (p.shape === 'dot') {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
  ctx.restore();
}

export function EffectsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const fx = new ParticleSystem();
    let frame = 0;
    let last = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const tick = (now: number) => {
      const alive = fx.step(last === 0 ? 0.016 : (now - last) / 1000);
      last = now;
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      for (const p of fx.particles) draw(ctx, p);
      ctx.globalAlpha = 1;
      frame = alive ? requestAnimationFrame(tick) : 0;
      if (!alive) last = 0;
    };

    const start = (kind: EffectKind, vx: number, vy: number) => {
      const box = canvas.getBoundingClientRect();
      const x = vx - box.left;
      const y = vy - box.top;
      if (kind === 'confetti')
        fx.confetti(
          x,
          y,
          70,
          tokens(canvas, ['--ai-accent', '--quiz-good', '--quiz-flame', '--link']),
        );
      else if (kind === 'sparks')
        fx.sparks(x, y, tokens(canvas, ['--quiz-flame', '--quiz-flame-core']));
      else fx.ring(x, y, tokens(canvas, ['--ai-accent'])[0] ?? '#d97757');
      if (frame === 0) {
        resize();
        frame = requestAnimationFrame(tick);
      }
    };

    const off = onEffect(start);
    window.addEventListener('resize', resize);
    return () => {
      off();
      window.removeEventListener('resize', resize);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="quiz-effects" aria-hidden />;
}
