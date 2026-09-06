#!/usr/bin/env python3
"""Consolidate Disorder119 rental runtime and close audit gaps.

This migration deliberately touches only the normal archive/rental/commerce path.
Match, Chaos and Baukasten remain outside every patch target and mode-guard.json
is never modified.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (BASE / rel).read_text(encoding="utf-8")


def write(rel: str, value: str) -> None:
    (BASE / rel).write_text(value, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"FEHLER: Runtime-Rental-Audit Patchmarker fehlt: {label}")
    return text.replace(old, new, 1)


def patch_rental_v2(text: str) -> str:
    text = replace_once(
        text,
        '  var RECEIPT_KEY = "d119_rental_terms_receipts";\n',
        '  var RECEIPT_KEY = "d119_rental_terms_receipts";\n  var BUNDLE_RECEIPT_KEY = "d119_rental_bundle_receipts"; // RUNTIME_AUDIT_ATOMIC_BUNDLE\n',
        "Bundle receipt key",
    )

    for old, new, label in (
        (
            '      requestSent: "Anfrage vorbereitet. Die Artikel bleiben bis zur Bestätigung unverbindlich.",\n      longPeriod:',
            '      requestSent: "Anfrage vorbereitet. Die Artikel bleiben bis zur Bestätigung unverbindlich.",\n      serverSaved: "Mietanfrage als gemeinsamer Vorgang gespeichert.",\n      serverSaveFailed: "Die Server-Speicherung ist fehlgeschlagen; deine Kontaktanfrage kann trotzdem gesendet werden.",\n      longPeriod:',
            "DE server status",
        ),
        (
            '      requestSent: "Request prepared. The items remain non-binding until confirmed.",\n      longPeriod:',
            '      requestSent: "Request prepared. The items remain non-binding until confirmed.",\n      serverSaved: "Rental request saved as one combined booking.",\n      serverSaveFailed: "Server saving failed; your contact request can still be sent.",\n      longPeriod:',
            "EN server status",
        ),
        (
            '      requestSent: "Demande préparée. Les articles restent sans engagement jusqu’à confirmation.",\n      longPeriod:',
            '      requestSent: "Demande préparée. Les articles restent sans engagement jusqu’à confirmation.",\n      serverSaved: "Demande enregistrée comme une location groupée.",\n      serverSaveFailed: "L’enregistrement serveur a échoué ; votre demande de contact peut tout de même être envoyée.",\n      longPeriod:',
            "FR server status",
        ),
    ):
        text = replace_once(text, old, new, label)

    text = replace_once(
        text,
        '      saved.ids = saved.ids.map(Number).filter(function (x) { return Number.isFinite(x) && x > 0; }).slice(0, 20);\n      return Object.assign(fallback, saved);',
        '      saved.ids = saved.ids.map(Number).filter(function (x) { return Number.isFinite(x) && x > 0; }).filter(function (x, i, all) { return all.indexOf(x) === i; }).slice(0, 20); // RUNTIME_AUDIT_RENTAL_DEDUPE\n      var now = new Date();\n      var today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");\n      if (saved.start && saved.start < today) { saved.start = ""; saved.end = ""; saved.termsAccepted = false; }\n      return Object.assign(fallback, saved);',
        "local rental state sanitation",
    )

    text = replace_once(text, '    if (!catalogMap[id]) return;\n', '    if (!catalogMap[id]) return false;\n', "toggle missing item")
    text = replace_once(text, '      if (state.ids.length >= 20) return;\n', '      if (state.ids.length >= 20) return false;\n', "toggle item limit")
    text = replace_once(
        text,
        '    renderOverlay();\n  }\n\n  function showToast(message) {',
        '    renderOverlay();\n    return true;\n  }\n\n  // Stable internal API for the integrated picker. It must not depend on a\n  // product card currently being rendered in the 12-card archive window.\n  window.D119RentalV2 = { // RUNTIME_AUDIT_PICKER_API\n    toggleItem: function (id) { return toggleItem(id); },\n    getSelectedIds: function () { return state.ids.slice(); }\n  };\n\n  function showToast(message) {',
        "picker API",
    )

    text = replace_once(
        text,
        '  function validPeriod() {\n    var days = dayCount(state.start, state.end);\n    return days && days <= STANDARD_MAX_DAYS ? days : null;\n  }',
        '  function localTodayIso() {\n    var now = new Date();\n    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");\n  }\n\n  function validPeriod() {\n    if (!state.start || state.start < localTodayIso()) return null; // RUNTIME_AUDIT_NO_PAST_RENTAL\n    var days = dayCount(state.start, state.end);\n    return days && days <= STANDARD_MAX_DAYS ? days : null;\n  }',
        "past rental dates",
    )

    text = replace_once(
        text,
        '      delivery: state.delivery, postal: state.postal, risk: state.risk, message: state.message,\n      termsVersion: TERMS_VERSION, language: LANG',
        '      delivery: state.delivery, postal: state.postal, risk: state.risk, message: state.message,\n      termsVersion: TERMS_VERSION, termsLanguage: LANG',
        "atomic payload language",
    )

    text = replace_once(
        text,
        '        saveTermsReceipt();\n        reportBundleToWorker();\n        showToast(t("requestSent"));',
        '        var receipt = saveTermsReceipt();\n        reportBundleToWorker(receipt && receipt.acceptedAt);\n        showToast(t("requestSent"));',
        "single atomic click reporter",
    )

    text = replace_once(
        text,
        '    } catch (e) {}\n  }\n\n  function stableHash(value) {',
        '    } catch (e) {}\n    return receipt;\n  }\n\n  function stableHash(value) {',
        "return terms receipt",
    )

    old_report = '''  function reportBundleToWorker() {\n    if (!SHOP_CONFIG.shopWorkerUrl || !validPeriod()) return;\n    var payload = requestPayload();\n    var bundleHash = stableHash(payload);\n    selectedItems().forEach(function (item) {\n      var body = {\n        itemId: item.id,\n        start: state.start,\n        end: state.end,\n        purpose: state.purpose,\n        message: "[MULTI_ITEM " + state.ids.length + " | " + TERMS_VERSION + " | bundle " + bundleHash + "] " + [state.delivery, state.postal, state.risk, state.message].filter(Boolean).join(" | ").slice(0, 1750)\n      };\n      fetch(String(SHOP_CONFIG.shopWorkerUrl).replace(/\\/+$/, "") + "/rental-request", {\n        method: "POST",\n        headers: { "Content-Type": "application/json", "Idempotency-Key": "rental-v2:" + bundleHash + ":" + item.id },\n        body: JSON.stringify(body)\n      }).catch(function () {});\n    });\n  }'''
    new_report = '''  function bundleAcceptanceTimestamp(hash, fallback) {\n    var key = "d119_rental_bundle_acceptance:" + hash;\n    try {\n      var existing = localStorage.getItem(key);\n      if (existing) return existing;\n      var created = fallback || new Date().toISOString();\n      localStorage.setItem(key, created);\n      return created;\n    } catch (e) { return fallback || new Date().toISOString(); }\n  }\n\n  function saveBundleReceipt(data, payload) {\n    try {\n      var list = JSON.parse(localStorage.getItem(BUNDLE_RECEIPT_KEY) || "[]");\n      if (!Array.isArray(list)) list = [];\n      list.push({\n        rentalGroupId: data.rentalGroupId || null, savedAt: new Date().toISOString(), expiresAt: data.expiresAt || null,\n        itemIds: payload.itemIds.slice(), start: payload.start, end: payload.end,\n        rentalTotalCents: data.rentalTotalCents == null ? null : data.rentalTotalCents,\n        depositTotalCents: data.depositTotalCents == null ? null : data.depositTotalCents,\n        termsVersion: payload.termsVersion, termsAcceptedAt: payload.termsAcceptedAt\n      });\n      localStorage.setItem(BUNDLE_RECEIPT_KEY, JSON.stringify(list.slice(-30)));\n    } catch (e) {}\n  }\n\n  function reportBundleToWorker(acceptedAt) {\n    if (!SHOP_CONFIG.shopWorkerUrl || !validPeriod()) return;\n    var payload = requestPayload();\n    var bundleHash = stableHash(payload);\n    payload.termsAcceptedAt = bundleAcceptanceTimestamp(bundleHash, acceptedAt);\n    fetch(String(SHOP_CONFIG.shopWorkerUrl).replace(/\\/+$/, "") + "/rental-bundle", { // RUNTIME_AUDIT_ATOMIC_BUNDLE_POST\n      method: "POST",\n      headers: { "Content-Type": "application/json", "Idempotency-Key": "rental-bundle-v2:" + bundleHash },\n      body: JSON.stringify(payload),\n      keepalive: true\n    }).then(function (response) {\n      return response.text().then(function (raw) {\n        var data = {};\n        try { data = raw ? JSON.parse(raw) : {}; } catch (e) {}\n        if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));\n        return data;\n      });\n    }).then(function (data) {\n      saveBundleReceipt(data, payload);\n      showToast(t("serverSaved"));\n    }).catch(function () {\n      showToast(t("serverSaveFailed"));\n    });\n  }'''
    text = replace_once(text, old_report, new_report, "atomic bundle reporter")

    text = replace_once(
        text,
        '        state.ids = state.ids.filter(function (id) { return !!catalogMap[id] && String(catalogMap[id].public_status || "").toUpperCase() !== "SOLD"; });',
        '        state.ids = state.ids.filter(function (id, index, all) { return all.indexOf(id) === index && !!catalogMap[id] && String(catalogMap[id].public_status || "").toUpperCase() !== "SOLD"; });',
        "post-catalog ID sanitation",
    )
    return text


def patch_rental_ui(text: str) -> str:
    return replace_once(
        text,
        '      return state.ids.map(Number).filter(function (id) { return Number.isFinite(id) && id > 0; }).slice(0, 20);',
        '      return state.ids.map(Number).filter(function (id) { return Number.isFinite(id) && id > 0; }).filter(function (id, index, all) { return all.indexOf(id) === index; }).slice(0, 20); // RUNTIME_AUDIT_UI_DEDUPE',
        "rental UI ID dedupe",
    )


def patch_rental_picker(text: str) -> str:
    text = replace_once(
        text,
        '        ? state.ids.map(Number).filter(function (id) { return Number.isFinite(id) && id > 0; }).slice(0, 20)',
        '        ? state.ids.map(Number).filter(function (id) { return Number.isFinite(id) && id > 0; }).filter(function (id, index, all) { return all.indexOf(id) === index; }).slice(0, 20) // RUNTIME_AUDIT_PICKER_DEDUPE',
        "picker ID dedupe",
    )
    text = replace_once(
        text,
        '  function title(item) {\n    return ((item && item.brand ? item.brand + " " : "") + (item && item.title ? item.title : "")).trim();\n  }',
        '  function title(item) {\n    var rawTitle = String(item && item.title || "").trim();\n    var brand = String(item && item.brand || "").trim();\n    if (!brand || rawTitle.toLowerCase().indexOf(brand.toLowerCase()) === 0) return rawTitle;\n    return (brand + " " + rawTitle).trim(); // RUNTIME_AUDIT_PICKER_ALT\n  }\n  function itemCategory(item) {\n    return String(item && (item.taxonomy_category || item.category) || "").trim(); // RUNTIME_AUDIT_PICKER_TAXONOMY\n  }',
        "picker title/category helpers",
    )
    text = replace_once(text, '      var cat = String(item.category || "").trim();', '      var cat = itemCategory(item);', "picker categories")
    text = replace_once(text, '      if (!selectedOnly && activeCategory !== "all" && String(item.category || "") !== activeCategory) return false;', '      if (!selectedOnly && activeCategory !== "all" && itemCategory(item) !== activeCategory) return false;', "picker category filter")
    text = replace_once(text, '      var hay = normalize([item.brand, item.title, item.article, item.id, item.category, item.size].join(" "));', '      var hay = normalize([item.brand, item.title, item.article, item.id, itemCategory(item), item.size].join(" "));', "picker search category")
    text = replace_once(
        text,
        '''    var source = document.querySelector('[data-rental="' + id + '"]');\n    if (source) {\n      source.click();\n      window.requestAnimationFrame(renderPicker);\n      return;\n    }\n    showAlert(t("unavailable"));''',
        '''    var api = window.D119RentalV2;\n    if (api && typeof api.toggleItem === "function") { // RUNTIME_AUDIT_PICKER_OFFDOM\n      if (api.toggleItem(id)) window.requestAnimationFrame(renderPicker);\n      else showAlert(t("unavailable"));\n      return;\n    }\n    var source = document.querySelector('[data-rental="' + id + '"]');\n    if (source) {\n      source.click();\n      window.requestAnimationFrame(renderPicker);\n      return;\n    }\n    showAlert(t("unavailable"));''',
        "off-DOM picker toggle",
    )
    return text


def patch_template(text: str) -> str:
    text = text.replace('<script src="/assets/rental-commerce.js"></script>\n', '')
    text = text.replace('<script src="/assets/rental-v2-bundle.js"></script>\n', '')
    if '<script src="/assets/rental-commerce.js"></script>' in text or '<script src="/assets/rental-v2-bundle.js"></script>' in text:
        raise SystemExit("FEHLER: Legacy-Rental-Scripts konnten nicht aus index_template.html entfernt werden")
    return text


def patch_commerce_core(text: str) -> str:
    text = replace_once(
        text,
        'export function rentalQuoteFromItem(item, startDate, endDate) {',
        'export function rentalQuoteFromItem(item, startDate, endDate, todayDate = new Date().toISOString().slice(0, 10)) {',
        "rental quote signature",
    )
    text = replace_once(
        text,
        '  const days = rentalDayCount(startDate, endDate);\n  if (!days) throw new Error("INVALID_RENTAL_DATES");',
        '  const days = rentalDayCount(startDate, endDate);\n  if (!days) throw new Error("INVALID_RENTAL_DATES");\n  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(todayDate || "")) || String(startDate) < String(todayDate)) throw new Error("RENTAL_DATE_IN_PAST"); // RUNTIME_AUDIT_SERVER_NO_PAST',
        "server past-date guard",
    )
    return text


def patch_commerce_tests(text: str) -> str:
    text = replace_once(
        text,
        '  const quote = rentalQuoteFromItem({ id: 1, price: 125, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-07");',
        '  const quote = rentalQuoteFromItem({ id: 1, price: 125, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-07", "2026-09-01");',
        "deterministic rental total test",
    )
    text = replace_once(
        text,
        '  const quote = rentalQuoteFromItem({ id: 1, price: null, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-05");',
        '  const quote = rentalQuoteFromItem({ id: 1, price: null, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-05", "2026-09-01");',
        "deterministic request-price test",
    )
    anchor = '''test("date parser rejects impossible and reversed dates", () => {\n  assert.equal(rentalDayCount("2026-02-30", "2026-03-01"), null);\n  assert.equal(rentalDayCount("2026-09-07", "2026-09-05"), null);\n  assert.equal(rentalDayCount("2026-09-05", "2026-09-05"), 1);\n});'''
    addition = anchor + '''\n\ntest("rental quote rejects dates before the booking day", () => {\n  assert.throws(\n    () => rentalQuoteFromItem({ id: 1, price: 125, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-06", "2026-09-06"),\n    /RENTAL_DATE_IN_PAST/\n  );\n}); // RUNTIME_AUDIT_SERVER_NO_PAST_TEST'''
    text = replace_once(text, anchor, addition, "past-date unit test")
    return text


def patch_worker(text: str) -> str:
    old = '          if (err.message === "INVALID_RENTAL_DATES") throw new PublicError("INVALID_RENTAL_DATES", 400);'
    new = '          if (err.message === "INVALID_RENTAL_DATES" || err.message === "RENTAL_DATE_IN_PAST") throw new PublicError("INVALID_RENTAL_DATES", 400); // RUNTIME_AUDIT_SERVER_DATE_MAP'
    count = text.count(old)
    if count == 0 and text.count(new) >= 2:
        return text
    if count != 2:
        raise SystemExit(f"FEHLER: Erwartete 2 Worker-Date-Mappings, gefunden: {count}")
    return text.replace(old, new)


def patch_bundle_worker(text: str) -> str:
    return replace_once(
        text,
        '        if (err.message === "INVALID_RENTAL_DATES") throw new BundleError("INVALID_RENTAL_DATES", 400);',
        '        if (err.message === "INVALID_RENTAL_DATES" || err.message === "RENTAL_DATE_IN_PAST") throw new BundleError("INVALID_RENTAL_DATES", 400); // RUNTIME_AUDIT_BUNDLE_DATE_MAP',
        "bundle past-date mapping",
    )


def main() -> None:
    patches = {
        "assets/rental-v2.js": patch_rental_v2,
        "assets/rental-v2-ui.js": patch_rental_ui,
        "assets/rental-v2-picker.js": patch_rental_picker,
        "index_template.html": patch_template,
        "shop-worker/commerce-core.js": patch_commerce_core,
        "shop-worker/commerce-core.test.mjs": patch_commerce_tests,
        "shop-worker/worker.js": patch_worker,
        "shop-worker/rental-bundle.js": patch_bundle_worker,
    }
    changed = []
    for rel, patch in patches.items():
        before = read(rel)
        after = patch(before)
        if after != before:
            write(rel, after)
            changed.append(rel)
    print("Runtime-Rental-Integritaet angewendet: " + (", ".join(changed) if changed else "bereits aktuell"))


if __name__ == "__main__":
    main()
