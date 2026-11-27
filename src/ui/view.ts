import type { RaceReport } from '../domain/game';
import type { GhostRun } from '../domain/ghost';
import type { TransmissionMode, Weather } from '../domain/tuning';
import type { GameState, RaceOutcome, Slot } from '../domain/types';

export type Screen = 'title' | 'intro' | 'hub' | 'prerace' | 'boss' | 'race' | 'result' | 'trial-result' | 'ending';

export const TABS = ['courses', 'garage', 'pieces', 'concession', 'bijouterie', 'respect'] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABELS: Readonly<Record<Tab, { readonly icon: string; readonly label: string }>> = {
  courses: { icon: '🏁', label: 'Courses' },
  garage: { icon: '🔧', label: 'Garage' },
  pieces: { icon: '⚙️', label: 'Pièces' },
  concession: { icon: '🚗', label: 'Concession' },
  bijouterie: { icon: '💎', label: 'Bijouterie' },
  respect: { icon: '✊', label: 'Grands noms' },
};

export interface ResultView {
  readonly title: string;
  readonly districtId: string;
  readonly outcome: RaceOutcome;
  readonly report: RaceReport;
  /** Set for boss duels. */
  readonly bossId: string | undefined;
}

/** Outcome of a time trial (nothing is applied to the career). */
export interface TrialResultView {
  readonly districtId: string;
  readonly weather: Weather;
  readonly outcome: RaceOutcome;
  /** The completed run, undefined if abandoned or the engine blew. */
  readonly run: GhostRun | undefined;
  /** The record before this run. */
  readonly previous: GhostRun | undefined;
  readonly newRecord: boolean;
  /** False when the new record could not be written to storage. */
  readonly saved: boolean;
}

export interface ConfirmView {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly danger: boolean;
  readonly onConfirm: () => void;
}

/** Ephemeral UI state: never persisted, lives next to the saved `GameState`. */
export interface UiState {
  screen: Screen;
  tab: Tab;
  districtId: string;
  introStep: number;
  eventId: string | undefined;
  bossStep: number;
  stakeUid: string | undefined;
  inventoryFilter: Slot | 'all';
  paintPreview: { readonly carUid: string; readonly hex: string } | undefined;
  result: ResultView | undefined;
  trialResult: TrialResultView | undefined;
  confirm: ConfirmView | undefined;
  hasSave: boolean;
  muted: boolean;
  transmission: TransmissionMode;
}

/** What a screen needs to render once a career is loaded. */
export interface View {
  readonly game: GameState;
  readonly ui: Readonly<UiState>;
}
