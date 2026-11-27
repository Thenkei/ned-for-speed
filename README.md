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
  dump valve qui crachote), V10 hurlant de la Mistral. Un turbo monté change la voix : sifflement
  et dump valve, et un **gros turbo maison** (pièce Racing ou mieux, préparée « par Dédé », « tombée
  du camion »…) arrive avec sa cartographie pop & bang : rafales de détonations et flammes à
  l'échappement à chaque lever de pied (Gros Dédé et Samira en ont un). L'échappement monté donne
  de la voix et des pétarades plus fortes, jusqu'au « Tonnerre de Brest » ; le pot percé crache
  même sans turbo. Les pneus hurlent quand ça patine (bien distinct du moteur) et crissent plus
  bas en glisse ; les moteurs des adversaires (chacun avec sa voix) s'entendent, à gauche ou à
  droite, avec l'effet Doppler quand ils passent.
- **Départ au régime** : pendant le compte à rebours, l'accélérateur fait monter le régime (jauge à
  zones). Feu vert dans la zone verte : départ parfait (boost). Trop bas : le moteur cale dans les
  tours. Trop haut : ça patine jusqu'à ~5 s ; relâcher puis réaccélérer rend le grip aussitôt.
  Un mauvais départ coûte du temps, jamais le moteur. Les adversaires jouent le même jeu : plus
  ils sont doués, plus leur départ est précis (les gamins du parking ratent souvent le leur).
- **Tenue de route** : les pneus ont une limite. Un virage pris trop vite, un freinage appuyé en
  plein virage, et la voiture glisse : le nez rentre, la voiture part large, la vitesse fond. Un
  pneu qui glisse accroche moins qu'un pneu qui roule, donc une glisse s'entretient : il faut lever
  le pied et braquer moins (ou contre-braquer) pour la rattraper, et accélérer dedans fait chasser
  l'arrière. Garde-fous d'arcade : l'angle de glisse est plafonné (pas de tête-à-queue) et sous la
  limite la voiture se conduit comme avant. Au clavier et au tactile la direction est
  « progressive » (une touche maintenue va un peu au-delà de la limite, un coup de touche non) ;
  au stick elle va plus loin, plus précise et plus risquée. Traces de pneus, crissement, vibration
  de la manette et un conseil pour les premières glisses.
- **Drift** : une glisse *maîtrisée* recharge la nitro. Tenue assez longtemps, à bonne vitesse,
  sur la piste, sans rien toucher, et rattrapée sans perdre trop de vitesse, elle rend jusqu'à
  30 % de la bouteille (plus elle est longue et profonde, plus elle paie ; un compteur « DRIFT
  +x % » s'affiche au-dessus de Ned). Contact, sortie de piste ou glisse qui fait fondre la vitesse :
  « Drift gâché », rien de gagné, et la glisse a quand même coûté son temps. Les adversaires ne
  driftent pas : c'est un outil du joueur.
- **Pluie** : certaines courses (tirées au sort, annoncées avant le départ) se courent sous la pluie :
  ça glisse. Le volant tourne autant qu'au sec mais les pneus tiennent moins (les glisses arrivent
  ~20 % plus tôt), une glisse sur l'eau se rattrape plus difficilement et l'accélérateur fait plus
  chasser l'arrière ; freinages plus longs, motricité limitée (la nitro fait patiner). Pluie, flaques, gerbes d'eau et chaussée luisante à l'écran. La pluie nivelle :
  le favori gagne moins souvent, l'outsider a sa chance ; en échange la prime est majorée de 50 %.
  Les deux premières courses restent au sec.
- **Contre la montre** : dans chaque quartier débloqué, trois tours seul en piste, au sec ou sous
  la pluie, contre le fantôme de son meilleur temps (par circuit, météo et modèle de voiture). Les
  écarts s'affichent à chaque intermédiaire (trois par tour). Rien à gagner, rien à casser : ni
  prime, ni usure. Les records sont gardés dans le navigateur, à part de la carrière.
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

| Action | Clavier | Tactile | Manette |
| --- | --- | --- | --- |
| Accélérer | ↑ ou W (Z en AZERTY) | automatique | RT (progressif) |
| Freiner / marche arrière | ↓ ou S | FREIN | LT (progressif) |
| Tourner | ← → ou A D (Q D en AZERTY) | ◀ ▶ | stick gauche ou croix |
| Nitro | Espace ou Maj | NITRO | Ⓐ |
| Monter en régime au départ | ↑ ou W pendant le compte à rebours | NITRO pendant le compte à rebours | RT dosé pendant le compte à rebours |
| Monter / descendre un rapport (boîte manuelle) | E / Q (E / A en AZERTY) | + / − | RB / LB |
| Revenir sur la route | R | ↺ | Ⓨ |
| Burnout après l'arrivée | maintenir B | maintenir le bouton | maintenir Ⓑ |
| Pause | Échap ou P | Ⅱ | Start |

La manette (disposition standard : Xbox, PlayStation, la plupart des manettes USB/Bluetooth) se
branche à tout moment : le navigateur ne la signale qu'après un premier appui. Les gâchettes sont
progressives, ce qui permet de *tenir* le régime dans la zone verte au départ au lieu de tapoter, et
de doser l'accélérateur pour sortir du patinage. Les conseils à l'écran suivent le dernier appareil
utilisé, et la manette vibre aux chocs, à l'explosion et au départ quand elle le peut. Les menus se
pilotent encore à la souris ou au clavier.

La partie est sauvegardée automatiquement dans le navigateur (`localStorage`).

## Architecture

```
src/domain   Règles du jeu, pures et testées : état, réducteurs (Result), pièces, bijoux,
             quartiers, modèle thermique du moteur. Aucun accès au DOM ni à l'horloge.
src/race     Course : circuits (splines), simulation déterministe (physique, IA, tours),
             rendu Canvas 2D, entrées clavier/tactile/manette.
src/ui       Menus en DOM : titre, garage, casse, concession, bijouterie, duels, résultats.
src/infra    Sauvegarde localStorage et sons procéduraux (WebAudio).
scripts      Outils de réglage, à lancer avec `npx vite-node scripts/<nom>.ts` :
             `balance` rejoue toutes les courses sans affichage (une graine), `winrate` mesure
             le taux de victoire de Ned sur N graines par écart de niveau (`SEEDS=20
             WEATHER=wet`), `keyboard-bot` vérifie qu'un pilotage « tout ou rien » au clavier
             reste compétitif, `handling-probe` mesure combien chaque type de pilote glisse
             et drifte proprement (IA, clavier tout ou rien, clavier tapoté ;
             `HANDLING='{...}'` / `DRIFT='{...}'` pour essayer d'autres réglages), `track-info` contrôle la géométrie des circuits.
```

`/race-dev.html?track=port&level=60&auto=1` lance une course seule en mode développement
(`auto=1` : l'IA conduit Ned, `coach=1` : conseils de conduite, `weather=wet` : pluie,
`gearbox=manual` : boîte manuelle, `sound=1` : son, `body=muscle` : carrosserie et moteur,
`turbo=big-homemade` : turbo monté, `small`, `big`, `homemade` ou `big-homemade`, `exhaust=legende` :
échappement monté, de `occasion` à `legende`), pratique pour travailler un circuit ou le rendu.

### Moteur, départ et météo

Tous les réglages sont centralisés dans `src/domain/tuning.ts` :

| Bloc | Paramètres principaux |
| --- | --- |
| `DRIVETRAIN_TUNING` | ralenti / zone rouge / rupteur (tr/min), étagement `gearSpan`, seuils de passage auto, vitesses de montée du régime, pénalité de sous-régime et bonus de plage de puissance (boîte manuelle) |
| `LAUNCH_TUNING` | fenêtres de régime au feu vert (`underRevBelow`, `perfect`, `overRevFrom`), boost du départ parfait (×1,3 pendant 1,6 s), calage (×0,55), patinage (×0,5, 2,5 à 5 s), seuils relâché/appuyé |
| `RIVAL_LAUNCH_TUNING` | erreur de timing des adversaires au départ (±1,8 s × (1 − habileté)), temps de réaction pour rattraper un patinage |
| `WHEELSPIN_TUNING` | perte de grip latéral quand ça patine, rendement d'un pneu qui patine, léger dandinement |
| `HANDLING_TUNING` | tenue de route : marge de grip réelle des pneus, portée du braquage au-delà de la limite (stick 1,3, clavier/tactile 1,15), grip d'un pneu qui glisse, grip perdu au freinage, survirage à l'accélération, angle de glisse maximal, vitesse perdue en glisse, grip exploité par les adversaires selon leur témérité |
| `DRIFT_TUNING` | drift récompensé : glisse minimale, vitesse minimale, durée minimale, temps de « reprise » qui clôt un drift, vitesse de sortie minimale, nitro gagnée par seconde de drift (20 % de la bouteille à pleine glisse), plafond par drift (30 %) |
| `WEATHER_PROFILES` | par météo : grip en virage, freinage, rattrapage de glisse, grip en glisse et survirage (pluie), motricité, décalage du seuil de patinage, durée du patinage, multiplicateur de prime (×1,5 sous la pluie) |
| `FORECAST_TUNING` | probabilité de pluie d'une course de carrière |
| `ENGINE_SOUND_PROFILES` (`src/infra/engineProfiles.ts`) | la voix de chaque carrosserie : nombre de cylindres (hauteur = tr/min × cylindres / 120), harmoniques, glouglou, brillance, grain, pétarades, résonances d'échappement, distribution variable, turbo (sifflement, temps de réponse, dump valve) |
| `popsAndBangsLevel`, `POPS_AND_BANGS` (`src/infra/engineProfiles.ts`) | turbo monté → niveau pop & bang (gros + maison = 1, gros = 0,4, maison = 0,3) ; régime minimal, durée et cadence de la rafale après un lever de pied |
| `EXHAUST_SOUND` (`src/infra/engineProfiles.ts`) | par rareté d'échappement : volume, brillance, rugosité, pétarades, force des détonations (×1,15 à ×1,6), pops sans turbo ; une ligne « maison » est plus brute |
| `TYRE_SOUND`, `RIVAL_SOUND` (`src/infra/engineSound.ts`) | seuils, niveaux et hauteurs du crissement des pneus ; portée, atténuation et Doppler des moteurs adverses |

Les modèles sont purs et testés : `drivetrain.ts` (rapports, régime), `launch.ts` (machine à états
du départ), `weather.ts` (application de la météo à la fiche de conduite, prévisions déterministes),
`src/infra/engineSound.ts` (régime, patinage, glisse → paramètres de synthèse). La météo agit sur
la `DriveSpec` de chaque voiture : la physique du joueur **et** l'IA (qui planifie ses vitesses de
virage et de freinage à partir de cette fiche) s'adaptent sans cas particulier.

La tenue de route (`src/race/handling.ts`, pur et testé) : les pneus ne peuvent tourner l'*élan*
de la voiture qu'à la vitesse que permet leur grip (accélération latérale = vitesse × vitesse de
rotation), alors que le volant peut tourner le *nez* un peu plus loin. Demander plus que le grip
fait glisser ; un pneu qui glisse garde moins de grip (`slidingGrip`), ce qui rend la glisse
« collante » jusqu'à ce que le pilote relâche. Sous la limite, le modèle est exactement celui
d'avant (test dédié). Les adversaires dosent leur braquage sur le grip qu'ils s'autorisent (un peu
au-delà pour les plus téméraires) et tiennent compte du freinage ; leur volant est mis à l'échelle et
non plafonné, pour que leur pilotage garde le même gain quelle que soit la portée du braquage. Le départ de chaque adversaire est tiré d'un flux aléatoire
propre (dérivé de la graine de la course) : la séquence aléatoire de la course n'est pas décalée.

### Contre la montre

`src/domain/ghost.ts` enregistre le chrono : une position toutes les 0,1 s (`GHOST_FRAME_HZ`) et le
temps de chaque intermédiaire (`SECTORS_PER_LAP` par tour, `TIME_TRIAL_LAPS` tours). Le fantôme
rejoue des **positions**, pas les touches : la simulation utilise `Math.sin`/`Math.exp`, que les
moteurs JavaScript peuvent arrondir différemment, et une course re-simulée à partir des touches
pourrait dériver d'un navigateur à l'autre. Un chrono de trois tours pèse ~9 Ko ; les records sont
validés à la relecture (`isGhostRun`) et stockés à part de la sauvegarde
(`ned-for-speed/ghosts/v1`), donc une nouvelle partie les garde.

Réglage de l'équilibre (`scripts/winrate.ts`, 20 graines par course, Ned piloté par l'IA avec une
habileté de 0,9, départ compris) — victoires sur 400 courses :

| Écart de niveau de Ned | −6 | 0 | +6 |
| --- | --- | --- | --- |
| Avant ces mécaniques | 2 | 32 | 227 |
| Sec | 1 | 38 | 218 |
| Pluie | 3 | 38 | 138 |
| Sec, avec la tenue de route | 2 | 40 | 184 |
| Pluie, avec la tenue de route | 3 | 24 | 124 |

Sur 40 graines (800 courses), la tenue de route laisse l'outsider et le match nul inchangés et fait
gagner le favori ~10 % moins souvent, au sec comme sous la pluie (rapport pluie/sec du favori
inchangé : 0,63) : une voiture plus rapide passe plus de temps à la limite.

Toutes les marques, modèles et personnages sont inventés. Les illustrations de `public/assets`
ont été générées pour le projet ; les sons sont synthétisés à la volée.
