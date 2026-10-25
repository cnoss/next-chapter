# AGENTS.md

Anleitung für Coding-Agents (Claude Code und Co.) in diesem Verzeichnis.

## Worum es geht

Marla (22, Berlin) sucht ab Frühjahr 2027 einen Freiwilligendienst, ein Praktikum oder eine befristete Stelle, weltweit, rund um Gender, Frauenrechte, Menschenrechte, Kommunikation und Redaktion. Ihr Vater Christian unterstützt sie dabei. In regelmäßigen Abständen entsteht ein **Digest**: eine Markdown-Datei mit passenden Ausschreibungen, bewertet gegen ihr Profil.

Marla bewertet jede Ausschreibung mit „passt“ oder „passt nicht“ und schreibt einen kurzen Grund dazu. Aus diesen Gründen wird das Suchprofil für den nächsten Digest geschärft. Was man will, merkt man oft erst, wenn konkrete Angebote auf dem Tisch liegen.

## Was gebaut werden soll

Ein kleines Web-Tool, das die Digests als Karten darstellt. Marla soll sich durchscrollen oder durchswipen und jede Karte schnell bewerten können, vor allem auf dem Handy.

### Kernfunktionen (v1)

1. **Digest laden und darstellen:** Jede Ausschreibung wird zu einer Karte mit Titel, Organisation, Ort, Dauer, Start, Bezahlung, Frist, Score, Begründung und Link.
2. **Bewerten:**
   - Rechts oder Button „passt“, links oder Button „passt nicht“
   - Danach Gründe als Tags antippen (Mehrfachauswahl), optional ein Freitext
   - Tastatur: Pfeil rechts und Pfeil links, Enter zum Bestätigen
3. **Fortschritt:** Anzeigen, wie viele Karten bewertet sind. Bereits bewertete Karten lassen sich ändern.
4. **Fristen hervorheben:** Frist in den nächsten 14 Tagen deutlich markieren, abgelaufene Fristen ausgrauen.
5. **Übersicht:** Eine Liste aller Karten mit Bewertung, sortierbar nach Score oder Frist.

### Grund-Tags (Startset)

Für „passt nicht“: `zu früh`, `zu spät`, `unbezahlt`, `zu lang`, `zu kurz`, `Ort`, `Thema`, `Tätigkeit`, `Anforderungen`
Für „passt“: `Thema`, `Ort`, `Tätigkeit`, `Organisation`, `Geld`, `Timing`

Die Tags sollen leicht erweiterbar sein (eine Konfigurationsstelle, kein Suchen im Code).

### Gesamtübersicht über alle Runden (v2, beauftragt am 25.10.2026)

**Wunsch von Marla:** Bisher ist jede Runde eine eigene Liste, und man muss zwischen den Digests hin und her schalten. Sie möchte alle Stellen aus allen Runden auf einen Blick sehen. Ab jetzt beginnt die Bewerbungsphase, die Übersicht ist also vor allem ihre Merkliste.

**Umsetzung:**

1. **Die bestehende Übersicht (`#/liste`) bekommt eine Umschaltung „Alle Runden“ / „Diese Runde“.** Standard ist „Alle Runden“. Kein zusätzlicher Reiter in der Tabbar, die bleibt bei vier Einträgen.
2. **Datenquelle:** alle Digests aus `content/digests.json` laden und parsen. Einträge über die **ID** zusammenführen: Taucht eine ID in mehreren Digests auf, zählt der neueste Digest (Felder), die Bewertung kommt wie bisher aus `getRating()`. Bewertungen liegen nur im `localStorage` (die Digests im Repo haben leere `Marla:`-Zeilen), das ist so gewollt.
3. **Filter** (als Chips oder Segmented Control, mehrfach kombinierbar nicht nötig, einer gleichzeitig reicht):
   - `passt` (Standard, das ist die Merkliste)
   - `offen` (noch nicht bewertet)
   - `passt nicht`
   - `alle`
   - `Favoriten` (siehe Punkt 6)
   Mit Anzahl pro Filter, z. B. „passt (24)“.
4. **Sortierung:** nach Frist (Standard), nach Score, nach „seit“ (neueste zuerst). Die bestehende Sortierlogik wiederverwenden. Einträge ohne Datum als Frist („laufend“) kommen bei Sortierung nach Frist nach den datierten, aber vor den abgelaufenen.
5. **Abgelaufene Fristen:** bei „Alle Runden“ standardmäßig ausgeblendet, mit Schalter „Abgelaufene zeigen (n)“. Ausgegraut, wenn eingeblendet.
6. **Favoriten (Top 3):** Auf jeder Karte und in jeder Listenzeile ein Stern-Button „Favorit“ (`aria-pressed`). Gespeichert im `localStorage` an der ID, unabhängig von der Bewertung. Keine harte Grenze, aber ein Hinweis, wenn mehr als 3 markiert sind („Mehr als 3 Favoriten: Welche sind deine Top 3?“). Favoriten werden im Export mitgeschickt, siehe Datenformat.
7. **Jede Zeile zeigt:** Titel (Heading), Organisation, Ort, Frist mit Badge, Score, Bewertung als Chip, Favoriten-Stern und **„aus Runde vom TT.MM.“** (Datum aus dem Digest-Dateinamen bzw. Feld `Hinzugefügt`). Klick öffnet die Karte im richtigen Digest (`#/karte/<id>` muss dafür den Digest wechseln können, falls die ID nicht im aktuellen Digest liegt).
8. **Leerer Zustand:** freundlicher Text pro Filter, z. B. „Noch keine Favoriten. Tipp auf den Stern bei deinen Top 3.“
9. **Performance:** Digests einmal laden und im Speicher halten. Der Service Worker cacht ohnehin alle Digests aus dem Manifest.

**Umgesetzt am 25.10.2026.** Zusammenführen, Filtern und Sortieren stecken in `app/collection.js` (ohne DOM, in Node testbar), Favoriten in `app/storage.js`. „Diese Runde“ startet mit dem Filter „alle“, damit eine frische Runde vollständig sichtbar ist. Der Export enthält Bewertungen und Favoriten aus allen Runden, ein Block pro Digest-Datei (jeweils die neueste Datei, in der die ID vorkommt).

**Nicht ändern:** Kartenansicht (`#/karten`) bleibt pro Digest, weil das Durchswipen einer neuen Runde der Kern ist. Das Datenformat der Digests bleibt gleich.

**Akzeptanzkriterien:**
- Mit drei Digests zeigt „Alle Runden“ + „passt“ alle positiv bewerteten Einträge aus allen drei Dateien, sortiert nach Frist.
- Eine ID, die in zwei Digests vorkommt, erscheint nur einmal.
- Favoriten überleben Neuladen und Digest-Wechsel.
- Tastatur- und Screenreader-Bedienung wie im Rest des Tools: Filter und Sortierung sind echte Formularelemente oder Buttons mit `aria-pressed`, Änderungen der Trefferzahl werden über `aria-live` angesagt.
- Funktioniert offline (Service Worker) und im Dark Mode.

### Später (nicht beauftragt)

- **Bewerbungsstatus** pro Stelle: offen, beworben, Absage, Zusage, Gespräch. Passt als Erweiterung der Gesamtübersicht. Erst bauen, wenn Christian es beauftragt.
- Auswertung: welche Gründe wie oft genannt werden
- Profil-Datei direkt im Tool anzeigen

## Datenformat: der Vertrag

Die Markdown-Dateien sind die einzige Datenquelle. Sie werden von außen erzeugt (Claudian im Obsidian-Vault von Christian), das Tool liest sie nur. **Das Format nicht ändern**, nur parsen.

### Dateien

Alle Inhalte liegen unter `content/`. Das Tool liegt in `app/`. Die Pfade sind zentral in `app/config.js` definiert.

| Datei | Inhalt |
|---|---|
| `README.md` (Root) | Einstieg für Marla und Repo-Beschreibung |
| `content/profil.md` | Suchprofil (persönlich, wird nicht veröffentlicht) |
| `content/fristen.md` | Fristen als Tabelle |
| `content/programme.md` | Überblick Programme und Börsen |
| `content/gut-zu-wissen.md` | Hintergrundwissen für Marla (Einschreibung, Haltung von Organisationen, Finanzierung) |
| `content/digests/digest-YYYY-MM-DD.md` | ein Digest pro Lauf. Es kommen weitere dazu |
| `content/digests.json` | Manifest der vorhandenen Digests |

Statische Seiten können kein Verzeichnis auflisten, deshalb das Manifest. Format:

```json
{ "digests": ["digest-2026-10-10.md"] }
```

Einträge sind Dateinamen relativ zu `content/digests/`. Neue Digests trägt Claudian beim Erzeugen selbst ein, neueste zuletzt.

### Aufbau eines Digest-Eintrags

Jeder Eintrag beginnt mit einer H2 in diesem Muster und enthält eine Liste mit festen Feldern:

```markdown
## 1. Gender-Kommunikation bei der UN in Bangkok · Score 5

- **ID:** `un-284741`
- **Titel:** Intern, Social Sciences (Gender Equality and Women's Empowerment Communications)
- **Organisation:** UN ESCAP, Gender Equality and Social Inclusion Section
- **Ort:** Bangkok oder remote, teilweise vor Ort bevorzugt
- **Format:** Praktikum
- **Dauer:** 3 bis 6 Monate, 6 bevorzugt
- **Start:** zwischen Januar und Juni 2027
- **Bezahlung:** unbezahlt
- **Frist:** **27.10.2026**
- **Begründung:** Thema und Tätigkeit treffen genau.
- **Link:** https://careers.un.org/jobSearchDescription/284741?language=en
- **Marla:** passt / passt nicht · Grund:
```

Hinweise zum Parsen:
- H2-Regex sinngemäß: `^## (\d+)\. (.+) · Score (\d)$`. Nur H2 mit „Score“ sind Einträge. Andere H2 (z. B. „Selbst reinschauen“) sind Freitext-Abschnitte.
- Feldwerte können Markdown enthalten (`**fett**`, `` `code` ``). Für die Anzeige entfernen bzw. rendern.
- **Frist** ist meist `TT.MM.JJJJ`, kann aber auch Text sein („laufend“, „laufend, nur über Online-Formular“). Dann keine Fristlogik anwenden.
- **ID** ist stabil und eindeutig. Bewertungen immer an der ID festmachen, nie an der Nummer oder Position.
- **Hinzugefügt** (optional, `TT.MM.JJJJ`): wann der Eintrag im Tool gelandet ist. Fehlt das Feld, gilt das Datum aus dem Dateinamen des Digests. Nur nötig, wenn ein Eintrag aus einem älteren Lauf in einen neuen Digest übernommen wird. Das Tool zeigt „seit TT.MM.JJJJ“ auf Karte und Übersicht und ein „Neu“-Badge für Einträge aus dem neuesten Digest. Ist ein neuerer Digest als beim letzten Besuch da, öffnet das Tool automatisch diesen.
- Der Text vor dem ersten Eintrag (Intro, Hinweis-Blockquote) soll oben im Tool sichtbar sein.

### Format einer Bewertung

Eine abgegebene Bewertung sieht so aus. Genau dieses Format wird später wieder eingelesen:

```markdown
- **Marla:** passt nicht · Grund: unbezahlt, zu lang · Kommentar: 6 Monate ohne Geld in Genf geht nicht
```

- Urteil: `passt` oder `passt nicht`
- `Grund:` die gewählten Tags, kommagetrennt
- `Kommentar:` optional, nur wenn Freitext vorhanden

**Favoriten im Export (seit v2):** Ist ein Eintrag als Favorit markiert, kommt im Export direkt unter der `Marla:`-Zeile eine eigene Zeile dazu:

```markdown
- **Favorit:** ja
```

Wird ein Favorit wieder entfernt, exportiert das Tool `- **Favorit:** nein`, damit Claudian die Änderung mitbekommt. Favoriten können auch ohne Bewertung exportiert werden, dann fehlt die `Marla:`-Zeile. Der Export enthält Favoriten aus allen Runden, gruppiert nach Digest-Datei wie bisher.

## Entscheidung: Wo werden Bewertungen gespeichert?

**Entschieden (10.10.2026): Option A.** Statische Seite auf GitHub Pages, Bewertungen im `localStorage`, an der ID festgemacht. „Bewertungen schicken“ erzeugt Markdown zum Teilen (Web Share API am Handy), Kopieren oder Herunterladen. Exportiert werden nur neue oder geänderte Bewertungen, jeweils mit `- **ID:**`-Zeile und der `- **Marla:**`-Zeile im Bewertungsformat oben.

**Konfliktregel: Die Markdown-Datei gewinnt.** Jede lokale Bewertung merkt sich, welche `Marla:`-Zeile beim Speichern in der Datei stand. Hat sich die Datei seitdem geändert, gilt die Datei und die lokale Bewertung wird verworfen. Sonst gilt die lokale Änderung.

## Home-Bildschirm-App (iPhone)

Die App heißt „Next Chapter“ (Repo-Name). Sie lässt sich über Safari zum Home-Bildschirm hinzufügen und läuft dann im Vollbild.

- `manifest.webmanifest`, Icons in `app/icons/` (Quelle: Archivo Black „NC“ auf Gelb, gerendert als PNG).
- `sw.js` (Service Worker): Online wird alles frisch geladen (am 10-Minuten-HTTP-Cache von GitHub Pages vorbei), der Cache ist nur Offline-Fallback oder springt ein, wenn das Netz länger als 4 Sekunden braucht. Ein Deploy erscheint beim nächsten Start der App, ohne die Version hochzuzählen. In der App gibt es unter „Mehr“ den Button „Jetzt aktualisieren“. **Neue Dateien in `app/` in die `SHELL`-Liste, neue feste Inhaltsseiten in die `CONTENT`-Liste in `sw.js` eintragen**, sonst fehlen sie offline.
- Im App-Modus (`html.is-app`) wandert die Navigation in eine Tab-Leiste unten. In Safari erscheint ein Hinweis zum Installieren.
- **Wichtig:** Auf iOS hat die Home-Bildschirm-App einen eigenen `localStorage`, getrennt von Safari. Bewertungen wandern nicht von einem zum anderen. Der Installationshinweis warnt davor.
- Die Zahl am App-Icon (Badging API) braucht auf iOS die Erlaubnis für Mitteilungen. Marla kann sie unter „Mehr“ freiwillig aktivieren. Mitteilungen werden keine verschickt.

## Datenschutz

- `index.html` setzt `noindex, nofollow, noarchive`.
- `content/profil.md` ist in `.gitignore` und wird nicht veröffentlicht. Das Tool blendet Seiten aus, deren Datei fehlt (lokal ist das Profil sichtbar, online nicht).
- `.nojekyll` im Root sorgt dafür, dass GitHub Pages die Markdown-Dateien roh ausliefert statt sie durch Jekyll zu schicken.

## Technische Leitplanken

Christian ist Frontend-Entwickler und Professor für Kommunikationsdesign. Er legt Wert auf einfache, standardkonforme Umsetzung.

- **Vanilla HTML, CSS und JavaScript** (ES-Module). Kein Framework, möglichst kein Build-Schritt. Wenn eine Abhängigkeit nötig ist (z. B. ein Markdown-Parser), dann klein und begründet.
- **Mobile first.** Touch-Swipe mit Pointer Events, Buttons als gleichwertige Alternative.
- **Barrierefrei:** semantisches HTML, echte `<button>`-Elemente, sichtbarer Fokus, Tastaturbedienung, ausreichende Kontraste, `prefers-reduced-motion` respektieren, `aria-live` für Statusmeldungen.
- **Dark Mode** über `prefers-color-scheme`.
- Gestaltung im Zine-Look (seit 10.10.2026, Wunsch: „ein bisschen punkig“): harte schwarze Kanten, versetzte Schatten, Pink und Signalgelb, Sticker und Absperrband als Akzente. Schriften Archivo Black (Überschriften) und Space Mono (Labels), lokal in `app/fonts/`, Fließtext in Systemschrift. Laut am Rand, aber der Inhalt bleibt gut lesbar, Kontraste mindestens AA. Keine Emojis in der UI.
- Code und Kommentare dürfen englisch sein. Die **Oberfläche ist auf Deutsch, in der Du-Form**.
- Struktur: Tool in `app/` (bzw. `index.html` im Root, die aus `app/` lädt), Inhalte in `content/`. Deployment über GitHub Pages.
- Lokal testen über einen einfachen Static Server (z. B. `npx serve` oder `python3 -m http.server`), weil `fetch` auf `file://` nicht geht.

## Regeln

- **Keine Git-Commits.** Committen tut nur Christian. Nach Änderungen kurz sagen, welche Dateien neu oder geändert sind.
- Die Inhaltsdateien unter `content/` und die `README.md` **nicht inhaltlich verändern.** Ausnahme: `README.md` darf einen Abschnitt zum Tool bekommen.
- Keine Gedankenstriche (—) als Satztrenner in Texten und UI-Strings. Punkt, Komma oder Doppelpunkt verwenden.
- Ton der UI-Texte: locker, freundlich, direkt, kurz.
- Bevor Dateien gelöscht oder überschrieben werden: nachfragen.

## Kontext außerhalb des Repos

Konzept, Quellenkatalog und Entscheidungen liegen in Christians Obsidian-Vault unter `02 Projekte/Stellensuche Marla/`. Dort nichts ändern. Dieses Repo ist der Teil, den Marla sieht.

Langfristige Idee (Ausbaustufe 4 im Vault): Die Bewertungen fließen automatisch ins Suchprofil zurück, und die Digests werden dadurch immer treffsicherer. Das Tool ist der erste Schritt dahin. Deshalb sind saubere IDs und das feste Bewertungsformat wichtig.
