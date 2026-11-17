# Ned for Speed

Jeu de street racing 2D dans le navigateur. On incarne **Ned**, aspirant Jacky tuning, qui part du
parking du Mégamarché avec la Biquette de mamie et veut le respect des cinq grands noms de la ville.

- **Courses de rue** vues du dessus sur 5 quartiers (parking, zone industrielle, quais, corniche, périph').
- **Tuning façon RPG** : 8 emplacements de pièces, 5 raretés (Occasion → Légende), affixes aléatoires
  (« tombé du camion », « béni par mamie »…), butin après les victoires, stock de la casse qui tourne.
- **6 voitures** à acheter : vitesse max, accélération, maniabilité, fiabilité.
- **Nitro et casse moteur** : la nitro fait monter la température ; passé la zone rouge, chaque seconde
  est un coup de dés et le moteur peut exploser (course perdue, réparation à payer). La fiabilité
  repousse la zone rouge.
- **Bijoux et boss** : chaque quartier a son boss, qu'on défie en posant un bijou sur le capot.
  Gagné : on repart avec son trophée. Perdu : il garde le bijou. Les bijoux donnent aussi du *swag*,
  qui augmente les primes.
- **But** : battre les cinq boss, jusqu'à Jacky Senior, la Légende du Périph'. L'onglet
  « Grands noms » montre qui respecte déjà Ned, qui le snobe encore, et ce qu'il reste à faire.
- **Moteur vivant** : régime moteur simulé (ralenti, inertie, patinage d'embrayage en 1re), boîte
  5 rapports automatique par défaut ou **manuelle** en option (bouton BVA/BVM). Le son du moteur
  est synthétisé à partir du régime et de la charge : ralenti irrégulier, montée en tours qui
  grogne sous la charge, admission, rupteur, coupure d'allumage aux passages de rapport,
  pétarades au lever de pied. Chaque voiture a son moteur : 4 cylindres fatigué de la Biquette,
  4 pattes rageur du Furet, 16 soupapes de la Cobra (la distribution variable qui « accroche » en
  haut), 6 en ligne turbo de la Sakura, V6 turbo glougloutant du Bulldozer (sifflement et
  dump valve qui crachote), V10 hurlant de la Mistral. Les pneus hurlent quand ça patine (bien
  distinct du moteur) et crissent plus bas en glisse ; les moteurs des adversaires (chacun avec
  sa voix) s'entendent, à gauche ou à droite, avec l'effet Doppler quand ils passent.
- **Départ au régime** : pendant le compte à rebours, l'accélérateur fait monter le régime (jauge à
  zones). Feu vert dans la zone verte : départ parfait (boost). Trop bas : le moteur cale dans les
  tours. Trop haut : ça patine jusqu'à ~5 s ; relâcher puis réaccélérer rend le grip aussitôt.
  Un mauvais départ coûte du temps, jamais le moteur. Les adversaires jouent le même jeu : plus
  ils sont doués, plus leur départ est précis (les gamins du parking ratent souvent le leur).
- **Pluie** : certaines courses (tirées au sort, annoncées avant le départ) se courent sous la pluie :
  moins de grip en virage, freinages plus longs, glissades qui durent, motricité limitée (la nitro
  fait patiner). Pluie, flaques, gerbes d'eau et chaussée luisante à l'écran. La pluie nivelle :
  le favori gagne moins souvent, l'outsider a sa chance ; en échange la prime est majorée de 50 %.
  Les deux premières courses restent au sec.
- **Prise en main** : des conseils s'affichent pendant les deux premières courses (commandes,
  nitro en ligne droite, relâcher avant le rouge), et le garage indique combien de secondes de
  nitro la voiture encaisse avant la zone rouge.

## Lancer le jeu

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
npm test           # tests du domaine et de la simulation
npm run check      # typage + tests + build, ce que lance la CI
```

## Déploiement

Chaque push sur `main` lance `.github/workflows/deploy.yml` : `npm run check`, puis publication
de `dist/` sur GitHub Pages. Le build utilise une base relative (`vite.config.ts`), il tourne donc
aussi bien à la racine d'un domaine que sous `/<repo>/`.

## Commandes

| Action | Clavier | Tactile |
| --- | --- | --- |
| Accélérer | ↑ ou W (Z en AZERTY) | automatique |
| Freiner / marche arrière | ↓ ou S | FREIN |
| Tourner | ← → ou A D (Q D en AZERTY) | ◀ ▶ |
| Nitro | Espace ou Maj | NITRO |
| Monter en régime au départ | ↑ ou W pendant le compte à rebours | NITRO pendant le compte à rebours |
| Monter / descendre un rapport (boîte manuelle) | E / Q (E / A en AZERTY) | + / − |
| Revenir sur la route | R | — |
| Pause | Échap ou P | Ⅱ |

La partie est sauvegardée automatiquement dans le navigateur (`localStorage`).

## Architecture

```
src/domain   Règles du jeu, pures et testées : état, réducteurs (Result), pièces, bijoux,
             quartiers, modèle thermique du moteur. Aucun accès au DOM ni à l'horloge.
src/race     Course : circuits (splines), simulation déterministe (physique, IA, tours),
             rendu Canvas 2D, entrées clavier/tactile.
src/ui       Menus en DOM : titre, garage, casse, concession, bijouterie, duels, résultats.
src/infra    Sauvegarde localStorage et sons procéduraux (WebAudio).
scripts      Outils de réglage, à lancer avec `npx vite-node scripts/<nom>.ts` :
             `balance` rejoue toutes les courses sans affichage (une graine), `winrate` mesure
             le taux de victoire de Ned sur N graines par écart de niveau (`SEEDS=20
             WEATHER=wet`), `keyboard-bot` vérifie qu'un pilotage « tout ou rien » au clavier
             reste compétitif, `track-info` contrôle la géométrie des circuits.
```

`/race-dev.html?track=port&level=60&auto=1` lance une course seule en mode développement
(`auto=1` : l'IA conduit Ned, `coach=1` : conseils de conduite, `weather=wet` : pluie,
`gearbox=manual` : boîte manuelle, `sound=1` : son, `body=muscle` : carrosserie et moteur),
pratique pour travailler un circuit ou le rendu.

### Moteur, départ et météo

Tous les réglages sont centralisés dans `src/domain/tuning.ts` :

| Bloc | Paramètres principaux |
| --- | --- |
| `DRIVETRAIN_TUNING` | ralenti / zone rouge / rupteur (tr/min), étagement `gearSpan`, seuils de passage auto, vitesses de montée du régime, pénalité de sous-régime et bonus de plage de puissance (boîte manuelle) |
| `LAUNCH_TUNING` | fenêtres de régime au feu vert (`underRevBelow`, `perfect`, `overRevFrom`), boost du départ parfait (×1,3 pendant 1,6 s), calage (×0,55), patinage (×0,5, 2,5 à 5 s), seuils relâché/appuyé |
| `RIVAL_LAUNCH_TUNING` | erreur de timing des adversaires au départ (±1,8 s × (1 − habileté)), temps de réaction pour rattraper un patinage |
| `WHEELSPIN_TUNING` | perte de grip latéral quand ça patine, rendement d'un pneu qui patine, léger dandinement |
| `WEATHER_PROFILES` | par météo : grip en virage, freinage, rattrapage de glisse, motricité, décalage du seuil de patinage, durée du patinage, multiplicateur de prime (×1,5 sous la pluie) |
| `FORECAST_TUNING` | probabilité de pluie d'une course de carrière |
| `ENGINE_SOUND_PROFILES` (`src/infra/engineProfiles.ts`) | la voix de chaque carrosserie : nombre de cylindres (hauteur = tr/min × cylindres / 120), harmoniques, glouglou, brillance, grain, pétarades, résonances d'échappement, distribution variable, turbo (sifflement, temps de réponse, dump valve) |
| `TYRE_SOUND`, `RIVAL_SOUND` (`src/infra/engineSound.ts`) | seuils, niveaux et hauteurs du crissement des pneus ; portée, atténuation et Doppler des moteurs adverses |

Les modèles sont purs et testés : `drivetrain.ts` (rapports, régime), `launch.ts` (machine à états
du départ), `weather.ts` (application de la météo à la fiche de conduite, prévisions déterministes),
`src/infra/engineSound.ts` (régime, patinage, glisse → paramètres de synthèse). La météo agit sur
la `DriveSpec` de chaque voiture : la physique du joueur **et** l'IA (qui planifie ses vitesses de
virage et de freinage à partir de cette fiche) s'adaptent sans cas particulier. Par temps sec et en boîte
automatique, la physique est identique au bit près à celle d'avant ces mécaniques ; seul l'effet du
départ change le résultat d'une course. Le départ de chaque adversaire est tiré d'un flux aléatoire
propre (dérivé de la graine de la course) : la séquence aléatoire de la course n'est pas décalée.

Réglage de l'équilibre (`scripts/winrate.ts`, 20 graines par course, Ned piloté par l'IA avec une
habileté de 0,9, départ compris) — victoires sur 400 courses :

| Écart de niveau de Ned | −6 | 0 | +6 |
| --- | --- | --- | --- |
| Avant ces mécaniques | 2 | 32 | 227 |
| Sec | 1 | 38 | 218 |
| Pluie | 3 | 38 | 138 |

Toutes les marques, modèles et personnages sont inventés. Les illustrations de `public/assets`
ont été générées pour le projet ; les sons sont synthétisés à la volée.
