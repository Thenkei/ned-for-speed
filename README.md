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
             `balance` rejoue toutes les courses sans affichage, `keyboard-bot` vérifie qu'un
             pilotage « tout ou rien » au clavier reste compétitif, `track-info` contrôle la
             géométrie des circuits.
```

`/race-dev.html?track=port&level=60&auto=1` lance une course seule en mode développement
(`auto=1` : l'IA conduit Ned, `coach=1` : conseils de conduite), pratique pour travailler un circuit ou le rendu.

Toutes les marques, modèles et personnages sont inventés. Les illustrations de `public/assets`
ont été générées pour le projet ; les sons sont synthétisés à la volée.
