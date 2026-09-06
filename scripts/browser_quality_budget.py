#!/usr/bin/env python3
"""Quantitative Lighthouse + axe-core quality budget for Disorder119.

This audit deliberately targets the normal archive / product / cart / rental
customer journeys. Match, Chaos and Baukasten are protected modes and remain
covered by their dedicated browser regression/guard tests rather than being
silently changed to satisfy generic audit tooling.

The script expects:
- a built site served via D119_SMOKE_URL (default http://127.0.0.1:4173)
- Selenium/Chrome
- node_modules/axe-core/axe.min.js
- node_modules/.bin/lighthouse

It writes machine-readable and Markdown reports to .quality-reports/ and exits
non-zero when a hard regression budget is exceeded.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver import ChromeOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

BASE_URL = os.environ.get("D119_SMOKE_URL", "http://127.0.0.1:4173").rstrip("/") + "/"
REPORT_DIR = Path(os.environ.get("D119_QUALITY_REPORT_DIR", ".quality-reports"))
AXE_PATH = Path(os.environ.get("D119_AXE_PATH", "node_modules/axe-core/axe.min.js"))
LIGHTHOUSE_BIN = Path(os.environ.get("D119_LIGHTHOUSE_BIN", "node_modules/.bin/lighthouse"))
WAIT = 12

# Hard gates are intentionally regression floors, not aspirational marketing
# scores. The Markdown report also shows the stricter target values we want to
# optimize toward. This keeps CI useful instead of flaky while still refusing
# material regressions.
LIGHTHOUSE_CASES: tuple[dict[str, Any], ...] = (
    {
        "name": "home-mobile",
        "path": "",
        "preset": None,
        "score_gates": {
            "performance": 0.85,
            "accessibility": 0.95,
            "best-practices": 0.90,
            "seo": 0.95,
        },
        "metric_gates": {
            "largest-contentful-paint": 4000.0,
            "cumulative-layout-shift": 0.10,
            "total-blocking-time": 400.0,
        },
    },
    {
        "name": "home-desktop",
        "path": "",
        "preset": "desktop",
        "score_gates": {
            "performance": 0.90,
            "accessibility": 0.95,
            "best-practices": 0.90,
            "seo": 0.95,
        },
        "metric_gates": {
            "largest-contentful-paint": 3000.0,
            "cumulative-layout-shift": 0.10,
            "total-blocking-time": 250.0,
        },
    },
    {
        "name": "product-mobile",
        "path": None,  # resolved from data/items.json
        "preset": None,
        "score_gates": {
            "performance": 0.80,
            "accessibility": 0.95,
            "best-practices": 0.90,
            "seo": 0.95,
        },
        "metric_gates": {
            "largest-contentful-paint": 4500.0,
            "cumulative-layout-shift": 0.10,
            "total-blocking-time": 450.0,
        },
    },
)

AXE_BLOCKING_IMPACTS = {"critical", "serious"}
AXE_WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]


def fail(message: str) -> None:
    raise AssertionError(message)


def chrome_options(width: int = 1440, height: int = 900) -> ChromeOptions:
    opts = ChromeOptions()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument(f"--window-size={width},{height}")
    opts.page_load_strategy = "eager"
    return opts


def new_driver(width: int = 1440, height: int = 900):
    driver = webdriver.Chrome(options=chrome_options(width, height))
    driver.set_page_load_timeout(25)
    driver.set_script_timeout(45)
    return driver


def wait(driver, condition, label: str):
    try:
        return WebDriverWait(driver, WAIT).until(condition)
    except TimeoutException as exc:
        raise AssertionError(f"Timeout: {label} @ {driver.current_url}") from exc


def dismiss_cookie_note(driver) -> None:
    try:
        button = driver.find_element(By.ID, "cookieNoteOk")
    except NoSuchElementException:
        return
    if button.is_displayed():
        button.click()
        wait(driver, lambda d: not d.find_element(By.ID, "cookieNote").is_displayed(), "Cookie-Hinweis geschlossen")


def representative_product_path() -> str:
    items_path = Path("data/items.json")
    if not items_path.exists():
        fail("data/items.json fehlt; kein repraesentatives Produkt fuer Lighthouse bestimmbar")
    items = json.loads(items_path.read_text(encoding="utf-8"))
    for item in items:
        item_id = item.get("id")
        public_status = str(item.get("public_status") or "").upper()
        if item_id and public_status in {"AVAILABLE", "RESERVED", "SOLD"}:
            return f"artikel/{item_id}/"
    fail("Kein oeffentliches Produkt in data/items.json gefunden")
    raise AssertionError  # pragma: no cover


def axe_source() -> str:
    if not AXE_PATH.exists():
        fail(f"axe-core nicht gefunden: {AXE_PATH}")
    return AXE_PATH.read_text(encoding="utf-8")


def run_axe(driver, source: str, context_name: str) -> dict[str, Any]:
    driver.execute_script(source)
    result = driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        if (!window.axe) {
          done({error: 'axe-core was not injected'});
          return;
        }
        axe.run(document, {
          runOnly: { type: 'tag', values: arguments[0] },
          resultTypes: ['violations', 'incomplete', 'passes'],
          reporter: 'v2'
        }).then(done).catch((err) => done({error: String(err && err.stack || err)}));
        """,
        AXE_WCAG_TAGS,
    )
    if not isinstance(result, dict) or result.get("error"):
        fail(f"axe-core Fehler in {context_name}: {result!r}")

    violations = result.get("violations") or []
    blocking = [v for v in violations if (v.get("impact") or "").lower() in AXE_BLOCKING_IMPACTS]
    compact = {
        "context": context_name,
        "url": driver.current_url,
        "violation_count": len(violations),
        "blocking_count": len(blocking),
        "violations": [
            {
                "id": v.get("id"),
                "impact": v.get("impact"),
                "help": v.get("help"),
                "helpUrl": v.get("helpUrl"),
                "nodes": [
                    {
                        "target": node.get("target"),
                        "html": (node.get("html") or "")[:500],
                        "failureSummary": (node.get("failureSummary") or "")[:1200],
                    }
                    for node in (v.get("nodes") or [])[:12]
                ],
            }
            for v in violations
        ],
    }
    (REPORT_DIR / f"axe-{context_name}.json").write_text(
        json.dumps(compact, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return compact


def audit_accessibility(product_path: str) -> list[dict[str, Any]]:
    source = axe_source()
    reports: list[dict[str, Any]] = []
    driver = new_driver()
    try:
        # Archive desktop.
        driver.set_window_size(1440, 900)
        driver.get(BASE_URL)
        wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 3, "Archivkarten")
        dismiss_cookie_note(driver)
        reports.append(run_axe(driver, source, "archive-desktop"))

        # Archive mobile with the real filter dialog open.
        driver.set_window_size(390, 844)
        driver.get(BASE_URL)
        wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 3, "mobile Archivkarten")
        dismiss_cookie_note(driver)
        toggle = driver.find_element(By.ID, "moreFiltersToggle")
        toggle.click()
        wait(driver, lambda d: d.find_element(By.ID, "filterPanel").is_displayed(), "Filterdialog offen")
        reports.append(run_axe(driver, source, "archive-mobile-filter"))

        # Product page.
        driver.get(urljoin(BASE_URL, product_path))
        wait(driver, lambda d: bool(d.find_elements(By.CSS_SELECTOR, ".product .info h1")), "Produktdetail")
        dismiss_cookie_note(driver)
        reports.append(run_axe(driver, source, "product-mobile"))

        # Cart page; an empty cart is still a real customer state and catches
        # landmark/form/button regressions without mutating persisted data.
        driver.get(urljoin(BASE_URL, "cart/"))
        wait(driver, lambda d: bool(d.find_elements(By.ID, "cartBody")), "Warenkorb")
        dismiss_cookie_note(driver)
        reports.append(run_axe(driver, source, "cart-mobile"))

        # Rental deep-link with its canonical modal actually open.
        driver.get(urljoin(BASE_URL, product_path))
        wait(driver, lambda d: bool(d.find_elements(By.CSS_SELECTOR, ".btn--rental")), "Mietlink")
        rental_href = driver.find_element(By.CSS_SELECTOR, ".btn--rental").get_attribute("href")
        if not rental_href:
            fail("Produktdetail hat keinen Rental-V2-Link")
        driver.get(rental_href)
        backdrop = wait(driver, lambda d: d.find_element(By.ID, "d119RentalV2Backdrop"), "Rental-V2-Backdrop")
        wait(driver, lambda d: backdrop.is_displayed() and "open" in (backdrop.get_attribute("class") or ""), "Rental V2 offen")
        reports.append(run_axe(driver, source, "rental-mobile-dialog"))

        # Localized archive shells.
        for lang in ("en", "fr"):
            driver.set_window_size(1280, 900)
            driver.get(urljoin(BASE_URL, f"{lang}/"))
            wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 3, f"/{lang}/ Archivkarten")
            dismiss_cookie_note(driver)
            reports.append(run_axe(driver, source, f"archive-{lang}"))
    finally:
        driver.quit()
    return reports


def run_lighthouse(case: dict[str, Any], product_path: str) -> dict[str, Any]:
    if not LIGHTHOUSE_BIN.exists():
        fail(f"Lighthouse CLI nicht gefunden: {LIGHTHOUSE_BIN}")
    path = case["path"] if case["path"] is not None else product_path
    url = urljoin(BASE_URL, path)
    output = REPORT_DIR / f"lighthouse-{case['name']}.json"
    log_path = REPORT_DIR / f"lighthouse-{case['name']}.log"
    cmd = [
        str(LIGHTHOUSE_BIN),
        url,
        "--quiet",
        "--output=json",
        f"--output-path={output}",
        "--only-categories=performance,accessibility,best-practices,seo",
        "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu",
    ]
    if case.get("preset"):
        cmd.append(f"--preset={case['preset']}")
    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=210)
    log_path.write_text(proc.stdout or "", encoding="utf-8")
    if proc.returncode != 0 or not output.exists():
        fail(f"Lighthouse {case['name']} fehlgeschlagen (Exit {proc.returncode}); siehe {log_path}")

    report = json.loads(output.read_text(encoding="utf-8"))
    categories = report.get("categories") or {}
    audits = report.get("audits") or {}
    scores = {
        category: float((categories.get(category) or {}).get("score") or 0.0)
        for category in ("performance", "accessibility", "best-practices", "seo")
    }
    metrics = {
        audit_id: float((audits.get(audit_id) or {}).get("numericValue") or 0.0)
        for audit_id in (
            "first-contentful-paint",
            "largest-contentful-paint",
            "cumulative-layout-shift",
            "total-blocking-time",
            "speed-index",
            "interactive",
        )
    }
    return {
        "name": case["name"],
        "url": url,
        "scores": scores,
        "metrics": metrics,
        "score_gates": case["score_gates"],
        "metric_gates": case["metric_gates"],
    }


def evaluate(lighthouse_reports: list[dict[str, Any]], axe_reports: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for report in lighthouse_reports:
        name = report["name"]
        for category, minimum in report["score_gates"].items():
            actual = report["scores"].get(category, 0.0)
            if actual + 1e-9 < minimum:
                errors.append(f"{name}: {category} {actual * 100:.0f} < Gate {minimum * 100:.0f}")
        for metric, maximum in report["metric_gates"].items():
            actual = report["metrics"].get(metric, 0.0)
            if actual > maximum:
                unit = "" if metric == "cumulative-layout-shift" else " ms"
                errors.append(f"{name}: {metric} {actual:.2f}{unit} > Gate {maximum:.2f}{unit}")

    for report in axe_reports:
        if report["blocking_count"]:
            ids = [
                f"{v['id']} ({v.get('impact')})"
                for v in report.get("violations", [])
                if (v.get("impact") or "").lower() in AXE_BLOCKING_IMPACTS
            ]
            errors.append(f"axe {report['context']}: {report['blocking_count']} serious/critical violation(s): {', '.join(ids)}")
    return errors


def pct(value: float) -> str:
    return f"{round(value * 100):d}"


def ms(value: float) -> str:
    return f"{round(value):d} ms"


def render_summary(lighthouse_reports: list[dict[str, Any]], axe_reports: list[dict[str, Any]], errors: list[str]) -> str:
    lines = [
        "## Disorder119 Performance & Accessibility Audit",
        "",
        "Quantitativer Chromium-Audit des normalen Shop-Flows. Match, Chaos und Baukasten bleiben durch ihre separaten Guard-/Browser-Tests geschützt.",
        "",
        "### Lighthouse",
        "",
        "| Fall | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for report in lighthouse_reports:
        s = report["scores"]
        m = report["metrics"]
        lines.append(
            f"| {report['name']} | {pct(s['performance'])} | {pct(s['accessibility'])} | {pct(s['best-practices'])} | {pct(s['seo'])} | {ms(m['largest-contentful-paint'])} | {m['cumulative-layout-shift']:.3f} | {ms(m['total-blocking-time'])} |"
        )

    lines += [
        "",
        "Zielwerte der nächsten Optimierungsrunde: **Performance ≥95**, **Accessibility ≥95**, **LCP ≤2.5 s**, **CLS ≤0.10**, **TBT ≤200 ms**. Die aktuellen Hard-Gates sind bewusst etwas toleranter, damit CI echte Regressionen blockiert ohne wegen normaler Lighthouse-Streuung instabil zu werden.",
        "",
        "### axe-core / WCAG 2.x",
        "",
        "| Kontext | Verstöße gesamt | Serious/Critical |",
        "|---|---:|---:|",
    ]
    for report in axe_reports:
        lines.append(f"| {report['context']} | {report['violation_count']} | {report['blocking_count']} |")

    all_rules: dict[tuple[str, str], int] = {}
    for report in axe_reports:
        for violation in report.get("violations", []):
            key = (str(violation.get("id") or "unknown"), str(violation.get("impact") or "unknown"))
            all_rules[key] = all_rules.get(key, 0) + 1
    if all_rules:
        lines += ["", "Gefundene Regeln (Kontextanzahl):"]
        for (rule_id, impact), count in sorted(all_rules.items(), key=lambda pair: (pair[0][1], pair[0][0])):
            lines.append(f"- `{rule_id}` — {impact}: {count}")
    else:
        lines += ["", "Keine axe-core-Verstöße in den geprüften normalen Shop-Kontexten."]

    lines += ["", "### Gate", ""]
    if errors:
        lines.append("**FAILED**")
        lines.extend(f"- {error}" for error in errors)
    else:
        lines.append("**PASSED** — keine Hard-Budget- oder serious/critical-WCAG-Regression.")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    product_path = representative_product_path()
    lighthouse_reports: list[dict[str, Any]] = []
    axe_reports: list[dict[str, Any]] = []
    fatal_errors: list[str] = []

    try:
        axe_reports = audit_accessibility(product_path)
    except Exception as exc:  # Ensure CI still gets a useful summary/artifact.
        fatal_errors.append(f"axe audit crashed: {exc}")

    for case in LIGHTHOUSE_CASES:
        try:
            lighthouse_reports.append(run_lighthouse(case, product_path))
        except Exception as exc:
            fatal_errors.append(f"Lighthouse {case['name']} crashed: {exc}")

    errors = fatal_errors + evaluate(lighthouse_reports, axe_reports)
    summary = render_summary(lighthouse_reports, axe_reports, errors)
    summary_data = {
        "base_url": BASE_URL,
        "product_path": product_path,
        "lighthouse": lighthouse_reports,
        "axe": axe_reports,
        "errors": errors,
        "passed": not errors,
    }
    (REPORT_DIR / "summary.json").write_text(json.dumps(summary_data, ensure_ascii=False, indent=2), encoding="utf-8")
    (REPORT_DIR / "summary.md").write_text(summary, encoding="utf-8")
    print(summary)
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
