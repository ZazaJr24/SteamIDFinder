# Plan: „CubeCraft Legends“, ein Minecraft-artiges Voxel-Spiel für CrazyGames

## Kontext

Das Repo `zazajr24/steamidfinder` enthält nur eine `README.md` (Commit `3334253`) und den Tag `v1.0.0`.
Du möchtest:

1. alles löschen, ausdrücklich auf **main** und inklusive **Tag v1.0.0**,
2. das Repo auf privat stellen,
3. einen großen, schönen Minecraft-Klon für **CrazyGames** bauen, mit ca. 1000 Texturen, Fackeln/Licht, Klappen (Falltüren), Türen, Bauen und allem, was dazugehört. Zuerst Singleplayer, der Code bleibt aber offen für Multiplayer.

Ziel ist ein Browser-Spiel, das die CrazyGames-Anforderungen erfüllt, schnell lädt, auf Laptops und Handys flüssig läuft und rechtlich sauber ist.

### Rechtliche Leitplanken (wichtig, sonst lehnt CrazyGames ab)

- **Keine Mojang-Assets:** keine Original-Minecraft-Texturen, -Sounds, -Modelle, -Logos und kein „Minecraft“ im Namen oder in der Beschreibung. Alle Texturen werden selbst erzeugt (siehe Abschnitt Texturen).
- **Keine Mojang-Eigennamen:** Creeper, Enderman, Nether, End, Redstone usw. werden durch eigene Namen ersetzt, etwa _Glimmling_ (explodiert), _Schattenwandler_, _Glutwelt_, _Leere_, _Glutstein_. Allgemeine Begriffe wie Zombie, Skelett, Spinne, Kuh oder Schaf sind in Ordnung.
- **⚠️ Achtung beim Namen:** „CubeCraft“ ist schon der Name eines großen, bekannten Minecraft-Server-Netzwerks (CubeCraft Games). Das kann Markenrechtsprobleme oder eine Ablehnung bringen. Deshalb bleibt **„CubeCraft Legends“ vorerst Arbeitstitel**. Vor dem Einreichen machen wir einen Markencheck und haben Ersatznamen bereit (z. B. _BlockVerse_, _Voxelia_). Der Name steht zentral in einer Konfigurationsdatei und lässt sich mit einer Zeile ändern.
- Nur Bibliotheken mit MIT- oder CC0-Lizenz: three.js, simplex-noise, fflate, Kenney-CC0-Sounds.
- Inhalte PEGI-12-konform (kein Blut).

---

## Schritt 0: Repo aufräumen (direkt nach der Freigabe)

1. `git rm README.md`, Commit „Remove SteamIDFinder“ auf `claude/zealous-sagan-5gvmzg`.
2. Projektgerüst (M0) plus `docs/PLAN.md` (dieser Plan) plus eine neue `README.md` committen.
3. Pushen: `git push -u origin claude/zealous-sagan-5gvmzg`, danach `git push origin claude/zealous-sagan-5gvmzg:main`. Das ist ein Fast-Forward, weil main bei `3334253` steht, und so von dir freigegeben.
4. Tag löschen: `git tag -d v1.0.0` und `git push origin :refs/tags/v1.0.0`. Blockiert der Proxy das, bekommst du die Klick-Anleitung für GitHub → Tags.
5. **Privat stellen kann ich nicht.** Dafür habe ich kein Tool. So geht es: GitHub → Repo → **Settings → General → ganz unten „Danger Zone“ → „Change repository visibility“ → Private**. Optional im selben Menü oben das Repo umbenennen, z. B. in `cubecraft-legends`. GitHub leitet alte URLs automatisch weiter.
6. Alle weiteren Meilensteine entwickle ich auf dem Branch und pushe sie dort. Nach main kommen sie per PR oder nach deiner Ansage.

---

## Technik-Stack

| Bereich     | Wahl                                                        | Grund                                   |
| ----------- | ----------------------------------------------------------- | --------------------------------------- |
| Sprache     | **TypeScript** (strict)                                     | Große Codebasis, Typsicherheit          |
| Build       | **Vite**                                                    | Schnell, Worker-Support, kleiner Output |
| 3D          | **three.js** (WebGL2) mit eigenen Shadern                   | Leicht (~150 KB gz), volle Kontrolle    |
| Rauschen    | `simplex-noise`                                             | Terrain, Höhlen, Biome                  |
| Kompression | `fflate`                                                    | Speicherstände                          |
| Tests       | **Vitest** plus **Playwright** (Chromium vorinstalliert)    | Logik- und Smoke-Tests                  |
| Lint/Format | ESLint plus Prettier                                        |                                         |
| CI          | GitHub Actions: Typecheck, Lint, Tests, Build, Größen-Check |                                         |

Keine schwere Engine wie Unity: kleiner Download, schnelle Ladezeit, voller Zugriff auf das Voxel-Rendering.

## Projektstruktur

```
index.html
package.json · tsconfig.json · vite.config.ts · .eslintrc · .github/workflows/ci.yml
src/
  main.ts                    Einstieg, Boot-Sequenz
  config.ts                  Spielname, Versionsnummer, Standardwerte
  core/                      GameLoop (fixed 20 TPS + Render-Frame), EventBus, Input, Settings, Random(seed)
  platform/crazygames.ts     SDK-v3-Wrapper mit lokalem Fallback (läuft auch ohne SDK)
  world/
    blocks/                  BlockRegistry, Blockdefinitionen (typisiert), Zustände (facing, open, half …)
    chunk.ts · world.ts      Chunks 16×16×16, Palette + Uint16Array, Spalten 0–255
    gen/                     Terrain, Biome, Höhlen, Erze, Bäume, Strukturen
    light/                   Himmels- + Blocklicht (Flood-Fill BFS, 0–15)
    fluids.ts · ticks.ts     Wasser/Lava-Fluss, zufällige Ticks (Wachstum, Blätterzerfall)
    storage/                 IndexedDB (Chunks komprimiert) + CrazyGames-Data (Metadaten)
  render/
    renderer.ts · camera.ts
    mesher/                  Greedy Meshing, Blockmodelle (Kreuz, Fackel, Treppe, Stufe, Zaun, Tür, Klappe, Scheibe, Flüssigkeit)
    shaders/                 Terrain (opaque / cutout / transparent), Wasser, Himmel, Wolken
    textures/                Textur-Array-Loader, Animationen (Wasser, Lava, Feuer)
    sky.ts · particles.ts · hand.ts · selection.ts · breaking.ts
  entity/                    Entity-Basis, Physik (AABB vs. Voxel), Spieler, Mobs, KI, Pfadfindung (A*)
  gameplay/                  Items, Inventar, Crafting, Ofen, Überleben (HP/Hunger/XP), Spielmodi
  ui/                        HUD, Menüs, Inventar-Screens, Einstellungen, i18n (EN/DE), Touch-Steuerung
  audio/                     WebAudio-Manager, Audio-Sprites, Musik
  workers/                   gen.worker.ts · mesh.worker.ts · light.worker.ts
data/                        recipes/*.json · loot/*.json · biomes.json · lang/en.json · lang/de.json
tools/texgen/                Prozeduraler Textur-Generator (Build-Zeit), siehe unten
assets/overrides/            Handgezeichnete PNGs, die generierte Texturen ersetzen
assets/audio/                CC0-Sounds, werden zu Audio-Sprites gebündelt
tests/                       unit/ (Vitest) · e2e/ (Playwright)
docs/PLAN.md
```

---

## Die ca. 1000 Texturen

**Ansatz:** ein eigener **prozeduraler Pixel-Art-Generator** (`tools/texgen/`), der zur Build-Zeit 16×16-Texturen erzeugt. Er arbeitet mit handverlesenen Farbpaletten pro Material, Rauschen, Mustern (Ziegel, Maserung, Jahresringe, Kristalle, Fliesen), Kantenschattierung und Dithering. Jede Textur ist ein kleines „Rezept“, etwa `bricks({palette: GRANITE, mortar: …})`. So entstehen einheitliche, schöne Texturen im eigenen Stil und nicht bloß Farbflächen.

- **Ausgabe:** wenige Atlas-PNGs plus `textures.json` (Manifest). CrazyGames erlaubt höchstens 1500 Dateien, daher auf keinen Fall 1000 Einzeldateien.
- **Vorschau:** `npm run textures` erzeugt zusätzlich `contact-sheet.html` mit allen Texturen zum Durchsehen.
- **Handarbeit:** Eine PNG in `assets/overrides/<name>.png` ersetzt automatisch die generierte Version. Die ca. 100 meistgesehenen Texturen (Gras, Erde, Stein, Holz, Erze, Fackel …) werden gezielt nachpoliert.
- **Rendering:** Blocktexturen landen in einem **WebGL2-Textur-Array** (`THREE.DataArrayTexture`), getrennt nach Render-Pass (opaque, cutout, transparent), damit jedes Array unter dem WebGL2-Minimum von 256 Layern bleibt. So funktioniert Greedy Meshing mit Kachelung und Mipmaps ohne Rand-Bluten. Items und UI kommen in einen normalen 2D-Atlas.

| Kategorie              | Inhalt                                                                                                                                              | ca. Anzahl |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Gestein                | 12 Gesteinsarten × (roh, poliert, Ziegel, rissig, gemeißelt, Fliesen, bemoost)                                                                      | 84         |
| Holz                   | 10 Baumarten × (Stamm Seite/Oben, geschält ×2, Bretter, Blätter, Setzling, Tür oben/unten, **Klappe**)                                              | 100        |
| Natur/Boden            | Gras (oben/Seite/verschneit), Erde, Podsol, Myzel, Schlamm, Sand, Sandstein-Varianten, Kies, Ton, Schnee, Eis-Arten, Moos                           | 50         |
| Erze & Mineralien      | 10 Erze × (Stein-, Tiefenvariante) + Roh- und Metallblöcke + Kristalle                                                                              | 50         |
| Farbblöcke             | 16 Farben × (Wolle, Beton, Betonpulver, Terrakotta, glasiert, Buntglas, Scheibenrand, Kerze, Bett)                                                  | 144        |
| Pflanzen & Feldfrüchte | 25 Blumen, Gräser, Farne, Pilze, Kakteen, Ranken; Feldfrüchte mit Wachstumsstufen                                                                   | 90         |
| Funktionsblöcke        | Werkbank, Ofen an/aus, Truhe, Fass, Amboss, Bücherregal, Leiter, **Fackel**, Laterne, Glutstein-Lampe an/aus, Hebel, Knöpfe, Druckplatten, Schienen | 70         |
| Eigene Dimensionen     | Glutwelt + Leere (Gesteine, Pilze, Kristalle, Portal)                                                                                               | 60         |
| Animiert               | Wasser still/fließend, Lava, Feuer, Portal (je 16–32 Frames)                                                                                        | 100        |
| Werkzeuge & Waffen     | 6 Materialien × 5 Werkzeuge + Bogen (4 Zustände), Armbrust, Angel, Schild, Pfeile                                                                   | 50         |
| Rüstung                | 6 Materialien × 4 Teile (Icon + Körpertextur)                                                                                                       | 40         |
| Items & Essen          | Barren, Edelsteine, Nuggets, 16 Farbstoffe, ca. 40 Essen, Eimer, Tränke, Bücher, Kompass/Uhr-Frames                                                 | 150        |
| Kreaturen              | 12 Tierarten + Varianten, 8 Monster, Dorfbewohner-Berufe                                                                                            | 50         |
| UI, Partikel, Himmel   | Hotbar, Slots, Herzen, Hunger, XP, Buttons, 10 Abbau-Stufen, ca. 30 Partikel, Sonne, 8 Mondphasen, Wolken                                           | 100        |
| **Summe**              |                                                                                                                                                     | **≈ 1140** |

Die Texturen entstehen schrittweise: ca. 60 in M1, der Rest in M6.

---

## Kernsysteme im Detail

### Welt und Generierung

- Chunks mit 16×16×16 Blöcken, Spalten 16×256×16. Blöcke als Palette plus `Uint16Array`, Blockzustände (Ausrichtung, offen/zu, oben/unten) im Zustands-Index.
- Seed-basiert und deterministisch, erzeugt in Web Workern.
- Terrain-Rauschen: Kontinentalität, Erosion, Gipfel, Temperatur, Feuchte. Daraus entstehen **Biome**: Ebene, Wald, Birkenwald, Taiga, Schneetundra, Wüste, Savanne, Dschungel, Sumpf, Berge, Ozean, Strand, Pilzinsel, Tafelland, Kirschhain-Äquivalent.
- **Höhlen**: „Käse“-Höhlen (3D-Rauschen) und „Spaghetti“-Tunnel, dazu unterirdische Seen und Lava-Seen in der Tiefe.
- **Erze** nach Höhe verteilt, **Bäume** je Biom (10 Arten), Gras, Blumen, Zuckerrohr, Kakteen.
- Strukturen in späteren Stufen: Verliese, Wüstentempel, kleine Dörfer, Ruinenportale.
- Meeresspiegel auf y = 62.

### Rendering

- **Greedy Meshing** im Worker, getrennt in drei Durchläufe: opaque, cutout (Blätter, Pflanzen, Fackeln per Alpha-Test) und transparent (Wasser, Glas, Buntglas, nach Entfernung sortiert).
- **Ambient Occlusion** pro Vertex und **weiches Licht** (Licht wird an den Ecken gemittelt).
- Eigene Blockmodelle: Kreuz (Pflanzen), Fackel (an Wand oder Boden), Treppen, Stufen, Zäune/Mauern (verbinden sich), Türen, **Klappen/Falltüren**, Zauntore, Glasscheiben, Leitern, Flüssigkeiten mit Füllhöhe.
- Himmel mit Farbverlauf und Tag/Nacht (20 Minuten pro Tag), Sonne, Mond mit 8 Phasen, Sterne, Wolken, Nebel an der Sichtgrenze, Unterwasser-Effekt.
- Animiertes Wasser mit Wellen im Shader, Lava und Feuer.
- Partikel: Abbau-Splitter in Blockfarbe, Fackelrauch und -flamme, Wasserspritzer.
- Gehaltenes Item in der Hand (Items als 3D-Sprite extrudiert, Blöcke als Mini-Würfel), Schwenk-Animation, View-Bobbing.
- Blockauswahl-Rahmen und Riss-Overlay beim Abbauen.
- Frustum-Culling pro Chunk, Sichtweite einstellbar (Standard: Desktop 8, Mobil 5). **Auto-Qualität** senkt die Sichtweite, wenn die FPS fallen.

### Licht: Fackeln und mehr

- Himmelslicht und Blocklicht (0–15), Ausbreitung per Flood-Fill (BFS). Beim Abbauen eines Lichtblocks läuft ein eigener BFS zum Entfernen von Licht. Neu berechnet wird nur im betroffenen Chunk-Bereich.
- Lichtquellen: Fackel (14), Laterne (15), Glutstein-Lampe (15), Lava (15), Feuer, Kerzen (3–12), Kürbislaterne.
- Der Tag/Nacht-Wechsel ändert nur einen Shader-Faktor, die Meshes werden dafür nicht neu gebaut.
- Fackeln flackern leicht (Shader), dazu Partikel für Rauch und Flamme.
- ⭐ **Wow-Feature (optional in M3):** farbiges Blocklicht mit RGB-Kanälen, z. B. blaue Kristall-Fackeln oder grüne Pilzlampen. Hebt das Spiel auf CrazyGames von der Masse ab.

### Spieler und Physik

- First-Person-Steuerung mit Pointer-Lock (ESC öffnet das Pausenmenü).
- AABB-Kollision gegen Voxel, Physik mit festen 60 Hz, gerendert wird interpoliert.
- Gehen, Sprinten (Doppel-W oder Strg), Schleichen (fällt nicht über Kanten), Springen, Schwimmen, Leitern klettern, Fallschaden.
- Kreativ-Modus: Fliegen per Doppel-Leertaste.
- Raycast per DDA-Voxel-Durchlauf, Reichweite 5 Blöcke.

### Bauen und Interaktion

- **Abbauen** mit Härte × Werkzeug-Multiplikator; Werkzeugstufe bestimmt, ob etwas droppt.
- **Platzieren** mit richtiger Ausrichtung: Stämme entlang der Achse, Treppen nach Blickrichtung, Stufen oben oder unten, **Fackeln an die Wand**, Türen mit Scharnierseite.
- Interaktive Blöcke: **Türen, Klappen (Falltüren), Zauntore** öffnen und schließen mit Sound; Hebel, Knöpfe, Druckplatten; Truhen (27 Slots); Werkbank; Ofen; Betten (Spawnpunkt, Nacht überspringen); Leitern.
- Flüssigkeiten: Wasser fließt 7 Blöcke weit, Lava 3, es gibt Quellblöcke; Lava plus Wasser ergibt Stein oder Obsidian-Ersatz.
- Zufallsticks: Getreide wächst, Gras breitet sich aus, Blätter zerfallen, Setzlinge wachsen zu Bäumen.

### Gameplay

- **Inventar**: 36 Slots, Hotbar mit 9 Plätzen, 4 Rüstungsslots, Zweithand. Drag & Drop, Shift-Klick, Stapel teilen, Mausrad für die Hotbar.
- **Kreativ-Inventar** mit Tabs und Suche.
- **Crafting**: 2×2 und 3×3, geformte und formlose Rezepte als JSON, Rezeptbuch. **Ofen** mit Brennstoff und Schmelzzeit.
- **Überleben**: Herzen, Hunger und Sättigung, Ertrinken, Lava, Fallschaden, XP, Tod und Respawn.
- **Spielmodi**: Überleben, Kreativ, Friedlich.
- **Kreaturen**:
  - friedlich: Kuh, Schwein, Schaf (scherbar, färbbar), Huhn, Pferd-Äquivalent;
  - feindlich: Zombie, Skelett (Bogen), Spinne, _Glimmling_ (explodiert), _Schattenwandler_;
  - Spawnen nach Lichtlevel und Biom, KI als Zustandsautomat, A*-Pfadfindung auf dem Voxelgitter, Kampf mit Rückstoß, Loot-Tabellen.
- Erfolge (Achievements) als Motivation, zum Beispiel für die erste Fackel oder die erste überlebte Nacht.

### Speichern

- Mehrere Welten mit Name, Seed und Modus.
- Nur veränderte Chunks werden gespeichert, komprimiert per fflate in **IndexedDB**.
- Autosave alle 30 Sekunden sowie bei `visibilitychange` und `pagehide`.
- Welt-Metadaten und Einstellungen zusätzlich über das **CrazyGames-Data-Modul**, damit sie bei eingeloggten Nutzern geräteübergreifend verfügbar sind.

### UI, Audio, Sprache, Mobil

- HTML/CSS-Oberfläche über dem Canvas im Pixel-Look:
  - Hauptmenü, Weltauswahl, Einstellungen (Sichtweite, FOV, Maus-Empfindlichkeit, Lautstärke, Grafikstufe, Sprache), Pause, HUD, Todesbildschirm.
- Audio über Web Audio mit CC0-Sounds (Kenney u. a.) als Audio-Sprites:
  - Schritte je Material, Abbauen und Platzieren, Türen/Klappen, Fackel-Knistern, Wasser, Höhlen-Ambiente, Kreaturen, ruhige Hintergrundmusik (CC0).
- Sprachen: **EN (Hauptsprache für CrazyGames) und DE**, weitere Sprachen per JSON.
- **Touch-Steuerung** für Handys:
  - virtueller Joystick, Umsehen durch Wischen, Tippen zum Platzieren, Halten zum Abbauen, Knöpfe für Springen und Schleichen, Hotbar per Tippen.

### Architektur für späteren Multiplayer

- Die Spiellogik läuft über **Commands und Events** (z. B. `PlaceBlock`, `BreakBlock`) statt über direkte Aufrufe aus der UI. Ein späterer Server kann dieselben Commands autoritativ ausführen.
- Die Welt-Logik ist vom Rendering getrennt und läuft damit auch in Node.

---

## CrazyGames-Integration (Checkliste)

- SDK v3 per `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js">`, Wrapper in `src/platform/crazygames.ts` mit No-Op-Fallback für lokal und Tests.
- `loadingStart()` und `loadingStop()` rund um das Laden der Texturen und das Erzeugen der ersten Welt.
- `gameplayStart()` beim Steuern der Welt, `gameplayStop()` bei Pause, Menü und Todesbildschirm.
- **Midgame-Ads nur an natürlichen Pausen**: nach dem Tod vor dem Respawn und beim Zurückkehren ins Hauptmenü. Nie mitten im Spiel.
- **Rewarded Ads**: „Wiederbeleben mit Inventar“, „Starter-Kiste“, „Nacht überspringen“.
- Während Ads: Spiel pausiert, Audio stumm, Eingaben gesperrt.
- `happytime()` bei großen Erfolgen.
- **Maximal 1 Klick bis ins Spiel**: großer „Spielen“-Button, der sofort eine Welt mit zufälligem Seed startet oder die letzte fortsetzt. Der Klick dient gleichzeitig als Nutzer-Geste für Pointer-Lock und Audio.
- Tastatur: `preventDefault` für Leertaste, Pfeiltasten und Mausrad, damit die Seite nicht scrollt. Keine externen Links, keine fremden Ads.
- **Größenbudget**:
  - Grenzen: Initial-Download ≤ 50 MB (≤ 20 MB für die mobile Startseite), gesamt ≤ 250 MB, unter 1500 Dateien.
  - **Unser Ziel: unter 10 MB und unter 50 Dateien.** Ein Skript `npm run check:size` bricht den CI-Lauf ab, wenn die Grenzen überschritten werden.
- Einreichung:
  - Build-ZIP, Cover-Bilder in den Portal-Formaten, kurzes Gameplay-Video.
  - Zuerst **Basic Launch** (Test-Traffic, Messung von Spielzeit und Retention), dann **Full Launch**.
- Vor dem Einreichen die aktuellen Anforderungen im Developer-Portal noch einmal gegenprüfen. Die Doku-Seite war aus dieser Umgebung gesperrt; die Zahlen oben stammen aus der Websuche.

---

## Meilensteine

Jeder Meilenstein ist spielbar, getestet und einzeln gepusht. Nach jedem Meilenstein bekommst du Screenshots.

| #       | Name               | Inhalt                                                                                                                 | Ergebnis                            |
| ------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **M0**  | Fundament          | Schritt 0, Vite + TS + three.js, CI, SDK-Wrapper, Game Loop, Settings, `docs/PLAN.md`                                  | Leere Szene läuft, CI grün          |
| **M1**  | Erste Welt         | Chunks, Basis-Terrain, Greedy Meshing in Workern, Textur-Array, Generator mit ca. 60 Texturen, Flug-Kamera             | Endlose Landschaft zum Durchfliegen |
| **M2**  | Laufen & Bauen     | Spieler-Physik, Raycast, Abbauen und Platzieren, Hotbar, Speichern in IndexedDB                                        | Bauen und Speichern funktionieren   |
| **M3**  | Licht & Fackeln    | Himmels- und Blocklicht, **Fackeln**, Laternen, Tag/Nacht, AO, weiches Licht, Himmel, Wolken (optional farbiges Licht) | Atmosphärische Nächte mit Fackeln   |
| **M4**  | Interaktive Blöcke | **Türen, Klappen**, Zauntore, Treppen, Stufen, Zäune, Scheiben, Leitern, Hebel und Knöpfe, Truhen, Betten              | Häuser bauen wie im Original        |
| **M5**  | Lebendige Welt     | Alle Biome, Höhlen, Erze, 10 Baumarten, Wasser- und Lava-Fluss, Pflanzenwachstum, erste Strukturen                     | Welt voller Entdeckungen            |
| **M6**  | 1000 Texturen      | Kompletter Generator, alle Kategorien, Contact-Sheet, Nachpolieren der Top 100                                         | ≈ 1100 Texturen im Spiel            |
| **M7**  | Überleben          | Inventar-UI, Crafting, Ofen, Werkzeuge und Rüstung, HP, Hunger, XP, Tod, Kreativ-Inventar                              | Kompletter Survival-Loop            |
| **M8**  | Kreaturen          | Tiere und Monster, KI, Pfadfindung, Spawnen, Kampf, Loot                                                               | Nächte werden gefährlich            |
| **M9**  | Feinschliff        | Sound und Musik, Partikel, Menüs, i18n, Touch-Steuerung, Performance-Tuning, Erfolge                                   | Release-Qualität                    |
| **M10** | CrazyGames-Release | Ads, Gameplay-Events, Data-Modul, QA-Checkliste, Größen-Check, Cover und Video, Upload, Basic Launch                   | Spiel ist live                      |
| M11+    | Danach             | Multiplayer (WebSocket-Server), Glutwelt und Leere, Glutstein-Schaltungen, Dörfer, Events                              | Wachstum nach dem Launch            |

Ehrlich gesagt: Das ist ein großes Projekt über mehrere Sessions. Direkt nach der Freigabe setze ich **Schritt 0 und M0** um und arbeite dann Meilenstein für Meilenstein weiter.

---

## Verifikation

- `npm run typecheck`, `npm run lint`, `npm test`. Vitest-Unit-Tests für Chunk-Speicher, Licht-Ausbreitung (Fackel setzen und entfernen), Meshing (Anzahl der Flächen), Raycast, Kollision, Crafting-Rezepte, Inventar-Logik und Speichern/Laden.
- `npm run build` und `npm run check:size` (Dateianzahl unter 1500, Größe unter 20 MB, sonst schlägt die CI fehl).
- **Playwright-Smoke-Test** im Headless-Chromium (`/opt/pw-browsers/chromium`):
  - Spiel laden, „Spielen“ klicken, auf Chunks warten;
  - prüfen, dass keine Konsolenfehler auftreten und die FPS über einer Schwelle liegen;
  - **Screenshot**, den ich dir nach jedem Meilenstein schicke.
- `npm run textures` erzeugt das Contact-Sheet, damit du alle Texturen ansehen kannst.
- `npm run dev` zum lokalen Spielen. Das SDK läuft dort in der Umgebung `local`, also ohne echte Ads.
- Vor dem Launch: Build-ZIP im CrazyGames Developer Portal hochladen und im Vorschau- und QA-Tool testen (Ads, Pause, Gameplay-Events, Mobilgeräte).
