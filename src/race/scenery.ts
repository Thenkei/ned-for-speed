import { createRng, hashString } from '../domain/rng';
import type { BodyKind, ThemeId } from '../domain/types';
import { SPRITE_SCALE, SPRITE_SIZE, carSprite, shade } from './carSprite';
import { sampleAtDistance, type Track } from './track';

/** Static decoration around a track: generated once per race from the track id. */

export interface Theme {
  readonly ground: string;
  readonly groundSpeck: string;
  readonly pavement: string;
  readonly asphalt: string;
  readonly wall: string;
  readonly lamp: string;
  /** Screen-space colour wash that sets the mood of the district. */
  readonly tint: string;
}

export const THEMES: Readonly<Record<ThemeId, Theme>> = {
  parking: { ground: '#23252e', groundSpeck: '#2c2f3a', pavement: '#3a3d49', asphalt: '#2a2c35', wall: '#d9a514', lamp: '#ffb347', tint: 'rgba(255,150,60,0.05)' },
  zi: { ground: '#1d2226', groundSpeck: '#262c31', pavement: '#3b4046', asphalt: '#2b2e33', wall: '#8a9199', lamp: '#ffd9a0', tint: 'rgba(120,170,255,0.05)' },
  port: { ground: '#182229', groundSpeck: '#1f2b33', pavement: '#36424a', asphalt: '#283238', wall: '#e8612c', lamp: '#9fe8ff', tint: 'rgba(60,200,255,0.06)' },
  corniche: { ground: '#1d2a22', groundSpeck: '#25352a', pavement: '#4a4638', asphalt: '#2f2f33', wall: '#e9e4d4', lamp: '#ffe2b0', tint: 'rgba(255,120,160,0.05)' },
  periph: { ground: '#17171f', groundSpeck: '#20202b', pavement: '#353540', asphalt: '#26262e', wall: '#6d6d7c', lamp: '#ff9a3c', tint: 'rgba(180,90,255,0.06)' },
};

type ItemKind = 'car' | 'warehouse' | 'truck' | 'container' | 'tree' | 'villa' | 'tower' | 'shop';

export interface SceneryItem {
  readonly kind: ItemKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly angle: number;
  readonly color: string;
  readonly variant: number;
  readonly body?: BodyKind;
  /** Bounding radius for culling. */
  readonly radius: number;
}

export interface Lamp {
  readonly x: number;
  readonly y: number;
  /** Where the pool of light lands on the road. */
  readonly glowX: number;
  readonly glowY: number;
}

export interface Scenery {
  readonly theme: Theme;
  readonly themeId: ThemeId;
  readonly items: readonly SceneryItem[];
  readonly lamps: readonly Lamp[];
  /** World Y beyond which the sea starts (corniche only). */
  readonly seaY: number | undefined;
}

const CAR_PAINTS = ['#c0392b', '#2c5fa8', '#d9d9d9', '#3d3d3d', '#7f8c8d', '#1e7d4a', '#e0b020', '#5b2d8c', '#f2f2f2', '#101010'];
const CONTAINER_COLORS = ['#b3402a', '#2b5d8f', '#2f7d57', '#d98a1f', '#8a8f96', '#7a2f5c', '#c9b037'];
const WAREHOUSE_COLORS = ['#4b545c', '#3d4a57', '#59616a', '#46505a', '#5a4d44'];
const TOWER_COLORS = ['#232333', '#2a2a3d', '#1d1d2b', '#2f2a3a'];
const VILLA_COLORS = ['#b5583a', '#c46a45', '#a84c33', '#d07a52'];
const PARKED_BODIES: readonly BodyKind[] = ['city', 'hatch', 'hatch', 'coupe', 'city', 'sport'];

/** Distance from a point to the centre line (coarse, used only at generation time). */
function distanceToTrack(track: Track, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < track.samples.length; i += 3) {
    const sample = track.samples[i];
    if (!sample) continue;
    const d = (sample.x - x) ** 2 + (sample.y - y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

interface PlacementRule {
  readonly kind: ItemKind;
  readonly cellW: number;
  readonly cellH: number;
  readonly probability: number;
  /** Size range. */
  readonly w: readonly [number, number];
  readonly h: readonly [number, number];
  readonly colors: readonly string[];
  /** Allowed distance band from the wall. */
  readonly near: number;
  readonly far: number;
  readonly jitter: number;
}

const RULES: Readonly<Record<ThemeId, readonly PlacementRule[]>> = {
  parking: [
    { kind: 'car', cellW: 34, cellH: 96, probability: 0.5, w: [42, 42], h: [20, 20], colors: CAR_PAINTS, near: 34, far: 430, jitter: 2 },
    { kind: 'shop', cellW: 620, cellH: 420, probability: 0.9, w: [460, 560], h: [260, 330], colors: ['#3a3f52', '#44405a'], near: 470, far: 1500, jitter: 30 },
  ],
  zi: [
    { kind: 'warehouse', cellW: 290, cellH: 240, probability: 0.72, w: [170, 240], h: [120, 190], colors: WAREHOUSE_COLORS, near: 20, far: 1200, jitter: 18 },
    { kind: 'truck', cellW: 150, cellH: 90, probability: 0.16, w: [96, 110], h: [24, 26], colors: ['#e6e6e6', '#c9d3dc', '#d8c9a0'], near: 22, far: 420, jitter: 20 },
  ],
  port: [
    { kind: 'container', cellW: 104, cellH: 46, probability: 0.62, w: [94, 94], h: [36, 36], colors: CONTAINER_COLORS, near: 18, far: 900, jitter: 3 },
    { kind: 'warehouse', cellW: 520, cellH: 420, probability: 0.3, w: [260, 340], h: [170, 220], colors: WAREHOUSE_COLORS, near: 520, far: 1400, jitter: 30 },
  ],
  corniche: [
    { kind: 'tree', cellW: 84, cellH: 84, probability: 0.5, w: [46, 84], h: [46, 84], colors: ['#1f4a2c', '#255733', '#1a3f27', '#2d6138'], near: 18, far: 1100, jitter: 30 },
    { kind: 'villa', cellW: 330, cellH: 300, probability: 0.45, w: [110, 150], h: [80, 110], colors: VILLA_COLORS, near: 40, far: 900, jitter: 40 },
  ],
  periph: [
    { kind: 'tower', cellW: 330, cellH: 310, probability: 0.68, w: [170, 250], h: [150, 230], colors: TOWER_COLORS, near: 30, far: 1500, jitter: 26 },
    { kind: 'truck', cellW: 200, cellH: 110, probability: 0.08, w: [96, 110], h: [24, 26], colors: ['#e6e6e6', '#c9d3dc'], near: 24, far: 300, jitter: 20 },
  ],
};

export function buildScenery(track: Track, themeId: ThemeId): Scenery {
  const rng = createRng(hashString(`scenery:${track.def.id}`));
  const items: SceneryItem[] = [];
  const margin = 900;
  const { minX, minY, maxX, maxY } = track.bounds;
  const seaY = themeId === 'corniche' ? maxY + track.wallOffset + 170 : undefined;
  const occupied: { x: number; y: number; r: number }[] = [];

  // Big items first so the small ones fill the gaps around them.
  const rules = [...RULES[themeId]].sort((a, b) => b.w[1] * b.h[1] - a.w[1] * a.h[1]);
  for (const rule of rules) {
    for (let cy = minY - margin; cy < maxY + margin; cy += rule.cellH) {
      for (let cx = minX - margin; cx < maxX + margin; cx += rule.cellW) {
        const roll = rng.next();
        const w = rng.range(rule.w[0], rule.w[1]);
        const h = rng.range(rule.h[0], rule.h[1]);
        const x = cx + rule.cellW / 2 + rng.range(-rule.jitter, rule.jitter);
        const y = cy + rule.cellH / 2 + rng.range(-rule.jitter, rule.jitter);
        const color = rng.pick(rule.colors);
        const variant = rng.int(0, 999);
        if (roll > rule.probability) continue;

        const upright = rule.kind === 'car';
        const radius = Math.hypot(w, h) / 2;
        if (seaY !== undefined && y + radius > seaY - 30) continue;
        const clearance = distanceToTrack(track, x, y) - track.wallOffset - (upright ? h : radius);
        if (clearance < rule.near || clearance > rule.far) continue;
        if (occupied.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + radius * 0.9)) continue;

        // Parked cars sit nose-in in rows, alternating direction by row.
        const row = Math.floor((cy - (minY - margin)) / rule.cellH);
        const angle = upright ? (row % 2 === 0 ? Math.PI / 2 : -Math.PI / 2) : rule.kind === 'tree' ? rng.range(0, Math.PI) : 0;
        const item: SceneryItem = {
          kind: rule.kind,
          x,
          y,
          w,
          h,
          angle,
          color,
          variant,
          radius: radius + 12,
          ...(upright ? { body: PARKED_BODIES[variant % PARKED_BODIES.length] as BodyKind } : {}),
        };
        items.push(item);
        if (rule.kind !== 'car' && rule.kind !== 'tree' && rule.kind !== 'container') {
          occupied.push({ x, y, r: radius });
        }
      }
    }
  }

  // Street lamps on alternating sides.
  const lamps: Lamp[] = [];
  const spacing = 300;
  const count = Math.floor(track.length / spacing);
  for (let i = 0; i < count; i++) {
    const sample = sampleAtDistance(track, i * spacing + 120);
    const side = i % 2 === 0 ? 1 : -1;
    const post = track.wallOffset + 4;
    const pool = track.halfWidth * 0.45;
    lamps.push({
      x: sample.x + sample.nx * side * post,
      y: sample.y + sample.ny * side * post,
      glowX: sample.x + sample.nx * side * pool,
      glowY: sample.y + sample.ny * side * pool,
    });
  }

  return { theme: THEMES[themeId], themeId, items, lamps, seaY };
}

function drawRoofBlock(ctx: CanvasRenderingContext2D, item: SceneryItem, depth: number): void {
  // Fake height: a darker footprint offset towards the bottom-right.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-item.w / 2 + depth, -item.h / 2 + depth, item.w, item.h);
  ctx.fillStyle = item.color;
  ctx.fillRect(-item.w / 2, -item.h / 2, item.w, item.h);
  ctx.strokeStyle = shade(item.color, 0.22);
  ctx.lineWidth = 2;
  ctx.strokeRect(-item.w / 2 + 1, -item.h / 2 + 1, item.w - 2, item.h - 2);
}

export function drawSceneryItem(ctx: CanvasRenderingContext2D, item: SceneryItem): void {
  ctx.save();
  ctx.translate(item.x, item.y);
  switch (item.kind) {
    case 'car': {
      ctx.rotate(item.angle);
      const sprite = carSprite({ body: item.body ?? 'hatch', paint: item.color, neon: '', spoiler: item.variant % 5 === 0 });
      ctx.drawImage(sprite, -SPRITE_SIZE / 2, -SPRITE_SIZE / 2, SPRITE_SIZE, sprite.height / SPRITE_SCALE);
      break;
    }
    case 'warehouse': {
      drawRoofBlock(ctx, item, 9);
      // Roof ribs and a skylight strip.
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -item.w / 2 + 14; x < item.w / 2; x += 14) {
        ctx.moveTo(x, -item.h / 2 + 3);
        ctx.lineTo(x, item.h / 2 - 3);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(190,225,255,0.16)';
      ctx.fillRect(-item.w / 2 + 12, -5, item.w - 24, 10);
      break;
    }
    case 'shop': {
      drawRoofBlock(ctx, item, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let x = -item.w / 2 + 30; x < item.w / 2 - 40; x += 70) {
        ctx.fillRect(x, -item.h / 2 + 26, 34, 22);
        ctx.fillRect(x + 18, item.h / 2 - 60, 34, 22);
      }
      // Neon sign strip on the edge facing the car park.
      ctx.save();
      ctx.shadowColor = '#ff3fa4';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ff3fa4';
      ctx.fillRect(-item.w / 2 + 40, item.h / 2 - 12, item.w - 80, 5);
      ctx.restore();
      break;
    }
    case 'truck': {
      ctx.rotate((item.variant % 4) * (Math.PI / 2) + 0.05);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(-item.w / 2 + 4, -item.h / 2 + 5, item.w, item.h);
      ctx.fillStyle = item.color;
      ctx.fillRect(-item.w / 2, -item.h / 2, item.w - 22, item.h);
      ctx.fillStyle = ['#b3402a', '#2b5d8f', '#2f7d57'][item.variant % 3] ?? '#b3402a';
      ctx.fillRect(item.w / 2 - 19, -item.h / 2 + 1, 19, item.h - 2);
      ctx.fillStyle = '#101820';
      ctx.fillRect(item.w / 2 - 8, -item.h / 2 + 3, 5, item.h - 6);
      break;
    }
    case 'container': {
      const stacked = item.variant % 3 !== 0;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-item.w / 2 + (stacked ? 8 : 4), -item.h / 2 + (stacked ? 9 : 5), item.w, item.h);
      ctx.fillStyle = stacked ? shade(item.color, 0.08) : shade(item.color, -0.12);
      ctx.fillRect(-item.w / 2, -item.h / 2, item.w, item.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -item.w / 2 + 6; x < item.w / 2; x += 6) {
        ctx.moveTo(x, -item.h / 2 + 2);
        ctx.lineTo(x, item.h / 2 - 2);
      }
      ctx.stroke();
      ctx.strokeStyle = shade(item.color, 0.3);
      ctx.strokeRect(-item.w / 2 + 0.5, -item.h / 2 + 0.5, item.w - 1, item.h - 1);
      break;
    }
    case 'tree': {
      const r = item.w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(6, 8, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(item.color, 0.14);
      ctx.beginPath();
      ctx.arc(-r * 0.22, -r * 0.25, r * 0.58, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'villa': {
      drawRoofBlock(ctx, item, 8);
      // Hipped roof ridge.
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-item.w / 2, -item.h / 2);
      ctx.lineTo(-item.w / 2 + item.h / 2, 0);
      ctx.lineTo(-item.w / 2, item.h / 2);
      ctx.moveTo(item.w / 2, -item.h / 2);
      ctx.lineTo(item.w / 2 - item.h / 2, 0);
      ctx.lineTo(item.w / 2, item.h / 2);
      ctx.moveTo(-item.w / 2 + item.h / 2, 0);
      ctx.lineTo(item.w / 2 - item.h / 2, 0);
      ctx.stroke();
      // Swimming pool, obviously.
      ctx.fillStyle = '#3fd0e8';
      ctx.fillRect(item.w / 2 + 14, -item.h / 4, 34, 22);
      ctx.strokeStyle = '#e9e4d4';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.w / 2 + 14, -item.h / 4, 34, 22);
      break;
    }
    case 'tower': {
      drawRoofBlock(ctx, item, 16);
      // Lit windows: a deterministic sprinkle.
      let seed = item.variant * 7919 + 13;
      for (let y = -item.h / 2 + 14; y < item.h / 2 - 12; y += 18) {
        for (let x = -item.w / 2 + 14; x < item.w / 2 - 12; x += 20) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          const lit = (seed >>> 16) % 5;
          ctx.fillStyle = lit === 0 ? 'rgba(255,214,130,0.75)' : lit === 1 ? 'rgba(130,220,255,0.5)' : 'rgba(255,255,255,0.04)';
          ctx.fillRect(x, y, 9, 7);
        }
      }
      break;
    }
  }
  ctx.restore();
}

/** Small tileable speckle texture so that the ground visibly scrolls under the car. */
export function createSpeckPattern(
  ctx: CanvasRenderingContext2D,
  base: string,
  speck: string,
  seedText: string,
): CanvasPattern | string {
  const size = 160;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return base;
  const rng = createRng(hashString(seedText));
  tileCtx.fillStyle = base;
  tileCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    tileCtx.fillStyle = i % 3 === 0 ? 'rgba(0,0,0,0.16)' : speck;
    const r = rng.range(0.8, 2.6);
    tileCtx.fillRect(rng.range(0, size - 3), rng.range(0, size - 3), r, r);
  }
  return ctx.createPattern(tile, 'repeat') ?? base;
}
