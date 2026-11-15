import type { BodyKind, CarLook } from '../domain/types';

export interface CarDrawState {
  /** 0–1 brake light intensity. */
  readonly braking?: number;
  /** True while nitro flames should be drawn. */
  readonly nitro?: boolean;
  /** Front wheel steering angle in radians. */
  readonly steer?: number;
  readonly headlights?: boolean;
  /** Animation clock in seconds. */
  readonly time?: number;
  /** Charred wreck after an engine explosion. */
  readonly wrecked?: boolean;
}

interface BodyShape {
  readonly length: number;
  readonly width: number;
  /** Width of the nose / tail relative to the widest point. */
  readonly nose: number;
  readonly tail: number;
  /** Cabin extent along the car, from the centre (negative = towards the rear). */
  readonly cabinRear: number;
  readonly cabinFront: number;
}

export const BODY_SHAPES: Readonly<Record<BodyKind, BodyShape>> = {
  city: { length: 38, width: 19, nose: 0.8, tail: 0.9, cabinRear: -15, cabinFront: 7 },
  hatch: { length: 42, width: 20, nose: 0.78, tail: 0.9, cabinRear: -16, cabinFront: 7 },
  coupe: { length: 45, width: 20, nose: 0.74, tail: 0.84, cabinRear: -14, cabinFront: 6 },
  sport: { length: 46, width: 21, nose: 0.7, tail: 0.86, cabinRear: -13, cabinFront: 6 },
  muscle: { length: 50, width: 22, nose: 0.86, tail: 0.88, cabinRear: -15, cabinFront: 4 },
  super: { length: 48, width: 23, nose: 0.62, tail: 0.92, cabinRear: -9, cabinFront: 9 },
};

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return [128, 128, 128];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Lightens (amount > 0) or darkens (amount < 0) a hex colour; amount in [-1, 1]. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (c: number): number => Math.round(c + (target - c) * k);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function bodyPath(ctx: CanvasRenderingContext2D, shape: BodyShape): void {
  const hl = shape.length / 2;
  const hw = shape.width / 2;
  const nw = hw * shape.nose;
  const tw = hw * shape.tail;
  ctx.beginPath();
  ctx.moveTo(-hl + 3, -tw);
  ctx.quadraticCurveTo(-hl * 0.4, -hw - 0.4, 0, -hw);
  ctx.quadraticCurveTo(hl * 0.62, -hw, hl - 5, -nw);
  ctx.quadraticCurveTo(hl + 1.2, -nw * 0.62, hl, 0);
  ctx.quadraticCurveTo(hl + 1.2, nw * 0.62, hl - 5, nw);
  ctx.quadraticCurveTo(hl * 0.62, hw, 0, hw);
  ctx.quadraticCurveTo(-hl * 0.4, hw + 0.4, -hl + 3, tw);
  ctx.quadraticCurveTo(-hl - 0.6, 0, -hl + 3, -tw);
  ctx.closePath();
}

/** Draws a car centred on the origin, nose pointing to +X, about 46 px long. */
export function drawCar(ctx: CanvasRenderingContext2D, look: CarLook, state: CarDrawState = {}): void {
  const shape = BODY_SHAPES[look.body];
  const hl = shape.length / 2;
  const hw = shape.width / 2;
  const nw = hw * shape.nose;
  const tw = hw * shape.tail;
  const time = state.time ?? 0;
  const wrecked = state.wrecked === true;
  const paint = wrecked ? '#2b2622' : look.paint;

  // Underglow neon.
  if (look.neon && !wrecked) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = look.neon;
    ctx.shadowBlur = 16;
    ctx.fillStyle = rgba(look.neon, 0.42);
    roundRect(ctx, -hl - 1, -hw - 2.5, shape.length + 2, shape.width + 5, 7);
    ctx.fill();
    ctx.restore();
  }

  // Contact shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  roundRect(ctx, -hl + 1.5, -hw + 2.5, shape.length, shape.width, 6);
  ctx.fill();

  // Wheels (front pair steers).
  ctx.fillStyle = '#0b0b0d';
  const wheelX = shape.length * 0.3;
  const wheelY = hw - 0.8;
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      ctx.save();
      ctx.translate(sx * wheelX, sy * wheelY);
      if (sx > 0) ctx.rotate(state.steer ?? 0);
      roundRect(ctx, -4, -2.2, 8, 4.4, 1.4);
      ctx.fill();
      ctx.restore();
    }
  }

  // Jacky-grade rear wing, drawn first so that the body overlaps its stays.
  if (look.spoiler) {
    ctx.fillStyle = wrecked ? '#1a1715' : '#16171c';
    roundRect(ctx, -hl - 3.5, -hw - 1.5, 6.5, shape.width + 3, 1.5);
    ctx.fill();
    ctx.fillStyle = wrecked ? '#2b2622' : shade(look.paint, -0.25);
    ctx.fillRect(-hl - 3.5, -hw - 1.5, 6.5, 1.8);
    ctx.fillRect(-hl - 3.5, hw - 0.3, 6.5, 1.8);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-hl - 0.2, -hw + 0.5, 0.9, shape.width - 1);
  }

  // Body with a soft highlight across its width.
  const bodyGradient = ctx.createLinearGradient(0, -hw, 0, hw);
  bodyGradient.addColorStop(0, shade(paint, -0.42));
  bodyGradient.addColorStop(0.22, shade(paint, -0.08));
  bodyGradient.addColorStop(0.5, shade(paint, 0.16));
  bodyGradient.addColorStop(0.78, shade(paint, -0.08));
  bodyGradient.addColorStop(1, shade(paint, -0.42));
  bodyPath(ctx, shape);
  ctx.fillStyle = bodyGradient;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();

  // Body-specific details.
  if (look.body === 'muscle' && !wrecked) {
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillRect(shape.cabinFront, -3.4, hl - shape.cabinFront - 2, 2.2);
    ctx.fillRect(shape.cabinFront, 1.2, hl - shape.cabinFront - 2, 2.2);
    ctx.fillRect(-hl + 2, -3.4, hl + shape.cabinRear - 2, 2.2);
    ctx.fillRect(-hl + 2, 1.2, hl + shape.cabinRear - 2, 2.2);
  }
  if (look.body === 'super') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < 4; i++) ctx.fillRect(-hl + 4 + i * 2.6, -5, 1.2, 10);
    ctx.beginPath();
    ctx.moveTo(-4, -hw + 0.6);
    ctx.lineTo(4, -hw + 0.6);
    ctx.lineTo(-2, -hw + 3.4);
    ctx.closePath();
    ctx.moveTo(-4, hw - 0.6);
    ctx.lineTo(4, hw - 0.6);
    ctx.lineTo(-2, hw - 3.4);
    ctx.closePath();
    ctx.fill();
  }
  if (look.body === 'sport' || look.body === 'coupe') {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    roundRect(ctx, shape.cabinFront + 4, -2.6, 5, 5.2, 1.2);
    ctx.fill();
  }

  // Glasshouse.
  const cabinLength = shape.cabinFront - shape.cabinRear;
  const cabinHalfWidth = hw - 2.1;
  const glass = ctx.createLinearGradient(shape.cabinRear, 0, shape.cabinFront, 0);
  glass.addColorStop(0, '#070b12');
  glass.addColorStop(0.75, '#111c2c');
  glass.addColorStop(1, wrecked ? '#111' : '#3b5878');
  ctx.fillStyle = glass;
  roundRect(ctx, shape.cabinRear, -cabinHalfWidth, cabinLength, cabinHalfWidth * 2, 4);
  ctx.fill();

  // Roof panel (leaves windscreen, rear screen and side windows visible).
  const roofRear = shape.cabinRear + cabinLength * 0.2;
  const roofLength = cabinLength * 0.5;
  ctx.fillStyle = shade(paint, wrecked ? 0 : 0.1);
  roundRect(ctx, roofRear, -cabinHalfWidth + 1.6, roofLength, (cabinHalfWidth - 1.6) * 2, 2.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, roofRear + 1, -cabinHalfWidth + 2.4, roofLength - 2, 2, 1);
  ctx.fill();

  // Lights.
  if (!wrecked) {
    const lightsOn = state.headlights !== false;
    ctx.fillStyle = lightsOn ? '#fff6c9' : '#c9c9c0';
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(hl - 3.2, side * nw * 0.7, 2.2, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const braking = state.braking ?? 0;
    ctx.save();
    if (braking > 0.05) {
      ctx.shadowColor = '#ff2a2a';
      ctx.shadowBlur = 8 * braking;
    }
    ctx.fillStyle = braking > 0.05 ? '#ff3b3b' : '#8f1414';
    for (const side of [-1, 1] as const) {
      roundRect(ctx, -hl + 0.6, side * tw * 0.72 - 1.9, 2.2, 3.8, 0.8);
      ctx.fill();
    }
    ctx.restore();
  }

  // Nitro flames out of the exhaust.
  if (state.nitro && !wrecked) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1] as const) {
      const flicker = 0.75 + 0.25 * Math.sin(time * 61 + side * 1.7) + 0.12 * Math.sin(time * 137);
      const flameLength = 17 * flicker;
      const y = side * tw * 0.42;
      const gradient = ctx.createLinearGradient(-hl, 0, -hl - flameLength, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
      gradient.addColorStop(0.3, 'rgba(90,220,255,0.85)');
      gradient.addColorStop(1, 'rgba(40,80,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(-hl + 1, y - 2.4);
      ctx.quadraticCurveTo(-hl - flameLength * 0.5, y - 3.2, -hl - flameLength, y);
      ctx.quadraticCurveTo(-hl - flameLength * 0.5, y + 3.2, -hl + 1, y + 2.4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

const spriteCache = new Map<string, HTMLCanvasElement>();
export const SPRITE_SCALE = 2;
export const SPRITE_SIZE = 72;

/** Pre-rendered static car (parked cars in the scenery): much cheaper than redrawing gradients. */
export function carSprite(look: CarLook): HTMLCanvasElement {
  const key = `${look.body}|${look.paint}|${look.spoiler}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE * SPRITE_SCALE;
  canvas.height = SPRITE_SIZE * SPRITE_SCALE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
    ctx.translate(SPRITE_SIZE / 2, SPRITE_SIZE / 2);
    drawCar(ctx, { ...look, neon: '' }, { headlights: false });
  }
  spriteCache.set(key, canvas);
  return canvas;
}

/** Renders a static, nicely framed top-down preview of a car into a canvas (garage, dealer cards). */
export function renderCarPreview(canvas: HTMLCanvasElement, look: CarLook): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssWidth = canvas.clientWidth || canvas.width || 240;
  const cssHeight = canvas.clientHeight || canvas.height || 120;
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const shape = BODY_SHAPES[look.body];
  // Leave room for the wing and the neon halo.
  const scale = Math.min(width / (shape.length + 26), height / (shape.width + 22));
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-0.12);
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  drawCar(ctx, look, { headlights: true });
}
