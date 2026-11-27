import type { CarLook } from '../domain/types';
import { renderCarPreview } from '../race/carSprite';

/** Sweep the old finish away under a fan of paint. The garage already shows the purchased finish underneath. */
export function playPaintSpray(car: HTMLCanvasElement, oldLook: CarLook, paint: string): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const overlay = document.createElement('canvas');
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  overlay.className = 'paint-spray';
  overlay.setAttribute('aria-hidden', 'true');
  car.after(overlay);
  renderCarPreview(overlay, oldLook);

  const original = document.createElement('canvas');
  original.width = overlay.width;
  original.height = overlay.height;
  original.getContext('2d')?.drawImage(overlay, 0, 0);

  // Draw in the same coordinates at every screen size and pixel density.
  const width = 420;
  const height = 220;
  ctx.setTransform(overlay.width / width, 0, 0, overlay.height / height, 0, 0);
  const drops = Array.from({ length: 180 }, () => ({
    offset: Math.random(), spread: Math.random() * 2 - 1, radius: 0.6 + Math.random() * 1.4,
  }));
  const mist = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  mist.addColorStop(0, paint);
  mist.addColorStop(1, 'transparent');

  const start = performance.now();
  const frame = (now: number): void => {
    if (!overlay.isConnected) return;
    const progress = Math.min(1, (now - start) / 1100);
    if (progress >= 1) {
      overlay.remove();
      return;
    }
    const x = width * (progress * 1.2 - 0.1);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, width - x, height);
    ctx.clip();
    ctx.drawImage(original, 0, 0, width, height);
    ctx.restore();

    ctx.save();
    ctx.translate(x, height * 0.52);
    ctx.scale(42, 54);
    ctx.fillStyle = mist;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    for (const drop of drops) {
      const age = ((now - start) / 270 + drop.offset) % 1;
      ctx.fillStyle = drop.radius < 1 ? '#fff' : paint;
      ctx.globalAlpha = 1 - age;
      ctx.beginPath();
      ctx.arc(x + 20 * (1 - age) + drop.spread * age * 46, 24 + age * 148, drop.radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
