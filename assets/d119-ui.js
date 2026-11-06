/* Oberflaeche (04.11.2026, aus der UI-Vorschau uebernommen): Seitenwechsel als Ueberblendung (CSS),
   Teil reinziehen am Handy, Slideshow auf der Kachel, Home-Bildschirm-Hinweis (iPhone), Zuletzt angesehen
   (schwebend im Kopf, Leiste auf der Produktseite), Teilen, Suche im Kopf, Suchvorschlaege, Start an der Kategorienleiste. */
(function () {
  "use strict";
  var grid = document.getElementById("grid");
  var istArchiv = Boolean(grid);
  var istArtikel = Boolean(window.ARTICLE_ITEM);
  var html = document.documentElement;
  var istIphone = /iPhone|iPad/.test(navigator.userAgent);
  var grob = window.matchMedia("(pointer: coarse)").matches;

  function speicher(key, wert) {
    try { if (wert === undefined) return JSON.parse(localStorage.getItem(key) || "null"); localStorage.setItem(key, JSON.stringify(wert)); } catch (e) { return null; }
  }
  var toastEl;
  function toast(text, ms) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "ui-toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = text;
    requestAnimationFrame(function () { toastEl.classList.add("is-sichtbar"); });
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("is-sichtbar"); }, ms || 2600);
  }
  // catalog.json (gross) erst nach dem Laden der Seite und einer Ruhepause holen,
  // damit es dem ersten Bild nicht die Leitung streitig macht (Lighthouse-Schwelle
  // Startseite). Tippt jemand vorher in die Suche, kommt es sofort (katalog(true)).
  var katalogAufloesen, katalogGestartet = false;
  var katalogVersprechen = new Promise(function (r) { katalogAufloesen = r; });
  var ruhe = new Promise(function (r) {
    var los = function () { (window.requestIdleCallback || function (fn) { setTimeout(fn, 1); })(function () { setTimeout(r, 900); }); };
    if (document.readyState === "complete") los(); else window.addEventListener("load", los, { once: true });
  });
  function katalogStarten() {
    if (katalogGestartet) return;
    katalogGestartet = true;
    fetch(location.origin + "/data/catalog.json").then(function (r) { return r.json(); }).catch(function () { return []; }).then(katalogAufloesen);
  }
  function katalog(sofort) {
    if (sofort) katalogStarten(); else ruhe.then(katalogStarten);
    return katalogVersprechen;
  }
  function teilZu(k, slug) { return k.find(function (x) { return String(x.url_slug || x.id) === String(slug); }); }
  function slugAus(href) { var m = /\/artikel\/([^/]+)\//.exec(href || ""); return m ? m[1] : null; }
  function gridBild(it) { return it.grid_image ? "/" + it.grid_image : "/" + (it.look || (it.gallery || [])[0] || ""); }
  function vibrieren(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  // Seitenuebergang (CSS @view-transition) nur zwischen Seiten, die diese Datei laden (Start, Produkt).
  // Sonst bricht der Browser den Uebergang mit "ViewTransition opt-in disabled" als Fehler ab
  // (Chromium-Smoke-Test /match/). Die Promises immer abfangen - Abbrueche sind kein Fehler.
  function mitUebergang(url) {
    try { return /^\/(en\/|fr\/)?(artikel\/[^/]+\/)?$/.test(new URL(url, location.href).pathname); } catch (e) { return false; }
  }
  function uebergangStill(vt) {
    if (!vt) return;
    try { vt.ready.catch(function () {}); vt.finished.catch(function () {}); vt.updateCallbackDone.catch(function () {}); } catch (e) {}
  }
  window.addEventListener("pageswap", function (e) {
    uebergangStill(e.viewTransition);
    var ziel = e.activation && e.activation.entry && e.activation.entry.url;
    if (e.viewTransition && !mitUebergang(ziel)) { try { e.viewTransition.skipTransition(); } catch (x) {} }
  });
  window.addEventListener("pagereveal", function (e) { uebergangStill(e.viewTransition); });

  /* 2 · Wischen = nächstes Teil reinziehen: unter den Fotos nach links/rechts ziehen, das nächste/vorige Teil
     schiebt sich mit dem Finger herein (Foto + Marke + Preis); loslassen ab einem Drittel = Wechsel. */
  if (istArtikel && grob) {
    var product = document.querySelector(".product");
    var karte = document.createElement("a"); karte.className = "ui-peek"; document.body.appendChild(karte);
    var sx = 0, sy = 0, aktiv = false, richtung = 0, breite = window.innerWidth, ziel = null, gefuellt = {};
    function navLink(r) {
      var a = document.querySelector(".article-sequence-nav__link--" + (r < 0 ? "next" : "prev"));
      return a && a.getAttribute("href") && a.style.visibility !== "hidden" ? a.getAttribute("href") : null;
    }
    function fuellen(href) {
      if (gefuellt[href]) return;
      gefuellt[href] = true;
      katalog().then(function (k) {
        var it = teilZu(k, slugAus(href)); if (!it) return;
        var preis = it.price > 0 ? Number(it.price).toLocaleString("de-DE") + " €" : "SOLD";
        gefuellt[href] = '<img src="' + gridBild(it) + '" alt=""><span><b>' + (it.brand || "") + "</b>" + (it.title_en && document.documentElement.lang === "en" ? it.title_en : it.title || "") + "<em>" + preis + "</em></span>";
        if (ziel === href) karte.innerHTML = gefuellt[href];
      });
    }
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1 || e.target.closest(".gallery, .lightbox, input, textarea, select, button, a, .ui-zuletzt")) { aktiv = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; aktiv = true; richtung = 0; breite = window.innerWidth;
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!aktiv) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (!richtung) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { aktiv = false; return; }
        if (Math.abs(dx) < 14) return;
        richtung = dx < 0 ? -1 : 1;
        ziel = navLink(richtung);
        if (!ziel) { aktiv = false; return; }
        karte.href = ziel; karte.className = "ui-peek is-aktiv" + (richtung < 0 ? " ui-peek--rechts" : " ui-peek--links");
        karte.innerHTML = typeof gefuellt[ziel] === "string" ? gefuellt[ziel] : "";
        fuellen(ziel);
        html.classList.add("ui-zieht");
      }
      if (e.cancelable) e.preventDefault();
      var anteil = Math.max(0, Math.min(1, Math.abs(dx) / (breite * 0.55)));
      if (product) product.style.transform = "translateX(" + (dx * 0.35) + "px)";
      karte.style.transform = "translateX(" + (richtung < 0 ? (1 - anteil) * 100 : -(1 - anteil) * 100) + "%)";
      karte.style.opacity = String(0.4 + anteil * 0.6);
    }, { passive: false });
    function ende(e) {
      if (!aktiv) return; aktiv = false;
      if (!richtung) return;
      var dx = (e.changedTouches ? e.changedTouches[0].clientX : sx) - sx;
      html.classList.remove("ui-zieht");
      if (Math.abs(dx) > breite * 0.33 && ziel) {
        vibrieren(8);
        karte.style.transform = "translateX(0)"; karte.style.opacity = "1";
        if (product) product.style.transform = "translateX(" + (richtung * 40) + "%)";
        setTimeout(function () { location.href = ziel; }, 180);
        return;
      }
      if (product) product.style.transform = "";
      karte.style.transform = ""; karte.style.opacity = "";
      setTimeout(function () { karte.className = "ui-peek"; }, 260);
    }
    document.addEventListener("touchend", ende, { passive: true });
    document.addEventListener("touchcancel", ende, { passive: true });
    window.addEventListener("pageshow", function () { if (product) product.style.transform = ""; karte.className = "ui-peek"; });
  }

  /* 3 · Slideshow bei gedrückter Maus / langem Finger auf der Kachel: alle Fotos des Teils nacheinander,
     ohne die Seite zu öffnen. Loslassen = zurück zum ersten Foto. */
  if (istArchiv) {
    var ssTimer = null, ssLauf = null, ssPlate = null, ssOrig = null, ssAktiv = false;
    function ssEnde() {
      clearTimeout(ssTimer); clearTimeout(ssLauf);
      if (ssPlate) {
        if (ssPlate._ssStop) ssPlate._ssStop();
        var img = ssPlate.querySelector(".plate__frame img");
        if (img && ssOrig) { img.src = ssOrig.src; if (ssOrig.srcset) img.setAttribute("srcset", ssOrig.srcset); else img.removeAttribute("srcset"); }
        ssPlate.classList.remove("ui-slideshow"); var z = ssPlate.querySelector(".ui-slideshow__zaehler"); if (z) z.remove();
      }
      ssPlate = null; ssOrig = null;
    }
    function ssStart(plate) {
      katalog().then(function (k) {
        var it = teilZu(k, slugAus(plate.getAttribute("href")));
        var img = plate.querySelector(".plate__frame img");
        var fotos = it && (it.gallery || []).filter(Boolean);
        if (!it || !img || !fotos || fotos.length < 2) return;
        if (kwGeste && kwGeste.phase) return; // Finger wischt schon (4) - keine Slideshow dazwischen
        kwZurueck(plate);
        kwZahlWeg(kwZahlJetzt); // Slideshow-Zähler ist dann der einzige
        ssAktiv = true; ssPlate = plate; ssOrig = { src: img.src, srcset: img.getAttribute("srcset") };
        plate.classList.add("ui-slideshow"); vibrieren(10);
        var zaehler = document.createElement("span"); zaehler.className = "ui-slideshow__zaehler"; plate.querySelector(".plate__frame").appendChild(zaehler);
        var i = 0, laeuft = true;
        function naechstes() {
          if (!laeuft || ssPlate !== plate) return;
          i = (i + 1) % fotos.length;
          var v = new Image();
          v.onload = function () {
            if (!laeuft || ssPlate !== plate) return;
            img.removeAttribute("srcset"); img.src = v.src; zaehler.textContent = (i + 1) + " / " + fotos.length;
            ssLauf = setTimeout(naechstes, 1000);
          };
          v.onerror = function () { ssLauf = setTimeout(naechstes, 50); };
          v.src = "/" + fotos[i];
        }
        plate._ssStop = function () { laeuft = false; clearTimeout(ssLauf); };
        naechstes();
      });
    }
    grid.addEventListener("pointerover", function (e) {
      if (e.pointerType !== "mouse") return;
      var plate = e.target.closest(".plate"); if (!plate || plate === ssPlate) return;
      clearTimeout(ssTimer); ssAktiv = false;
      ssTimer = setTimeout(function () { ssStart(plate); }, 3000);
    });
    grid.addEventListener("pointerout", function (e) {
      if (e.pointerType !== "mouse") return;
      var plate = e.target.closest(".plate"); if (!plate) return;
      if (e.relatedTarget && plate.contains(e.relatedTarget)) return;
      clearTimeout(ssTimer); ssEnde();
    });
    grid.addEventListener("pointerdown", function (e) {
      var plate = e.target.closest(".plate"); if (!plate || e.button || e.pointerType === "mouse") return;
      ssAktiv = false; clearTimeout(ssTimer);
      ssTimer = setTimeout(function () { ssStart(plate); }, 420);
    });
    ["pointerup", "pointercancel"].forEach(function (ev) { grid.addEventListener(ev, function (e) { if (e.pointerType === "mouse") return; clearTimeout(ssTimer); setTimeout(ssEnde, 120); }); });
    grid.addEventListener("pointermove", function (e) { if (!ssPlate && e.pointerType === "touch") clearTimeout(ssTimer); });
    // Klick nach Slideshow (hier) bzw. nach Wischen (4) schlucken. Auf window in der Capture-Phase:
    // pwa-runtime.js faengt Kachel-Klicks schon auf document ab und navigiert selbst (location.href),
    // ein preventDefault erst am #grid kam zu spaet - Loslassen nach der Slideshow oeffnete das Teil.
    window.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest || !grid.contains(t)) return;
      if ((ssAktiv && e.pointerType === "touch") || (Date.now() - kwZuletzt < 400 && t.closest(".plate__frame"))) {
        e.preventDefault(); e.stopPropagation();
      }
      ssAktiv = false;
    }, true);
    grid.addEventListener("contextmenu", function (e) { if (ssPlate) e.preventDefault(); });
    grid.addEventListener("dragstart", function (e) { if (ssPlate) e.preventDefault(); });

    /* 4 · Fotos wischen auf der Kachel (Inhaber 06.11.2026): Finger nach links/rechts = nächstes/voriges
       Foto des Teils, ohne die Seite zu öffnen. Unten steht kurz „3 / 8“. Nach dem letzten Foto kommt
       wieder das erste (rückwärts genauso). Tippen öffnet das Teil wie bisher, senkrecht scrollt die Seite.
       Am Handy die Vorschaubilder (thumbs/, wie das Titelbild der Kachel), auf breiteren Touch-Geräten
       danach das Original. Maus/PC unverändert (Hover-Foto, Slideshow nach 3 s). */
    var kwStil = document.createElement("style");
    kwStil.textContent =
      "#grid .plate__frame{touch-action:pan-y}" +
      ".kw{position:absolute;inset:0;overflow:hidden;background:inherit;display:none;pointer-events:none}" +
      ".kw.is-an{display:block}" +
      ".kw__bahn{position:absolute;inset:0;will-change:transform;transform:translate3d(0,0,0)}" +
      ".kw__platz{position:absolute;top:0;bottom:0;width:100%}" +
      ".plate__frame .kw__platz img{transform:none!important;transition:none!important;-webkit-user-drag:none;-webkit-user-select:none;user-select:none}" +
      ".kw__zahl{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);background:rgba(0,0,0,.62);color:#fff;" +
      "font:700 11px/1 system-ui,sans-serif;letter-spacing:.04em;padding:5px 9px;border-radius:999px;pointer-events:none;" +
      "opacity:0;transition:opacity .25s;white-space:nowrap}" +
      ".kw__zahl.is-an{opacity:1}";
    document.head.appendChild(kwStil);
    var kwGeste = null, kwZuletzt = 0;
    var kwKlein = window.matchMedia("(max-width: 600px)");
    var kwRuhig = window.matchMedia("(prefers-reduced-motion: reduce)");
    function kwMod(i, n) { return ((i % n) + n) % n; }
    function kwPfad(p) { return "/" + String(p).replace(/^\/+/, ""); }
    function kwVorschau(p) {
      var roh = kwPfad(p), i = roh.lastIndexOf("/");
      return roh.slice(0, i) + "/thumbs/" + roh.slice(i + 1);
    }
    function kwFotos(plate) {
      var s = plate._kw || (plate._kw = { i: 0 });
      if (!s.laden) {
        s.laden = katalog(true).then(function (k) {
          var it = teilZu(k, slugAus(plate.getAttribute("href")));
          s.fotos = it ? (it.gallery || []).filter(Boolean) : [];
          return s.fotos;
        });
      }
      return s.laden;
    }
    function kwVorladen(s, i) {
      var n = s.fotos ? s.fotos.length : 0;
      if (n < 2 || kwMod(i, n) === 0) return;
      var v = new Image(); v.decoding = "async"; v.src = kwVorschau(s.fotos[kwMod(i, n)]);
    }
    function kwBild(img, s, i) {
      img._i = i; img.onerror = null;
      if (i === 0 || !s.fotos || !s.fotos.length) {
        // Erstes Foto = das Kachelbild. Noch nicht geladen (currentSrc leer): am Handy dessen Vorschaubild.
        var o = s.orig;
        img.src = o && o.currentSrc ? o.currentSrc : (kwKlein.matches && s.fotos && s.fotos[0] ? kwVorschau(s.fotos[0]) : (o ? o.src : ""));
        return;
      }
      var gross = kwPfad(s.fotos[i]);
      img.onerror = function () { img.onerror = null; if (img._i === i) img.src = gross; };
      img.src = kwVorschau(s.fotos[i]);
      if (!kwKlein.matches) {
        var v = new Image();
        v.onload = function () { if (img._i === i) { img.onerror = null; img.src = gross; } };
        v.src = gross;
      }
    }
    function kwPlaetze(s) { s.reihe[0].style.left = "-100%"; s.reihe[1].style.left = "0"; s.reihe[2].style.left = "100%"; }
    function kwFuellen(s) {
      var n = s.fotos ? s.fotos.length : 0;
      kwBild(s.reihe[1].firstChild, s, s.i);
      if (n > 1) {
        kwBild(s.reihe[0].firstChild, s, kwMod(s.i - 1, n));
        kwBild(s.reihe[2].firstChild, s, kwMod(s.i + 1, n));
        s.gefuellt = true;
      }
    }
    // Höchstens ein Zähler im ganzen Raster (Inhaber 06.11.2026): Erscheint einer, verschwinden alle
    // anderen sofort. Die Fotos der anderen Kacheln bleiben wie gewischt. kwZahlJetzt = die Kachel,
    // deren Zähler zuletzt dran war - nur sie darf ihn (wieder) zeigen.
    var kwZahlJetzt = null;
    function kwZahlWeg(s) {
      if (!s || !s.zahl) return;
      clearTimeout(s.zahlT);
      s.zahl.style.transition = "none";
      s.zahl.classList.remove("is-an");
      void s.zahl.offsetWidth; // sofort weg, ohne Ausblenden
      s.zahl.style.transition = "";
    }
    function kwZahl(s, halten) {
      var n = s.fotos ? s.fotos.length : 0;
      clearTimeout(s.zahlT);
      if (kwZahlJetzt && kwZahlJetzt !== s) kwZahlWeg(kwZahlJetzt);
      kwZahlJetzt = s;
      if (n < 2) { s.zahl.classList.remove("is-an"); return; }
      s.zahl.textContent = (s.i + 1) + " / " + n;
      s.zahl.classList.add("is-an");
      if (!halten) s.zahlT = setTimeout(function () { s.zahl.classList.remove("is-an"); }, 1500);
    }
    // Overlay direkt hinter <picture> (ohne z-index): Verkauft-Balken o. Ä. bleiben darüber.
    function kwAn(plate, frame, still) {
      var s = plate._kw || (plate._kw = { i: 0 });
      if (!s.el || !frame.contains(s.el)) {
        s.orig = frame.querySelector("img");
        s.el = document.createElement("div"); s.el.className = "kw"; s.el.setAttribute("aria-hidden", "true");
        s.bahn = document.createElement("div"); s.bahn.className = "kw__bahn"; s.el.appendChild(s.bahn);
        s.reihe = [0, 1, 2].map(function () {
          var platz = document.createElement("div"); platz.className = "kw__platz";
          var im = document.createElement("img"); im.alt = ""; im.decoding = "async"; im.draggable = false;
          platz.appendChild(im); s.bahn.appendChild(platz); return platz;
        });
        s.zahl = document.createElement("span"); s.zahl.className = "kw__zahl"; s.zahl.setAttribute("aria-hidden", "true");
        var bild = frame.querySelector("picture") || s.orig;
        if (bild && bild.parentNode === frame) frame.insertBefore(s.el, bild.nextSibling); else frame.insertBefore(s.el, frame.firstChild);
        frame.insertBefore(s.zahl, s.el.nextSibling);
        s.gefuellt = false;
        kwPlaetze(s);
        kwFuellen(s);
      } else if (!s.gefuellt) {
        kwFuellen(s);
      }
      s.w = frame.clientWidth || 1;
      s.bahn.style.transition = "none";
      s.el.classList.add("is-an");
      if (!still) kwZahl(s, true);
      return s;
    }
    // Beim Nachladen (alle 12 Teile) baut app.js die ganze Liste neu auf. Damit eine gewischte Kachel
    // dabei nicht auf Foto 1 zurückspringt, merkt sich kwMerk das Foto je Teil und setzt es wieder.
    var kwMerk = {}, kwMerkAnzahl = 0;
    function kwMerken(plate) {
      var href = plate.getAttribute("href"), s = plate._kw;
      if (!href || !s) return;
      var war = Boolean(kwMerk[href]);
      if (s.i && s.fotos) { kwMerk[href] = { i: s.i, fotos: s.fotos }; if (!war) kwMerkAnzahl++; }
      else if (war) { delete kwMerk[href]; kwMerkAnzahl--; }
    }
    if (window.MutationObserver) {
      new MutationObserver(function () {
        if (!kwMerkAnzahl) return;
        Array.prototype.forEach.call(grid.querySelectorAll(".plate"), function (plate) {
          var m = kwMerk[plate.getAttribute("href")], frame = plate.querySelector(".plate__frame");
          if (!m || plate._kw || !frame) return;
          plate._kw = { i: m.i, fotos: m.fotos, laden: Promise.resolve(m.fotos) };
          kwAn(plate, frame, true);
        });
      }).observe(grid, { childList: true });
    }
    function kwFertig(plate) {
      var s = plate._kw;
      if (!s || !s.lauf) return;
      clearTimeout(s.ende);
      var r = s.lauf.richtung; s.lauf = null;
      s.bahn.style.transition = "none";
      if (r && s.fotos && s.fotos.length > 1) {
        var n = s.fotos.length;
        s.i = kwMod(s.i + r, n);
        // Plätze weiterreichen statt Bilder neu setzen: das sichtbare Foto bleibt dasselbe Element (kein Flackern).
        if (r > 0) { s.reihe = [s.reihe[1], s.reihe[2], s.reihe[0]]; kwBild(s.reihe[2].firstChild, s, kwMod(s.i + 1, n)); }
        else { s.reihe = [s.reihe[2], s.reihe[0], s.reihe[1]]; kwBild(s.reihe[0].firstChild, s, kwMod(s.i - 1, n)); }
        kwPlaetze(s);
        kwVorladen(s, s.i + 2 * r);
      }
      s.bahn.style.transform = "translate3d(0,0,0)";
      // Wird inzwischen auf einer anderen Kachel gewischt, bleibt deren Zähler der einzige.
      if (kwZahlJetzt === s) kwZahl(s, false);
      // Erstes Foto: wieder das echte Kachelbild zeigen (Hover/Slideshow arbeiten darauf).
      if (s.i === 0) s.el.classList.remove("is-an");
      kwMerken(plate);
    }
    function kwLoslassen(g, abbruch) {
      var s = g.plate._kw, n = s.fotos ? s.fotos.length : 0, dx = g.dx, r = 0;
      if (!abbruch && n > 1) {
        var schnell = Math.abs(g.vx) > 0.3 && (g.vx < 0) === (dx < 0) && Math.abs(dx) > 14;
        if (Math.abs(dx) > s.w * 0.2 || schnell) r = dx < 0 ? 1 : -1;
      }
      var ziel = -r * s.w;
      var dauer = kwRuhig.matches ? 1 : Math.round(Math.max(150, Math.min(280, Math.abs(ziel - dx) * 0.9)));
      s.lauf = { richtung: r };
      s.bahn.style.transition = "transform " + dauer + "ms cubic-bezier(.2,.75,.25,1)";
      s.bahn.style.transform = "translate3d(" + ziel + "px,0,0)";
      clearTimeout(s.ende);
      s.ende = setTimeout(function () { kwFertig(g.plate); }, dauer + 20);
    }
    function kwZurueck(plate) {
      var s = plate._kw;
      if (!s || !s.el) return;
      if (s.lauf) kwFertig(plate);
      if (s.i !== 0) { s.i = 0; s.gefuellt = false; }
      s.el.classList.remove("is-an"); s.zahl.classList.remove("is-an");
      kwMerken(plate);
    }
    grid.addEventListener("pointerdown", function (e) {
      kwGeste = null;
      if (e.pointerType === "mouse" || !e.isPrimary || e.button) return;
      var frame = e.target.closest(".plate__frame"), plate = frame && frame.closest(".plate");
      if (!plate || ssPlate) return;
      if (plate._kw && plate._kw.lauf) kwFertig(plate);
      kwGeste = { plate: plate, frame: frame, id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, phase: 0, lx: e.clientX, lt: e.timeStamp, vx: 0 };
      kwFotos(plate).then(function (f) {
        var s = plate._kw;
        if (f.length < 2) return;
        kwVorladen(s, s.i + 1); kwVorladen(s, s.i - 1);
        if (s.el && s.el.classList.contains("is-an") && !s.gefuellt) {
          kwFuellen(s);
          if (kwGeste && kwGeste.plate === plate && kwGeste.phase) kwZahl(s, true);
        }
      });
    }, { passive: true });
    grid.addEventListener("pointermove", function (e) {
      var g = kwGeste;
      if (!g || e.pointerId !== g.id) return;
      var dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.phase) {
        if (ssPlate) { kwGeste = null; return; }
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { kwGeste = null; return; }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        var bekannt = g.plate._kw && g.plate._kw.fotos;
        if (bekannt && bekannt.length < 2) { kwGeste = null; return; }
        g.phase = 1; clearTimeout(ssTimer);
        try { g.frame.setPointerCapture(g.id); } catch (x) {}
        kwAn(g.plate, g.frame);
      }
      var dt = e.timeStamp - g.lt;
      if (dt > 0) { g.vx = 0.7 * ((e.clientX - g.lx) / dt) + 0.3 * g.vx; g.lx = e.clientX; g.lt = e.timeStamp; }
      g.dx = dx;
      var s = g.plate._kw, n = s.fotos ? s.fotos.length : 0;
      // Fotos noch unbekannt oder nur eins: gebremst ziehen, beim Loslassen zurück.
      s.bahn.style.transform = "translate3d(" + (n > 1 ? dx : dx * 0.25) + "px,0,0)";
    }, { passive: true });
    function kwEnde(e) {
      var g = kwGeste;
      if (!g || e.pointerId !== g.id) return;
      kwGeste = null;
      if (!g.phase) return;
      kwZuletzt = Date.now();
      // Kurz vor dem Loslassen stillgehalten: kein Schwung mehr.
      if (e.timeStamp - g.lt > 90) g.vx = 0;
      kwLoslassen(g, e.type === "pointercancel");
    }
    grid.addEventListener("pointerup", kwEnde);
    grid.addEventListener("pointercancel", kwEnde);
    // Den Klick direkt nach einem Wischen schluckt der window-Klickfänger in Abschnitt 3 (kwZuletzt).
    grid.addEventListener("dragstart", function (e) { if (kwGeste && kwGeste.phase) e.preventDefault(); });
  }

  /* 6 · „Zum Home-Bildschirm“: nur iPhone/iPad, nicht in der installierten App, ab dem zweiten Besuch,
     höchstens zweimal, nach Wegtippen 30 Tage Ruhe. (Vorschau: ?homescreen erzwingt die Anzeige.) */
  if (istArchiv && istIphone && !(navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches)) {
    var besuche = (speicher("ui_besuche") || 0) + 1; speicher("ui_besuche", besuche);
    var stand = speicher("ui_home") || { gezeigt: 0, weg: 0 };
    var erzwingen = location.search.indexOf("homescreen") >= 0;
    if (erzwingen || (besuche >= 2 && stand.gezeigt < 2 && Date.now() - stand.weg > 30 * 864e5)) {
      setTimeout(function () {
        var el = document.createElement("div"); el.className = "ui-home";
        el.innerHTML = '<div class="ui-home__icon"></div><div><strong>Disorder119 auf dem Home-Bildschirm</strong><small>Unten <kbd>Teilen</kbd> tippen → <kbd>Zum Home-Bildschirm</kbd>. Öffnet dann wie eine App, ohne Browserleiste.</small></div><button type="button" class="ui-home__zu" aria-label="Schließen">✕</button>';
        el.querySelector(".ui-home__zu").addEventListener("click", function () { el.classList.remove("is-sichtbar"); speicher("ui_home", { gezeigt: stand.gezeigt + 1, weg: Date.now() }); });
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.classList.add("is-sichtbar"); });
        if (!erzwingen) speicher("ui_home", { gezeigt: stand.gezeigt + 1, weg: stand.weg });
        setTimeout(function () { el.classList.remove("is-sichtbar"); }, 12000);
      }, erzwingen ? 600 : 6000);
    }
  }

  /* 8 · „Zuletzt angesehen“ (Browser-Speicher) im Archiv und auf jeder Produktseite. */
  function zuletztListe() { return speicher("ui_zuletzt") || []; }
  function zuletztRendern(ziel, vorElement, ohneSlug) {
    var liste = zuletztListe().filter(function (s) { return s !== ohneSlug; });
    if (!liste.length) return;
    katalog().then(function (k) {
      var teile = liste.map(function (s) { return teilZu(k, s); }).filter(Boolean).slice(0, 8);
      if (!teile.length) return;
      var box = document.createElement("section"); box.className = "ui-zuletzt";
      box.innerHTML = '<p class="ui-zuletzt__titel">Zuletzt angesehen</p><div class="ui-zuletzt__liste"></div>';
      var l = box.querySelector(".ui-zuletzt__liste");
      teile.forEach(function (it) {
        var a = document.createElement("a"); a.href = "/artikel/" + (it.url_slug || it.id) + "/";
        var preis = it.price > 0 ? Number(it.price).toLocaleString("de-DE") + " €" : "SOLD";
        var titel = String(it.title || ""), marke = String(it.brand || "");
        var name = titel.toLowerCase().indexOf(marke.toLowerCase()) === 0 ? titel.slice(marke.length).trim() : titel;
        name = name.replace(/\s+(Damen|Herren|Unisex)\b[\s\S]*$/i, "").trim() || (it.product_type || "");
        a.innerHTML = '<img src="' + gridBild(it) + '" alt="" loading="lazy"><b>' + (it.brand || "") + "</b><span>" + name + "</span><em>" + preis + "</em>";
        l.appendChild(a);
      });
      ziel.insertBefore(box, vorElement || null);
    });
  }
  if (istArtikel) {
    var slug = slugAus(location.pathname);
    var alt = zuletztListe().filter(function (s) { return s !== slug; }); alt.unshift(slug); speicher("ui_zuletzt", alt.slice(0, 12));
    var related = document.querySelector(".related");
    zuletztRendern(related ? related.parentNode : document.querySelector(".product").parentNode, related || document.querySelector(".page-foot"), slug);
  }
  /* 8b · Archiv: die zuletzt angesehenen Teile schweben um den DISORDER119-Schriftzug (wie im Universum):
     freigestellte Fotos poppen nacheinander auf, driften leicht, die aeltesten weichen. Ohne Verlauf: die neuesten Teile. */
  if (istArchiv) {
    var masthead = document.querySelector(".masthead");
    if (masthead) {
      katalog().then(function (k) {
        // Erst ab drei angesehenen Teilen, nur aus dem eigenen Verlauf.
        var teile = zuletztListe().map(function (s) { return teilZu(k, s); }).filter(Boolean).slice(0, 10);
        var neu = false;
        if (teile.length < 3) return;
        var orbit = document.createElement("div"); orbit.className = "ui-orbit"; orbit.setAttribute("aria-hidden", "true");
        var label = document.createElement("span"); label.className = "ui-orbit__label"; label.textContent = neu ? "Neu im Archiv" : "Zuletzt angesehen";
        orbit.appendChild(label);
        masthead.classList.add("ui-orbit-host"); masthead.appendChild(orbit);
        var schmal = window.innerWidth < 760, maxSichtbar = schmal ? 2 : 4, lebend = [], idx = 0;
        // Plaetze neben dem Schriftzug, nie dahinter (Inhaber 04.11.): auf dem Handy klein in den
        // beiden oberen Ecken ueber der Zeile "Das kuratierte Archiv von", am Rechner links/rechts
        // am Rand in der oberen Haelfte (unten stehen Suche und Zahlen).
        var plaetze = schmal
          ? ["left:8px;top:0", "right:8px;top:0"]
          : ["left:3%;top:8%", "right:3%;top:8%", "left:5%;top:44%", "right:5%;top:44%"];
        function zufall(a, b) { return a + Math.random() * (b - a); }
        function auftauchen() {
          var it = teile[idx % teile.length]; idx++;
          var platz = plaetze[(idx - 1) % plaetze.length];
          if (lebend.length >= maxSichtbar) platz = plaetze[(idx - 1 - maxSichtbar) % plaetze.length];
          var a = document.createElement("a"); a.className = "ui-orbit__teil"; a.href = "/artikel/" + (it.url_slug || it.id) + "/";
          a.title = (it.brand || "") + (it.title ? " – " + it.title : "");
          var groesse = schmal ? 54 : 100;
          a.style.cssText = platz + ";width:" + groesse + "px;--rot:" + zufall(-4, 4).toFixed(1) + "deg;--dx:" + zufall(-8, 8).toFixed(0) + "px;--dy:" + zufall(-10, -4).toFixed(0) + "px;--dauer:" + zufall(12, 18).toFixed(1) + "s";
          a.innerHTML = '<img src="' + gridBild(it) + '" alt="" loading="lazy" decoding="async">';
          orbit.appendChild(a);
          requestAnimationFrame(function () { a.classList.add("is-da"); });
          lebend.push(a);
          if (lebend.length > maxSichtbar) {
            var alt = lebend.shift();
            alt.classList.add("is-weg");
            setTimeout(function () { alt.remove(); }, 1100);
          }
        }
        auftauchen();
        var takt = setInterval(function () { if (!document.hidden) auftauchen(); }, 4000);
        window.addEventListener("pagehide", function () { clearInterval(takt); });
      });
    }
  }

  /* 9 · Teilen (Inhaber 06.11.2026): Antippen öffnet erst eine kleine Auswahl, danach das Teilen-Menü des
     Handys. Foto mit Infos (Archiv-Karte 4:5 + Steckbrief, vorausgewählt), Instagram-Story (9:16), Video aus
     allen Fotos (entsteht auf dem Handy), Link kopieren. Die Bilder entstehen per Canvas für jeden Artikel,
     Hintergrund nach Ansicht: hell = weiß, dunkel = schwarz mit leichtem Lichtschein (dunkle Teile bleiben
     sichtbar). Text als Steckbrief ohne Emojis in der Sprache des Landes, in dem man gerade ist (/_land).
     Geteilte Links tragen utm_source=teilen - so zeigt der Shop, wer über einen geteilten Link kam.
     Am Rechner ohne Teilen-Menü: Bild wird gespeichert, Text und Link kommen in die Zwischenablage. */
  if (istArtikel) {
    var info = document.querySelector(".info"), h1 = info && info.querySelector("h1");
    if (h1) {
      var it = window.ARTICLE_ITEM || {};
      var verkauft = it.sold === true || !(Number(it.price) > 0);
      var slug = String(it.url_slug || it.id || "artikel");
      var teilenLink = location.origin + location.pathname + "?utm_source=teilen";
      var seitenSprache = (html.lang || "de").slice(0, 2);
      var kannTeilen = Boolean(navigator.share);
      var TXT = {
        de: { l: "de-DE", gr: "Größe", zu: "Zustand", ein: "Einzelstück – nur 1× verfügbar", kurz: "Einzelstück", sehen: "Hier ansehen:", weg: "Schon verkauft", mehr: "Mehr Einzelstücke im Archiv", archiv: "Archiv ansehen:", ca: "ca.", vk: "VERKAUFT",
          z: { "Sehr gut": "sehr gut", "Gut": "gut", "Zufriedenstellend": "zufriedenstellend", "Repariert": "repariert", "Mit Defekt": "mit Defekt" } },
        en: { l: "en-GB", gr: "Size", zu: "Condition", ein: "One of a kind – only 1 available", kurz: "One of a kind", sehen: "Take a look:", weg: "Already sold", mehr: "More one-of-a-kind pieces in the archive", archiv: "See the archive:", ca: "approx.", vk: "SOLD",
          z: { "Sehr gut": "very good", "Gut": "good", "Zufriedenstellend": "fair", "Repariert": "repaired", "Mit Defekt": "with defect" } },
        fr: { l: "fr-FR", gr: "Taille", zu: "État", ein: "Pièce unique – un seul exemplaire", kurz: "Pièce unique", sehen: "À découvrir ici :", weg: "Déjà vendu", mehr: "D'autres pièces uniques dans l'archive", archiv: "Voir l'archive :", ca: "env.", vk: "VENDU",
          z: { "Sehr gut": "très bon", "Gut": "bon", "Zufriedenstellend": "satisfaisant", "Repariert": "réparé", "Mit Defekt": "avec défaut" } },
        it: { l: "it-IT", gr: "Taglia", zu: "Condizioni", ein: "Pezzo unico – solo 1 disponibile", kurz: "Pezzo unico", sehen: "Guardalo qui:", weg: "Già venduto", mehr: "Altri pezzi unici nell'archivio", archiv: "Vedi l'archivio:", ca: "ca.", vk: "VENDUTO",
          z: { "Sehr gut": "ottime", "Gut": "buone", "Zufriedenstellend": "discrete", "Repariert": "riparato", "Mit Defekt": "con difetto" } },
        es: { l: "es-ES", gr: "Talla", zu: "Estado", ein: "Pieza única – solo 1 disponible", kurz: "Pieza única", sehen: "Míralo aquí:", weg: "Ya vendido", mehr: "Más piezas únicas en el archivo", archiv: "Ver el archivo:", ca: "aprox.", vk: "VENDIDO",
          z: { "Sehr gut": "muy bueno", "Gut": "bueno", "Zufriedenstellend": "aceptable", "Repariert": "reparado", "Mit Defekt": "con defecto" } },
        nl: { l: "nl-NL", gr: "Maat", zu: "Staat", ein: "Uniek stuk – maar 1 beschikbaar", kurz: "Uniek stuk", sehen: "Bekijk het hier:", weg: "Al verkocht", mehr: "Meer unieke stukken in het archief", archiv: "Bekijk het archief:", ca: "ca.", vk: "VERKOCHT",
          z: { "Sehr gut": "zeer goed", "Gut": "goed", "Zufriedenstellend": "redelijk", "Repariert": "gerepareerd", "Mit Defekt": "met defect" } },
        pl: { l: "pl-PL", gr: "Rozmiar", zu: "Stan", ein: "Unikat – tylko 1 sztuka", kurz: "Unikat", sehen: "Zobacz tutaj:", weg: "Już sprzedane", mehr: "Więcej unikatów w archiwum", archiv: "Zobacz archiwum:", ca: "ok.", vk: "SPRZEDANE",
          z: { "Sehr gut": "bardzo dobry", "Gut": "dobry", "Zufriedenstellend": "zadowalający", "Repariert": "naprawiony", "Mit Defekt": "z wadą" } },
        pt: { l: "pt-BR", gr: "Tamanho", zu: "Estado", ein: "Peça única – só 1 disponível", kurz: "Peça única", sehen: "Veja aqui:", weg: "Já vendida", mehr: "Mais peças únicas no arquivo", archiv: "Ver o arquivo:", ca: "aprox.", vk: "VENDIDA",
          z: { "Sehr gut": "muito bom", "Gut": "bom", "Zufriedenstellend": "satisfatório", "Repariert": "reparado", "Mit Defekt": "com defeito" } }
      };
      var LAND_SPRACHE = { DE: "de", AT: "de", CH: "de", LI: "de", LU: "de", FR: "fr", BE: "fr", MC: "fr", IT: "it", SM: "it", VA: "it",
        ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es", UY: "es", PY: "es", BO: "es", CR: "es",
        PA: "es", DO: "es", GT: "es", HN: "es", SV: "es", NI: "es", NL: "nl", PL: "pl", PT: "pt", BR: "pt" };
      // Menü in der Sprache der Seite (de/en/fr).
      var UI = ({
        de: { titel: "Wie möchtest du teilen?", foto: ["Foto mit Infos", "Bild + Steckbrief · WhatsApp, Instagram, Nachrichten"], story: ["Instagram-Story", "Hochformat mit Logo, Marke und Preis"],
          video: ["Video – alle Fotos", "Läuft durch alle Bilder · WhatsApp, Story, Reel"], link: ["Link kopieren", "Zum Einfügen, wo du willst"], zu: "Abbrechen",
          macht: "Video wird erstellt …", fertig: "Video teilen", kopiert: "Link kopiert", gespeichert: "Bild gespeichert – Text und Link sind in der Zwischenablage", fehler: "Das hat nicht geklappt. Bitte noch einmal." },
        en: { titel: "How do you want to share?", foto: ["Photo with details", "Image + key facts · WhatsApp, Instagram, messages"], story: ["Instagram Story", "Portrait format with logo, brand and price"],
          video: ["Video – all photos", "Runs through every photo · WhatsApp, Story, Reel"], link: ["Copy link", "Paste it wherever you like"], zu: "Cancel",
          macht: "Creating video …", fertig: "Share video", kopiert: "Link copied", gespeichert: "Image saved – text and link are on your clipboard", fehler: "That didn't work. Please try again." },
        fr: { titel: "Comment veux-tu partager ?", foto: ["Photo avec infos", "Image + fiche · WhatsApp, Instagram, messages"], story: ["Story Instagram", "Format portrait avec logo, marque et prix"],
          video: ["Vidéo – toutes les photos", "Fait défiler toutes les photos · WhatsApp, Story, Reel"], link: ["Copier le lien", "À coller où tu veux"], zu: "Annuler",
          macht: "Création de la vidéo …", fertig: "Partager la vidéo", kopiert: "Lien copié", gespeichert: "Image enregistrée – texte et lien copiés", fehler: "Ça n'a pas marché. Réessaie." }
      })[seitenSprache] || null;
      if (!UI) UI = { titel: "Wie möchtest du teilen?" };

      // ---- Land und Sprache
      var landLaeuft = null;
      function mitFrist(p, ms, ersatz) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(ersatz); }, ms); })]); }
      function landHolen() {
        if (!landLaeuft) landLaeuft = fetch("/_land", { cache: "no-store", credentials: "omit" })
          .then(function (r) { return r.ok ? r.json() : {}; })
          .then(function (d) { return /^[A-Z]{2}$/.test(String(d && d.land || "")) ? d.land : ""; })
          .catch(function () { return ""; });
        return landLaeuft;
      }
      function spracheFuer(land) { return LAND_SPRACHE[land] || (land ? "en" : (TXT[seitenSprache] ? seitenSprache : "de")); }

      // ---- Text (Steckbrief)
      var marke = String(it.brand || "").trim();
      function ohneMarke(t) {
        t = String(t || "").trim();
        return marke && t.toLowerCase().indexOf(marke.toLowerCase()) === 0 ? t.slice(marke.length).trim() : t;
      }
      function nameFuer(sprache) {
        var titel = sprache === "de" && seitenSprache === "de" ? it.title : (it.title_en || it.title);
        return ohneMarke(titel || (h1.textContent || ""));
      }
      function preisFuer(sprache) {
        var p = Number(it.price), s = TXT[sprache], text;
        try { text = p.toLocaleString(s.l, { style: "currency", currency: "EUR", minimumFractionDigits: p % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
        catch (e) { text = p + " €"; }
        return (it.priceEstimated ? s.ca + " " : "") + text;
      }
      function steckbrief(sprache) {
        var s = TXT[sprache], name = nameFuer(sprache), z = [];
        z.push(marke ? marke.toUpperCase() : name);
        if (marke && name) z.push(name);
        z.push("");
        if (verkauft) { z.push("• " + s.weg, "• " + s.mehr, "", s.archiv); return z.join("\n"); }
        if (it.size) z.push("• " + s.gr + " " + it.size);
        if (s.z[it.condition]) z.push("• " + s.zu + (sprache === "fr" ? " : " : ": ") + s.z[it.condition]);
        z.push("• " + preisFuer(sprache), "• " + s.ein, "", s.sehen);
        return z.join("\n");
      }

      // ---- Bilder per Canvas
      function bildLaden(src) {
        return new Promise(function (ok, fehler) { var im = new Image(); im.decoding = "async"; im.onload = function () { ok(im); }; im.onerror = fehler; im.src = src; });
      }
      function variante(pfad, ordner) {
        var g = String(pfad || "").replace(/^\/+/, ""), i = g.lastIndexOf("/");
        return "/" + (ordner && i >= 0 ? g.slice(0, i) + "/" + ordner + "/" + g.slice(i + 1) : g);
      }
      var fotos = (it.gallery || []).filter(Boolean);
      var hauptLaeuft = null;
      function hauptbild() {
        if (!hauptLaeuft) {
          hauptLaeuft = bildLaden(variante(fotos[0])).catch(function () { return bildLaden(variante(fotos[0], "display")); });
          hauptLaeuft.catch(function () { hauptLaeuft = null; });
        }
        return hauptLaeuft;
      }
      function istDunkel() { return html.getAttribute("data-theme") !== "hell"; }
      var SCHRIFT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
      function gesperrt(z, text, x, y, abstand, ausrichtung) {
        // Buchstabenabstand ohne ctx.letterSpacing (aeltere Safari).
        var breite = 0, i;
        for (i = 0; i < text.length; i++) breite += z.measureText(text[i]).width + (i < text.length - 1 ? abstand : 0);
        var start = ausrichtung === "mitte" ? x - breite / 2 : ausrichtung === "rechts" ? x - breite : x;
        z.textAlign = "left";
        for (i = 0; i < text.length; i++) { z.fillText(text[i], start, y); start += z.measureText(text[i]).width + abstand; }
        return breite;
      }
      function passend(z, text, gewicht, groesse, minimal, maxBreite) {
        // Schrift verkleinern, bis der Text passt; sonst mit … kuerzen.
        var g = groesse;
        z.font = gewicht + " " + g + "px " + SCHRIFT;
        while (z.measureText(text).width > maxBreite && g > minimal) { g -= 2; z.font = gewicht + " " + g + "px " + SCHRIFT; }
        if (z.measureText(text).width <= maxBreite) return text;
        while (text.length > 3 && z.measureText(text + "…").width > maxBreite) text = text.slice(0, -1);
        return text.trim() + "…";
      }
      function enthalten(z, im, x, y, b, h) {
        var f = Math.min(b / im.naturalWidth, h / im.naturalHeight), w = im.naturalWidth * f, hh = im.naturalHeight * f;
        z.drawImage(im, x + (b - w) / 2, y + (h - hh) / 2, w, hh);
      }
      function lichtschein(z, x, y, b, h) {
        var g = z.createRadialGradient(x + b / 2, y + h * 0.45, 10, x + b / 2, y + h * 0.45, Math.max(b, h) * 0.62);
        g.addColorStop(0, "#2e2e2e"); g.addColorStop(1, "#0b0b0b");
        z.fillStyle = g; z.fillRect(x, y, b, h);
      }
      function datei(canvas, name, typ) {
        return new Promise(function (ok, fehler) {
          canvas.toBlob(function (b) { if (b) ok(new File([b], name, { type: typ })); else fehler(new Error("kein Bild")); }, typ, 0.92);
        });
      }
      function untertitel(sprache) {
        var s = TXT[sprache], teile = [nameFuer(sprache)];
        if (it.size) teile.push(s.gr + " " + it.size);
        return teile.filter(Boolean).join(" · ");
      }
      // Archiv-Karte 1080x1350: Logo oben links, Teil, Band mit Marke, Name/Größe und Preis.
      function karteZeichnen(z, im, sprache, dunkel) {
        var s = TXT[sprache], B = 1080, H = 1350, band = 250;
        if (dunkel) lichtschein(z, 0, 0, B, H - band); else { z.fillStyle = "#ffffff"; z.fillRect(0, 0, B, H - band); }
        z.fillStyle = dunkel ? "#f2efe7" : "#111111";
        z.font = "800 30px " + SCHRIFT; z.textBaseline = "alphabetic";
        gesperrt(z, "DISORDER119", 64, 82, 3);
        if (im) enthalten(z, im, 90, 120, B - 180, H - band - 160);
        z.fillStyle = dunkel ? "#f2efe7" : "#111111"; z.fillRect(0, H - band, B, band);
        var schrift = dunkel ? "#111111" : "#ffffff";
        var preis = verkauft ? s.vk : preisFuer(sprache);
        z.fillStyle = schrift; z.font = "800 70px " + SCHRIFT;
        var preisBreite = z.measureText(preis).width;
        z.textAlign = "right"; z.fillText(preis, B - 64, H - band / 2 + 24); z.textAlign = "left";
        var frei = B - 64 - preisBreite - 60 - 64;
        z.font = "800 50px " + SCHRIFT;
        var markeText = passend(z, (marke || nameFuer(sprache)).toUpperCase(), "800", 50, 32, frei);
        gesperrt(z, markeText, 64, H - band / 2 - 6, 3);
        var unter = passend(z, untertitel(sprache), "400", 31, 22, frei);
        z.globalAlpha = 0.72; z.fillText(unter, 64, H - band / 2 + 46); z.globalAlpha = 1;
      }
      // Story 1080x1920: Logo, Karte mit Teil, Marke, Name/Größe, Preis, Einzelstück.
      function storyZeichnen(z, im, sprache, dunkel, deckkraft, nurFoto) {
        var s = TXT[sprache], B = 1080, H = 1920;
        if (!nurFoto) { z.fillStyle = dunkel ? "#0b0b0b" : "#ffffff"; z.fillRect(0, 0, B, H); }
        z.fillStyle = dunkel ? "#f2efe7" : "#111111";
        if (!nurFoto) { z.font = "800 46px " + SCHRIFT; gesperrt(z, "DISORDER119", B / 2, 150, 5, "mitte"); }
        var kx = 86, ky = 220, kb = B - 172, kh = 1110, r = 40;
        z.save(); z.beginPath();
        z.moveTo(kx + r, ky); z.arcTo(kx + kb, ky, kx + kb, ky + kh, r); z.arcTo(kx + kb, ky + kh, kx, ky + kh, r); z.arcTo(kx, ky + kh, kx, ky, r); z.arcTo(kx, ky, kx + kb, ky, r); z.closePath(); z.clip();
        if (!nurFoto) { if (dunkel) lichtschein(z, kx, ky, kb, kh); else { z.fillStyle = "#f3f2ef"; z.fillRect(kx, ky, kb, kh); } }
        if (im) { z.globalAlpha = deckkraft == null ? 1 : deckkraft; enthalten(z, im, kx + 50, ky + 50, kb - 100, kh - 100); z.globalAlpha = 1; }
        z.restore();
        if (nurFoto) return;
        z.fillStyle = dunkel ? "#f2efe7" : "#111111";
        z.font = "800 64px " + SCHRIFT;
        gesperrt(z, passend(z, (marke || nameFuer(sprache)).toUpperCase(), "800", 64, 40, kb), kx, 1450, 4);
        z.globalAlpha = 0.78; z.fillText(passend(z, untertitel(sprache), "400", 40, 28, kb), kx, 1515); z.globalAlpha = 1;
        z.font = "800 96px " + SCHRIFT; z.fillText(verkauft ? s.vk : preisFuer(sprache), kx, 1640);
        z.globalAlpha = 0.6; z.font = "400 34px " + SCHRIFT; z.fillText(s.kurz + " · disorder119.com", kx, 1730); z.globalAlpha = 1;
      }
      function karteDatei(sprache) {
        return hauptbild().catch(function () { return null; }).then(function (im) {
          var c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
          karteZeichnen(c.getContext("2d"), im, sprache, istDunkel());
          return datei(c, "disorder119-" + slug + ".jpg", "image/jpeg");
        });
      }
      function storyDatei(sprache) {
        return hauptbild().catch(function () { return null; }).then(function (im) {
          var c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
          storyZeichnen(c.getContext("2d"), im, sprache, istDunkel());
          return datei(c, "disorder119-" + slug + "-story.jpg", "image/jpeg");
        });
      }

      // ---- Video: Story-Format, läuft durch alle Fotos (MediaRecorder, nur wo MP4 geht).
      var VIDEO_TYP = (function () {
        try {
          if (!window.MediaRecorder || !MediaRecorder.isTypeSupported || !HTMLCanvasElement.prototype.captureStream) return "";
          var t = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"];
          for (var i = 0; i < t.length; i++) if (MediaRecorder.isTypeSupported(t[i])) return t[i];
        } catch (e) {}
        return "";
      })();
      function videoErstellen(sprache, fortschritt) {
        var liste = fotos.slice(0, 6);
        var geladen = 0;
        return Promise.all(liste.map(function (p, i) {
          var laden = i === 0 ? hauptbild() : bildLaden(variante(p));
          return laden.then(function (im) { geladen++; fortschritt(geladen / (liste.length + 2)); return im; }, function () { return null; });
        })).then(function (bilder) {
          bilder = bilder.filter(Boolean);
          if (!bilder.length) throw new Error("ohne Bilder");
          var c = document.createElement("canvas"); c.width = 720; c.height = 1280;
          var z = c.getContext("2d"); z.scale(720 / 1080, 1280 / 1920);
          var dunkel = istDunkel(), STANDZEIT = 1300, BLENDE = 300, dauer = bilder.length * STANDZEIT + 200;
          var strom = c.captureStream(30), stuecke = [];
          var rec = new MediaRecorder(strom, { mimeType: VIDEO_TYP, videoBitsPerSecond: 3000000 });
          rec.ondataavailable = function (e) { if (e.data && e.data.size) stuecke.push(e.data); };
          return new Promise(function (ok, fehler) {
            rec.onerror = function (e) { fehler(e.error || new Error("Aufnahme")); };
            rec.onstop = function () {
              strom.getTracks().forEach(function (t) { t.stop(); });
              if (!stuecke.length) { fehler(new Error("leer")); return; }
              ok(new File([new Blob(stuecke, { type: "video/mp4" })], "disorder119-" + slug + ".mp4", { type: "video/mp4" }));
            };
            var beginn = 0;
            function bild(zeit) {
              if (!beginn) beginn = zeit;
              var t = zeit - beginn, n = Math.min(bilder.length - 1, Math.floor(t / STANDZEIT)), rest = t - n * STANDZEIT;
              storyZeichnen(z, bilder[n], sprache, dunkel, 1);
              if (n + 1 < bilder.length && rest > STANDZEIT - BLENDE) {
                // Weiche Überblendung zum nächsten Foto (nur im Kartenbereich).
                storyZeichnen(z, bilder[n + 1], sprache, dunkel, (rest - (STANDZEIT - BLENDE)) / BLENDE, true);
              }
              fortschritt((liste.length + Math.min(1, t / dauer)) / (liste.length + 2));
              if (t < dauer) requestAnimationFrame(bild); else rec.stop();
            }
            rec.start(250);
            requestAnimationFrame(bild);
          });
        });
      }

      // ---- Teilen selbst
      function linkKopieren(text) {
        var wert = text || teilenLink;
        return (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(wert) : Promise.reject(new Error("ohne Zwischenablage")));
      }
      function speichern(f) {
        var a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      }
      function teilenMit(f, sprache) {
        var text = steckbrief(sprache);
        var daten = { title: (marke ? marke + " – " : "") + nameFuer(sprache), text: text, url: teilenLink };
        if (kannTeilen && grob) {
          var mit = f ? Object.assign({ files: [f] }, daten) : daten;
          return (f && navigator.canShare && navigator.canShare(mit)) ? navigator.share(mit) : navigator.share(daten);
        }
        // Rechner: Bild speichern, Text + Link in die Zwischenablage.
        if (f) speichern(f);
        return linkKopieren(text + "\n" + teilenLink).then(function () { toast(UI.gespeichert); });
      }

      // ---- Auswahlmenü
      var menue = null, karteBereit = null, storyBereit = null, videoBereit = null, videoFertig = false, menueSprache = "de";
      function vorbereiten() {
        landHolen().then(function (land) {
          menueSprache = spracheFuer(land);
          if (!karteBereit) { karteBereit = karteDatei(menueSprache); karteBereit.catch(function () { karteBereit = null; }); }
        });
        hauptbild().catch(function () {});
      }
      function status(text) {
        var s = menue.querySelector(".ui-teil__status");
        s.hidden = !text; s.textContent = text || "";
      }
      function menueZu() { if (menue) menue.classList.remove("is-sichtbar"); }
      function option(art, beschr, extra) {
        return '<button type="button" class="ui-sheet__btn ui-teil__opt' + (extra || "") + '" data-art="' + art + '"><i class="ui-teil__ico ui-teil__ico--' + art + '"></i><span><strong>' +
          beschr[0] + "</strong><small>" + beschr[1] + "</small></span></button>";
      }
      function menueZeigen() {
        if (!menue) {
          menue = document.createElement("div"); menue.className = "ui-sheet ui-teilmenue";
          menue.innerHTML = '<div class="ui-sheet__box" role="dialog" aria-label="' + UI.titel + '"><p>' + UI.titel + "</p>" +
            option("foto", UI.foto, " is-erst") + option("story", UI.story) + (VIDEO_TYP ? option("video", UI.video) : "") + option("link", UI.link) +
            '<div class="ui-teil__status" role="status" hidden></div>' +
            '<button type="button" class="ui-teil__los" hidden>' + UI.fertig + "</button>" +
            '<button type="button" class="ui-sheet__zu">' + UI.zu + "</button></div>";
          menue.addEventListener("click", function (e) {
            if (e.target === menue || e.target.closest(".ui-sheet__zu")) { menueZu(); return; }
            var los = e.target.closest(".ui-teil__los");
            if (los && videoBereit && videoFertig) {
              videoBereit.then(function (f) { return teilenMit(f, menueSprache); }).then(menueZu).catch(function (err) { if (!err || err.name !== "AbortError") status(UI.fehler); });
              return;
            }
            var opt = e.target.closest(".ui-teil__opt"); if (!opt) return;
            var art = opt.getAttribute("data-art");
            if (art === "link") { linkKopieren().then(function () { toast(UI.kopiert); menueZu(); }, function () { status(UI.fehler); }); return; }
            if (art === "video") {
              status(UI.macht + " 0 %"); menue.querySelector(".ui-teil__los").hidden = true; videoFertig = false;
              videoBereit = videoErstellen(menueSprache, function (anteil) { status(UI.macht + " " + Math.round(anteil * 100) + " %"); });
              videoBereit.then(function () { videoFertig = true; status(""); menue.querySelector(".ui-teil__los").hidden = false; }, function () { videoBereit = null; status(UI.fehler); });
              return;
            }
            var bereit = art === "foto" ? (karteBereit || (karteBereit = karteDatei(menueSprache))) : (storyBereit || (storyBereit = storyDatei(menueSprache)));
            mitFrist(bereit, 2500, null).catch(function () { return null; }).then(function (f) { return teilenMit(f, menueSprache); })
              .then(menueZu).catch(function (err) { if (!err || err.name !== "AbortError") status(UI.fehler); });
          });
          document.body.appendChild(menue);
        }
        status(""); menue.querySelector(".ui-teil__los").hidden = !videoFertig;
        requestAnimationFrame(function () { menue.classList.add("is-sichtbar"); });
        // Story im Hintergrund schon vorbereiten - das Teilen-Menü des Handys muss direkt nach dem Tippen kommen.
        landHolen().then(function () { if (!storyBereit) { storyBereit = storyDatei(menueSprache); storyBereit.catch(function () { storyBereit = null; }); } });
      }
      var teilen = document.createElement("button"); teilen.type = "button"; teilen.className = "ui-teilen";
      teilen.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M8 7l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg><span>Teilen</span>';
      teilen.addEventListener("pointerdown", vorbereiten);
      teilen.addEventListener("click", function () { vorbereiten(); menueZeigen(); });
      // Ansicht gewechselt: vorbereitete Bilder passen nicht mehr.
      new MutationObserver(function () { karteBereit = null; storyBereit = null; videoBereit = null; videoFertig = false; }).observe(html, { attributes: true, attributeFilter: ["data-theme"] });
      // Für Tests und die Admin-Vorschau: Text und Bilder ohne Menü erzeugen.
      window.D119Teilen = { steckbrief: steckbrief, karte: karteDatei, story: storyDatei, sprache: spracheFuer, video: VIDEO_TYP ? videoErstellen : null };
      // Inhaber 05.11.2026: Teilen neben PayPal/Apple Pay unter "Jetzt kaufen".
      // article.js baut die Zeile (.d119-zahlart) - je nach Ladereihenfolge
      // kurz darauf warten; ohne Zeile (verkauft, Preis auf Anfrage) wie bisher in die Infospalte.
      (function platzieren(versuch) {
        var logos = info.querySelector(".d119-zahlart .d119-zahlarten");
        if (logos) { teilen.classList.add("ui-teilen--zahlart"); logos.appendChild(teilen); return; }
        if (versuch < 20) { setTimeout(function () { platzieren(versuch + 1); }, 100); return; }
        info.appendChild(teilen);
      })(0);
    }
  }

  /* Archiv-Kopf (Rückmeldung 04.11.): die drei grossen Zahlen werden eine kleine Zeile, an ihrer Stelle
     steht die (kompakte) Suche. */
  if (istArchiv) {
    var meta = document.querySelector(".masthead__meta"), suchfeld = document.getElementById("searchInput");
    var zeile = document.getElementById("uiZahlen");
    if (meta && suchfeld && !zeile) {
      // Aeltere Vorlage ohne den Kopf: zur Laufzeit umbauen (seit 04.11. bringt index_template.html ihn mit).
      html.classList.add("ui-kopf");
      zeile = document.createElement("p"); zeile.className = "ui-kopf__zahlen";
      var halter = document.createElement("div"); halter.className = "ui-kopf__suche";
      halter.appendChild(suchfeld);
      meta.insertAdjacentElement("afterend", halter);
      halter.insertAdjacentElement("afterend", zeile);
    }
    if (zeile) {
      katalog().then(function (k) {
        var verf = k.filter(function (x) { return x.public_status !== "SOLD"; }).length;
        var marken = {}; k.forEach(function (x) { if (x.brand) marken[x.brand] = 1; });
        zeile.textContent = verf + " verfügbar · " + k.length + " im Archiv · " + Object.keys(marken).length + " Marken";
      });
    }
  }

  /* Startseite (ab dem zweiten Besuch): landet an der Leiste mit den Kategorien; der Kopf mit dem Schriftzug liegt darueber (hochscrollen). */
  if (istArchiv) {
    var rail = document.querySelector(".rail");
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    // Erst ab dem zweiten Besuch: beim ersten Mal bleibt der Schriftzug oben (und das
    // Raster darf sich noch setzen - Lighthouse wertet den Sprung sonst als Layout-Verschiebung,
    // Startseite mobil 50 statt 95 Punkte).
    var besuche = Number(speicher("ui_besuche") || 0) + 1;
    speicher("ui_besuche", besuche);
    // Auch beim Zurueck aus einem Teil (iPhone: Kopf soll oben liegen, nicht sichtbar sein) - nur wenn
    // der Browser die alte Position nicht ohnehin wiederhergestellt hat (scrollY < 40).
    if (rail && besuche >= 2 && !location.hash && window.scrollY < 40) {
      var kopf = document.querySelector(".page-head");
      var versatz = (kopf ? kopf.getBoundingClientRect().height : 0) + 6;
      var ziel = function () { return rail.getBoundingClientRect().top + window.scrollY - versatz; };
      window.scrollTo({ top: ziel(), behavior: "auto" });
      setTimeout(function () { if (Math.abs(window.scrollY - ziel()) > 30 && window.scrollY < 40) window.scrollTo({ top: ziel(), behavior: "auto" }); }, 350);
    }
  }

  /* 12 · Suchvorschläge: fehlertolerant (Bigramm-Ähnlichkeit) über Marken und Titel. */
  if (istArchiv) {
    var such = document.getElementById("searchInput");
    if (such) {
      var box = document.createElement("div"); box.className = "ui-suggest";
      such.insertAdjacentElement("afterend", box);
      function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
      function bigramme(s) { var m = {}; s = " " + s + " "; for (var i = 0; i < s.length - 1; i++) { var k = s.substr(i, 2); m[k] = (m[k] || 0) + 1; } return m; }
      function aehnlich(a, b) {
        var x = bigramme(a), y = bigramme(b), s = 0, nx = 0, ny = 0, k;
        for (k in x) { nx += x[k]; if (y[k]) s += Math.min(x[k], y[k]); }
        for (k in y) ny += y[k];
        return nx + ny ? (2 * s) / (nx + ny) : 0;
      }
      var timer;
      such.addEventListener("input", function () {
        clearTimeout(timer);
        var q = norm(such.value);
        if (q.length < 2) { box.innerHTML = ""; return; }
        timer = setTimeout(function () {
          katalog(true).then(function (k) {
            var marken = {}, kandidaten = [];
            k.forEach(function (it) {
              if (it.brand) { marken[it.brand] = (marken[it.brand] || 0) + 1; }
              kandidaten.push({ text: it.title || "", art: it.brand || "", rang: 1 });
            });
            Object.keys(marken).forEach(function (m) { kandidaten.push({ text: m, art: marken[m] + " Teile", rang: -marken[m] }); });
            var treffer = kandidaten.map(function (c) {
              var t = norm(c.text), s = t.indexOf(q) === 0 ? 1 : t.indexOf(q) >= 0 ? .9 : Math.max(aehnlich(q, t), aehnlich(q, t.split(" ")[0]), aehnlich(q, t.split(" ").slice(0, 2).join(" ")));
              return { c: c, s: s };
            }).filter(function (x) { return x.s >= .45; }).sort(function (a, b) { return b.s - a.s || a.c.rang - b.c.rang; }).slice(0, 6);
            box.innerHTML = "";
            if (treffer.length && treffer[0].s < .9) { var hint = document.createElement("span"); hint.className = "ui-suggest__hint"; hint.textContent = "Meintest du:"; box.appendChild(hint); }
            treffer.forEach(function (x) {
              var b = document.createElement("button"); b.type = "button";
              b.innerHTML = x.c.text.replace(/</g, "&lt;") + (x.c.art ? " <em>· " + x.c.art + "</em>" : "");
              b.addEventListener("click", function () { such.value = x.c.text; such.dispatchEvent(new Event("input", { bubbles: true })); box.innerHTML = ""; such.blur(); });
              box.appendChild(b);
            });
          });
        }, 120);
      });
    }
  }
})();
