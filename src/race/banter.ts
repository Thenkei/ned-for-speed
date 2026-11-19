import { createRng } from '../domain/rng';
import type { CarSim, RaceSim } from './sim';

const lines = {
  nedPass: [
    'Merci pour le créneau !',
    'Je passe, garde ta ligne.',
    'Il est beau, mon pot, vu de là ?',
    'Je t’ai fait signe, t’as vu ?',
    'Fallait rabattre les rétros.',
    'Sympa, la balade du dimanche !',
    'Ton cligno est resté au garage ?',
    'J’ai même pas coupé la clim.',
  ],
  rivalPass: [
    'Ned, t’as laissé le frein à main ?',
    'Tu me gardes la place au feu rouge ?',
    'Tu veux que je te tracte ?',
    'C’était toi, le dos-d’âne ?',
    'T’as payé le parking pour la journée ?',
    'Tu l’entends mieux, mon pot, là ?',
    'Prends ma roue, y a de l’aspi !',
    'Ça va, la visite guidée ?',
  ],
  retake: [
    'Je te l’avais prêtée, cette place.',
    'Coucou, c’est encore moi.',
    'On en était où, déjà ?',
    'Tu peux effacer la photo.',
    'T’as eu le temps de savourer ?',
    'C’était juste pour lire ta plaque.',
    'On va finir par se tutoyer.',
    'À force, je connais ton cligno par cœur.',
  ],
  lead: [
    'Il est où, le prochain ? Ah bah non.',
    'Ah, enfin un pare-brise sans autocollant devant !',
    'Ça y est, je choisis la musique.',
    'Première place, siège en skaï.',
    'J’ouvre la route. Suivez le bruit !',
    'Vous me dites si je rate la sortie.',
    'Ma mère va vouloir la photo.',
    'Le premier qui arrive commande les frites !',
  ],
} as const;
type Pass = keyof typeof lines;

const victory = [
  'Mate ça !', 'Je signe avec les pneus.', 'Filme, ma mère me croit jamais !',
  'Ils étaient déjà lisses !', 'Le dernier rond, il est pour toi !',
  'Ça, c’est mon tour d’honneur.', 'Tu sens ça ? C’est le podium.',
  'Je range la caisse et j’arrive !',
];

export interface RaceQuote {
  readonly speaker: CarSim;
  readonly listener: CarSim;
  readonly text: string;
  readonly until: number;
}

// Wait for a clear nose ahead. Wheel-to-wheel jitter can flip the HUD order every frame.
const PASS_MARGIN = 18;
const RETAKE_WINDOW = 8;

export class RaceBanter {
  private readonly rng;
  private readonly decks = new Map<Pass, string[]>();
  private readonly duels = new Map<number, { ahead: boolean; lastPass: number }>();
  private quote?: RaceQuote;
  readonly victoryLine: string;

  constructor(sim: RaceSim) {
    this.rng = createRng(sim.setup.seed ^ 0xba77e2);
    this.victoryLine = this.rng.pick(victory);
    for (const rival of sim.cars) {
      const gap = sim.player.progress - rival.progress;
      if (!rival.isPlayer && Math.abs(gap) >= PASS_MARGIN) {
        this.duels.set(rival.id, { ahead: gap > 0, lastPass: -Infinity });
      }
    }
  }

  private drawLine(kind: Pass): string {
    let deck = this.decks.get(kind);
    if (!deck?.length) {
      deck = [...lines[kind]];
      this.decks.set(kind, deck);
    }
    return deck.splice(this.rng.int(0, deck.length - 1), 1)[0]!;
  }

  update(sim: RaceSim, ranked: readonly CarSim[]): RaceQuote | undefined {
    const ned = sim.player;
    if (sim.phase !== 'racing' || ned.finished || ned.engine.exploded) return;
    let best: { speaker: CarSim; listener: CarSim; kind: Pass; priority: number } | undefined;
    for (const rival of ranked) {
      if (rival.isPlayer || rival.finished || rival.engine.exploded) continue;
      const gap = ned.progress - rival.progress;
      if (Math.abs(gap) < PASS_MARGIN) continue;
      const ahead = gap > 0;
      const duel = this.duels.get(rival.id);
      if (!duel) {
        this.duels.set(rival.id, { ahead, lastPass: -Infinity });
        continue;
      }
      if (duel.ahead === ahead) continue;
      duel.ahead = ahead;
      if (ned.wrongWayTime > 0 || rival.wrongWayTime > 0) {
        duel.lastPass = -Infinity;
        continue;
      }

      const retake = sim.time - duel.lastPass <= RETAKE_WINDOW;
      duel.lastPass = sim.time;
      const speaker = ahead ? ned : rival;
      const lead = speaker === ranked[0];
      const kind = retake ? 'retake' : lead ? 'lead' : ahead ? 'nedPass' : 'rivalPass';
      const priority = Number(lead) * 2 + Number(retake);
      if (!best || priority > best.priority) {
        best = { speaker, listener: ahead ? rival : ned, kind, priority };
      }
    }

    if (best && (!this.quote || sim.time >= this.quote.until + 0.6)) {
      this.quote = { speaker: best.speaker, listener: best.listener, text: this.drawLine(best.kind), until: sim.time + 2.4 };
    }
    return this.quote && sim.time < this.quote.until ? this.quote : undefined;
  }
}
