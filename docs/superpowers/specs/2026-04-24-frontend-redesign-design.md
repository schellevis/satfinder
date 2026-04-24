# Frontend redesign — design spec
*2026-04-24*

## Summary

Volledig herschrijven van `public/index.html` en de presentatielaag van `public/app.js`. Doel: betere visuele kwaliteit, emoji-iconen vervangen door inline SVG, en light/dark mode met OS-detectie en handmatige toggle.

---

## Aesthetic direction

**Basis: optie C (Refined / modern dashboard)**
- Lettertype: **Inter** (UI) + **JetBrains Mono** (meetwaarden)
- Accentkleur: indigo/paars (`#6366f1` light, `#818cf8` dark)
- Afgeronde hoeken (`--radius: 10px`, `--radius-sm: 6px`)
- Witte kaarten op lichtgrijze achtergrond (light); donkere kaarten op near-black (dark)
- Schaduwen in beide thema's: licht (`rgba(0,0,0,.06)`) in light mode, zwaarder (`rgba(0,0,0,.3)`) in dark mode

---

## Theming system

CSS custom properties op `:root`, overschreven door `[data-theme="dark"]` op `<html>`:

```
light              dark
--bg        #f5f6fa        #0f1117
--surface   #ffffff        #1a1d2e
--surface-2 #f0f1f8        #232640
--border    #e5e8f0        #2d3048
--text      #1a1f35        #e2e4f0
--text-muted #8a93b0       #6b7a99
--accent    #6366f1        #818cf8
--accent-2  #8b5cf6        #a78bfa
--success   #059669        #34d399
--warning   #f59e0b        #fbbf24
--danger    #ef4444        #f87171
```

**Toggle-logica (in `app.js`):**
1. Bij startup: lees `localStorage.getItem('theme')`. Als aanwezig, gebruik dat. Anders: lees `prefers-color-scheme`.
2. Schrijf resultaat als `data-theme` attribuut op `<html>`.
3. Handmatige toggle: wissel `data-theme`, sla op in `localStorage`.

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│ [logo]  [tab] [tab] [tab] [tab]          [☀/🌙]    │  ← topbar (sticky, 52px)
├─────────────────────────────────────────────────────┤
│                                                     │
│  [stat]  [stat]  [stat]                             │  ← 3-koloms stat-tiles
│                                                     │
│  ┌─────────────────┐  ┌─────────────────┐          │
│  │ SAT-IP config   │  │ Chart           │          │  ← 2-koloms grid
│  ├─────────────────┤  ├─────────────────┤          │
│  │ Signaalstatus   │  │ Weer            │          │
│  └─────────────────┘  └─────────────────┘          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Max-breedte: 900px, gecentreerd. Padding: 24px 20px.

---

## Componenten

### Topbar
- Logo: gradient-blokje (indigo→paars) + "Satfinder" bold
- Tabs: `<button class="nav-tab">` — actieve tab krijgt `accent-soft` achtergrond + accentkleur tekst
- Elke tab heeft een inline SVG-icoon (14×14px, 2px stroke)
- Theme-toggle: klein blokje rechts (32×32px), toont zon (dark mode aan) of maan (light mode aan)

### Kaarten (`.card`)
- `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--radius)`
- Kaart-header: kleine uppercase label + optionele badge rechts

### Stat-tiles (`.stat-tile`)
- 3-koloms rij bovenaan de Signaalfinder-tab
- Grote monospacede waarde + kleine label + eenheid

### Meters
- Tweekleurige `border-radius: 99px` balk
- Kleur op basis van waarde: ≥ 60% groen, 30–59% geel, < 30% rood
- Gradient fill: `linear-gradient(90deg, startkleur, eindkleur)`
- Waarde in JetBrains Mono rechts

### Knoppen
- `.btn-primary` — indigo fill, wit tekst
- `.btn-ghost` — `surface-2` achtergrond, rand, tekst
- `.btn-success` / `.btn-danger` — gekleurde varianten
- Altijd met inline SVG-icoon links

### Badges
- `.badge-success` / `.badge-warning` — pill-vormig, zachte achtergrond
- Live-indicator: pulserende groene dot via CSS `@keyframes`

---

## Iconen

Alle iconen zijn **inline SVG**, geen externe library. Stroke-based, 2px stroke-width, `stroke-linecap: round`. Kleur via `currentColor`. Meegeschaald met de omringende tekst of expliciet 14×14 / 16×16px.

Iconenset per tab:
- Signaalfinder: satellietschotel, signaalsterkte-bars, golfvorm (kwaliteit), wolk
- TVheadend: monitor/tv, lijst, verbinding
- Geschiedenis: klok-met-pijl, grafiek
- Instellingen: tandwiel

---

## Bestanden die veranderen

| Bestand | Wat er verandert |
|---|---|
| `public/index.html` | Volledige herschrijving: nieuwe HTML-structuur, inline SVG-iconen, CSS custom properties, verwijdering van alle emoji |
| `public/app.js` | Theming-logica toegevoegd (startup + toggle), DOM-selectors bijgewerkt waar de nieuwe HTML van `index.html` afwijkt van de huidige; bestaande signaal/chart/API-logica blijft intact |

`server.js`, `src/*.js` en `config*.json` worden **niet** aangeraakt.

---

## Wat er niet verandert

- Alle API-aanroepen en business logic in `app.js`
- Alle backend-routes en modules
- Chart.js (blijft van CDN)
- De vier tabs en hun functionaliteit

---

## Succescriteria

- [ ] Light en dark mode werken, OS-voorkeur wordt gevolgd bij eerste bezoek
- [ ] Handmatige toggle persisteert via `localStorage`
- [ ] Geen emoji meer zichtbaar in de UI
- [ ] Alle inline SVG-iconen zijn zichtbaar in beide thema's
- [ ] Alle bestaande functionaliteit (tunen, meten, TVheadend, geschiedenis, instellingen) werkt ongewijzigd
- [ ] Geen lokale IP-adressen of PII in de gecommittede bestanden
