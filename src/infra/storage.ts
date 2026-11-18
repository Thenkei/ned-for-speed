import { ghostKey, isGhostRun, type GhostRun } from '../domain/ghost';
import type { TransmissionMode, Weather } from '../domain/tuning';
import type { GameState } from '../domain/types';

const SAVE_KEY = 'ned-for-speed/save/v1';
const SETTINGS_KEY = 'ned-for-speed/settings/v1';
/** Time trial records live apart from the career: a new game keeps them. */
const GHOSTS_KEY = 'ned-for-speed/ghosts/v1';

export interface Settings {
  readonly muted: boolean;
  /** Ned's gearbox. Automatic by default; manual is opt-in. */
  readonly transmission: TransmissionMode;
}

const DEFAULT_SETTINGS: Settings = { muted: false, transmission: 'auto' };

function isGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<GameState>;
  return (
    candidate.version === 1 &&
    typeof candidate.money === 'number' &&
    typeof candidate.respect === 'number' &&
    Array.isArray(candidate.cars) &&
    candidate.cars.length > 0 &&
    typeof candidate.activeCarUid === 'string' &&
    candidate.cars.some((car) => car.uid === candidate.activeCarUid) &&
    Array.isArray(candidate.inventory) &&
    Array.isArray(candidate.jewels) &&
    Array.isArray(candidate.bossesBeaten) &&
    typeof candidate.eventWins === 'object' &&
    typeof candidate.shop === 'object'
  );
}

/** localStorage can be unavailable (private mode, quota): the game then simply does not persist. */
export function loadGame(): GameState | undefined {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isGameState(parsed)) {
      console.warn('[save] save file ignored: unexpected shape');
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.warn('[save] could not read save', error);
    return undefined;
  }
}

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[save] could not write save', error);
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (error) {
    console.warn('[save] could not clear save', error);
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { muted: parsed.muted === true, transmission: parsed.transmission === 'manual' ? 'manual' : 'auto' };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('[save] could not write settings', error);
  }
}

// ───────────────────────── Time trial records ─────────────────────────

/** Parsed records, kept in memory: the course list reads them on every render. */
let ghostCache: Record<string, GhostRun> | undefined;

/** Every stored record that passes validation, by `ghostKey`. Corrupt entries are dropped. */
function readGhosts(): Record<string, GhostRun> {
  if (ghostCache) return ghostCache;
  ghostCache = parseGhosts();
  return ghostCache;
}

function parseGhosts(): Record<string, GhostRun> {
  try {
    const raw = localStorage.getItem(GHOSTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const valid: Record<string, GhostRun> = {};
    for (const [key, run] of Object.entries(parsed)) {
      if (isGhostRun(run) && key === ghostKey(run.trackId, run.weather, run.modelId)) valid[key] = run;
    }
    return valid;
  } catch (error) {
    console.warn('[save] could not read time trial records', error);
    return {};
  }
}

export function loadGhost(trackId: string, weather: Weather, modelId: string): GhostRun | undefined {
  return readGhosts()[ghostKey(trackId, weather, modelId)];
}

/** Stores a record (replacing the previous one for its track, weather and car). Returns false if storage failed. */
export function saveGhost(run: GhostRun): boolean {
  try {
    const all = { ...readGhosts(), [ghostKey(run.trackId, run.weather, run.modelId)]: run };
    localStorage.setItem(GHOSTS_KEY, JSON.stringify(all));
    ghostCache = all;
    return true;
  } catch (error) {
    // Quota or private mode: the run still counts on screen, it is just not kept.
    console.warn('[save] could not write time trial record', error);
    return false;
  }
}
