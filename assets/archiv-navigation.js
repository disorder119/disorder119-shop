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
      anzeigen: "Filter anzeigen", ausblenden: "Filter ausblenden", filter: "Filter", schliessen: "Schließen"
    },
    en: {
      alle: "All", kategorien: "Categories", groesse: "Size", weitereGroessen: "More sizes",
      wenigerGroessen: "Fewer sizes", schuhgroessen: "Shoe sizes",
      fuer: "For", sortieren: "Sort", preis: "Price", mehr: "Price, brand, colour",
      marke: "Brand", farbe: "Colour", erhaltung: "Condition", zuruecksetzen: "Reset all",
      keineGroessen: "No sizes listed for this selection.", alleMarken: "All brands ({n})",
      weniger: "Less", bis: "up to €{b}", ab: "from €{a}", spanne: "€{a}–{b}",
      anzeigen: "Show filters", ausblenden: "Hide filters", filter: "Filters", schliessen: "Close"
    },
    fr: {
      alle: "Tout", kategorien: "Catégories", groesse: "Taille", weitereGroessen: "Autres tailles",
      wenigerGroessen: "Moins de tailles", schuhgroessen: "Pointures",
      fuer: "Pour", sortieren: "Trier", preis: "Prix", mehr: "Prix, marque, couleur",
      marke: "Marque", farbe: "Couleur", erhaltung: "État", zuruecksetzen: "Tout réinitialiser",
      keineGroessen: "Aucune taille indiquée pour cette sélection.", alleMarken: "Toutes les marques ({n})",
      weniger: "Moins", bis: "jusqu’à {b} €", ab: "dès {a} €", spanne: "{a}–{b} €",
      anzeigen: "Afficher les filtres", ausblenden: "Masquer les filtres", filter: "Filtres", schliessen: "Fermer"
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
      ".d119-kat__knopf:hover{opacity:1}",
      ".d119-kat__knopf[aria-pressed=\"true\"]{opacity:1;border-bottom-color:var(--text)}",
      ".d119-kat__knopf:focus-visible{outline:2px solid var(--accent-text,#8f897c);outline-offset:3px}",
      /* "Filter anzeigen" rechts in der Leiste (Desktop) */
      ".d119-kat #moreFiltersToggle,.d119-kat #mountToggle{flex:0 0 auto;margin:0;padding:8px 14px;white-space:nowrap}",
      /* Passen die Knoepfe nicht mehr daneben, stehen sie rechts darunter */
      ".d119-kat__aktionen{display:flex;align-items:center;gap:10px;flex:0 0 auto;margin-left:auto}",
      "@media (min-width:721px) and (max-width:1100px){.d119-kat__knopf{font-size:.7rem;letter-spacing:.07em}.d119-kat__liste{column-gap:16px}}",
      /* Laptop: Kategorien mittig auf der Seite (Wunsch des Inhabers). Links eine
         leere Spalte so breit wie rechts "Ansicht"/"Filter"; wird es eng,
         rueckt die Mitte nach links, statt die Knoepfe zu ueberdecken. */
      "@media (min-width:721px){.d119-kat{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(max-content,1fr)}",
      ".d119-kat::before{content:\"\";grid-column:1}",
      ".d119-kat__liste{grid-column:2;justify-content:center;column-gap:clamp(12px,1.3vw,22px)}",
      ".d119-kat__aktionen{grid-column:3;justify-self:end;margin-left:0}}",
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
      ".d119-kat #mountToggle{display:none}",
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
      "@media (prefers-reduced-motion:reduce){.d119-kat__knopf,.d119-chip{transition:none}}",
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
        // Nach oben an den Anfang der Liste, wenn man schon tief unten war.
        var rail = document.querySelector(".rail");
        var oben = rail ? rail.getBoundingClientRect().bottom + window.scrollY - leisteOffset() : 0;
        if (rail && window.scrollY > oben + 4) window.scrollTo({ top: oben, behavior: "smooth" });
      });
      liste.appendChild(b);
    });
    rail.parentNode.insertBefore(leiste, rail.nextSibling);

    // "Filter" wandert in die Leiste: am Desktop rechts, am Handy unten mittig.
    // Beide Knoepfe als Gruppe: brechen nur gemeinsam (rechtsbuendig) um.
    var aktionen = el("div", "d119-kat__aktionen");
    leiste.appendChild(aktionen);
    var ansicht = document.getElementById("mountToggle");
    if (ansicht) aktionen.appendChild(ansicht);
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

  function leisteOffset() {
    var wert = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-h")) || 0;
    return wert;
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
    var g = gruppe(tx("groesse"));
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
    return einfacheGruppe(tx("fuer"), "department", "filterDepartment", werte, n, z.department, api.bereich).gruppe;
  }

  function sortierGruppe(z) {
    var sel = document.getElementById("sortSelect");
    if (!sel) return null;
    var g = gruppe(tx("sortieren"));
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
    var g = gruppe(tx("preis"));
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
      var m = einfacheGruppe(tx("marke"), "brand", "filterBrand", sichtbar, mn, z.brand);
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
      return String(it.color || "").split(",").map(function (c) { return c.trim(); });
    });
    var farben = Object.keys(fn).sort(function (a, b) { return fn[b] - fn[a] || a.localeCompare(b, "de"); });
    if (farben.length) {
      innen.appendChild(einfacheGruppe(tx("farbe"), "color", "filterColor", farben, fn, z.color, null, {
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

  function zeichnen() {
    geplant = false;
    leisteZeigen();
    kachelnAufhellen();
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
    chipsBox.appendChild(groessenGruppe(z));
    [bereichGruppe(z), sortierGruppe(z), mehrGruppe(z)].forEach(function (g) { if (g) chipsBox.appendChild(g); });
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
    document.addEventListener("d119:archiv", planen);
    // Sprache wechselt auf der Seite (DE/EN/FR).
    new MutationObserver(planen).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    var toggle = document.getElementById("moreFiltersToggle");
    if (toggle) {
      // Andere Skripte setzen den Text nach jedem Wechsel neu - danach wieder unseren.
      new MutationObserver(function () { knopfText(); }).observe(toggle, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });
    }
    window.addEventListener("resize", function () { knopfText(); untenAbstandPlanen(); }, { passive: true });
    var hinweis = document.getElementById("cookieNote");
    if (hinweis) new MutationObserver(untenAbstandPlanen).observe(hinweis, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
    untenAbstandPlanen();
    // Filter geht auf (Knopf, Drawer, Tastatur): Chips sofort nachbauen,
    // noch bevor der Browser das offene Panel zeichnet.
    var panel = document.getElementById("filterPanel");
    if (panel) new MutationObserver(function () {
      if (chipsVeraltet && panelOffen()) chipsBauen();
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
