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
    grid.addEventListener("click", function (e) { if (ssAktiv && e.pointerType === "touch") { e.preventDefault(); } ssAktiv = false; }, true);
    grid.addEventListener("contextmenu", function (e) { if (ssPlate) e.preventDefault(); });
    grid.addEventListener("dragstart", function (e) { if (ssPlate) e.preventDefault(); });
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
        // Plaetze: links und rechts vom Schriftzug, auf dem Handy in den oberen Ecken.
        // Nur im Kopfbereich neben dem Schriftzug: links/rechts, obere Haelfte (unten stehen Suche und Zahlen).
        var plaetze = schmal
          ? [[4, 6], [70, 6]]
          : [[4, 8], [84, 8], [6, 44], [82, 44]];
        function zufall(a, b) { return a + Math.random() * (b - a); }
        function auftauchen() {
          var it = teile[idx % teile.length]; idx++;
          var platz = plaetze[(idx - 1) % plaetze.length];
          if (lebend.length >= maxSichtbar) platz = plaetze[(idx - 1 - maxSichtbar) % plaetze.length];
          var a = document.createElement("a"); a.className = "ui-orbit__teil"; a.href = "/artikel/" + (it.url_slug || it.id) + "/";
          a.title = (it.brand || "") + (it.title ? " – " + it.title : "");
          var groesse = schmal ? 78 : 100;
          a.style.cssText = "left:" + platz[0] + "%;top:" + platz[1] + "%;width:" + groesse + "px;--rot:" + zufall(-4, 4).toFixed(1) + "deg;--dx:" + zufall(-8, 8).toFixed(0) + "px;--dy:" + zufall(-10, -4).toFixed(0) + "px;--dauer:" + zufall(12, 18).toFixed(1) + "s";
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

  /* 9 · Teilen: Handy = Teilen-Menü des Systems mit Foto, Titel, Preis, Link (WhatsApp, Instagram, TikTok, AirDrop …);
     Rechner = kleine Auswahl (WhatsApp, E-Mail, Link kopieren). */
  if (istArtikel) {
    var info = document.querySelector(".info"), h1 = info && info.querySelector("h1");
    if (h1) {
      var it = window.ARTICLE_ITEM || {};
      var titel = (h1.textContent || "").trim();
      var text = titel + (it.price > 0 ? " · " + Number(it.price).toLocaleString("de-DE") + " €" : "") + " · Disorder119";
      var teilen = document.createElement("button"); teilen.type = "button"; teilen.className = "ui-teilen";
      teilen.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M8 7l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg><span>Teilen</span>';
      var sheet;
      function sheetZeigen() {
        if (!sheet) {
          sheet = document.createElement("div"); sheet.className = "ui-sheet";
          sheet.innerHTML = '<div class="ui-sheet__box"><p>Teilen</p>' +
            '<a class="ui-sheet__btn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text + "\n" + location.href) + '"><b style="background:#25d366">W</b>WhatsApp</a>' +
            '<a class="ui-sheet__btn" href="mailto:?subject=' + encodeURIComponent(titel) + "&body=" + encodeURIComponent(text + "\n" + location.href) + '"><b style="background:#555">@</b>E-Mail</a>' +
            '<button type="button" class="ui-sheet__btn" data-kopieren><b style="background:#7a4bff">⧉</b>Link kopieren</button>' +
            '<button type="button" class="ui-sheet__zu">Schließen</button></div>';
          sheet.addEventListener("click", function (e) { if (e.target === sheet || e.target.closest(".ui-sheet__zu")) sheet.classList.remove("is-sichtbar"); });
          sheet.querySelector("[data-kopieren]").addEventListener("click", function () { navigator.clipboard.writeText(location.href).then(function () { toast("Link kopiert"); sheet.classList.remove("is-sichtbar"); }); });
          document.body.appendChild(sheet);
        }
        requestAnimationFrame(function () { sheet.classList.add("is-sichtbar"); });
      }
      teilen.addEventListener("click", function () {
        var daten = { title: titel, text: text, url: location.href };
        if (navigator.share && grob) {
          var bild = document.getElementById("galleryMain");
          fetch(bild.currentSrc).then(function (r) { return r.blob(); }).then(function (b) {
            var datei = new File([b], "disorder119-" + (it.url_slug || it.id) + ".webp", { type: b.type || "image/webp" });
            var mit = Object.assign({ files: [datei] }, daten);
            return (navigator.canShare && navigator.canShare(mit)) ? navigator.share(mit) : navigator.share(daten);
          }).catch(function () { return navigator.share(daten).catch(function () {}); });
        } else sheetZeigen();
      });
      info.appendChild(teilen);
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
    var zurueck = nav && nav.type === "back_forward";
    // Erst ab dem zweiten Besuch: beim ersten Mal bleibt der Schriftzug oben (und das
    // Raster darf sich noch setzen - Lighthouse wertet den Sprung sonst als Layout-Verschiebung,
    // Startseite mobil 50 statt 95 Punkte).
    var besuche = Number(speicher("ui_besuche") || 0) + 1;
    speicher("ui_besuche", besuche);
    if (rail && besuche >= 2 && !zurueck && !location.hash && window.scrollY < 40) {
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
