/* Kategorie-Leiste und Chip-Filter im Archiv (wie Palace / Balenciaga).

   - Oben eine Zeile "Alle · Neu · Jacken · … · Archiv" zum Wechseln. Sie
     klebt beim Scrollen unter der Kopfzeile. Die Kategorien kommen aus dem
     Menue (data-menu-categories), damit beide immer gleich sind.
   - Filter direkt als Chips statt Dropdowns, Groesse zuerst und passend zur
     Kategorie: bei Schuhen Schuhgroessen, bei Kleidung XS–XXL. Unter "Alle"
     stehen Kleidung, Schuhe und Accessoires getrennt; ein Schuh-Chip wechselt
     dabei gleich zu den Schuhen.
   - Die Chips stellen nur die vorhandenen Felder (Selects) und rufen app.js
     (window.D119Archiv): Zaehler, Null-Treffer, aktive Filter und
     Zuruecksetzen bleiben, wie sie sind.
   - Am Handy sitzt "Filter" unten mittig (zwischen Hell/Dunkel und Tasche)
     und oeffnet die Filter im Vollbild. */
(function () {
  "use strict";
  if (window.D119ArchivNavigation) return;
  window.D119ArchivNavigation = true;

  var TEXT = {
    de: {
      alle: "Alle", kategorien: "Kategorien", groesse: "Größe", weitereGroessen: "Weitere Größen",
      wenigerGroessen: "Weniger Größen", schuhgroessen: "Schuhgrößen",
      fuer: "Für", sortieren: "Sortieren", preis: "Preis", mehr: "Preis, Marke, Farbe",
      marke: "Marke", farbe: "Farbe", erhaltung: "Zustand", zuruecksetzen: "Alles zurücksetzen",
      keineGroessen: "Für diese Auswahl gibt es keine Größenangaben.", alleMarken: "Alle Marken ({n})",
      weniger: "Weniger", bis: "bis {b} €", ab: "ab {a} €", spanne: "{a}–{b} €",
      anzeigen: "Filter anzeigen", ausblenden: "Filter ausblenden", filter: "Filter", schliessen: "Schließen",
      verkauft: "Bereits verkauft", verkauftArchiv: "Zum Archiv der verkauften Stücke", verkauftStatus: "Verkauft"
    },
    en: {
      alle: "All", kategorien: "Categories", groesse: "Size", weitereGroessen: "More sizes",
      wenigerGroessen: "Fewer sizes", schuhgroessen: "Shoe sizes",
      fuer: "For", sortieren: "Sort", preis: "Price", mehr: "Price, brand, colour",
      marke: "Brand", farbe: "Colour", erhaltung: "Condition", zuruecksetzen: "Reset all",
      keineGroessen: "No sizes listed for this selection.", alleMarken: "All brands ({n})",
      weniger: "Less", bis: "up to €{b}", ab: "from €{a}", spanne: "€{a}–{b}",
      anzeigen: "Show filters", ausblenden: "Hide filters", filter: "Filters", schliessen: "Close",
      verkauft: "Already sold", verkauftArchiv: "See the archive of sold pieces", verkauftStatus: "Sold"
    },
    fr: {
      alle: "Tout", kategorien: "Catégories", groesse: "Taille", weitereGroessen: "Autres tailles",
      wenigerGroessen: "Moins de tailles", schuhgroessen: "Pointures",
      fuer: "Pour", sortieren: "Trier", preis: "Prix", mehr: "Prix, marque, couleur",
      marke: "Marque", farbe: "Couleur", erhaltung: "État", zuruecksetzen: "Tout réinitialiser",
      keineGroessen: "Aucune taille indiquée pour cette sélection.", alleMarken: "Toutes les marques ({n})",
      weniger: "Moins", bis: "jusqu’à {b} €", ab: "dès {a} €", spanne: "{a}–{b} €",
      anzeigen: "Afficher les filtres", ausblenden: "Masquer les filtres", filter: "Filtres", schliessen: "Fermer",
      verkauft: "Déjà vendu", verkauftArchiv: "Voir l’archive des pièces vendues", verkauftStatus: "Vendu"
    }
  };
  // Kleidung in der ueblichen Reihenfolge; Zahlen danach, Schuhe numerisch.
  var BUCHSTABEN = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
  var SCHUHE = ["Shoes"];
  var ACCESSOIRES = ["Accessories", "Objects"];
  var PREISE = [[0, 100], [100, 200], [200, 400], [400, null]];
  var MARKEN_KURZ = 10;
  var SORT_KURZ = {
    de: { "new": "Neueste", "price-asc": "Günstigste", "price-desc": "Teuerste", brightness: "Hell → Dunkel", brand: "Marke A–Z" },
    en: { "new": "Newest", "price-asc": "Lowest price", "price-desc": "Highest price", brightness: "Light → dark", brand: "Brand A–Z" },
    fr: { "new": "Nouveautés", "price-asc": "Prix croissant", "price-desc": "Prix décroissant", brightness: "Clair → foncé", brand: "Marque A–Z" }
  };
  var FARBEN = {
    "Schwarz": "#111", "Grau": "#8a8a8a", "Braun": "#6b4a2f", "Blau": "#2f5fb3", "Grün": "#2f8a4a", "Weiß": "#fff",
    "Khaki": "#8b8455", "Marineblau": "#1d2a4d", "Rot": "#c0322d", "Dunkelblau": "#1f3566", "Beige": "#d9c7a6",
    "Creme": "#f3e9d2", "Hellblau": "#9cc6e8", "Rose": "#e7a6b4", "Orange": "#e6802e", "Dunkelgrün": "#1f5232",
    "Rotbraun": "#7d3a26", "Elfenbein": "#f6f0dc", "Silber": "#c6c8cc", "Aprikose": "#f2b38a", "Gelb": "#ecc53a",
    "Flieder": "#c3a6dc", "Lila": "#7e4fa8", "Burgunderrot": "#6d1a2a", "Violett": "#5b2d8e", "Pink": "#e0559b",
    "Gold": "#c9a54a", "Neongrün": "#55f04a", "Türkis": "#2bb3b1", "Bordeaux": "#5c1626", "Oliv": "#6b6b2f"
  };

  var api = null;
  var leiste = null;
  var chipsBox = null;
  var markenOffen = false;
  var geplant = false;
  var chipsVeraltet = true;
  // Layout-Abfragen in den naechsten Frame: dort rechnet der Browser das
  // Layout ohnehin, statt es mitten im Skript zu erzwingen.
  var naechsterFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (fn) { return window.setTimeout(fn, 16); };

  function sprache() {
    var l = String(document.documentElement.getAttribute("lang") || "de").slice(0, 2).toLowerCase();
    return TEXT[l] ? l : "de";
  }
  function tx(key, werte) {
    var s = String((TEXT[sprache()] || TEXT.de)[key] || TEXT.de[key] || "");
    for (var k in werte || {}) s = s.split("{" + k + "}").join(werte[k]);
    return s;
  }
  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }
  function kategorie(it) { return it.taxonomy_category || it.category || ""; }
  function istMobil() { return !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches); }

  // ------------------------------------------------------------ Gestaltung

  function stil() {
    if (document.getElementById("d119ArchivNavigationStil")) return;
    var s = document.createElement("style");
    s.id = "d119ArchivNavigationStil";
    s.textContent = [
      /* body mit overflow-x:hidden ist selbst ein Scroll-Container - dann
         klebt nichts. clip schneidet genauso ab, ohne das. */
      "body{overflow-x:clip}",
      /* Kategorie-Leiste */
      ".d119-kat{position:sticky;top:var(--rail-h,64px);z-index:45;display:flex;flex-wrap:wrap;align-items:center;column-gap:18px;row-gap:0;",
      "padding:0 clamp(20px,5vw,64px);background:var(--bg);border-bottom:1px solid var(--rule)}",
      /* Am Laptop alle Kategorien sichtbar: lieber umbrechen als wischen */
      ".d119-kat__liste{display:flex;flex-wrap:wrap;align-items:center;column-gap:clamp(16px,2.2vw,30px);row-gap:0;",
      "flex:1 1 auto;min-width:0;padding:0 2px}",
      ".d119-kat__liste::-webkit-scrollbar{display:none}",
      ".d119-kat__knopf{appearance:none;flex:0 0 auto;background:none;border:0;padding:15px 0 13px;margin:0;cursor:pointer;",
      "font:inherit;font-size:.74rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;",
      "color:var(--text);opacity:.62;border-bottom:2px solid transparent;scroll-snap-align:start;transition:opacity .15s ease,border-color .15s ease}",
      /* Schwarze Ansicht: nicht gewaehlte Kategorien heller (Inhaber 07.11.2026),
         die gewaehlte bleibt voll weiss mit Unterstrich. */
      ":root:not([data-theme=\"hell\"]) .d119-kat__knopf{opacity:.85}",
      ".d119-kat__knopf:hover{opacity:1}",
      ".d119-kat__knopf[aria-pressed=\"true\"]{opacity:1;border-bottom-color:var(--text)}",
      ".d119-kat__knopf:focus-visible{outline:2px solid var(--accent-text,#8f897c);outline-offset:3px}",
      /* "Filter anzeigen" rechts in der Leiste (Desktop) */
      ".d119-kat #moreFiltersToggle,.d119-kat #mountToggle{flex:0 0 auto;margin:0;padding:8px 14px;white-space:nowrap}",
      /* Passen die Knoepfe nicht mehr daneben, stehen sie rechts darunter */
      ".d119-kat__aktionen{display:flex;align-items:center;gap:10px;flex:0 0 auto;margin-left:auto}",
      "@media (min-width:721px) and (max-width:1100px){.d119-kat__knopf{font-size:.7rem;letter-spacing:.07em}.d119-kat__liste{column-gap:16px}}",
      /* Laptop: links "Ansicht", in der Mitte die Kategorien, rechts "Filter"
         (Wunsch des Inhabers 07.10.2026). Beide Seitenspalten sind gleich
         breit, so steht die Mitte genau mittig; wird es eng, bekommt jede
         Seite mindestens ihren Knopf, statt ihn zu ueberdecken. */
      "@media (min-width:721px){.d119-kat{display:grid;grid-template-columns:minmax(max-content,1fr) auto minmax(max-content,1fr)}",
      ".d119-kat__links{grid-column:1;justify-self:start;display:flex;align-items:center}",
      ".d119-kat__liste{grid-column:2;justify-content:center;column-gap:clamp(12px,1.3vw,22px)}",
      ".d119-kat__aktionen{grid-column:3;justify-self:end;margin-left:0}",
      /* Zu schmal fuer eine Zeile (leisteZeilen misst): oben links "Ansicht",
         oben rechts "Filter", darunter die Kategorien mittig. */
      ".d119-kat.d119-kat--zweizeilig{grid-template-columns:minmax(max-content,1fr) minmax(max-content,1fr);grid-template-areas:\"links rechts\" \"liste liste\";padding-top:8px}",
      ".d119-kat--zweizeilig .d119-kat__links{grid-area:links}",
      ".d119-kat--zweizeilig .d119-kat__aktionen{grid-area:rechts}",
      ".d119-kat--zweizeilig .d119-kat__liste{grid-area:liste;justify-content:center}}",
      /* Ab 1280px die Kategorien etwas groesser, aber eng beieinander wie
         zuvor - das laesst mehr Platz (Inhaber 07.11.2026). */
      "@media (min-width:1280px){.d119-kat__knopf{font-size:.84rem}}",
      ".d119-kat #moreFiltersToggle::after{content:\"+\";display:inline-block;margin-left:8px;font-weight:400}",
      ".d119-kat #moreFiltersToggle[aria-expanded=\"true\"]::after{content:\"\\2013\"}",
      ".rail .rail__sort{display:none}",
      /* Filter als Chips */
      "#filterPanel.d119-chips-an>.filter-field{display:none!important}",
      "#filterPanel.d119-chips-an>.filter-reset{display:none}",
      "#filterPanel.d119-chips-an{display:block;padding:18px clamp(20px,5vw,64px) 22px;margin:0;border-top:0;border-bottom:1px solid var(--rule)}",
      "#filterPanel.d119-chips-an.hidden{display:none}",
      ".d119-chips{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1fr) minmax(0,1.2fr);gap:22px 40px;max-width:1280px}",
      ".d119-chips__gruppe{min-width:0;display:grid;gap:10px;align-content:start}",
      ".d119-chips__gruppe--breit{grid-column:1/-1}",
      ".d119-chips__titel{font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--text);margin:0}",
      ".d119-chips__unter{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text);opacity:.7;margin:4px 0 -2px}",
      ".d119-chips__reihe{display:flex;flex-wrap:wrap;gap:8px}",
      ".d119-chip{appearance:none;display:inline-flex;align-items:center;gap:7px;min-height:38px;min-width:44px;justify-content:center;",
      "padding:8px 13px;border:1px solid var(--rule-strong);background:transparent;color:var(--text);font:inherit;",
      "font-size:.74rem;letter-spacing:.04em;cursor:pointer;transition:border-color .15s ease,background .15s ease,color .15s ease}",
      ".d119-chip:hover{border-color:var(--text)}",
      ".d119-chip[aria-pressed=\"true\"]{background:var(--text);border-color:var(--text);color:var(--bg)}",
      ".d119-chip:focus-visible{outline:2px solid var(--accent-text,#8f897c);outline-offset:2px}",
      /* "Weitere Groessen" / "Schuhgroessen": leise Textknoepfe unter den Chips */
      ".d119-chips__links{display:flex;flex-wrap:wrap;gap:4px 20px}",
      ".d119-chips__link{appearance:none;background:none;border:0;padding:6px 0;min-height:32px;cursor:pointer;font:inherit;",
      "font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;color:var(--text);text-decoration:underline;text-underline-offset:3px}",
      ".d119-chips__link:focus-visible{outline:2px solid var(--accent-text,#8f897c);outline-offset:2px}",
      ".d119-chip__punkt{width:12px;height:12px;border-radius:50%;border:1px solid var(--rule-strong);flex:0 0 auto}",
      ".d119-chip--leise{border-style:dashed}",
      ".d119-chips__leer{font-size:.74rem;color:var(--text);opacity:.75;margin:0}",
      ".d119-chips__mehr{grid-column:1/-1;border-top:1px solid var(--rule);padding-top:14px}",
      ".d119-chips__mehr>summary{cursor:pointer;list-style:none;font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--text);display:flex;align-items:center;min-height:44px;padding:0}",
      ".d119-chips__mehr>summary:focus-visible{outline:2px solid var(--accent-text,#8f897c);outline-offset:2px}",
      ".d119-chips__mehr>summary::-webkit-details-marker{display:none}",
      ".d119-chips__mehr>summary::after{content:\"\\00a0+\"}",
      ".d119-chips__mehr[open]>summary::after{content:\"\\00a0\\2013\"}",
      ".d119-chips__mehrinhalt{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px 40px;padding-top:10px}",
      ".d119-chips__fuss{grid-column:1/-1;display:flex;gap:18px;align-items:center;flex-wrap:wrap}",
      ".d119-chips__zurueck{appearance:none;background:none;border:0;padding:8px 0;cursor:pointer;font:inherit;font-size:.7rem;",
      "letter-spacing:.06em;text-transform:uppercase;color:var(--text);opacity:.75;text-decoration:underline;text-underline-offset:3px}",
      ".d119-chips__zurueck:hover{opacity:1}",
      /* Schliessen im Filter in voller Textfarbe (gedaempft knapp unter 4.5:1 in Hell) */
      "#filterPanel.d119-chips-an .d119-filter-drawer__close{color:var(--text)}",
      /* Aktive Filter ("Groesse: M ×") direkt ueber den Artikeln */
      "#activeFilters.d119-aktiv{padding:14px clamp(20px,5vw,64px) 0}",
      "#activeFilters.d119-aktiv--leer{display:none}",
      /* Handy: Filter unten mittig, Filter im Vollbild */
      "@media (max-width:720px){",
      ".d119-kat{top:var(--rail-h,54px);padding:0 16px;gap:0}",
      "#activeFilters.d119-aktiv{padding:12px 16px 0}",
      ".d119-kat{flex-wrap:nowrap}",
      ".d119-kat__liste{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;gap:20px}",
      ".d119-kat__knopf{font-size:.72rem;padding:14px 0 12px}",
      ".d119-kat #moreFiltersToggle{position:fixed;left:50%;transform:translateX(-50%);",
      "bottom:calc(var(--d119-unten,14px) + env(safe-area-inset-bottom,0px));z-index:125;min-height:44px;min-width:128px;padding:12px 22px;",
      "border:1px solid var(--text);background:var(--text);color:var(--bg);font-size:.74rem;font-weight:700;letter-spacing:.1em;",
      "box-shadow:0 10px 30px rgba(0,0,0,.28)}",
      ".d119-kat #moreFiltersToggle::after{content:none}",
      "#filterPanel.d119-chips-an.d119-filter-drawer{inset:0;max-height:none;height:100%;height:100dvh;padding:0;z-index:400;",
      "border-top:0;box-shadow:none;display:flex;flex-direction:column;align-items:stretch}",
      ".d119-filter-backdrop{z-index:399}",
      ".d119-kat #mountToggle,.d119-kat__links{display:none}",
      "#filterPanel.d119-chips-an.d119-filter-drawer.hidden{display:none}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__head{padding-top:max(12px,env(safe-area-inset-top))}",
      "#filterPanel.d119-chips-an .d119-chips{display:flex;flex-direction:column;gap:26px;padding:4px 18px 24px;flex:1 1 auto}",
      "#filterPanel.d119-chips-an .d119-chips__fuss{display:none}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__foot{margin-top:auto;display:flex;gap:12px;align-items:center}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__foot .d119-chips__zurueck{flex:0 0 auto}",
      ".d119-chip{min-height:44px;padding:10px 14px}",
      ".d119-chips__link{min-height:44px}",
      ".d119-chips__mehrinhalt{grid-template-columns:1fr;gap:22px}",
      "}",
      /* PC und Tablet: Filter als Archiv-Index im Vollbild (Konzept C, Inhaber
         07.11.2026). Grosse Schrift wie der Schriftzug, auf die Fotokanten
         ausgerichtet; die Seite dahinter bleibt stehen. Gewaehlt = volle
         Farbe, sonst gedaempft (gross mind. 3:1, klein mind. 4.5:1). */
      "@media (min-width:721px){",
      "body.d119-filter-open{overflow:hidden}",
      "#filterPanel.d119-chips-an.d119-filter-drawer{position:fixed;inset:0;z-index:400;display:flex;flex-direction:column;align-items:stretch;",
      "margin:0;padding:0;border:0;background:var(--bg);overflow-y:auto;overscroll-behavior:contain}",
      "#filterPanel.d119-chips-an.d119-filter-drawer.hidden{display:none}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__head{display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:2;",
      "flex:0 0 auto;min-height:64px;padding:0 clamp(20px,5vw,64px);background:var(--bg);border-bottom:1px solid var(--rule)}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__title{font-size:.8rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--text)}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__close{appearance:none;background:none;border:0;min-height:44px;padding:0;cursor:pointer;font:inherit;",
      "font-size:.7rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__close::after{content:\"\\00a0\\00a0\\00d7\";font-size:1.1rem;font-weight:400}",
      "#filterPanel.d119-chips-an .d119-chips{width:calc(100% - 2 * clamp(18px,3vw,36px));max-width:1328px;margin:0 auto;padding:clamp(32px,6vh,64px) 0 32px;",
      "flex:1 0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(36px,6vh,60px) clamp(18px,2.5vw,34px);align-content:start}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe{gap:12px}",
      "#filterPanel.d119-chips-an .d119-chips__titel{font-size:.62rem;letter-spacing:.2em;opacity:.75}",
      "#filterPanel.d119-chips-an .d119-chips__reihe{gap:4px clamp(16px,1.6vw,28px);align-items:baseline}",
      "#filterPanel.d119-chips-an .d119-chip{min-height:0;min-width:0;padding:0;border:0;border-radius:0;background:none;color:var(--text);gap:.3em;",
      "font-size:clamp(.95rem,1.1vw,1.15rem);font-weight:800;letter-spacing:.03em;line-height:1.3;text-transform:uppercase;opacity:.6;transition:opacity .15s ease}",
      "#filterPanel.d119-chips-an .d119-chip:hover,#filterPanel.d119-chips-an .d119-chip[aria-pressed=\"true\"]{opacity:1;background:none;color:var(--text)}",
      "#filterPanel.d119-chips-an .d119-chip__punkt{width:.32em;height:.32em}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--sortieren .d119-chips__reihe,#filterPanel.d119-chips-an .d119-chips__gruppe--preis .d119-chips__reihe{flex-direction:column;align-items:flex-start;gap:6px}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--marke,#filterPanel.d119-chips-an .d119-chips__gruppe--farbe{grid-column:1/-1}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chips__reihe{display:block;columns:2;column-gap:clamp(18px,2.5vw,34px)}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip{display:flex;justify-content:flex-start;text-align:left;break-inside:avoid;font-size:clamp(1.05rem,1.55vw,1.6rem);letter-spacing:.01em;line-height:1.25;padding:.12em 0}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chip{font-size:clamp(1.05rem,1.4vw,1.45rem)}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chips__reihe{gap:6px clamp(18px,2vw,30px)}",
      "#filterPanel.d119-chips-an .d119-chips__fuss{display:none}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__foot{display:flex;position:sticky;bottom:0;z-index:2;flex:0 0 auto;justify-content:center;align-items:center;gap:24px;",
      "padding:24px 20px 28px;background:linear-gradient(to top,var(--bg) 72%,transparent)}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__apply{min-height:54px;padding:0 42px;border:0;background:var(--text);color:var(--bg);cursor:pointer;",
      "font:inherit;font-size:.74rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase}",
      "}",
      "@media (min-width:1180px){#filterPanel.d119-chips-an .d119-chips{grid-template-columns:repeat(4,minmax(0,1fr))}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chips__reihe{columns:4}}",
      /* Handy: Filter als App-Blatt von unten (Inhaber 07.11.2026) - Griff,
         runde Ecken, Seite dahinter abgedunkelt; Marken zweireihig vorne,
         "Fuer" als Umschalter, der Rest als wischbare Reihen. */
      "@keyframes d119BlattHoch{from{transform:translateY(100%)}to{transform:none}}",
      "@keyframes d119BlattHinter{from{opacity:0}to{opacity:1}}",
      "@media (max-width:720px){",
      ".d119-filter-backdrop{background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:d119BlattHinter .25s ease}",
      "#filterPanel.d119-chips-an.d119-filter-drawer{inset:auto 0 0 0;height:auto;max-height:calc(100dvh - 44px);overflow:hidden;border:1px solid var(--rule-strong);border-bottom:0;",
      "border-radius:20px 20px 0 0;box-shadow:0 -24px 60px rgba(0,0,0,.45);animation:d119BlattHoch .34s cubic-bezier(.2,.8,.2,1);transition:transform .22s ease}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__head{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;",
      "min-height:60px;margin:0;padding:20px 10px 4px 22px;border-bottom:0;background:transparent;touch-action:none}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__head::before{content:\"\";position:absolute;top:8px;left:50%;width:38px;height:5px;margin-left:-19px;border-radius:3px;background:currentColor;opacity:.28}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__title{font-size:.86rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--text)}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__close{position:relative;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;font-size:0;text-decoration:none;color:var(--text)}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__close::before{content:\"\";position:absolute;inset:6px;border-radius:50%;background:currentColor;opacity:.13}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__close::after{content:\"\\00d7\";position:relative;font-size:22px;line-height:44px;font-weight:300}",
      "#filterPanel.d119-chips-an .d119-chips{display:block;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 0 16px}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe{display:block;padding:16px 22px 18px;border-top:1px solid var(--rule)}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe:first-child{border-top:0;padding-top:8px}",
      "#filterPanel.d119-chips-an .d119-chips__titel{margin:0 0 10px;font-size:.6rem;letter-spacing:.2em;opacity:.7}",
      "#filterPanel.d119-chips-an .d119-chips__reihe{gap:8px}",
      "#filterPanel.d119-chips-an .d119-chips__links{margin-top:4px}",
      /* "Fuer" als Umschalter wie in einer App */
      "#filterPanel.d119-chips-an .d119-chips__gruppe--fuer .d119-chips__reihe{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:0;padding:3px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--rule-strong)}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--fuer .d119-chip{min-height:40px;min-width:0;padding:0 6px;border:0;border-radius:9px;background:none;",
      "font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--fuer .d119-chip[aria-pressed=\"true\"]{background:var(--text);color:var(--bg)}",
      /* Sortieren, Preis, Marke, Farbe: wischbare Reihen mit runden Knoepfen */
      "#filterPanel.d119-chips-an :is(.d119-chips__gruppe--groesse,.d119-chips__gruppe--sortieren,.d119-chips__gruppe--preis,.d119-chips__gruppe--marke,.d119-chips__gruppe--farbe) .d119-chips__reihe{",
      "flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -22px;padding:0 22px;scroll-padding:0 22px;",
      "-webkit-mask-image:linear-gradient(to right,transparent 0,#000 18px,#000 calc(100% - 26px),transparent);mask-image:linear-gradient(to right,transparent 0,#000 18px,#000 calc(100% - 26px),transparent)}",
      "#filterPanel.d119-chips-an .d119-chips__reihe::-webkit-scrollbar{display:none}",
      "#filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chips__reihe{flex-wrap:wrap;overflow:visible;margin:0;padding:0;-webkit-mask-image:none;mask-image:none;gap:8px}",
      "#filterPanel.d119-chips-an :is(.d119-chips__gruppe--groesse,.d119-chips__gruppe--sortieren,.d119-chips__gruppe--preis,.d119-chips__gruppe--marke,.d119-chips__gruppe--farbe) .d119-chip{",
      "flex:0 0 auto;min-height:42px;padding:0 16px;border:1px solid var(--rule-strong);border-radius:999px;background:none;white-space:nowrap;",
      "font-size:.7rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase}",
      "#filterPanel.d119-chips-an :is(.d119-chips__gruppe--groesse,.d119-chips__gruppe--sortieren,.d119-chips__gruppe--preis,.d119-chips__gruppe--marke,.d119-chips__gruppe--farbe) .d119-chip[aria-pressed=\"true\"]{background:var(--text);color:var(--bg);border-color:var(--text)}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__foot{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:14px;margin:0;",
      "padding:12px 14px max(14px,env(safe-area-inset-bottom)) 20px;border-top:1px solid var(--rule);background:var(--bg)}",
      "#filterPanel.d119-chips-an .d119-filter-drawer__apply{flex:1 1 auto;width:auto;min-height:52px;padding:0 12px;border:0;border-radius:14px;white-space:nowrap;font-size:.72rem;font-weight:800;letter-spacing:.1em}",
      "}",
      "@media (prefers-reduced-motion:reduce){#filterPanel.d119-filter-drawer,.d119-filter-backdrop{animation:none;transition:none}}",
      "@media (prefers-reduced-motion:reduce){.d119-kat__knopf,.d119-chip{transition:none}}",
      /* Band "Bereits verkauft" im Raster (verkauftBandSetzen) */
      ".d119-verkauft{grid-column:1/-1;min-width:0;overflow-x:clip;margin:clamp(4px,1.5vw,14px) 0;padding:16px 0 14px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}",
      ".d119-verkauft__kopf{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 16px;margin:0 0 10px}",
      ".d119-verkauft__titel{margin:0;font-size:.72rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--text)}",
      ".d119-verkauft__link{min-height:44px;padding:0;border:0;background:none;color:var(--text-muted);font:inherit;font-size:.72rem;letter-spacing:.06em;",
      "text-decoration:underline;text-underline-offset:3px;cursor:pointer}",
      ".d119-verkauft__link:hover{color:var(--text)}",
      // position+contain: iOS-WebKit schneidet das laufende Band (rund 4000 px breit) sonst nicht
      // sicher ab - die Seite liess sich dann bis auf Viertelgroesse herauszoomen (06.11.2026).
      ".d119-verkauft__fenster{position:relative;contain:paint;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent);mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent)}",
      ".d119-verkauft__spur{display:flex;width:max-content;animation:d119-verkauft-lauf 80s linear infinite}",
      ".d119-verkauft:not(.d119-verkauft--sichtbar) .d119-verkauft__spur,.d119-verkauft:hover .d119-verkauft__spur,.d119-verkauft:focus-within .d119-verkauft__spur{animation-play-state:paused}",
      ".d119-verkauft__liste{display:flex;gap:18px;margin:0;padding:0 18px 0 0;list-style:none}",
      ".d119-verkauft__karte{display:flex;align-items:center;gap:10px;min-height:44px;color:var(--text);text-decoration:none}",
      "a.d119-verkauft__karte:focus-visible{outline:2px solid var(--focus,var(--text));outline-offset:2px}",
      ".d119-verkauft__bild{flex:0 0 auto;width:48px;height:64px;background:var(--mount);overflow:hidden}",
      ".d119-verkauft__bild img{display:block;width:100%;height:100%;object-fit:contain}",
      ".d119-verkauft__text{display:grid;gap:3px;white-space:nowrap}",
      ".d119-verkauft__marke{font-size:.76rem;font-weight:600}",
      ".d119-verkauft__status{font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted)}",
      ".d119-verkauft__unsichtbar{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
      "@keyframes d119-verkauft-lauf{to{transform:translateX(-50%)}}",
      "@media (prefers-reduced-motion:reduce){.d119-verkauft__spur{animation:none}.d119-verkauft__fenster{overflow-x:auto;-webkit-mask-image:none;mask-image:none}.d119-verkauft__liste[aria-hidden]{display:none}}",
      "@media print{.d119-kat,#moreFiltersToggle{display:none!important}}"
    ].join("");
    document.head.appendChild(s);
  }

  // --------------------------------------------------- Kategorie-Leiste

  function ansichten() {
    var liste = [{ key: "alle", label: function () { return tx("alle"); } },
      { key: "neu", label: function () { return api.t("categoryNew"); } }];
    // Nur Kategorien mit verfuegbaren Stuecken (Archiv zeigt alle).
    var verfuegbar = {};
    api.artikel().forEach(function (it) {
      if (it.public_status === "AVAILABLE") verfuegbar[kategorie(it)] = (verfuegbar[kategorie(it)] || 0) + 1;
    });
    function anzahl(key) {
      return key.split(",").reduce(function (summe, k) { return summe + (verfuegbar[k] || 0); }, 0);
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-menu-categories]"), function (knopf) {
      var key = knopf.getAttribute("data-menu-categories");
      var labelKey = knopf.getAttribute("data-i18n");
      liste.push({ key: key, labelKey: labelKey, label: function () { return api.t(labelKey) || knopf.textContent; } });
    });
    liste.push({ key: "archiv", labelKey: "menuArchive", label: function () { return api.t("menuArchive"); } });
    return liste.filter(function (a) { return a.key === "alle" || a.key === "neu" || a.key === "archiv" || anzahl(a.key) > 0; });
  }

  function leisteBauen() {
    var rail = document.querySelector(".rail");
    if (!rail || leiste) return;
    leiste = el("nav", "d119-kat");
    leiste.id = "d119Kategorien";
    // Links "Ansicht", in der Mitte die Kategorien, rechts "Filter".
    var links = el("div", "d119-kat__links");
    leiste.appendChild(links);
    var liste = el("div", "d119-kat__liste");
    leiste.appendChild(liste);
    ansichten().forEach(function (a) {
      var b = el("button", "d119-kat__knopf");
      b.type = "button";
      b.setAttribute("data-d119-ansicht", a.key);
      b.setAttribute("aria-pressed", "false");
      b._label = a.label;
      b.addEventListener("click", function () {
        api.ansicht(a.key, a.labelKey || "");
        if (a.key === "neu") selectSetzen("sortSelect", "new");
        b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        // Leiste direkt unter das Logo, Schriftzug und Suche weg - von oben wie
        // von weiter unten (Inhaber 07.11.2026: bisher blieb man oben stehen).
        var rail = document.querySelector(".rail");
        var oben = rail ? Math.max(0, rail.getBoundingClientRect().bottom + window.scrollY - leisteOffset()) : 0;
        var ruhig = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (rail && Math.abs(window.scrollY - oben) > 4) window.scrollTo({ top: oben, behavior: ruhig ? "auto" : "smooth" });
      });
      liste.appendChild(b);
    });
    rail.parentNode.insertBefore(leiste, rail.nextSibling);

    // "Ansicht" links, "Filter" rechts in der Leiste; am Handy steht "Filter"
    // unten mittig und "Ansicht" entfaellt.
    var aktionen = el("div", "d119-kat__aktionen");
    leiste.appendChild(aktionen);
    var ansicht = document.getElementById("mountToggle");
    if (ansicht) links.appendChild(ansicht);
    var toggle = document.getElementById("moreFiltersToggle");
    if (toggle) aktionen.appendChild(toggle);
    var panel = document.getElementById("filterPanel");
    if (panel) leiste.parentNode.insertBefore(panel, leiste.nextSibling);
    var aktiv = document.getElementById("activeFilters");
    if (aktiv) {
      aktiv.classList.add("d119-aktiv");
      leiste.parentNode.insertBefore(aktiv, (panel || leiste).nextSibling);
    }
    var rechts = rail.querySelector(".rail__right");
    if (rechts) naechsterFrame(function () {
      if (!Array.prototype.some.call(rechts.children, function (kind) {
        return !kind.classList.contains("rail__sort") && getComputedStyle(kind).display !== "none";
      })) rechts.style.display = "none";
    });
  }

  // Passen "Ansicht", alle Kategorien und "Filter" nebeneinander? Gemessen wird
  // die natuerliche Breite (Kategorien ohne Umbruch), nicht die aktuelle - so
  // springt die Leiste nicht zwischen ein- und zweizeilig hin und her. Die
  // Sprachen sind verschieden lang (Franzoesisch braucht am meisten).
  function leisteZeilen() {
    if (!leiste) return;
    var liste = leiste.querySelector(".d119-kat__liste");
    var knoepfe = liste ? liste.querySelectorAll("[data-d119-ansicht]") : [];
    if (istMobil() || !knoepfe.length) { leiste.classList.remove("d119-kat--zweizeilig"); return; }
    var vorher = liste.style.flexWrap;
    liste.style.flexWrap = "nowrap";
    var breite = knoepfe[knoepfe.length - 1].getBoundingClientRect().right - knoepfe[0].getBoundingClientRect().left;
    liste.style.flexWrap = vorher;
    var seite = 0;
    ["mountToggle", "moreFiltersToggle"].forEach(function (id) {
      var k = document.getElementById(id);
      if (k) seite = Math.max(seite, k.getBoundingClientRect().width);
    });
    var cs = window.getComputedStyle(leiste);
    var luft = 2 * (parseFloat(cs.columnGap) || 0) + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    leiste.classList.toggle("d119-kat--zweizeilig", breite + 2 * seite + luft > leiste.clientWidth + 1);
  }

  function leisteOffset() {
    var wert = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-h")) || 0;
    return wert;
  }

  // Handy: Das Filter-Blatt laesst sich am Griff nach unten wegwischen.
  function blattWischen(panel) {
    var kopf = panel && panel.querySelector(".d119-filter-drawer__head");
    if (!kopf || kopf.getAttribute("data-d119-wischen")) return;
    kopf.setAttribute("data-d119-wischen", "1");
    var start = null, weg = 0;
    var zurueck = function () { panel.style.transition = ""; panel.style.transform = ""; };
    kopf.addEventListener("touchstart", function (e) {
      if (!istMobil() || e.touches.length !== 1 || e.target.closest(".d119-filter-drawer__close")) return;
      start = e.touches[0].clientY; weg = 0;
      panel.style.transition = "none";
    }, { passive: true });
    kopf.addEventListener("touchmove", function (e) {
      if (start === null) return;
      weg = Math.max(0, e.touches[0].clientY - start);
      panel.style.transform = weg ? "translateY(" + weg + "px)" : "";
    }, { passive: true });
    var ende = function () {
      if (start === null) return;
      start = null;
      if (weg < 90) { zurueck(); return; }
      panel.style.transition = "";
      panel.style.transform = "translateY(100%)";
      window.setTimeout(function () {
        var zu = panel.querySelector(".d119-filter-drawer__close");
        if (zu) zu.click();
        zurueck();
      }, 200);
    };
    kopf.addEventListener("touchend", ende);
    kopf.addEventListener("touchcancel", function () { start = null; zurueck(); });
  }

  // Anfang der Ergebnisse: wie beim Klick auf eine Kategorie klebt die
  // Leiste direkt unter dem Kopf, der Schriftzug darueber ist weggescrollt.
  function zuDenErgebnissen() {
    var rail = document.querySelector(".rail");
    if (!rail) return;
    var oben = Math.max(0, rail.getBoundingClientRect().bottom + window.scrollY - leisteOffset());
    if (Math.abs(window.scrollY - oben) > 4) window.scrollTo({ top: oben, behavior: "auto" });
  }

  function leisteZeigen() {
    if (!leiste) return;
    var aktiv = api.ansichtJetzt();
    var markiert = false;
    Array.prototype.forEach.call(leiste.querySelectorAll("[data-d119-ansicht]"), function (b) {
      b.textContent = b._label();
      var an = b.getAttribute("data-d119-ansicht") === aktiv;
      if (an) markiert = true;
      b.setAttribute("aria-pressed", an ? "true" : "false");
    });
    leiste.setAttribute("aria-label", tx("kategorien"));
    doppelteChipsAus(markiert);
  }

  // "Kategorie: Schuhe ×" / "Status: Verkauft ×" sagen dasselbe wie die
  // markierte Leiste - dann nur die echten Filter zeigen. Kommt man ueber das
  // Menue in eine Kategorie ohne eigenen Knopf, bleibt der Chip stehen.
  function doppelteChipsAus(leisteMarkiert) {
    var reihe = document.getElementById("activeFilters");
    if (!reihe) return;
    var vorsilben = [api.t("activeFilterCategory") + " ", api.t("activeFilterStatus") + " "];
    var sichtbar = 0;
    var loeschen = null;
    Array.prototype.forEach.call(reihe.children, function (kind) {
      if (kind.classList.contains("active-filter-clear")) { loeschen = kind; return; }
      var label = kind.getAttribute("aria-label") || "";
      var doppelt = leisteMarkiert && vorsilben.some(function (v) { return label.indexOf(v) === 0; });
      kind.style.display = doppelt ? "none" : "";
      if (!doppelt) sichtbar++;
    });
    if (loeschen) loeschen.style.display = sichtbar < 2 ? "none" : "";
    reihe.classList.toggle("d119-aktiv--leer", sichtbar === 0);
  }

  // -------------------------------------------------------------- Chips

  function zaehlen(liste, wert) {
    var n = {};
    liste.forEach(function (it) {
      wert(it).forEach(function (v) { if (v) n[v] = (n[v] || 0) + 1; });
    });
    return n;
  }
  function groesseVon(it) {
    var g = it.size_normalized;
    return g && g !== "Unknown" && g !== "Other" && g !== "Dimensions" ? [g] : [];
  }
  function groessenSortieren(werte) {
    function rang(v) {
      var b = BUCHSTABEN.indexOf(String(v).toUpperCase());
      if (b >= 0) return [0, b];
      var eu = /^EU\s*(\d+(?:[.,]\d+)?)$/i.exec(v);
      if (eu) return [1, parseFloat(eu[1].replace(",", "."))];
      var zahl = /^(\d+(?:[.,]\d+)?)$/.exec(v);
      if (zahl) return [2, parseFloat(zahl[1].replace(",", "."))];
      return [3, 0, String(v)];
    }
    return werte.slice().sort(function (a, b) {
      var ra = rang(a), rb = rang(b);
      if (ra[0] !== rb[0]) return ra[0] - rb[0];
      if (ra[1] !== rb[1]) return ra[1] - rb[1];
      return String(a).localeCompare(String(b), "de", { numeric: true });
    });
  }

  function selectSetzen(id, wert, ereignis) {
    var feld = document.getElementById(id);
    if (!feld) return;
    if (feld.tagName === "SELECT" && wert && !Array.prototype.some.call(feld.options, function (o) { return o.value === wert; })) {
      var opt = document.createElement("option");
      opt.value = wert;
      opt.textContent = wert;
      feld.appendChild(opt);
    }
    feld.value = wert;
    feld.dispatchEvent(new Event(ereignis || "change", { bubbles: true }));
  }

  function chip(text, aktiv, beiKlick, extra) {
    var b = el("button", "d119-chip");
    b.type = "button";
    b.setAttribute("aria-pressed", aktiv ? "true" : "false");
    if (extra && extra.punkt) {
      var punkt = el("span", "d119-chip__punkt");
      punkt.style.background = extra.punkt;
      punkt.setAttribute("aria-hidden", "true");
      b.appendChild(punkt);
    }
    b.appendChild(document.createTextNode(text));
    if (extra && extra.daten) {
      for (var k in extra.daten) b.setAttribute("data-d119-" + k, extra.daten[k]);
    }
    if (extra && extra.label) b.setAttribute("aria-label", extra.label);
    b.addEventListener("click", beiKlick);
    return b;
  }

  function gruppe(titel, klasse) {
    var g = el("section", "d119-chips__gruppe" + (klasse ? " " + klasse : ""));
    var h = el("h3", "d119-chips__titel", titel);
    g.appendChild(h);
    return g;
  }

  function reihe(g, unter) {
    if (unter) g.appendChild(el("p", "d119-chips__unter", unter));
    var r = el("div", "d119-chips__reihe");
    r.setAttribute("role", "group");
    r.setAttribute("aria-label", unter || g.firstChild.textContent);
    g.appendChild(r);
    return r;
  }

  // Hauptgroessen: Buchstaben (XS-XXXL) und EU-Schuhgroessen. Zahlen wie
  // 46/48, "3", Einheitsgroesse und UK/US-Schuhgroessen stehen hinter
  // "Weitere Groessen" - der Filter soll ruhig bleiben (Wunsch 07.10.2026).
  function hauptGroesse(wert) {
    return BUCHSTABEN.indexOf(String(wert).toUpperCase()) >= 0 || /^EU\s*\d/i.test(String(wert));
  }
  var weitereOffen = false;
  var weitereAnsicht = null;

  function groessenGruppe(z) {
    var g = gruppe(tx("groesse"), "d119-chips__gruppe--groesse");
    var ansicht = api.ansichtJetzt();
    if (ansicht !== weitereAnsicht) { weitereOffen = false; weitereAnsicht = ansicht; }
    var gruppiert = ansicht === "alle" || ansicht === "neu" || ansicht === "archiv" || ansicht === "";
    var treffer = api.treffer("size");
    // Unter "Alle" nur Kleidungsgroessen; Schuh- und Accessoire-Groessen gibt
    // es in ihrer Kategorie ("Schuhgroessen" springt dorthin).
    if (gruppiert) {
      treffer = treffer.filter(function (it) {
        var k = kategorie(it);
        return SCHUHE.indexOf(k) < 0 && ACCESSOIRES.indexOf(k) < 0;
      });
    }
    var werte = groessenSortieren(Object.keys(zaehlen(treffer, groesseVon)));
    // Eine aktive Groesse bleibt sichtbar, auch ohne Treffer.
    if (z.size && werte.indexOf(z.size) < 0) werte.push(z.size);
    var haupt = werte.filter(hauptGroesse);
    var weitere = werte.filter(function (w) { return !hauptGroesse(w); });
    if (!haupt.length) { haupt = weitere; weitere = []; }
    var offen = weitereOffen || (!!z.size && weitere.indexOf(z.size) >= 0);
    var zeigen = offen ? haupt.concat(weitere) : haupt;
    if (zeigen.length) {
      var r = reihe(g, "");
      zeigen.forEach(function (wert) {
        var aktiv = z.size === wert;
        r.appendChild(chip(api.groesse(wert) || wert, aktiv, function () {
          selectSetzen("filterSize", aktiv ? "" : wert);
        }, { daten: { facette: "size", wert: wert } }));
      });
    } else {
      g.appendChild(el("p", "d119-chips__leer", tx("keineGroessen")));
    }
    var links = el("div", "d119-chips__links");
    if (weitere.length) {
      var mehr = el("button", "d119-chips__link", tx(offen ? "wenigerGroessen" : "weitereGroessen"));
      mehr.type = "button";
      mehr.setAttribute("aria-expanded", offen ? "true" : "false");
      mehr.setAttribute("data-d119-facette", "groessen-mehr");
      mehr.setAttribute("data-d119-wert", "1");
      mehr.addEventListener("click", function () { weitereOffen = !offen; zeichnen(); });
      links.appendChild(mehr);
    }
    if (gruppiert && ansicht !== "archiv" && leiste && leiste.querySelector('[data-d119-ansicht="Shoes"]')) {
      var schuhe = el("button", "d119-chips__link", tx("schuhgroessen"));
      schuhe.type = "button";
      schuhe.setAttribute("data-d119-facette", "schuhgroessen");
      schuhe.addEventListener("click", function () { api.ansicht("Shoes", "menuShoes"); });
      links.appendChild(schuhe);
    }
    if (links.childNodes.length) g.appendChild(links);
    return g;
  }

  function einfacheGruppe(titel, facette, feldId, werte, n, aktiv, label, extra) {
    var g = gruppe(titel, extra && extra.klasse);
    var r = reihe(g, "");
    werte.forEach(function (wert) {
      var istAktiv = aktiv === wert;
      r.appendChild(chip(label ? label(wert) : wert, istAktiv, function () {
        selectSetzen(feldId, istAktiv ? "" : wert);
      }, { punkt: extra && extra.punkt ? extra.punkt(wert) : null, daten: { facette: facette, wert: wert } }));
    });
    return { gruppe: g, reihe: r };
  }

  function bereichGruppe(z) {
    var n = zaehlen(api.treffer("department"), function (it) { return [it.department]; });
    var werte = ["Women", "Men", "Unisex"].filter(function (w) { return n[w] || z.department === w; });
    if (werte.length < 2 && !z.department) return null;
    return einfacheGruppe(tx("fuer"), "department", "filterDepartment", werte, n, z.department, api.bereich, { klasse: "d119-chips__gruppe--fuer" }).gruppe;
  }

  function sortierGruppe(z) {
    var sel = document.getElementById("sortSelect");
    if (!sel) return null;
    var g = gruppe(tx("sortieren"), "d119-chips__gruppe--sortieren");
    var r = reihe(g, "");
    // Reihenfolge fuer Kundschaft: Neu, Preis, dann der Rest.
    var reihenfolge = ["new", "price-asc", "price-desc", "brightness", "brand"];
    Array.prototype.slice.call(sel.options).sort(function (a, b) {
      return reihenfolge.indexOf(a.value) - reihenfolge.indexOf(b.value);
    }).forEach(function (opt) {
      var kurz = (SORT_KURZ[sprache()] || SORT_KURZ.de)[opt.value] || opt.textContent;
      r.appendChild(chip(kurz, z.sort === opt.value, function () {
        selectSetzen("sortSelect", opt.value);
      }, { daten: { facette: "sort", wert: opt.value } }));
    });
    return g;
  }

  function preisGruppe(z) {
    var preise = api.treffer("price").map(function (it) { return Number(it.price) || 0; }).filter(function (p) { return p > 0; });
    var g = gruppe(tx("preis"), "d119-chips__gruppe--preis");
    var r = reihe(g, "");
    PREISE.forEach(function (stufe) {
      var a = stufe[0], b = stufe[1];
      var anzahl = preise.filter(function (p) { return (a === 0 || p >= a) && (b == null || p <= b); }).length;
      var aktiv = (z.priceMin == null ? 0 : z.priceMin) === a && z.priceMax === b;
      if (!anzahl && !aktiv) return;
      var text = a === 0 ? tx("bis", { b: b }) : b == null ? tx("ab", { a: a }) : tx("spanne", { a: a, b: b });
      r.appendChild(chip(text, aktiv, function () {
        var min = document.getElementById("filterPriceMin"), max = document.getElementById("filterPriceMax");
        if (!min || !max) return;
        min.value = aktiv || a === 0 ? "" : String(a);
        max.value = aktiv || b == null ? "" : String(b);
        min.dispatchEvent(new Event("input", { bubbles: true }));
        max.dispatchEvent(new Event("input", { bubbles: true }));
      }, { daten: { facette: "price", wert: a + "-" + (b == null ? "" : b) } }));
    });
    return r.childNodes.length ? g : null;
  }

  function mehrGruppe(z) {
    var details = el("details", "d119-chips__mehr");
    if (z.brand || z.color || z.condition || z.priceMin != null || z.priceMax != null) details.open = true;
    details.appendChild(el("summary", "", tx("mehr")));
    var innen = el("div", "d119-chips__mehrinhalt");
    details.appendChild(innen);
    var preis = preisGruppe(z);
    if (preis) innen.appendChild(preis);

    var mn = zaehlen(api.treffer("brand"), function (it) { return [it.brand]; });
    var marken = Object.keys(mn).sort(function (a, b) { return mn[b] - mn[a] || a.localeCompare(b, "de"); });
    if (z.brand && marken.indexOf(z.brand) < 0) marken.unshift(z.brand);
    if (marken.length) {
      var kurz = !markenOffen && marken.length > MARKEN_KURZ + 2;
      var sichtbar = kurz ? marken.slice(0, MARKEN_KURZ) : marken;
      if (kurz && z.brand && sichtbar.indexOf(z.brand) < 0) sichtbar.push(z.brand);
      var m = einfacheGruppe(tx("marke"), "brand", "filterBrand", sichtbar, mn, z.brand, null, { klasse: "d119-chips__gruppe--marke" });
      if (marken.length > MARKEN_KURZ + 2) {
        var mehr = chip(kurz ? tx("alleMarken", { n: marken.length }) : tx("weniger"), false, function () {
          markenOffen = !markenOffen;
          zeichnen();
        });
        mehr.className += " d119-chip--leise";
        mehr.setAttribute("aria-expanded", kurz ? "false" : "true");
        mehr.removeAttribute("aria-pressed");
        m.reihe.appendChild(mehr);
      }
      innen.appendChild(m.gruppe);
    }

    var fn = zaehlen(api.treffer("color"), function (it) {
      return String(it.color || "").split(",").map(function (c) { return (window.D119Farbgruppe ? window.D119Farbgruppe(c) : c.trim()); });
    });
    var farben = Object.keys(fn).sort(function (a, b) { return fn[b] - fn[a] || a.localeCompare(b, "de"); });
    if (farben.length) {
      innen.appendChild(einfacheGruppe(tx("farbe"), "color", "filterColor", farben, fn, z.color, api.farbe || null, {
        klasse: "d119-chips__gruppe--farbe",
        punkt: function (f) { return FARBEN[f] || "linear-gradient(135deg,#e04b4b,#e8c33a,#3aa35b,#3a6fd6)"; }
      }).gruppe);
    }

    var en = zaehlen(api.treffer("condition"), function (it) { return [it.condition]; });
    var erhaltung = Object.keys(en).filter(Boolean);
    if (erhaltung.length > 1 || z.condition) {
    }
    return innen.childNodes.length ? details : null;
  }

  function zuruecksetzenKnopf() {
    var b = el("button", "d119-chips__zurueck", tx("zuruecksetzen"));
    b.type = "button";
    b.addEventListener("click", function () {
      var reset = document.getElementById("filterReset");
      if (reset) reset.click();
    });
    return b;
  }

  function panelOffen() {
    var panel = document.getElementById("filterPanel");
    return !!panel && !panel.classList.contains("hidden");
  }

  // Helle Ansicht: build_site.py misst je Foto, wie stark es aufgehellt
  // werden soll (foto_hell in catalog.json). Die Kacheln baut app.js - deren
  // Vorlage steht unter CI-Ankern -, deshalb haengt der Wert hier an.
  var hellJeId = null;
  function kachelnAufhellen() {
    if (!hellJeId) {
      hellJeId = {};
      api.artikel().forEach(function (it) {
        if (Number(it.foto_hell) > 0) hellJeId[it.id] = String(Number(it.foto_hell));
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("#grid .plate"), function (kachel) {
      var treffer = /\/artikel\/(\d+)\//.exec(kachel.getAttribute("href") || "");
      var wert = treffer && hellJeId[treffer[1]];
      if (wert && kachel.style.getPropertyValue("--d119-hell") !== wert) kachel.style.setProperty("--d119-hell", wert);
    });
  }

  // ------------------------------------------- Band "Bereits verkauft"

  // Echte verkaufte Stuecke aus dem Archiv laufen als schmales Band durch die
  // Ansicht "Alle" - ohne Datum und ohne Zahlen: gezeigt wird nur, was in
  // catalog.json als verkauft steht (Testartikel ausgenommen). Es sitzt nach
  // ganzen Reihen, damit das Raster keine Luecke bekommt, und traegt nicht die
  // Klasse "plate" - die gehoert allein den Produktkarten.
  var VERKAUFT_MAX = 14;
  var verkauftBand = null;
  var verkauftSprache = "";
  var verkauftSpalten = 0;
  var verkauftGeplant = false;

  function verkauftListe() {
    return api.artikel().filter(function (it) {
      return it.public_status === "SOLD" && (it.grid_image || (it.gallery && it.gallery[0])) &&
        !/testartikel/i.test(String(it.title || ""));
    }).sort(function (a, b) { return Number(b.id) - Number(a.id); }).slice(0, VERKAUFT_MAX);
  }

  function vorschauPfad(it) {
    var pfad = String(it.grid_image || "");
    if (!pfad) {
      pfad = String(it.gallery[0]);
      var i = pfad.lastIndexOf("/");
      pfad = pfad.slice(0, i) + "/thumbs/" + pfad.slice(i + 1);
    }
    return /^(https?:)?\//.test(pfad) ? pfad : "/" + pfad;
  }

  function verkauftBandBauen() {
    var liste = verkauftListe();
    if (liste.length < 6) return null;
    var lang = sprache();
    var home = lang === "de" ? "/" : "/" + lang + "/";
    var band = el("section", "d119-verkauft");
    band.setAttribute("aria-labelledby", "d119VerkauftTitel");
    var kopf = el("div", "d119-verkauft__kopf");
    var titel = el("h2", "d119-verkauft__titel", tx("verkauft"));
    titel.id = "d119VerkauftTitel";
    var archiv = el("button", "d119-verkauft__link", tx("verkauftArchiv"));
    archiv.type = "button";
    archiv.addEventListener("click", function () {
      api.ansicht("archiv", "menuArchive");
      var grid = document.getElementById("grid");
      if (grid) window.scrollTo(0, Math.max(0, grid.getBoundingClientRect().top + window.pageYOffset - 160));
    });
    kopf.appendChild(titel);
    kopf.appendChild(archiv);
    band.appendChild(kopf);
    // Zweimal dieselbe Reihe: das Band laeuft um die halbe Breite und beginnt
    // dann unmerklich von vorn. Die zweite Reihe ist nur Bild, ohne Links.
    function reihe(kopie) {
      var ul = el("ul", "d119-verkauft__liste");
      if (kopie) ul.setAttribute("aria-hidden", "true");
      liste.forEach(function (it) {
        var li = el("li", "");
        var karte = el(kopie ? "span" : "a", "d119-verkauft__karte");
        if (!kopie) karte.href = home + "artikel/" + (it.url_slug || it.id) + "/";
        var bild = el("span", "d119-verkauft__bild");
        var img = document.createElement("img");
        img.src = vorschauPfad(it);
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.width = 48;
        img.height = 64;
        bild.appendChild(img);
        var text = el("span", "d119-verkauft__text");
        text.appendChild(el("span", "d119-verkauft__marke", it.brand || "DISORDER119"));
        if (!kopie) text.appendChild(el("span", "d119-verkauft__unsichtbar", it.title || ""));
        text.appendChild(el("span", "d119-verkauft__status", tx("verkauftStatus")));
        karte.appendChild(bild);
        karte.appendChild(text);
        li.appendChild(karte);
        ul.appendChild(li);
      });
      return ul;
    }
    var fenster = el("div", "d119-verkauft__fenster");
    var spur = el("div", "d119-verkauft__spur");
    spur.appendChild(reihe(false));
    spur.appendChild(reihe(true));
    fenster.appendChild(spur);
    band.appendChild(fenster);
    // Ausserhalb des Bildes steht das Band still.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (eintraege) {
        band.classList.toggle("d119-verkauft--sichtbar", eintraege[eintraege.length - 1].isIntersecting);
      }).observe(band);
    } else {
      band.classList.add("d119-verkauft--sichtbar");
    }
    return band;
  }

  function verkauftBandSetzen() {
    var grid = document.getElementById("grid");
    if (!grid || !api) return;
    var z = api.zustand();
    var passt = api.ansichtJetzt() === "alle" && !z.department && !z.size && !z.brand && !z.color &&
      z.priceMin == null && z.priceMax == null;
    if (passt && !verkauftSpalten) {
      var spalten = String(window.getComputedStyle(grid).gridTemplateColumns || "").trim();
      verkauftSpalten = spalten && spalten !== "none" ? spalten.split(/\s+/).length : 0;
    }
    var karten = grid.querySelectorAll(".plate");
    // Nach ganzen Reihen, mindestens zwei (am Handy vier mit je zwei Karten).
    var nach = verkauftSpalten ? verkauftSpalten * Math.max(2, Math.ceil(8 / verkauftSpalten)) : 0;
    if (!passt || !nach || karten.length <= nach) {
      if (verkauftBand && verkauftBand.parentNode) verkauftBand.parentNode.removeChild(verkauftBand);
      return;
    }
    if (!verkauftBand || verkauftSprache !== sprache()) {
      if (verkauftBand && verkauftBand.parentNode) verkauftBand.parentNode.removeChild(verkauftBand);
      verkauftBand = verkauftBandBauen();
      verkauftSprache = sprache();
      if (!verkauftBand) return;
    }
    var vorher = karten[nach - 1];
    if (vorher.nextSibling !== verkauftBand) grid.insertBefore(verkauftBand, vorher.nextSibling);
  }

  // Beim ersten Mal erst, wenn der Browser Luft hat: Das Band liegt unter den
  // ersten Reihen und soll den Seitenaufbau nicht bremsen. Danach (Filter,
  // "Mehr laden") sofort im selben Frame wie das neue Raster.
  function verkauftPlanen() {
    if (verkauftBand) { verkauftBandSetzen(); return; }
    if (verkauftGeplant) return;
    verkauftGeplant = true;
    var los = function () { verkauftGeplant = false; verkauftBandSetzen(); };
    if (window.requestIdleCallback) window.requestIdleCallback(los, { timeout: 2500 });
    else window.setTimeout(los, 600);
  }

  function zeichnen() {
    geplant = false;
    leisteZeigen();
    leisteZeilen();
    kachelnAufhellen();
    verkauftPlanen();
    // Chips nur bei offenem Filter bauen: beim Laden kostet das sonst
    // Rechenzeit, die niemand sieht (TBT). Beim Oeffnen baut der
    // Beobachter in start() sie sofort nach.
    if (panelOffen()) chipsBauen();
    else chipsVeraltet = true;
    knopfText();
  }

  function chipsBauen() {
    var panel = document.getElementById("filterPanel");
    if (!panel || !api) return;
    chipsVeraltet = false;
    if (!chipsBox) {
      chipsBox = el("div", "d119-chips");
      chipsBox.id = "d119Chips";
      var kopf = panel.querySelector(".d119-filter-drawer__head");
      panel.insertBefore(chipsBox, kopf ? kopf.nextSibling : panel.firstChild);
      panel.classList.add("d119-chips-an");
    }
    // Fokus merken: ein Chip-Klick baut die Chips neu.
    var fokus = document.activeElement && chipsBox.contains(document.activeElement)
      ? { facette: document.activeElement.getAttribute("data-d119-facette"), wert: document.activeElement.getAttribute("data-d119-wert") }
      : null;
    var z = api.zustand();
    chipsBox.textContent = "";
    // Reihenfolge (Inhaber 07.11.2026): zuerst Marke und Farbe - danach
    // suchen die Leute; Groesse sichtbar, aber nicht im Vordergrund. Preis,
    // Marke und Farbe stehen direkt im Filter (kein "Preis, Marke, Farbe +").
    var groesse = groessenGruppe(z), fuer = bereichGruppe(z), sortierung = sortierGruppe(z);
    var mehr = mehrGruppe(z);
    var teil = function (k) { return mehr ? mehr.querySelector(".d119-chips__gruppe--" + k) : null; };
    [teil("marke"), teil("farbe"), fuer, groesse, teil("preis"), sortierung].forEach(function (g) { if (g) chipsBox.appendChild(g); });
    blattWischen(panel);
    var fuss = el("div", "d119-chips__fuss");
    fuss.appendChild(zuruecksetzenKnopf());
    chipsBox.appendChild(fuss);

    // Am Handy steht "Alles zuruecksetzen" neben "… Artikel anzeigen".
    var drawerFuss = panel.querySelector(".d119-filter-drawer__foot");
    if (drawerFuss && !drawerFuss.querySelector(".d119-chips__zurueck")) drawerFuss.insertBefore(zuruecksetzenKnopf(), drawerFuss.firstChild);
    else if (drawerFuss) drawerFuss.querySelector(".d119-chips__zurueck").textContent = tx("zuruecksetzen");

    if (fokus && fokus.facette) {
      var ziel = chipsBox.querySelector('[data-d119-facette="' + fokus.facette + '"][data-d119-wert="' + String(fokus.wert).replace(/"/g, '\\"') + '"]')
        || chipsBox.querySelector('[data-d119-facette="size"]');
      if (ziel) ziel.focus();
    }
  }

  // "Filter anzeigen / ausblenden" am Desktop, "Filter · 2" am Handy.
  function knopfText() {
    var toggle = document.getElementById("moreFiltersToggle");
    if (!toggle) return;
    var z = api ? api.zustand() : {};
    var aktiv = ["department", "size", "brand", "color", "condition"].filter(function (k) { return z[k]; }).length +
      ((z.priceMin != null || z.priceMax != null) ? 1 : 0);
    var offen = toggle.getAttribute("aria-expanded") === "true";
    var text = istMobil() ? tx("filter") : tx(offen ? "ausblenden" : "anzeigen");
    var soll = text + (aktiv ? " · " + aktiv : "");
    if (toggle.textContent !== soll) toggle.textContent = soll;
  }

  // Der Cookie-Hinweis liegt beim ersten Besuch unten - der Filterknopf
  // rutscht so lange darueber.
  function untenAbstand() {
    var toggle = document.getElementById("moreFiltersToggle");
    if (!toggle) return;
    var hinweis = document.getElementById("cookieNote");
    var hoehe = 0;
    if (hinweis && hinweis.classList.contains("visible")) {
      var r = hinweis.getBoundingClientRect();
      if (r.height && r.top < window.innerHeight) hoehe = Math.max(0, window.innerHeight - r.top);
    }
    var wert = (hoehe ? Math.round(hoehe) + 10 : 14) + "px";
    // Nur am Knopf und nur bei Aenderung setzen: dieselbe Variable an <html>
    // liesse den Browser die Styles der ganzen Seite neu berechnen.
    if (toggle.style.getPropertyValue("--d119-unten") !== wert) toggle.style.setProperty("--d119-unten", wert);
  }

  function untenAbstandPlanen() {
    var hinweis = document.getElementById("cookieNote");
    // Ohne sichtbaren Hinweis gibt es nichts zu messen - sofort setzen.
    if (!hinweis || !hinweis.classList.contains("visible")) untenAbstand();
    else naechsterFrame(untenAbstand);
  }

  function planen() {
    if (geplant) return;
    geplant = true;
    (window.requestAnimationFrame || window.setTimeout)(zeichnen);
  }

  var gestartet = false;
  function start() {
    api = window.D119Archiv;
    if (gestartet || !document.getElementById("grid") || !document.querySelector(".rail")) return;
    if (!api) {
      document.addEventListener("d119:archiv", start, { once: true });
      return;
    }
    gestartet = true;
    stil();
    leisteBauen();
    zeichnen();
    // Schriften und Knopftexte (app.js setzt sie je Sprache) kommen evtl. erst
    // nach dem ersten Messen: Aendert sich die Groesse der Knoepfe oder der
    // Kategorien, wird neu gemessen - im naechsten Frame, damit der Wechsel
    // selbst keine Schleife im ResizeObserver ausloest.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(leisteZeilen);
    if ("ResizeObserver" in window && leiste) {
      var zeilenBeobachter = new ResizeObserver(function () { naechsterFrame(leisteZeilen); });
      [document.getElementById("mountToggle"), document.getElementById("moreFiltersToggle"), leiste.querySelector(".d119-kat__liste")]
        .forEach(function (k) { if (k) zeilenBeobachter.observe(k); });
    }
    document.addEventListener("d119:archiv", planen);
    // Sprache wechselt auf der Seite (DE/EN/FR).
    new MutationObserver(planen).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    var toggle = document.getElementById("moreFiltersToggle");
    if (toggle) {
      // Andere Skripte setzen den Text nach jedem Wechsel neu - danach wieder unseren.
      new MutationObserver(function () { knopfText(); }).observe(toggle, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });
    }
    window.addEventListener("resize", function () {
      knopfText();
      untenAbstandPlanen();
      naechsterFrame(leisteZeilen);
      // Andere Spaltenzahl: das Band rutscht ans Ende einer ganzen Reihe.
      if (verkauftSpalten) { verkauftSpalten = 0; planen(); }
    }, { passive: true });
    var hinweis = document.getElementById("cookieNote");
    if (hinweis) new MutationObserver(untenAbstandPlanen).observe(hinweis, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
    untenAbstandPlanen();
    // Filter geht auf (Knopf, Drawer, Tastatur): Chips sofort nachbauen,
    // noch bevor der Browser das offene Panel zeichnet.
    var panel = document.getElementById("filterPanel");
    // Hat sich beim Filtern etwas geaendert, zeigt die Seite nach dem
    // Schliessen den Anfang der Ergebnisse: Kategorie-Leiste direkt unter dem
    // Kopf - nicht den grossen Schriftzug mit der Suche (Inhaber 07.11.2026).
    var warOffen = panelOffen();
    var zustandBeimOeffnen = null;
    if (panel) new MutationObserver(function () {
      var offen = panelOffen();
      if (chipsVeraltet && offen) chipsBauen();
      if (offen && !warOffen) zustandBeimOeffnen = JSON.stringify(api.zustand());
      if (!offen && warOffen && zustandBeimOeffnen !== null && JSON.stringify(api.zustand()) !== zustandBeimOeffnen) naechsterFrame(zuDenErgebnissen);
      warOffen = offen;
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    // Der einmalige Hinweis auf Match/Universum/Baukasten liegt direkt unter
    // dem Kopf. Dockt die Leiste dort an, wuerde er ihre Knoepfe verdecken -
    // dann schliesst er wie nach seinen 7 Sekunden.
    var modusHinweis = document.getElementById("modeRailHint");
    var modusHinweisZu = document.getElementById("modeRailHintClose");
    if (modusHinweis && modusHinweisZu && leiste) {
      var hinweisGeplant = false;
      var hinweisBeobachter = null;
      var hinweisPruefen = function () {
        if (hinweisGeplant) return;
        hinweisGeplant = true;
        naechsterFrame(function () {
          hinweisGeplant = false;
          if (!modusHinweis.classList.contains("visible")) return;
          var oben = parseFloat(getComputedStyle(leiste).top) || 0;
          if (leiste.getBoundingClientRect().top <= oben + 1) {
            window.removeEventListener("scroll", hinweisPruefen);
            if (hinweisBeobachter) hinweisBeobachter.disconnect();
            modusHinweisZu.click();
          }
        });
      };
      // Auch wenn der Hinweis erst erscheint, nachdem schon gescrollt wurde.
      hinweisBeobachter = new MutationObserver(hinweisPruefen);
      hinweisBeobachter.observe(modusHinweis, { attributes: true, attributeFilter: ["class"] });
      window.addEventListener("scroll", hinweisPruefen, { passive: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

/* Filter-Gestaltung "Nebel" (Inhaber 07./08.11.2026, ausgewaehlt auf der Testseite:
   Laptop Entwurf 12 "Register", iPhone Entwurf 4 "Wortwolke"). Baut auf den Chips
   oben auf (chipsBauen) und setzt nach jedem Neuzeichnen nur Klassen/Attribute.
   - Laptop: Kategorien genau ueber der Fotobreite ("Alle" linke, "Archiv" rechte
     Fotokante); "Ansicht" und "Filter" links/rechts daneben, wenn Platz ist, sonst
     eine Zeile hoeher bei "Verfuegbar". Beim Scrollen schwebt unten "Filter".
     Filter im Nebel: links die Gruppen als grosse Woerter (springen, leuchten beim
     Scrollen), rechts alle Werte offen.
   - iPhone: Kategorien in zwei Reihen statt wischen; Filter als Blatt von unten
     (fast der ganze Bildschirm); Marken A-Z als Wortwolke (viel Bestand = gross),
     auch unter "Alle Marken"; Farben als Kreise mit Namen; nichts zum Wischen.
   - Marken immer A-Z, Sortieren wie bisher als Kaestchen. */
(function () {
  "use strict";
  var html = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(max-width: 720px)") : { matches: false };
  function istMobil() { return !!mq.matches; }
  function el(tag, klasse, text) { var e = document.createElement(tag); if (klasse) e.className = klasse; if (text != null) e.textContent = text; return e; }
  function sprache() { var l = String(html.lang || "de").toLowerCase(); return l.indexOf("en") === 0 ? "en" : l.indexOf("fr") === 0 ? "fr" : "de"; }
  var TEXT = {
    de: { filter: "Filter", anwenden: "Anwenden", gruppen: "Filtergruppen" },
    en: { filter: "Filters", anwenden: "Apply", gruppen: "Filter groups" },
    fr: { filter: "Filtres", anwenden: "Appliquer", gruppen: "Groupes de filtres" }
  };
  function tx(k) { return (TEXT[sprache()] || TEXT.de)[k]; }

  function stil() {
    if (document.getElementById("d119NebelStil")) return;
    var s = el("style"); s.id = "d119NebelStil";
    s.textContent = [
      /* ---------- Laptop */
      "@media (min-width:721px){",
      /* Das Filterblatt sperrt auch den Wurzel-Scroller. Sonst zeigt Edge
         neben dem Blatt noch die Scrollleiste der darunterliegenden Seite. */
      "html.nebel:has(body.d119-filter-open){overflow:hidden}",
      /* Die Leiste und die Zeile "Verfuegbar · Anzahl" stehen schon vor dem Start so (Inline-Stil in
         index_template.html, "Archiv-Zeile vor dem Start"), sonst springt das Layout (CLS). Hier kommen nur die neuen
         Knoepfe dazu: absolut an den Fotokanten, auf Hoehe der Zeile (--nebel-rail-* aus kanten()). */
      "html.nebel .rail.nebel-rail{position:relative;border-bottom:0}",
      "html.nebel .rail.nebel-rail>:not(.nebel-rail__links):not(.catalog-heading):not(.nebel-rail__rechts){display:none}",
      "html.nebel .nebel-rail__links,html.nebel .nebel-rail__rechts{position:absolute;top:var(--nebel-rail-mitte,38px);transform:translateY(-50%);display:flex;align-items:center}",
      "html.nebel .nebel-rail__links{left:var(--nebel-rail-l,0px)}",
      "html.nebel .nebel-rail__rechts{right:var(--nebel-rail-r,0px)}",
      "html.nebel .nebel-rail #mountToggle,html.nebel .nebel-rail #moreFiltersToggle{margin:0;white-space:nowrap}",
      "html.nebel .nebel-rail #moreFiltersToggle::after{content:\"+\";display:inline-block;margin-left:8px;font-weight:400}",
      "html.nebel .nebel-rail #moreFiltersToggle[aria-expanded=\"true\"]::after{content:\"\\2013\"}",
      "html.nebel .d119-kat,html.nebel .d119-kat.d119-kat--zweizeilig{display:block;padding:0;grid-template-columns:none}",
      "html.nebel .d119-kat__links,html.nebel .d119-kat__aktionen{display:none}",
      "html.nebel .d119-kat__liste{width:var(--nebel-breite,calc(100% - 112px));margin-left:var(--nebel-links,56px);padding:0;justify-content:space-between;flex-wrap:wrap;column-gap:18px;row-gap:0;overflow:visible}",
      "html.nebel .nebel-zeilenbruch{display:none}",
      "html.nebel.nebel-seitlich .d119-kat__links,html.nebel.nebel-seitlich .d119-kat__aktionen{display:flex;position:absolute;top:50%;transform:translateY(-50%);margin:0}",
      "html.nebel.nebel-seitlich .d119-kat__links{left:clamp(20px,2.5vw,48px)}",
      "html.nebel.nebel-seitlich .d119-kat__aktionen{right:clamp(20px,2.5vw,48px)}",
      "html.nebel.nebel-seitlich .nebel-rail__links,html.nebel.nebel-seitlich .nebel-rail__rechts{display:none}",
      ".nebel-pille{position:fixed;left:50%;bottom:24px;z-index:120;transform:translate(-50%,16px);opacity:0;pointer-events:none;display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 26px;",
      "border:1px solid color-mix(in srgb,var(--text) 22%,transparent);background:color-mix(in srgb,var(--bg) 62%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);",
      "color:var(--text);font:inherit;font-size:.7rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:opacity .2s ease,transform .2s ease}",
      ".nebel-pille.da{opacity:1;transform:translate(-50%,0);pointer-events:auto}",
      ".nebel-pille i{font-style:normal;font-weight:400}",
      ".nebel-pille b{font-weight:800}",
      /* Filter im Nebel: links Register, rechts alle Werte */
      "html.nebel #filterPanel.d119-chips-an.d119-filter-drawer{gap:0;padding-top:0;background:color-mix(in srgb,var(--bg) 76%,transparent);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);animation:nebelRein .22s ease;scrollbar-width:none}",
      "html.nebel #filterPanel.d119-chips-an.d119-filter-drawer::-webkit-scrollbar{display:none}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__head{padding:0 var(--nebel-links,56px);background:color-mix(in srgb,var(--bg) 80%,transparent);border-bottom:0}",
      ".nebel-register{position:sticky;top:104px;height:0;overflow:visible;margin-left:var(--nebel-links,56px);width:calc(var(--nebel-breite,1328px) * .34);display:flex;flex-direction:column;align-items:flex-start;z-index:3;flex:0 0 0}",
      ".nebel-register button{appearance:none;border:0;background:none;color:var(--text);font:inherit;cursor:pointer;padding:2px 0;text-align:left;font-size:clamp(30px,3.6vw,56px);font-weight:800;letter-spacing:-.025em;line-height:1.02;text-transform:uppercase;opacity:.28;transition:opacity .18s ease}",
      ".nebel-register button:hover{opacity:.6}",
      ".nebel-register button.an{opacity:1}",
      ".nebel-register sup{font-size:.32em;letter-spacing:.06em;margin-left:.35em;vertical-align:super}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips{display:block;width:calc(var(--nebel-breite,1328px) * .62);max-width:none;margin:0 0 0 calc(var(--nebel-links,56px) + var(--nebel-breite,1328px) * .38);padding:30px 0 18px}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe{display:block;margin:0 0 28px;padding:0}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__titel{font-size:.62rem;font-weight:800;letter-spacing:.22em;opacity:.6;margin:0 0 14px;cursor:default}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__titel::after{content:\" \" attr(data-zahl)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__reihe{display:flex;flex-wrap:wrap;flex-direction:row;gap:6px 30px;align-items:baseline}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chips__reihe{display:block;columns:3;column-gap:28px}",
      "html.nebel #filterPanel.d119-chips-an .d119-chip,html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip,html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chip{",
      "font-size:clamp(1rem,1.35vw,1.4rem);font-weight:800;letter-spacing:.01em;line-height:1.3;opacity:.7;padding:.1em 0}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"1\"]{font-size:clamp(.78rem,.85vw,.9rem)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"2\"]{font-size:clamp(.9rem,1vw,1.05rem)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"3\"]{font-size:clamp(1rem,1.2vw,1.25rem)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"4\"]{font-size:clamp(1.1rem,1.4vw,1.45rem)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"5\"]{font-size:clamp(1.25rem,1.6vw,1.65rem)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chip[aria-pressed=\"true\"]{opacity:1;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px}",
      "html.nebel #filterPanel.d119-chips-an .d119-chip:hover{opacity:.85}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__foot{justify-content:flex-start;gap:28px;padding:18px 0 26px calc(var(--nebel-links,56px) + var(--nebel-breite,1328px) * .38);background:color-mix(in srgb,var(--bg) 88%,transparent);border-top:1px solid color-mix(in srgb,var(--text) 12%,transparent)}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__apply{font-size:0;padding:0 40px}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__apply::after{content:attr(data-nebel-text) \" [ \" attr(data-treffer) \" ]\";font-size:.74rem;font-weight:800;letter-spacing:.18em}",
      "}",
      /* Auch auf einem flacheren Laptop bleibt die Standardauswahl voll
         sichtbar. Erst aufgeklappte Zusatzwerte brauchen internes Scrollen. */
      "@media (min-width:721px) and (max-height:800px){",
      "html.nebel #filterPanel.d119-chips-an .d119-chips{padding-top:16px;padding-bottom:8px}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe{margin-bottom:8px}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__titel{margin-bottom:7px}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__foot{padding-top:12px;padding-bottom:12px}",
      "}",
      "@keyframes nebelRein{from{opacity:0}to{opacity:1}}",
      /* ---------- ueberall: Filterzeilen nie wischen, Sortieren als Kaestchen */
      "html.nebel #filterPanel.d119-chips-an .d119-chips__reihe{flex-wrap:wrap!important;overflow:visible!important;-webkit-mask-image:none!important;mask-image:none!important}",
      "html.nebel.nebel #filterPanel.d119-chips-an .d119-chips__gruppe.d119-chips__gruppe--sortieren .d119-chips__reihe{display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;columns:auto;align-items:center;overflow:visible;margin:0;padding:0 0 18px;box-shadow:none;border-radius:0}",
      "html.nebel.nebel #filterPanel.d119-chips-an .d119-chips__gruppe.d119-chips__gruppe--sortieren .d119-chip{display:inline-flex;width:auto;min-width:44px;min-height:42px;padding:9px 14px;margin:0;justify-content:center;",
      "border:1px solid var(--rule-strong);border-radius:0;background:transparent;color:var(--text);opacity:1;font-size:.76rem;font-weight:400;letter-spacing:.04em;line-height:1.2;text-transform:none;text-decoration:none;white-space:nowrap;box-shadow:none}",
      "html.nebel.nebel #filterPanel.d119-chips-an .d119-chips__gruppe.d119-chips__gruppe--sortieren .d119-chip:hover{border-color:var(--text)}",
      "html.nebel.nebel #filterPanel.d119-chips-an .d119-chips__gruppe.d119-chips__gruppe--sortieren .d119-chip[aria-pressed=\"true\"]{background:var(--text);color:var(--bg);border-color:var(--text);opacity:1;text-decoration:none}",
      /* ---------- iPhone */
      "@keyframes nebelBlatt{from{transform:translateY(100%)}to{transform:none}}",
      "@keyframes nebelHinter{from{opacity:0}to{opacity:1}}",
      "@media (max-width:720px){",
      ".nebel-pille,.nebel-register{display:none}",
      /* Handy: Ansicht/Filter sitzen in der Kategorie-Leiste; die leeren Huellen wuerden sonst je 30px Abstand in die Leiste schieben */
      "html.nebel .nebel-rail__links,html.nebel .nebel-rail__rechts{display:none}",
      "html.nebel .d119-kat__liste{flex-wrap:wrap;overflow:visible;justify-content:space-between;column-gap:10px;row-gap:0;scroll-snap-type:none;padding:2px 0 4px}",
      "html.nebel .d119-kat__knopf{font-size:.68rem;letter-spacing:.06em;padding:11px 0 9px}",
      "html.nebel .nebel-zeilenbruch{display:block;flex-basis:100%;height:0}",
      /* Filter-Knopf: Text mit drei Strichen unten mittig, ohne Kasten (schwarz bzw. weiss wie die Seite) */
      "html.nebel.nebel .d119-kat #moreFiltersToggle{position:fixed;transform:none;left:0;right:0;top:auto;bottom:0;min-width:0;min-height:0;margin:0;border:0;border-radius:0;box-shadow:none;",
      "height:calc(72px + env(safe-area-inset-bottom,0px));padding:0 0 env(safe-area-inset-bottom,0px);display:flex;align-items:center;justify-content:center;gap:10px;",
      "background:linear-gradient(to top,var(--bg) 40%,transparent);color:var(--text);font-size:.8rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}",
      "html.nebel.nebel .d119-kat #moreFiltersToggle::before{content:\"\";width:14px;height:10px;flex:0 0 auto;background:linear-gradient(currentColor,currentColor) 0 0/14px 1.5px no-repeat,linear-gradient(currentColor,currentColor) 0 50%/14px 1.5px no-repeat,linear-gradient(currentColor,currentColor) 0 100%/14px 1.5px no-repeat}",
      /* Blatt von unten wie bei Apple */
      "html.nebel #filterPanel.d119-chips-an.d119-filter-drawer{inset:auto 0 0 0;height:calc(100dvh - 26px);max-height:none;gap:0;padding-top:0;border:0;border-top:1px solid color-mix(in srgb,var(--text) 16%,transparent);",
      "border-radius:22px 22px 0 0;box-shadow:0 -20px 60px rgba(0,0,0,.5);background:var(--bg);animation:nebelBlatt .5s cubic-bezier(.32,.72,0,1)}",
      "html.nebel .d119-filter-backdrop{background:rgba(0,0,0,.42);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);animation:nebelHinter .3s ease}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__head{position:relative;min-height:40px;margin:0;padding:14px 8px 0 20px;border-bottom:0;border-radius:22px 22px 0 0;touch-action:none;background:var(--bg)}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__head::before{display:block;content:\"\";position:absolute;top:7px;left:50%;width:36px;height:5px;margin-left:-18px;border-radius:3px;background:currentColor;opacity:.3}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__title{font-size:.8rem;letter-spacing:.2em}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips{padding:0 0 6px;scrollbar-width:none}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips::-webkit-scrollbar{display:none}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe,html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe:first-child{padding:5px 20px 6px;border-top:0}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__titel{margin:0 0 4px;font-size:.54rem;letter-spacing:.22em;opacity:.55}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe .d119-chips__reihe{margin:0;padding:0;gap:6px}",
      /* Marken: Wortwolke A-Z, je mehr Stuecke, desto groesser */
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chips__reihe{display:flex;flex-wrap:wrap;gap:0 10px;align-items:baseline}",
      /* WCAG: jede Marke mind. 24px hoch (Tippflaeche) und nicht gewaehlt mit .62 Deckkraft (>= 4,5:1 hell und dunkel) */
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip{display:inline-flex;align-items:center;min-height:24px;padding:0;border:0;border-radius:0;background:none;color:var(--text);",
      "font-size:.9rem;font-weight:800;letter-spacing:-.015em;line-height:1.05;text-transform:uppercase;opacity:.62;transition:opacity .18s ease}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"1\"]{font-size:.66rem}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"2\"]{font-size:.8rem}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"3\"]{font-size:1rem}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"4\"]{font-size:1.22rem}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"5\"]{font-size:1.5rem}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip[aria-pressed=\"true\"]{opacity:1;background:none;color:var(--text)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--marke .d119-chip--leise{font-size:.6rem;font-weight:800;letter-spacing:.12em;opacity:.85;text-decoration:underline;text-underline-offset:3px;align-self:center}",
      /* "Alle Marken": ebenfalls Wortwolke, die anderen Gruppen solange aus (kein Scrollen) */
      "html.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe:not(.d119-chips__gruppe--marke){display:none}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chips__reihe{gap:0 11px}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip{line-height:1.08;font-size:.74rem}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"1\"]{font-size:.72rem}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"2\"]{font-size:.92rem}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"3\"]{font-size:1.14rem}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"4\"]{font-size:1.4rem}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip[data-gewicht=\"5\"]{font-size:1.7rem}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip[aria-pressed=\"true\"]{opacity:1;text-decoration:underline;text-underline-offset:4px}",
      "html.nebel.nebel #filterPanel.d119-chips-an #d119Chips.nebel-alle-marken .d119-chips__gruppe--marke .d119-chip--leise{flex:0 0 100%;margin:12px 0 0;font-size:.6rem;opacity:.9}",
      /* Farben: grosse Kreise mit Namen, sieben pro Reihe */
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chips__reihe{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px 0}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chip{display:flex;flex-direction:column;align-items:center;gap:4px;min-height:0;min-width:0;padding:0;border:0;border-radius:0;background:none;color:var(--text);",
      "font-size:.44rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;opacity:.85}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chip .d119-chip__punkt{width:32px;height:32px;border:1px solid var(--rule-strong)}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chip[aria-pressed=\"true\"]{background:none;color:var(--text);opacity:1}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--farbe .d119-chip[aria-pressed=\"true\"] .d119-chip__punkt{box-shadow:0 0 0 2px var(--bg),0 0 0 3.5px var(--text)}",
      /* Fuer: Apple-Umschalter */
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--fuer .d119-chips__reihe{border-radius:10px;padding:2px;box-shadow:none;background:color-mix(in srgb,var(--text) 9%,var(--bg))}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--fuer .d119-chip{min-height:28px;border-radius:8px;font-size:.64rem;transition:background .2s ease}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--fuer .d119-chip[aria-pressed=\"true\"]{background:color-mix(in srgb,var(--text) 26%,var(--bg));color:var(--text)}",
      /* Groesse (Weitere/Schuhe rechts daneben), Preis, Sortieren kompakt */
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--groesse{display:flex;flex-wrap:wrap;align-items:center;column-gap:12px}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--groesse .d119-chips__titel{flex:0 0 100%}",
      "html.nebel #filterPanel.d119-chips-an :is(.d119-chips__gruppe--groesse,.d119-chips__gruppe--preis) .d119-chips__reihe{display:flex;flex-wrap:wrap;gap:5px}",
      "html.nebel #filterPanel.d119-chips-an :is(.d119-chips__gruppe--groesse,.d119-chips__gruppe--preis) .d119-chip{min-height:28px;min-width:32px;padding:0 8px;border:1px solid var(--rule-strong);border-radius:0;font-size:.62rem}",
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--groesse .d119-chips__links{flex-direction:column;align-items:flex-start;gap:0;margin:-10px 0}",
      /* WCAG-Tippflaeche: je 24px hoch; die Spalte ragt per -10px in die Abstaende zu den Titeln, die Zeile bleibt 28px */
      "html.nebel #filterPanel.d119-chips-an .d119-chips__gruppe--groesse .d119-chips__link{display:inline-flex;align-items:center;min-height:24px;font-size:.54rem;padding:0}",
      "html.nebel.nebel #filterPanel.d119-chips-an .d119-chips__gruppe.d119-chips__gruppe--sortieren .d119-chips__reihe{gap:5px;padding:0 0 4px}",
      "html.nebel.nebel #filterPanel.d119-chips-an .d119-chips__gruppe.d119-chips__gruppe--sortieren .d119-chip{min-height:28px;padding:0 10px;font-size:.7rem}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__foot{padding:7px 14px max(12px,env(safe-area-inset-bottom)) 20px;border-top:1px solid var(--rule);background:var(--bg)}",
      "html.nebel #filterPanel.d119-chips-an .d119-filter-drawer__apply{min-height:44px;background:var(--bg);color:var(--text);border:1px solid var(--text);border-radius:0}",
      "}",
      "@media (prefers-reduced-motion:reduce){html.nebel #filterPanel.d119-filter-drawer,html.nebel .d119-filter-backdrop,.nebel-pille{animation:none!important;transition:none!important}}"
    ].join("");
    document.head.appendChild(s);
  }

  var box = null, register = null, pille = null, links = null, rechts = null;

  // Gruppen kennzeichnen (data-gruppe, Zaehler am Titel), Marken A-Z mit Gewicht
  function schluessel(g) { var m = /d119-chips__gruppe--([a-z]+)/.exec(g.className); return m ? m[1] : ""; }
  function dekorieren() {
    if (!box) return;
    var api = window.D119Archiv;
    Array.prototype.forEach.call(box.querySelectorAll(".d119-chips__gruppe"), function (g) {
      var k = schluessel(g);
      g.setAttribute("data-gruppe", k);
      var an = Array.prototype.filter.call(g.querySelectorAll('.d119-chip[aria-pressed="true"]'), function (c) { return !c.classList.contains("d119-chip--leise"); });
      var t = g.querySelector(".d119-chips__titel");
      if (t) t.setAttribute("data-zahl", k !== "sortieren" && an.length ? "[" + an.length + "]" : "");
    });
    var mg = box.querySelector(".d119-chips__gruppe--marke");
    if (mg) {
      var r = mg.querySelector(".d119-chips__reihe"), leise = r && r.querySelector(".d119-chip--leise");
      box.classList.toggle("nebel-alle-marken", !!(leise && leise.getAttribute("aria-expanded") === "true"));
      if (r) {
        var chips = Array.prototype.filter.call(r.children, function (c) { return c.classList.contains("d119-chip") && c !== leise; });
        chips.sort(function (a, b) { return a.textContent.trim().localeCompare(b.textContent.trim(), "de", { sensitivity: "base" }); });
        // Groesse nach dem ganzen verfuegbaren Bestand: jede Marke bleibt gleich gross,
        // egal welcher Filter gesetzt ist (sonst springt die Wolke beim Filtern).
        var zahlen = {}, max = 1;
        if (api) api.artikel().forEach(function (it) { if (it.public_status !== "SOLD") zahlen[it.brand] = (zahlen[it.brand] || 0) + 1; });
        Object.keys(zahlen).forEach(function (k) { if (zahlen[k] > max) max = zahlen[k]; });
        chips.forEach(function (c) {
          var n = zahlen[c.textContent.trim()] || 0;
          c.setAttribute("data-gewicht", String(Math.max(1, Math.min(5, Math.ceil(5 * Math.sqrt(n / max))))));
          r.appendChild(c);
        });
        if (leise) r.appendChild(leise);
      }
    }
    registerZeichnen();
  }

  function treffer() { var r = document.getElementById("railCount"); var m = /\d+/.exec(r ? r.textContent : ""); return m ? m[0] : ""; }
  function knoepfeBeschriften() {
    var panel = document.getElementById("filterPanel"); if (!panel) return;
    var an = panel.querySelector(".d119-filter-drawer__apply"), zahl = treffer();
    if (an && an.getAttribute("data-treffer") !== zahl) an.setAttribute("data-treffer", zahl);
    if (an && an.getAttribute("data-nebel-text") !== tx("anwenden")) an.setAttribute("data-nebel-text", tx("anwenden"));
    var t = document.getElementById("moreFiltersToggle");
    var m = t ? /·\s*(\d+)/.exec(t.textContent) : null;
    if (pille) { pille.querySelector("span").textContent = tx("filter"); pille.querySelector("b").textContent = m ? " [" + m[1] + "]" : ""; }
  }

  // Laptop: links die Gruppen als grosse Woerter - Klick springt hin, beim Scrollen leuchtet die aktuelle
  function registerAktiv() {
    var panel = document.getElementById("filterPanel");
    if (!register || !panel || !box || istMobil()) return;
    var gr = box.querySelectorAll(".d119-chips__gruppe"), aktiv = gr[0];
    Array.prototype.forEach.call(gr, function (g) { if (g.getBoundingClientRect().top <= 150) aktiv = g; });
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) aktiv = gr[gr.length - 1];
    Array.prototype.forEach.call(register.children, function (b) { b.classList.toggle("an", !!aktiv && b.getAttribute("data-g") === aktiv.getAttribute("data-gruppe")); });
  }
  function registerZeichnen() {
    var panel = document.getElementById("filterPanel");
    if (!panel || !box) return;
    if (!register) {
      register = el("nav", "nebel-register");
      register.setAttribute("aria-label", tx("gruppen"));
      panel.insertBefore(register, box);
      panel.addEventListener("scroll", function () { (window.requestAnimationFrame || setTimeout)(registerAktiv); }, { passive: true });
    }
    register.textContent = "";
    Array.prototype.forEach.call(box.querySelectorAll(".d119-chips__gruppe"), function (g) {
      var t = g.querySelector(".d119-chips__titel");
      var b = el("button"); b.type = "button"; b.setAttribute("data-g", g.getAttribute("data-gruppe"));
      b.appendChild(el("span", "", t ? t.textContent : ""));
      b.appendChild(el("sup", "", t ? t.getAttribute("data-zahl") : ""));
      b.addEventListener("click", function () { panel.scrollTo({ top: Math.max(0, g.offsetTop - 96), behavior: "smooth" }); });
      register.appendChild(b);
    });
    registerAktiv();
  }

  // Fotokanten messen: Leiste und Zeile richten sich danach
  function kanten() {
    var grid = document.getElementById("grid"); if (!grid) return;
    var r = grid.getBoundingClientRect(); if (!r.width) return;
    html.style.setProperty("--nebel-links", Math.round(r.left) + "px");
    html.style.setProperty("--nebel-breite", Math.round(r.width) + "px");
    var rail = document.querySelector(".rail");
    if (rail) {
      var q = rail.getBoundingClientRect();
      html.style.setProperty("--nebel-rail-l", Math.round(r.left - q.left) + "px");
      html.style.setProperty("--nebel-rail-r", Math.round(q.right - r.right) + "px");
      var kopf = rail.querySelector(".catalog-heading"), k = kopf && kopf.getBoundingClientRect();
      if (k && k.height) html.style.setProperty("--nebel-rail-mitte", Math.round(k.top - q.top + k.height / 2) + "px");
    }
    var liste = document.querySelector(".d119-kat__liste"); if (!liste) return;
    var knoepfe = liste.querySelectorAll("[data-d119-ansicht]"), bruch = liste.querySelector(".nebel-zeilenbruch");
    var ziel = knoepfe[Math.ceil(knoepfe.length / 2)];
    if (!ziel) return;
    if (!bruch) { bruch = el("span", "nebel-zeilenbruch"); bruch.setAttribute("aria-hidden", "true"); }
    if (bruch.nextSibling !== ziel) liste.insertBefore(bruch, ziel);
  }
  // "Ansicht" und "Filter": am Laptop neben den Fotos, wenn Platz ist, sonst eine Zeile hoeher
  function railUmbauen() {
    var rail = document.querySelector(".rail"), kat = document.getElementById("d119Kategorien");
    var ansicht = document.getElementById("mountToggle"), filter = document.getElementById("moreFiltersToggle");
    if (!rail || !kat) return;
    if (!links) {
      links = el("div", "nebel-rail__links"); rechts = el("div", "nebel-rail__rechts");
      rail.insertBefore(links, rail.firstChild); rail.appendChild(rechts); rail.classList.add("nebel-rail");
    }
    kanten();
    var kl = kat.querySelector(".d119-kat__links"), ka = kat.querySelector(".d119-kat__aktionen");
    // Ab 1820px ist neben den Fotos Platz - dieselbe Grenze wie im Inline-Stil von index_template.html ("Archiv-Zeile vor dem Start")
    var seitlich = !istMobil() && !!(window.matchMedia && window.matchMedia("(min-width:1820px)").matches);
    html.classList.toggle("nebel-seitlich", seitlich);
    if (istMobil() || seitlich) {
      if (ansicht && kl && ansicht.parentNode !== kl) kl.appendChild(ansicht);
      if (filter && ka && filter.parentNode !== ka) ka.appendChild(filter);
    } else {
      if (ansicht && ansicht.parentNode !== links) links.appendChild(ansicht);
      if (filter && filter.parentNode !== rechts) rechts.appendChild(filter);
    }
  }
  // Laptop: schwebender Filter, sobald die Zeile weggescrollt ist
  function pillePruefen() {
    if (!pille) return;
    var rail = document.querySelector(".rail"), panel = document.getElementById("filterPanel");
    var weg = rail ? rail.getBoundingClientRect().bottom < 70 : false;
    pille.classList.toggle("da", weg && !(panel && !panel.classList.contains("hidden")) && !istMobil());
  }
  function pilleBauen() {
    pille = el("button", "nebel-pille"); pille.type = "button";
    pille.appendChild(el("i", "", "\u2261")); pille.appendChild(el("span", "", tx("filter"))); pille.appendChild(el("b"));
    pille.addEventListener("click", function () { var t = document.getElementById("moreFiltersToggle"); if (t) t.click(); });
    document.body.appendChild(pille);
    var geplant = false;
    window.addEventListener("scroll", function () { if (geplant) return; geplant = true; (window.requestAnimationFrame || setTimeout)(function () { geplant = false; pillePruefen(); }); }, { passive: true });
    pillePruefen();
  }

  function boxSuchen() {
    if (box) return;
    box = document.getElementById("d119Chips"); if (!box) return;
    new MutationObserver(function () { dekorieren(); knoepfeBeschriften(); }).observe(box, { childList: true });
    dekorieren(); knoepfeBeschriften();
  }
  function los() {
    var panel = document.getElementById("filterPanel");
    if (!panel || !document.getElementById("d119Kategorien") || !document.getElementById("grid")) return false;
    html.classList.add("nebel");
    stil(); railUmbauen(); pilleBauen();
    new MutationObserver(function () { boxSuchen(); knoepfeBeschriften(); pillePruefen(); }).observe(panel, { childList: true, attributes: true, attributeFilter: ["class"] });
    var rc = document.getElementById("railCount");
    if (rc) new MutationObserver(knoepfeBeschriften).observe(rc, { childList: true, characterData: true, subtree: true });
    var t = document.getElementById("moreFiltersToggle");
    if (t) new MutationObserver(knoepfeBeschriften).observe(t, { childList: true, characterData: true, subtree: true });
    boxSuchen(); knoepfeBeschriften();
    window.addEventListener("resize", function () { railUmbauen(); dekorieren(); }, { passive: true });
    if (mq.addEventListener) mq.addEventListener("change", function () { railUmbauen(); dekorieren(); });
    if ("ResizeObserver" in window) new ResizeObserver(kanten).observe(document.getElementById("grid"));
    return true;
  }
  // Die Leiste baut der obere Teil erst, wenn app.js bereit ist - kurz darauf warten.
  function start() {
    if (!document.getElementById("grid")) return;
    if (los()) return;
    // Die Kategorie-Leiste entsteht spaeter: gleich nach ihrem Einfuegen umbauen, noch vor dem naechsten
    // Bild - sonst sieht man kurz die alte Leiste und das Layout springt zweimal.
    var fertig = false, mo = null, warten = null;
    var aus = function () { fertig = true; if (mo) mo.disconnect(); if (warten) clearInterval(warten); };
    var pruefen = function () { if (!fertig && los()) aus(); };
    if ("MutationObserver" in window) { mo = new MutationObserver(pruefen); mo.observe(document.body || html, { childList: true, subtree: true }); }
    warten = setInterval(pruefen, 100);
    setTimeout(function () { if (!fertig) aus(); }, 15000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
