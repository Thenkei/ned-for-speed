import { carModel } from '../domain/cars';
import {
  activeCar,
  applyBossOutcome,
  applyEventOutcome,
  bossRaceSetup,
  buyCar,
  buyJewel,
  buyPart,
  canChallengeBoss,
  canEnterEvent,
  canRunTimeTrial,
  eligibleStakes,
  equipPart,
  eventRaceSetup,
  isDistrictUnlocked,
  lookOf,
  markEndingSeen,
  markIntroSeen,
  newGame,
  partByUid,
  repairCar,
  repaintCar,
  selectCar,
  sellJewel,
  sellPart,
  setNeon,
  timeTrialSetup,
  transferParts,
  unequipSlot,
} from '../domain/game';
import { beatsRecord, type GhostRun } from '../domain/ghost';
import { jewelKind, jewelResaleValue } from '../domain/jewels';
import { partResaleValue } from '../domain/parts';
import type { Weather } from '../domain/tuning';
import {
  SLOTS,
  type CarLook,
  type GameState,
  type RaceOutcome,
  type RaceSetup,
  type Result,
  type Slot,
} from '../domain/types';
import { DISTRICTS, districtById } from '../domain/world';
import { audio, type UiSound } from '../infra/audio';
import { loadGame, loadGhost, loadSettings, saveGame, saveGhost, saveSettings } from '../infra/storage';
import { renderCarPreview } from '../race/carSprite';
import { runRace, type RaceOptions } from '../race/index';
import { button } from './components';
import { esc, euro } from './dom';
import { playPaintSpray } from './paintSpray';
import { renderBoss, renderPreRace } from './screens/courses';
import { renderHub } from './screens/hub';
import { renderResult } from './screens/result';
import { INTRO_PANELS, renderEnding, renderIntro, renderTitle } from './screens/story';
import { renderTrialResult } from './screens/timeTrial';
import { TABS, type ConfirmView, type Tab, type UiState } from './view';

type RaceRunner = (host: HTMLElement, setup: RaceSetup, options: RaceOptions) => Promise<RaceOutcome>;

/** Debug/test hook exposed on `window.__ned`. */
export interface NedDebugHook {
  getState(): GameState | undefined;
  setState(state: GameState): void;
  getUi(): Readonly<UiState>;
  setUi(patch: Partial<UiState>): void;
  /** When set, replaces the real race (lets tests script an outcome). */
  raceOverride?: RaceRunner;
}

declare global {
  interface Window {
    __ned?: NedDebugHook;
  }
}

type ToastTone = 'error' | 'good' | 'info';
const TOAST_MS = 3400;

export function startApp(root: HTMLElement, toastHost: HTMLElement): void {
  // ───────────────────────── State ─────────────────────────
  const settings = loadSettings();
  let game: GameState | undefined = loadGame();
  let racing = false;
  let lastScrollKey = '';
  let jumpToInventory = false;

  const ui: UiState = {
    screen: 'title',
    tab: 'courses',
    districtId: currentDistrictId(game),
    introStep: 0,
    eventId: undefined,
    bossStep: 0,
    stakeUid: undefined,
    inventoryFilter: 'all',
    paintPreview: undefined,
    result: undefined,
    trialResult: undefined,
    confirm: undefined,
    hasSave: game !== undefined,
    muted: settings.muted,
    transmission: settings.transmission,
  };
  audio.setMuted(ui.muted);

  /** The furthest district Ned has reached: where the action is. */
  function currentDistrictId(state: GameState | undefined): string {
    const first = DISTRICTS[0];
    if (!first) throw new Error('No district defined');
    if (!state) return first.id;
    let current = first;
    for (const district of DISTRICTS) if (isDistrictUnlocked(state, district)) current = district;
    return current.id;
  }

  function requireGame(): GameState {
    if (!game) throw new Error('No career loaded');
    return game;
  }

  // ───────────────────────── Toasts ─────────────────────────
  function toast(message: string, tone: ToastTone = 'info'): void {
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    node.textContent = message;
    toastHost.append(node);
    while (toastHost.childElementCount > 3) toastHost.firstElementChild?.remove();
    window.setTimeout(() => {
      node.classList.add('out');
      window.setTimeout(() => node.remove(), 300);
    }, TOAST_MS);
  }

  // ───────────────────────── Store ─────────────────────────
  /**
   * Commits a new game state (or a reducer `Result`): saves, plays an optional
   * sound and re-renders. Reducer errors become a toast and leave the state
   * untouched. Returns whether the state changed.
   */
  function dispatch(next: GameState | Result<GameState>, sound?: UiSound): boolean {
    if ('ok' in next) {
      if (!next.ok) {
        toast(next.error, 'error');
        audio.ui('error');
        return false;
      }
      game = next.value;
    } else {
      game = next;
    }
    saveGame(game);
    ui.hasSave = true;
    if (sound) audio.ui(sound);
    render();
    return true;
  }

  function fail(message: string): void {
    toast(message, 'error');
    audio.ui('error');
  }

  function go(patch: Partial<UiState>, sound: UiSound | undefined = 'click'): void {
    Object.assign(ui, patch);
    if (sound) audio.ui(sound);
    render();
  }

  function ask(confirm: ConfirmView): void {
    ui.confirm = confirm;
    audio.ui('click');
    render();
  }

  // ───────────────────────── Rendering ─────────────────────────
  function screenHtml(): string {
    if (ui.screen === 'title' || !game) return renderTitle(ui);
    const view = { game, ui };
    switch (ui.screen) {
      case 'intro':
        return renderIntro(ui);
      case 'hub':
        return renderHub(view);
      case 'prerace':
        return renderPreRace(view);
      case 'boss':
        return renderBoss(view);
      case 'race':
        return '<div id="race-host" class="race-host"></div>';
      case 'result':
        return renderResult(view);
      case 'trial-result':
        return renderTrialResult(view);
      case 'ending':
        return renderEnding(view);
    }
  }

  function confirmHtml(): string {
    const confirm = ui.confirm;
    if (!confirm) return '';
    return `
      <div class="modal-backdrop" data-action="confirm-no">
        <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" data-action="noop">
          <h3 id="modal-title">${esc(confirm.title)}</h3>
          <p>${esc(confirm.body)}</p>
          <div class="modal-actions">
            ${button({ action: 'confirm-no', label: 'Annuler', variant: 'ghost' })}
            ${button({ action: 'confirm-yes', label: esc(confirm.confirmLabel), variant: confirm.danger ? 'danger' : 'primary' })}
          </div>
        </div>
      </div>`;
  }

  function captureScroll(): Map<string, { left: number; top: number }> {
    const positions = new Map<string, { left: number; top: number }>();
    for (const el of root.querySelectorAll<HTMLElement>('[data-scroll]')) {
      const key = el.dataset['scroll'];
      if (key) positions.set(key, { left: el.scrollLeft, top: el.scrollTop });
    }
    return positions;
  }

  function paintCanvases(): void {
    for (const canvas of root.querySelectorAll<HTMLCanvasElement>('canvas[data-look]')) {
      try {
        const look = JSON.parse(canvas.dataset['look'] ?? '') as CarLook;
        renderCarPreview(canvas, look);
      } catch (error) {
        console.warn('[ui] car preview failed', error);
      }
    }
  }

  function guardImages(): void {
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-fallback]')) {
      const markMissing = (): void => {
        img.parentElement?.classList.add('img-missing');
        img.remove();
      };
      if (img.complete && img.naturalWidth === 0) markMissing();
      else img.addEventListener('error', markMissing, { once: true });
    }
  }

  function render(): void {
    // The race owns the DOM while it runs: never re-render underneath it.
    if (racing && document.getElementById('race-host')) return;

    const scrollKey = `${ui.screen}/${ui.screen === 'hub' ? ui.tab : ''}`;
    const sameView = scrollKey === lastScrollKey;
    const pageY = window.scrollY;
    const inner = sameView ? captureScroll() : new Map<string, { left: number; top: number }>();

    if (ui.screen !== 'hub' || ui.tab !== 'garage' || ui.paintPreview?.carUid !== game?.activeCarUid) {
      ui.paintPreview = undefined;
    }
    root.innerHTML = screenHtml() + confirmHtml();
    document.body.dataset['screen'] = ui.screen;

    for (const el of root.querySelectorAll<HTMLElement>('[data-scroll]')) {
      const saved = inner.get(el.dataset['scroll'] ?? '');
      if (saved) {
        el.scrollLeft = saved.left;
        el.scrollTop = saved.top;
      } else {
        // Fresh view: make sure the selected item of a horizontal strip is visible.
        const selected = el.querySelector<HTMLElement>('.on');
        if (selected) el.scrollLeft = Math.max(0, selected.offsetLeft - el.offsetLeft - 16);
      }
    }
    window.scrollTo(0, sameView ? pageY : 0);
    lastScrollKey = scrollKey;

    paintCanvases();
    guardImages();

    if (jumpToInventory) {
      jumpToInventory = false;
      document.getElementById('inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (ui.confirm) root.querySelector<HTMLElement>('.modal .btn.primary, .modal .btn.danger')?.focus();
  }

  // ───────────────────────── Racing ─────────────────────────
  async function runAndReport(
    setup: RaceSetup,
    apply: (outcome: RaceOutcome) => void,
    extra: Partial<RaceOptions> = {},
  ): Promise<void> {
    if (racing) return;
    racing = true;
    ui.screen = 'race';
    ui.confirm = undefined;
    lastScrollKey = '';
    root.innerHTML = screenHtml();
    document.body.dataset['screen'] = 'race';
    window.scrollTo(0, 0);
    const host = document.getElementById('race-host');

    let outcome: RaceOutcome | undefined;
    try {
      if (!host) throw new Error('race host missing');
      const runner = window.__ned?.raceOverride ?? runRace;
      outcome = await runner(host, setup, { ...extra, muted: ui.muted, transmission: ui.transmission });
    } catch (error) {
      console.error('[race] the race crashed, nothing was applied', error);
    } finally {
      racing = false;
      host?.replaceChildren();
    }

    if (!outcome) {
      ui.screen = 'hub';
      render();
      fail('La course a calé avant le départ. Rien n’a été débité, réessaie.');
      return;
    }
    apply(outcome);
  }

  function showResult(won: boolean, jewelWon: boolean): void {
    ui.screen = 'result';
    render();
    audio.ui(won ? 'win' : 'lose');
    if (jewelWon) window.setTimeout(() => audio.ui('jewel'), 700);
  }

  function launchEvent(): void {
    const state = requireGame();
    const district = districtById(ui.districtId);
    const event = district.events.find((e) => e.id === ui.eventId);
    if (!event) return fail('Cette course n’existe plus.');
    const allowed = canEnterEvent(state, event);
    if (!allowed.ok) return fail(allowed.error);

    void runAndReport(eventRaceSetup(state, district, event), (outcome) => {
      const { state: next, report } = applyEventOutcome(state, event, outcome);
      game = next;
      saveGame(next);
      ui.result = { title: event.name, districtId: district.id, outcome, report, bossId: undefined };
      showResult(report.won, false);
    });
  }

  function launchBoss(): void {
    const state = requireGame();
    const district = districtById(ui.districtId);
    const allowed = canChallengeBoss(state, district);
    if (!allowed.ok) return fail(allowed.error);
    const stakeUid = ui.stakeUid;
    if (stakeUid === undefined || !eligibleStakes(state, district.boss).some((j) => j.uid === stakeUid)) {
      return fail('Choisis d’abord le bijou que tu mets en jeu.');
    }

    void runAndReport(bossRaceSetup(state, district), (outcome) => {
      const applied = applyBossOutcome(state, district, stakeUid, outcome);
      if (!applied.ok) {
        ui.screen = 'hub';
        render();
        return fail(applied.error);
      }
      game = applied.value.state;
      saveGame(applied.value.state);
      ui.result = {
        title: `Duel contre ${district.boss.name}`,
        districtId: district.id,
        outcome,
        report: applied.value.report,
        bossId: district.boss.id,
      };
      showResult(applied.value.report.won, applied.value.report.jewelWon !== undefined);
    });
  }

  /**
   * Time trial on the selected district's track. Nothing touches the career:
   * the only thing kept is the record (and its ghost), per track, weather and car.
   */
  function launchTimeTrial(weather: Weather): void {
    const state = requireGame();
    const district = districtById(ui.districtId);
    const allowed = canRunTimeTrial(state, district);
    if (!allowed.ok) return fail(allowed.error);
    const modelId = activeCar(state).modelId;
    const previous = loadGhost(district.trackId, weather, modelId);
    let run: GhostRun | undefined;

    void runAndReport(
      timeTrialSetup(state, district, weather),
      (outcome) => {
        const newRecord = run !== undefined && beatsRecord(run, previous);
        const saved = newRecord && run !== undefined ? saveGhost(run) : false;
        ui.trialResult = { districtId: district.id, weather, outcome, run, previous, newRecord, saved };
        ui.screen = 'trial-result';
        render();
        audio.ui(newRecord ? 'win' : 'click');
      },
      { timeTrial: { ghost: previous, modelId, onRun: (recorded) => (run = recorded) } },
    );
  }

  // ───────────────────────── Actions ─────────────────────────
  function focusPaintSwatch(): void {
    root.querySelector<HTMLElement>('[data-action="preview-paint"][aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  function enterCareer(): void {
    const state = requireGame();
    ui.districtId = currentDistrictId(state);
    ui.tab = 'courses';
    ui.introStep = 0;
    go({ screen: state.introSeen ? 'hub' : 'intro' });
  }

  function finishIntro(): void {
    ui.screen = 'hub';
    dispatch(markIntroSeen(requireGame()), 'click');
  }

  function startNewGame(): void {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    game = newGame(seed);
    saveGame(game);
    ui.hasSave = true;
    ui.result = undefined;
    ui.inventoryFilter = 'all';
    enterCareer();
  }

  const isTab = (value: string | undefined): value is Tab =>
    value !== undefined && (TABS as readonly string[]).includes(value);
  const isSlot = (value: string | undefined): value is Slot =>
    value !== undefined && (SLOTS as readonly string[]).includes(value);

  const actions: Readonly<Record<string, (el: HTMLElement) => void>> = {
    noop: () => undefined,

    // ── Title / story ──
    'title-continue': () => {
      if (!game) return fail('Aucune sauvegarde trouvée.');
      enterCareer();
    },
    'title-new': () => {
      if (!ui.hasSave) return startNewGame();
      ask({
        title: 'Recommencer à zéro ?',
        body: 'Ta partie en cours sera écrasée : voitures, pièces, bijoux, respect… tout repart à la Biquette de mamie.',
        confirmLabel: 'Tout effacer et recommencer',
        danger: true,
        onConfirm: startNewGame,
      });
    },
    'toggle-mute': () => {
      ui.muted = !ui.muted;
      audio.setMuted(ui.muted);
      saveSettings({ muted: ui.muted, transmission: ui.transmission });
      audio.ui('click');
      render();
    },
    'toggle-transmission': () => {
      ui.transmission = ui.transmission === 'auto' ? 'manual' : 'auto';
      saveSettings({ muted: ui.muted, transmission: ui.transmission });
      audio.ui('click');
      render();
    },
    'to-title': () => go({ screen: 'title' }),
    'intro-next': () => {
      if (ui.introStep >= INTRO_PANELS.length - 1) finishIntro();
      else go({ introStep: ui.introStep + 1 });
    },
    'intro-skip': finishIntro,
    'ending-continue': () => go({ screen: 'hub', tab: 'courses' }),

    // ── Hub navigation ──
    tab: (el) => {
      const tab = el.dataset['tab'];
      if (isTab(tab)) go({ screen: 'hub', tab });
    },
    district: (el) => {
      const id = el.dataset['id'];
      if (id && DISTRICTS.some((d) => d.id === id)) go({ districtId: id });
    },
    'goto-district': (el) => {
      const id = el.dataset['id'];
      if (id && DISTRICTS.some((d) => d.id === id)) go({ screen: 'hub', tab: 'courses', districtId: id });
    },

    // ── Races ──
    'open-event': (el) => {
      const state = requireGame();
      const event = districtById(ui.districtId).events.find((e) => e.id === el.dataset['id']);
      if (!event) return;
      const allowed = canEnterEvent(state, event);
      if (!allowed.ok) return fail(allowed.error);
      go({ screen: 'prerace', eventId: event.id });
    },
    'prerace-back': () => go({ screen: 'hub' }),
    'race-go': launchEvent,
    'open-boss': () => {
      const state = requireGame();
      const district = districtById(ui.districtId);
      const allowed = canChallengeBoss(state, district);
      if (!allowed.ok) return fail(allowed.error);
      // Pre-select the cheapest jewel that satisfies the boss: the least painful bet.
      const cheapest = eligibleStakes(state, district.boss)
        .slice()
        .sort((a, b) => jewelKind(a.kindId).value - jewelKind(b.kindId).value)[0];
      go({ screen: 'boss', bossStep: 0, stakeUid: cheapest?.uid });
    },
    'boss-next': () => go({ bossStep: ui.bossStep + 1 }),
    'boss-skip': () => go({ bossStep: districtById(ui.districtId).boss.intro.length }),
    'boss-back': () => go({ screen: 'hub' }),
    stake: (el) => go({ stakeUid: el.dataset['uid'] }),
    'boss-go': launchBoss,
    'time-trial': (el) => {
      const weather = el.dataset['weather'];
      if (weather === 'dry' || weather === 'wet') launchTimeTrial(weather);
    },
    'trial-back': () => go({ screen: 'hub', tab: 'courses' }),

    // ── Result ──
    'result-continue': () => {
      const unlocked = ui.result?.report.unlockedDistrictId;
      go({ screen: 'hub', tab: 'courses', districtId: unlocked ?? ui.districtId });
    },
    'result-garage': () => go({ screen: 'hub', tab: 'garage' }),
    'result-ending': () => {
      ui.screen = 'ending';
      dispatch(markEndingSeen(requireGame()), 'win');
    },

    // ── Garage ──
    'select-car': (el) => {
      const uid = el.dataset['uid'];
      if (uid) dispatch(selectCar(requireGame(), uid), 'equip');
    },
    equip: (el) => {
      const state = requireGame();
      const uid = el.dataset['uid'];
      if (uid) dispatch(equipPart(state, activeCar(state).uid, uid), 'equip');
    },
    unequip: (el) => {
      const state = requireGame();
      const slot = el.dataset['slot'];
      if (isSlot(slot)) dispatch(unequipSlot(state, activeCar(state).uid, slot), 'click');
    },
    'sell-part': (el) => {
      const state = requireGame();
      const uid = el.dataset['uid'];
      const part = uid === undefined ? undefined : partByUid(state, uid);
      if (!uid || !part) return;
      const value = partResaleValue(part);
      const sell = (): void => {
        if (dispatch(sellPart(requireGame(), uid), 'buy')) toast(`Vendue à la casse : +${euro(value)}`, 'good');
      };
      // Cheap parts sell in one click; anything valuable asks first.
      if (value < 1000) return sell();
      ask({
        title: 'Vendre cette pièce ?',
        body: `${part.name} part à la casse pour ${euro(value)}. C’est définitif.`,
        confirmLabel: `Vendre ${euro(value)}`,
        danger: true,
        onConfirm: sell,
      });
    },
    filter: (el) => {
      const slot = el.dataset['slot'];
      if (slot !== 'all' && !isSlot(slot)) return;
      // "Choisir" on an empty slot jumps down to the matching inventory list.
      jumpToInventory = el.closest('.slot') !== null;
      go({ inventoryFilter: slot });
    },
    repair: () => {
      const state = requireGame();
      const before = activeCar(state);
      if (dispatch(repairCar(state, before.uid), 'equip')) {
        const after = activeCar(requireGame());
        toast(
          after.condition >= 100
            ? 'Moteur comme neuf. Ça sent encore le dégrippant.'
            : 'Tonton Gégé a fait ce qu’il a pu : 45 %. « Ça tiendra… normalement. »',
          'good',
        );
      }
    },
    'preview-paint': (el) => {
      const car = activeCar(requireGame());
      const hex = el.dataset['hex'];
      if (!hex) return;
      go({ paintPreview: hex === car.paint.toLowerCase() ? undefined : { carUid: car.uid, hex } });
      focusPaintSwatch();
    },
    'cancel-paint': () => {
      go({ paintPreview: undefined });
      focusPaintSwatch();
    },
    'buy-paint': () => {
      const state = requireGame();
      const car = activeCar(state);
      const paint = ui.paintPreview?.hex ?? car.paint;
      const next = repaintCar(state, car.uid, paint);
      if (!next.ok) return fail(next.error);
      if (next.value === state) return;
      ui.paintPreview = undefined;
      dispatch(next.value, 'paint');
      focusPaintSwatch();
      toast('Peinture appliquée !', 'good');
      const canvas = root.querySelector<HTMLCanvasElement>('.garage-stage .car-canvas');
      if (canvas) playPaintSpray(canvas, lookOf(car), paint);
    },
    neon: (el) => {
      const state = requireGame();
      const hex = el.dataset['hex'];
      if (hex === undefined) return;
      dispatch(setNeon(state, activeCar(state).uid, hex), 'equip');
    },
    transfer: (el) => {
      const state = requireGame();
      const from = el.dataset['uid'];
      if (!from) return;
      if (dispatch(transferParts(state, from, activeCar(state).uid), 'equip')) {
        toast('Pièces transférées. Les anciennes fixations ont été « adaptées ».', 'good');
      }
    },

    // ── Shops ──
    'buy-part': (el) => {
      const uid = el.dataset['uid'];
      if (!uid) return;
      if (dispatch(buyPart(requireGame(), uid), 'buy')) toast('Achetée ! Elle t’attend dans le coffre, au garage.', 'good');
    },
    'buy-car': (el) => {
      const state = requireGame();
      const id = el.dataset['id'];
      if (!id) return;
      const model = carModel(id);
      if (state.money < model.price) return fail(`Il te manque ${euro(model.price - state.money)} pour la ${model.name}.`);
      ask({
        title: `Acheter la ${model.brand} ${model.name} ?`,
        body: `${euro(model.price)}, payables tout de suite. Elle arrive sans aucune pièce : tu pourras transférer celles de ta voiture actuelle depuis le garage.`,
        confirmLabel: `Signer pour ${euro(model.price)}`,
        danger: false,
        onConfirm: () => {
          if (dispatch(buyCar(requireGame(), id), 'buy')) {
            toast('Les clés sont à toi ! File au garage transférer tes pièces.', 'good');
          }
        },
      });
    },
    'buy-jewel': (el) => {
      const id = el.dataset['id'];
      if (!id) return;
      if (dispatch(buyJewel(requireGame(), id), 'jewel')) toast('Ça brille. Momo approuve.', 'good');
    },
    'sell-jewel': (el) => {
      const state = requireGame();
      const uid = el.dataset['uid'];
      const jewel = state.jewels.find((j) => j.uid === uid);
      if (!uid || !jewel) return;
      const kind = jewelKind(jewel.kindId);
      ask({
        title: 'Revendre ce bijou ?',
        body: `${kind.name} : Momo t’en donne ${euro(jewelResaleValue(kind))}. Tu perds ${kind.swag} point${kind.swag > 1 ? 's' : ''} de swag.`,
        confirmLabel: `Revendre ${euro(jewelResaleValue(kind))}`,
        danger: true,
        onConfirm: () => {
          dispatch(sellJewel(requireGame(), uid), 'buy');
        },
      });
    },

    // ── Modal ──
    'confirm-yes': () => {
      const confirm = ui.confirm;
      ui.confirm = undefined;
      if (confirm) confirm.onConfirm();
      else render();
    },
    'confirm-no': () => go({ confirm: undefined }),
  };

  root.addEventListener('click', (event) => {
    if (racing) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
    if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
    const action = actions[target.dataset['action'] ?? ''];
    if (!action) return;
    try {
      action(target);
    } catch (error) {
      console.error('[ui] action failed', target.dataset['action'], error);
      fail('Oups, un boulon a sauté. Réessaie.');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (racing || event.repeat) return;
    if (event.key === 'Escape') {
      if (ui.confirm) go({ confirm: undefined });
      else if (ui.paintPreview) actions['cancel-paint']?.(root);
      else if (ui.screen === 'prerace' || ui.screen === 'boss') go({ screen: 'hub' });
      return;
    }
    if (event.key !== 'Enter' || ui.confirm) return;
    // Let focused buttons handle Enter themselves.
    if (event.target instanceof HTMLButtonElement) return;
    if (ui.screen === 'intro') actions['intro-next']?.(root);
    else if (ui.screen === 'boss' && ui.bossStep < districtById(ui.districtId).boss.intro.length) {
      actions['boss-next']?.(root);
    }
  });

  // ───────────────────────── Debug hook ─────────────────────────
  window.__ned = {
    getState: () => game,
    setState: (state) => {
      game = state;
      saveGame(state);
      ui.hasSave = true;
      render();
    },
    getUi: () => ui,
    setUi: (patch) => {
      Object.assign(ui, patch);
      render();
    },
  };

  render();
}
