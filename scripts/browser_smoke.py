#!/usr/bin/env python3
"""Real Chromium smoke tests for the built Disorder119 shop.

Run against a local HTTP server after build/injection. The purpose is not to
replace unit/regression tests; it catches integration failures that only exist in
a real browser: async catalog rendering, native selects, mobile overflow/focus,
language routes, product -> cart, and product -> Rental V2 deep links.
"""
from __future__ import annotations

import os
import re
import time
from datetime import date
from urllib.parse import urljoin, urlparse

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver import ChromeOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

BASE_URL = os.environ.get("D119_SMOKE_URL", "http://127.0.0.1:4173").rstrip("/") + "/"
WAIT = 12


def fail(message: str) -> None:
    raise AssertionError(message)


def options() -> ChromeOptions:
    opts = ChromeOptions()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return opts


def wait(driver, condition, label: str):
    try:
        return WebDriverWait(driver, WAIT).until(condition)
    except TimeoutException as exc:
        raise AssertionError(f"Timeout: {label} @ {driver.current_url}") from exc


def wait_cards(driver, minimum: int = 1):
    return wait(driver, lambda d: d.find_elements(By.CSS_SELECTOR, "#grid .plate") if len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= minimum else False, f"mindestens {minimum} Produktkarten")


def assert_no_horizontal_overflow(driver, label: str) -> None:
    overflow = driver.execute_script(
        "return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth;"
    )
    if overflow > 2:
        fail(f"{label}: horizontales Overflow von {overflow}px")


def assert_no_zero_options(driver) -> None:
    ids = ["filterDepartment", "filterBrand", "filterSize", "filterColor", "filterCondition"]
    for element_id in ids:
        select = driver.find_element(By.ID, element_id)
        values = [opt.text.strip() for opt in select.find_elements(By.TAG_NAME, "option")]
        zero = [value for value in values[1:] if re.search(r"\(0\)\s*$", value)]
        if zero:
            fail(f"#{element_id} zeigt Null-Treffer-Optionen: {zero[:5]}")


def assert_no_js_exceptions(driver, label: str) -> None:
    bad = []
    try:
        for entry in driver.get_log("browser"):
            # Resource/network errors on a local static server are handled by the
            # dedicated local-link validator. Here we care about uncaught JS.
            if entry.get("level") == "SEVERE" and entry.get("source") == "javascript":
                bad.append(entry.get("message", ""))
    except Exception:
        return
    if bad:
        fail(f"{label}: JavaScript-Fehler: {bad[:3]}")


def visible_text(driver) -> str:
    return driver.find_element(By.TAG_NAME, "body").text


def test_responsive_catalog(driver) -> None:
    viewports = [(320, 760), (360, 800), (375, 812), (390, 844), (430, 900), (768, 1024), (1024, 768), (1440, 900)]
    for width, height in viewports:
        driver.set_window_size(width, height)
        driver.get(BASE_URL)
        wait_cards(driver, 3)
        assert_no_horizontal_overflow(driver, f"Archiv {width}x{height}")
        assert_no_zero_options(driver)
        first = driver.find_element(By.CSS_SELECTOR, "#grid .plate")
        if not first.find_elements(By.CSS_SELECTOR, ".plate__brand") or not first.find_elements(By.CSS_SELECTOR, ".plate__title") or not first.find_elements(By.CSS_SELECTOR, ".plate__price"):
            fail(f"Archiv {width}x{height}: Produktkarten-Hierarchie unvollstaendig")
        if "Art.-Nr." in first.text or "Article no." in first.text:
            fail(f"Archiv {width}x{height}: interne Artikelnummer auf Produktkarte sichtbar")
        assert_no_js_exceptions(driver, f"Archiv {width}x{height}")


def test_search_and_mobile_filter(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(BASE_URL)
    wait_cards(driver, 3)
    search = driver.find_element(By.ID, "searchInput")
    search.clear()
    search.send_keys("Comme des Garcons")
    wait(driver, lambda d: any("Comme des Gar" in el.text for el in d.find_elements(By.CSS_SELECTOR, "#grid .plate")), "akzenttolerante Comme-des-Garcons-Suche")

    search.clear()
    search.send_keys("Y3")
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) > 0, "Y3/Y-3-Suche")
    search.clear()
    search.send_keys(Keys.ENTER)
    wait_cards(driver, 3)

    toggle = driver.find_element(By.ID, "moreFiltersToggle")
    toggle.click()
    panel = driver.find_element(By.ID, "filterPanel")
    wait(driver, lambda d: panel.is_displayed(), "mobiler Filter-Drawer offen")
    if panel.get_attribute("role") != "dialog" or panel.get_attribute("aria-modal") != "true":
        fail("Mobiler Filter-Drawer hat keine echte Dialog-Semantik")
    backdrop = driver.find_element(By.ID, "d119CompactFilterDrawerBackdrop")
    if not backdrop.is_displayed():
        fail("Mobiler Filter-Drawer hat keinen sichtbaren Backdrop")
    wait(driver, lambda d: "d119-filter-drawer__close" in (d.switch_to.active_element.get_attribute("class") or ""), "Fokus im Filter-Drawer")

    Select(driver.find_element(By.ID, "filterDepartment")).select_by_value("Men")
    wait(driver, lambda d: not any(re.search(r"\(0\)\s*$", opt.text.strip()) for opt in d.find_element(By.ID, "filterBrand").find_elements(By.TAG_NAME, "option")[1:]), "Null-Treffer nach Bereichswechsel entfernt")
    assert_no_zero_options(driver)

    driver.switch_to.active_element.send_keys(Keys.ESCAPE)
    wait(driver, lambda d: not panel.is_displayed(), "Escape schliesst Filter-Drawer")
    if driver.switch_to.active_element.get_attribute("id") != "moreFiltersToggle":
        fail("Filter-Drawer gibt Fokus nicht an den ausloesenden Button zurueck")
    assert_no_horizontal_overflow(driver, "Mobiler Filter")
    assert_no_js_exceptions(driver, "Suche/Mobile Filter")


def test_language_routes(driver) -> None:
    for path, lang, expected in [("en/", "en", "Filters"), ("fr/", "fr", "Filtres")]:
        driver.set_window_size(1280, 900)
        driver.get(urljoin(BASE_URL, path))
        wait_cards(driver, 3)
        if driver.find_element(By.TAG_NAME, "html").get_attribute("lang") != lang:
            fail(f"/{path}: HTML-Sprache ist nicht {lang}")
        toggle = driver.find_element(By.ID, "moreFiltersToggle")
        if expected not in toggle.text:
            fail(f"/{path}: Filter-UI nicht lokalisiert ({toggle.text!r})")
        assert_no_horizontal_overflow(driver, f"/{path}")
        assert_no_js_exceptions(driver, f"/{path}")


def test_product_cart_and_rental(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(BASE_URL)
    cards = wait_cards(driver, 3)
    first = cards[0]
    href = first.get_attribute("href")
    title = first.find_element(By.CSS_SELECTOR, ".plate__title").text.strip()
    if not href or "/artikel/" not in href:
        fail("Produktkarte besitzt keine echte Produkt-URL")
    item_match = re.search(r"/artikel/(\d+)/", urlparse(href).path)
    if not item_match:
        fail(f"Produkt-ID nicht aus URL lesbar: {href}")
    item_id = int(item_match.group(1))

    driver.get(href)
    wait(driver, EC.presence_of_element_located((By.CSS_SELECTOR, ".product .info h1")), "Produktdetail")
    if driver.find_element(By.CSS_SELECTOR, ".product .info h1").text.strip() != title:
        fail("Produktkarten-Titel und Produktdetail-Titel widersprechen sich")
    if "Art.-Nr." in visible_text(driver):
        fail("Produktdetail zeigt interne Artikelnummer sichtbar")
    assert_no_horizontal_overflow(driver, "Produktdetail mobile")

    add = driver.find_element(By.ID, "addToCartBtn")
    add.click()
    wait(driver, lambda d: str(item_id) in (d.execute_script("return localStorage.getItem('disorder119_cart') || ''")), "Artikel im Warenkorb-LocalStorage")
    driver.get(urljoin(BASE_URL, "cart/"))
    wait(driver, EC.presence_of_element_located((By.CSS_SELECTOR, "#cartBody .cart-line")), "Warenkorbzeile")
    if title not in visible_text(driver):
        fail("Warenkorb verliert den ausgewaehlten Artikel")
    if "0,00 €" in driver.find_element(By.ID, "cartBody").text and "Auf Anfrage" in driver.find_element(By.ID, "cartBody").text:
        fail("Warenkorb mischt Preis-auf-Anfrage mit 0,00 EUR")
    assert_no_horizontal_overflow(driver, "Warenkorb mobile")

    # Product-detail deep link must land in the one canonical Rental V2 flow.
    driver.get(href)
    rental_link = driver.find_element(By.CSS_SELECTOR, ".btn--rental")
    rental_link.click()
    wait(driver, lambda d: "/mieten/" in d.current_url, "Produkt -> Mieten Navigation")
    backdrop = wait(driver, EC.presence_of_element_located((By.ID, "d119RentalV2Backdrop")), "Rental V2 Backdrop")
    wait(driver, lambda d: "open" in (backdrop.get_attribute("class") or ""), "Rental V2 automatisch offen")
    if not backdrop.is_displayed():
        fail("Rental V2 ist nach Produkt-Deep-Link nicht sichtbar")
    body = driver.find_element(By.ID, "d119RentalV2Body").text
    if title not in body:
        fail("Rental V2 hat den Produkt-Deep-Link nicht in die Mietauswahl uebernommen")
    if "Art.-Nr." in body:
        fail("Rental V2 zeigt interne Artikelnummer sichtbar")
    start = driver.find_element(By.ID, "d119RentalStart")
    if not start.get_attribute("min") or start.get_attribute("min") < date.today().isoformat():
        fail("Rental V2 erlaubt einen Mietstart vor heute")
    assert_no_horizontal_overflow(driver, "Rental V2 mobile")
    assert_no_js_exceptions(driver, "Produkt/Warenkorb/Rental")


def main() -> None:
    driver = webdriver.Chrome(options=options())
    driver.set_page_load_timeout(20)
    try:
        test_responsive_catalog(driver)
        test_search_and_mobile_filter(driver)
        test_language_routes(driver)
        test_product_cart_and_rental(driver)
        print("Browser-Smoke: OK — responsive Archiv, Suche, iOS-sicherer Filter, DE/EN/FR, Produkt, Warenkorb und Rental V2 in echtem Chromium getestet.")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
