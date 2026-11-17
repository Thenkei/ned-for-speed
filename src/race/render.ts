import { KMH_PER_PX_S, MAX_HEAT } from '../domain/engine';
import { BODY_SHAPES, drawCar, rgba } from './carSprite';
import { buildScenery, createSpeckPattern, drawSceneryItem, type Scenery } from './scenery';
import { playerPosition, rankCars, type CarSim, type RaceSim } from './sim';
import type { Track } from './track';

/** Everything visual about a race. Owns no game rules: it only reads the simulation. */

interface Particle {
  kind: 'smoke' | 'fire' | 'spark' | 'debris';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface SkidSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Banner {
  text: string;
  sub?: string;
  color: string;
  /** Seconds left on screen. */
  ttl: number;
  big: boolean;
}

const MAX_PARTICLES = 420;
const MAX_SKIDS = 900;
const FONT = '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", Impact, "Helvetica Neue", Arial, sans-serif';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function ordinal(position: number): string {
  return position === 1 ? '1er' : `${position}e`;
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

export class RaceRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly track: Track;
  private readonly scenery: Scenery;
  private readonly roadPath: Path2D;
  private readonly lanePaths: Path2D[];
  private readonly groundFill: CanvasPattern | string;
  private readonly asphaltFill: CanvasPattern | string;
  private readonly glowSprite: HTMLCanvasElement;
  private readonly minimapPoints: { x: number; y: number }[];
  private readonly particles: Particle[] = [];
  private readonly skids: SkidSegment[] = [];
  private skidCursor = 0;
  private readonly lastRear = new Map<number, { lx: number; ly: number; rx: number; ry: number; active: boolean }>();
  private camX: number;
  private camY: number;
  private zoom = 1;
  private shake = 0;
  private clock = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private banner: Banner | undefined;
  private hint: string | undefined;
  /** Seconds the gear readout stays highlighted after a shift. */
  private gearFlash = 0;
  private lastGear = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sim: RaceSim,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    this.track = sim.track;
    this.scenery = buildScenery(sim.track, sim.setup.theme);
    this.camX = sim.player.x;
    this.camY = sim.player.y;

    this.roadPath = new Path2D();
    sim.track.samples.forEach((sample, index) => {
      if (index === 0) this.roadPath.moveTo(sample.x, sample.y);
      else this.roadPath.lineTo(sample.x, sample.y);
    });
    this.roadPath.closePath();

    this.lanePaths = sim.track.def.laneLines.map((offset) => {
      const path = new Path2D();
      sim.track.samples.forEach((sample, index) => {
        const x = sample.x + sample.nx * offset;
        const y = sample.y + sample.ny * offset;
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
      return path;
    });

    const theme = this.scenery.theme;
    this.groundFill = createSpeckPattern(ctx, theme.ground, theme.groundSpeck, `ground:${sim.setup.theme}`);
    this.asphaltFill = createSpeckPattern(ctx, theme.asphalt, 'rgba(255,255,255,0.05)', `asphalt:${sim.setup.theme}`);
    this.glowSprite = this.createGlowSprite(theme.lamp);

    const stride = Math.max(1, Math.floor(sim.track.samples.length / 160));
    this.minimapPoints = sim.track.samples.filter((_, i) => i % stride === 0).map((s) => ({ x: s.x, y: s.y }));
  }

  private createGlowSprite(color: string): HTMLCanvasElement {
    const size = 256;
    const sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const g = sprite.getContext('2d');
    if (g) {
      const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, rgba(color, 0.34));
      gradient.addColorStop(0.35, rgba(color, 0.15));
      gradient.addColorStop(1, rgba(color, 0));
      g.fillStyle = gradient;
      g.fillRect(0, 0, size, size);
    }
    return sprite;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    this.width = Math.max(1, cssWidth);
    this.height = Math.max(1, cssHeight);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
  }

  showBanner(banner: Banner): void {
    this.banner = banner;
  }

  /** One-line driving tip shown at the bottom of the screen (undefined hides it). */
  setHint(hint: string | undefined): void {
    this.hint = hint;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  // ───────────────────────── Effects ─────────────────────────

  private spawn(particle: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(particle);
  }

  explode(car: CarSim): void {
    for (let i = 0; i < 46; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 260;
      this.spawn({
        kind: i % 3 === 0 ? 'debris' : 'fire',
        x: car.x,
        y: car.y,
        vx: Math.cos(angle) * speed + car.vx * 0.4,
        vy: Math.sin(angle) * speed + car.vy * 0.4,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.9,
        size: 5 + Math.random() * 12,
        color: i % 2 === 0 ? '#ffb347' : '#ff5a1f',
      });
    }
    for (let i = 0; i < 18; i++) {
      this.spawn({
        kind: 'smoke',
        x: car.x + (Math.random() - 0.5) * 20,
        y: car.y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 60 + car.vx * 0.2,
        vy: (Math.random() - 0.5) * 60 + car.vy * 0.2,
        life: 0,
        maxLife: 1.6 + Math.random() * 1.4,
        size: 14 + Math.random() * 18,
        color: '#2a2a2a',
      });
    }
    if (car.isPlayer) this.addShake(1.2);
  }

  sparks(car: CarSim, strength: number): void {
    const count = Math.round(3 + strength * 8);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 180;
      this.spawn({
        kind: 'spark',
        x: car.x,
        y: car.y,
        vx: Math.cos(angle) * speed + car.vx * 0.5,
        vy: Math.sin(angle) * speed + car.vy * 0.5,
        life: 0,
        maxLife: 0.2 + Math.random() * 0.3,
        size: 2,
        color: '#ffe08a',
      });
    }
    if (car.isPlayer) this.addShake(0.25 + strength * 0.5);
  }

  private updateEffects(dt: number): void {
    const sim = this.sim;
    for (const car of sim.cars) {
      const shape = BODY_SHAPES[car.racer.look.body];
      const cos = Math.cos(car.heading);
      const sin = Math.sin(car.heading);
      const rearX = car.x - cos * shape.length * 0.3;
      const rearY = car.y - sin * shape.length * 0.3;
      const half = shape.width / 2 - 1;
      const lx = rearX - sin * half;
      const ly = rearY + cos * half;
      const rx = rearX + sin * half;
      const ry = rearY - cos * half;

      // Tyre marks when sliding or stamping on the brakes.
      const skidding = car.slip > 55 || (car.controls.brake > 0.6 && car.speed > 180);
      const previous = this.lastRear.get(car.id);
      if (skidding && previous?.active) {
        this.pushSkid(previous.lx, previous.ly, lx, ly);
        this.pushSkid(previous.rx, previous.ry, rx, ry);
        if (Math.random() < dt * 22) {
          this.spawn({ kind: 'smoke', x: rearX, y: rearY, vx: car.vx * 0.15, vy: car.vy * 0.15, life: 0, maxLife: 0.6, size: 7, color: '#9a9a9a' });
        }
      }
      this.lastRear.set(car.id, { lx, ly, rx, ry, active: skidding });

      // Engine smoke: grey when hot, black and thick once it has let go.
      const spec = car.engineSpec;
      const heat = car.engine.heat;
      const noseX = car.x + cos * shape.length * 0.3;
      const noseY = car.y + sin * shape.length * 0.3;
      if (car.engine.exploded) {
        if (Math.random() < dt * 26) {
          this.spawn({ kind: 'smoke', x: noseX, y: noseY, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, life: 0, maxLife: 1.8, size: 12, color: '#1c1c1c' });
        }
        if (Math.random() < dt * 14) {
          this.spawn({ kind: 'fire', x: noseX, y: noseY, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 30, life: 0, maxLife: 0.5, size: 8, color: '#ff7a1f' });
        }
      } else if (heat > spec.redline - 8) {
        const intensity = clamp((heat - (spec.redline - 8)) / (MAX_HEAT - spec.redline + 8), 0, 1);
        if (Math.random() < dt * (6 + intensity * 30)) {
          this.spawn({ kind: 'smoke', x: noseX, y: noseY, vx: car.vx * 0.3, vy: car.vy * 0.3, life: 0, maxLife: 0.9, size: 6 + intensity * 8, color: intensity > 0.5 ? '#5a5a5a' : '#bdbdbd' });
        }
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i] as Particle;
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const damping = p.kind === 'smoke' ? 1.2 : 2.6;
      p.vx *= Math.exp(-damping * dt);
      p.vy *= Math.exp(-damping * dt);
    }
  }

  private pushSkid(x1: number, y1: number, x2: number, y2: number): void {
    if (Math.hypot(x2 - x1, y2 - y1) > 40) return;
    const segment = { x1, y1, x2, y2 };
    if (this.skids.length < MAX_SKIDS) this.skids.push(segment);
    else {
      this.skids[this.skidCursor] = segment;
      this.skidCursor = (this.skidCursor + 1) % MAX_SKIDS;
    }
  }

  // ───────────────────────── Frame ─────────────────────────

  render(dt: number): void {
    const { ctx, sim } = this;
    this.clock += dt;
    this.updateEffects(dt);
    if (this.banner) {
      this.banner.ttl -= dt;
      if (this.banner.ttl <= 0) this.banner = undefined;
    }

    // Camera: look ahead of the car and pull back with speed.
    const player = sim.player;
    const speedRatio = clamp(Math.abs(player.speed) / 900, 0, 1);
    const targetX = player.x + player.vx * 0.3;
    const targetY = player.y + player.vy * 0.3;
    const follow = Math.min(1, dt * 5);
    this.camX += (targetX - this.camX) * follow;
    this.camY += (targetY - this.camY) * follow;
    const baseZoom = clamp(Math.min(this.width, this.height * 1.35) / 880, 0.5, 1.6);
    const targetZoom = baseZoom * (1.12 - 0.4 * speedRatio);
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const shakeX = (Math.random() - 0.5) * this.shake * 16;
    const shakeY = (Math.random() - 0.5) * this.shake * 16;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.scenery.theme.ground;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.width / 2 + shakeX, this.height / 2 + shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    const viewHalfW = this.width / 2 / this.zoom + 80;
    const viewHalfH = this.height / 2 / this.zoom + 80;
    const visible = (x: number, y: number, radius: number): boolean =>
      Math.abs(x - this.camX) < viewHalfW + radius && Math.abs(y - this.camY) < viewHalfH + radius;

    this.drawGround(viewHalfW, viewHalfH);
    this.drawRoad();
    this.drawSkids();
    for (const item of this.scenery.items) {
      if (visible(item.x, item.y, item.radius)) drawSceneryItem(ctx, item);
    }
    this.drawLamps(visible);
    this.drawCars(visible);
    this.drawParticles();
    ctx.restore();

    this.drawAtmosphere();
    this.drawHud(dt);
  }

  private drawGround(viewHalfW: number, viewHalfH: number): void {
    const { ctx } = this;
    ctx.fillStyle = this.groundFill;
    ctx.fillRect(this.camX - viewHalfW, this.camY - viewHalfH, viewHalfW * 2, viewHalfH * 2);

    const seaY = this.scenery.seaY;
    if (seaY !== undefined && this.camY + viewHalfH > seaY - 40) {
      const left = this.camX - viewHalfW;
      const sea = ctx.createLinearGradient(0, seaY, 0, seaY + 500);
      sea.addColorStop(0, '#17506b');
      sea.addColorStop(1, '#0b2740');
      ctx.fillStyle = sea;
      ctx.fillRect(left, seaY, viewHalfW * 2, viewHalfH * 2 + 600);
      // Beach strip and a slow line of foam.
      ctx.fillStyle = '#b9a67a';
      ctx.fillRect(left, seaY - 34, viewHalfW * 2, 34);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const start = Math.floor(left / 40) * 40;
      for (let x = start; x < left + viewHalfW * 2 + 40; x += 40) {
        const y = seaY + 5 + Math.sin(x * 0.02 + this.clock * 1.4) * 4;
        if (x === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawRoad(): void {
    const { ctx, track } = this;
    const theme = this.scenery.theme;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Wall, pavement, kerb line, asphalt: one path stroked at decreasing widths.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = track.wallOffset * 2 + 26;
    ctx.stroke(this.roadPath);
    ctx.strokeStyle = theme.wall;
    ctx.lineWidth = track.wallOffset * 2 + 10;
    ctx.stroke(this.roadPath);
    ctx.strokeStyle = theme.pavement;
    ctx.lineWidth = track.wallOffset * 2;
    ctx.stroke(this.roadPath);
    ctx.strokeStyle = 'rgba(235,235,235,0.75)';
    ctx.lineWidth = track.def.width + 7;
    ctx.stroke(this.roadPath);
    ctx.strokeStyle = this.asphaltFill;
    ctx.lineWidth = track.def.width;
    ctx.stroke(this.roadPath);

    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 3;
    ctx.setLineDash([34, 46]);
    for (const lane of this.lanePaths) ctx.stroke(lane);
    ctx.setLineDash([]);

    // Start / finish line.
    const start = track.samples[0];
    if (start) {
      ctx.save();
      ctx.translate(start.x, start.y);
      ctx.rotate(Math.atan2(start.ty, start.tx));
      const square = 10;
      const rows = Math.floor(track.def.width / square);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < 2; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? '#f2f2f2' : '#111';
          ctx.fillRect(col * square - square, -track.halfWidth + row * square, square, square);
        }
      }
      ctx.restore();
    }
  }

  private drawSkids(): void {
    const { ctx } = this;
    if (this.skids.length === 0) return;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const skid of this.skids) {
      ctx.moveTo(skid.x1, skid.y1);
      ctx.lineTo(skid.x2, skid.y2);
    }
    ctx.stroke();
  }

  private drawLamps(visible: (x: number, y: number, r: number) => boolean): void {
    const { ctx } = this;
    const radius = 210;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const lamp of this.scenery.lamps) {
      if (!visible(lamp.glowX, lamp.glowY, radius)) continue;
      ctx.drawImage(this.glowSprite, lamp.glowX - radius, lamp.glowY - radius, radius * 2, radius * 2);
    }
    ctx.restore();
    for (const lamp of this.scenery.lamps) {
      if (!visible(lamp.x, lamp.y, 10)) continue;
      ctx.fillStyle = '#15151a';
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.scenery.theme.lamp;
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCars(visible: (x: number, y: number, r: number) => boolean): void {
    const { ctx, sim } = this;

    // Headlight beams first (under every car body).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const car of sim.cars) {
      if (car.engine.exploded || !visible(car.x, car.y, 240)) continue;
      const shape = BODY_SHAPES[car.racer.look.body];
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.heading);
      const reach = 190;
      const beam = ctx.createLinearGradient(shape.length / 2, 0, shape.length / 2 + reach, 0);
      beam.addColorStop(0, 'rgba(255,244,200,0.2)');
      beam.addColorStop(1, 'rgba(255,244,200,0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(shape.length / 2 - 2, -shape.width / 2 + 2);
      ctx.lineTo(shape.length / 2 + reach, -58);
      ctx.lineTo(shape.length / 2 + reach, 58);
      ctx.lineTo(shape.length / 2 - 2, shape.width / 2 - 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // The player is drawn last so it is never hidden.
    const ordered = [...sim.cars].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer));
    for (const car of ordered) {
      if (!visible(car.x, car.y, 60)) continue;
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.heading);
      drawCar(ctx, car.racer.look, {
        braking: car.controls.brake,
        nitro: car.engine.nitroActive,
        steer: car.steer * 0.45,
        headlights: true,
        time: this.clock + car.id,
        wrecked: car.engine.exploded,
      });
      ctx.restore();

      if (!car.isPlayer) {
        ctx.save();
        ctx.translate(car.x, car.y - 30);
        ctx.scale(1 / this.zoom, 1 / this.zoom);
        ctx.font = `italic 700 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(car.racer.name, 0, 0);
        ctx.fillStyle = car.engine.exploded ? '#9a9a9a' : '#ffffff';
        ctx.fillText(car.racer.name, 0, 0);
        ctx.restore();
      }
    }
  }

  private drawParticles(): void {
    const { ctx } = this;
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      if (p.kind === 'smoke') {
        ctx.globalAlpha = 0.42 * (1 - t);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + t * 1.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (p.kind === 'smoke') continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      if (p.kind === 'spark' || p.kind === 'debris') {
        ctx.fillRect(p.x - 1.5, p.y - 1.5, p.kind === 'debris' ? 4 : 3, p.kind === 'debris' ? 4 : 3);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawAtmosphere(): void {
    const { ctx } = this;
    ctx.fillStyle = this.scenery.theme.tint;
    ctx.fillRect(0, 0, this.width, this.height);
    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.3,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(5,5,16,0)');
    vignette.addColorStop(1, 'rgba(5,5,16,0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);

    // Red pulse on the edges while the engine is in the danger zone.
    const player = this.sim.player;
    if (!player.engine.exploded && player.engine.heat > player.engineSpec.redline) {
      const pulse = 0.2 + 0.16 * Math.sin(this.clock * 12);
      const danger = ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        Math.min(this.width, this.height) * 0.35,
        this.width / 2,
        this.height / 2,
        Math.max(this.width, this.height) * 0.7,
      );
      danger.addColorStop(0, 'rgba(255,30,30,0)');
      danger.addColorStop(1, `rgba(255,30,30,${pulse})`);
      ctx.fillStyle = danger;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  // ───────────────────────── HUD ─────────────────────────

  private text(
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = 'left',
    weight = 800,
  ): void {
    const { ctx } = this;
    ctx.font = `italic ${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.14);
    ctx.strokeStyle = 'rgba(8,6,20,0.85)';
    ctx.strokeText(value, x, y);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  private drawHud(dt: number): void {
    const { ctx, sim } = this;
    const gear = sim.player.drivetrain.gear;
    if (gear !== this.lastGear) {
      this.lastGear = gear;
      this.gearFlash = 0.35;
    }
    this.gearFlash = Math.max(0, this.gearFlash - dt);
    const player = sim.player;
    const compact = this.width < 700;
    const scale = compact ? 0.78 : 1;
    const pad = compact ? 12 : 22;
    ctx.textBaseline = 'alphabetic';

    // Position, lap, clock.
    const position = playerPosition(sim);
    this.text(ordinal(position), pad, pad + 44 * scale, 54 * scale, position === 1 ? '#ffd23f' : '#ffffff');
    const positionWidth = ctx.measureText(ordinal(position)).width;
    this.text(`/ ${sim.cars.length}`, pad + positionWidth + 8, pad + 44 * scale, 24 * scale, '#b9b4d6');
    const lap = clamp(player.lap + 1, 1, sim.setup.laps);
    this.text(`TOUR ${lap}/${sim.setup.laps}`, pad, pad + 76 * scale, 22 * scale, '#2ff3ff');
    this.text(formatTime(sim.time), pad, pad + 102 * scale, 20 * scale, '#ffffff', 'left', 700);

    // Running order.
    const ranked = rankCars(sim);
    ranked.forEach((car, index) => {
      const y = pad + 22 * scale + index * 22 * scale;
      const label = `${index + 1}. ${car.racer.name}${car.engine.exploded ? ' 💥' : car.finished ? ' 🏁' : ''}`;
      this.text(label, this.width - pad, y, 17 * scale, car.isPlayer ? '#ffd23f' : '#e8e6f5', 'right', 700);
    });

    this.drawGauges(scale, pad);
    this.drawMinimap(scale, pad);
    this.drawMessages(scale);
    this.drawHint(scale);
  }

  private drawHint(scale: number): void {
    if (!this.hint) return;
    const { ctx } = this;
    const size = 19 * scale;
    ctx.font = `italic 700 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    const width = ctx.measureText(this.hint).width + 36 * scale;
    const height = size + 20 * scale;
    const x = this.width / 2 - width / 2;
    const y = this.height * 0.84 - height / 2;
    ctx.fillStyle = 'rgba(10,8,26,0.82)';
    ctx.strokeStyle = '#2ff3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.hint, this.width / 2, y + height / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  private drawGauges(scale: number, pad: number): void {
    const { ctx, sim } = this;
    const player = sim.player;
    const spec = player.engineSpec;
    const radius = 66 * scale;
    const cx = this.width - pad - radius - 6;
    const cy = this.height - pad - radius - 26 * scale;
    const start = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;

    ctx.lineCap = 'butt';
    ctx.fillStyle = 'rgba(10,8,26,0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
    ctx.fill();

    // Heat arc: track, red zone, current value.
    const heatRatio = clamp(player.engine.heat / MAX_HEAT, 0, 1);
    const redRatio = spec.redline / MAX_HEAT;
    ctx.lineWidth = 11 * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * redRatio);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,45,45,0.42)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start + sweep * redRatio, start + sweep);
    ctx.stroke();
    const over = player.engine.heat > spec.redline;
    const blink = over && Math.sin(this.clock * 18) > 0;
    ctx.strokeStyle = over ? (blink ? '#ffffff' : '#ff2d2d') : heatRatio > redRatio - 0.12 ? '#ff9a2f' : '#4dff6a';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * heatRatio);
    ctx.stroke();

    // Rev counter: inner arc, with the band past the redline shaded red.
    const { tuning } = player.gearbox;
    const tachRadius = radius - 15 * scale;
    const redlineShare = tuning.redlineRpm / tuning.limiterRpm;
    const rpmShare = clamp(player.drivetrain.rpm / tuning.limiterRpm, 0, 1);
    ctx.lineWidth = 5 * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.arc(cx, cy, tachRadius, start, start + sweep * redlineShare);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,45,45,0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, tachRadius, start + sweep * redlineShare, start + sweep);
    ctx.stroke();
    const onLimiter = player.drivetrain.limiter && Math.sin(this.clock * 40) > 0;
    ctx.strokeStyle = onLimiter ? '#ffffff' : rpmShare > redlineShare * 0.9 ? '#ff9a2f' : '#2ff3ff';
    ctx.beginPath();
    ctx.arc(cx, cy, tachRadius, start, start + sweep * rpmShare);
    ctx.stroke();

    // Gear readout, left of the dial.
    const gearX = cx - radius - 46 * scale;
    const gearLabel = sim.phase === 'countdown' ? 'N' : player.speed < -5 ? 'R' : String(player.drivetrain.gear);
    ctx.fillStyle = this.gearFlash > 0 ? 'rgba(255,210,63,0.35)' : 'rgba(10,8,26,0.72)';
    ctx.beginPath();
    ctx.roundRect(gearX - 26 * scale, cy - 38 * scale, 52 * scale, 66 * scale, 10 * scale);
    ctx.fill();
    this.text(gearLabel, gearX, cy + 8 * scale, 42 * scale, '#ffd23f', 'center');
    const modeLabel = player.drivetrain.mode === 'manual' ? 'MANU' : 'AUTO';
    this.text(modeLabel, gearX, cy + 24 * scale, 11 * scale, '#b9b4d6', 'center', 700);

    // Speed.
    const kmh = Math.round(Math.abs(player.speed) * KMH_PER_PX_S);
    ctx.textBaseline = 'alphabetic';
    this.text(String(kmh), cx, cy + 12 * scale, 44 * scale, '#ffffff', 'center');
    this.text('km/h', cx, cy + 32 * scale, 14 * scale, '#b9b4d6', 'center', 700);
    this.text('MOTEUR', cx, cy - 26 * scale, 12 * scale, over ? '#ff5a5a' : '#b9b4d6', 'center', 700);

    // Nitro bottle.
    const barWidth = (radius + 12) * 2;
    const barX = cx - barWidth / 2;
    const barY = this.height - pad - 16 * scale;
    ctx.fillStyle = 'rgba(10,8,26,0.72)';
    ctx.fillRect(barX - 3, barY - 3, barWidth + 6, 14 * scale + 6);
    if (spec.nitroTank > 0) {
      const ratio = clamp(player.engine.nitro / spec.nitroTank, 0, 1);
      const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
      gradient.addColorStop(0, '#3f7bff');
      gradient.addColorStop(1, '#2ff3ff');
      ctx.fillStyle = gradient;
      ctx.fillRect(barX, barY, barWidth * ratio, 14 * scale);
      if (player.engine.nitroActive) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(barX, barY, barWidth * ratio, 14 * scale);
      }
      this.text('NITRO', barX + 6, barY + 11.5 * scale, 12 * scale, '#ffffff', 'left', 800);
    } else {
      this.text('PAS DE NITRO', cx, barY + 11.5 * scale, 12 * scale, '#8a86a6', 'center', 800);
    }
  }

  private drawMinimap(scale: number, pad: number): void {
    const { ctx, sim, track } = this;
    const size = 138 * scale;
    const { minX, minY, maxX, maxY } = track.bounds;
    const k = Math.min(size / (maxX - minX), size / (maxY - minY));
    const offsetX = pad + (size - (maxX - minX) * k) / 2;
    const offsetY = this.height - pad - size + (size - (maxY - minY) * k) / 2;
    const mapX = (x: number): number => offsetX + (x - minX) * k;
    const mapY = (y: number): number => offsetY + (y - minY) * k;

    ctx.fillStyle = 'rgba(10,8,26,0.6)';
    ctx.fillRect(pad - 8, this.height - pad - size - 8, size + 16, size + 16);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.minimapPoints.forEach((p, i) => {
      if (i === 0) ctx.moveTo(mapX(p.x), mapY(p.y));
      else ctx.lineTo(mapX(p.x), mapY(p.y));
    });
    ctx.closePath();
    ctx.stroke();
    const start = track.samples[0];
    if (start) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mapX(start.x) - 2, mapY(start.y) - 5, 4, 10);
    }
    for (const car of sim.cars) {
      ctx.fillStyle = car.isPlayer ? '#ffd23f' : car.engine.exploded ? '#555' : car.racer.look.paint;
      ctx.strokeStyle = '#0a081a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mapX(car.x), mapY(car.y), car.isPlayer ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawMessages(scale: number): void {
    const { sim } = this;
    const player = sim.player;
    const cx = this.width / 2;
    const top = this.height * 0.24;

    if (sim.phase === 'countdown') {
      const value = Math.ceil(sim.countdown - 0.6);
      if (value >= 1 && value <= 3) {
        const pop = 1 + 0.25 * (1 - ((sim.countdown - 0.6) % 1));
        this.text(String(value), cx, top + 40 * scale, 130 * scale * pop, value === 1 ? '#ff3fa4' : '#ffffff', 'center');
      } else if (value > 3) {
        this.text(sim.setup.title.toUpperCase(), cx, top, 40 * scale, '#ffffff', 'center');
      }
      if (sim.setup.taunt) this.text(`« ${sim.setup.taunt} »`, cx, this.height * 0.74, 19 * scale, '#ffd23f', 'center', 700);
      return;
    }

    if (this.banner) {
      const fade = clamp(this.banner.ttl / 0.35, 0, 1);
      this.ctx.globalAlpha = fade;
      this.text(this.banner.text, cx, top + (this.banner.big ? 30 : 0) * scale, (this.banner.big ? 84 : 44) * scale, this.banner.color, 'center');
      if (this.banner.sub) this.text(this.banner.sub, cx, top + (this.banner.big ? 72 : 36) * scale, 22 * scale, '#ffffff', 'center', 700);
      this.ctx.globalAlpha = 1;
      return;
    }

    if (player.engine.exploded || player.finished) return;
    const spec = player.engineSpec;
    if (player.engine.heat > spec.redline) {
      if (Math.sin(this.clock * 14) > -0.3) this.text('SURCHAUFFE ! LÂCHE LA NITRO !', cx, top, 36 * scale, '#ff3b3b', 'center');
    } else if (player.engine.heat > spec.redline - 9) {
      this.text('ça chauffe…', cx, top, 26 * scale, '#ff9a2f', 'center');
    } else if (player.wrongWayTime > 1.2) {
      if (Math.sin(this.clock * 10) > 0) this.text('DEMI-TOUR !', cx, top, 40 * scale, '#ffd23f', 'center');
    }
  }
}
