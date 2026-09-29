#!/usr/bin/env python3
"""Real-browser regression coverage for Disorder119's protected creative modes."""
from __future__ import annotations

from urllib.parse import urljoin, urlparse

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from browser_smoke import (
    BASE_URL,
    assert_no_horizontal_overflow,
    assert_no_js_exceptions,
    dismiss_cookie_note,
    new_driver,
    wait,
)


def fail(message: str) -> None:
    raise AssertionError(message)


def assert_active_mode(driver, mode: str) -> None:
    rail = driver.find_element(By.ID, "modeRail")
    if not rail.is_displayed():
        fail(f"{mode}: Mode-Rail ist nicht sichtbar")
    button = rail.find_element(By.CSS_SELECTOR, f'[data-mode-view="{mode}"]')
    if button.get_attribute("aria-current") != "true":
        fail(f"{mode}: aktiver Modus ist im Mode-Rail nicht ausgezeichnet")


def assert_mode_links(driver, prefix: str = "/") -> None:
    expected = {
        "swipe": prefix + "match/",
        "chaos": prefix + "chaos/",
        "outfit": prefix + "baukasten/",
    }
    for mode, path in expected.items():
        href = driver.find_element(By.CSS_SELECTOR, f'#modeRail [data-mode-view="{mode}"]').get_attribute("href")
        if not href or urlparse(href).path != path:
            fail(f"{mode}: Mode-Link zeigt auf {href!r} statt {path!r}")


def test_match(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "match/"))
    wait(driver, lambda d: d.find_element(By.ID, "swipeView").is_displayed(), "Match sichtbar")
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#swipeStage .swipe-card")) == 1, "Match-Karte")
    dismiss_cookie_note(driver)

    if driver.find_element(By.ID, "appShell").is_displayed():
        fail("Match: Archiv-Shell ist gleichzeitig sichtbar")
    assert_active_mode(driver, "swipe")
    assert_mode_links(driver)

    progress = driver.find_element(By.ID, "swipeProgress").text.strip()
    title = driver.find_element(By.CSS_SELECTOR, "#swipeStage .swipe-card__title").text.strip()
    driver.find_element(By.ID, "swipeNope").click()
    wait(
        driver,
        lambda d: (
            d.find_element(By.ID, "swipeProgress").text.strip() != progress
            or d.find_element(By.CSS_SELECTOR, "#swipeStage .swipe-card__title").text.strip() != title
        ),
        "Match reagiert auf Nope",
    )
    if urlparse(driver.current_url).path != "/match/":
        fail("Match: Interaktion veraendert unerwartet die Route")
    assert_no_horizontal_overflow(driver, "Match mobile")
    assert_no_js_exceptions(driver, "Match")


def test_chaos(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "chaos/"))
    wait(driver, lambda d: urlparse(d.current_url).path == "/universe/", "Chaos-Weiterleitung")
    wait(driver, lambda d: "Universum bereit" in (d.find_element(By.ID, "uStatus").get_attribute("textContent") or ""), "Universum bereit")
    canvas = driver.find_element(By.ID, "uCanvas")
    if not canvas.is_displayed() or canvas.size["width"] < 1 or canvas.size["height"] < 1:
        fail("Universum: Canvas ist nicht sichtbar")
    if not driver.find_elements(By.CSS_SELECTOR, '.u-mode[aria-current="page"][href="/universe/"]'):
        fail("Universum: aktive Navigation fehlt")
    if driver.find_elements(By.CSS_SELECTOR, "[data-d119-game-launch], #d119SecretGames"):
        fail("Universum: alter Game-Einstieg ist noch sichtbar")
    driver.find_element(By.ID, "uShuffle").click()
    if urlparse(driver.current_url).path != "/universe/":
        fail("Universum: Mischen veraendert unerwartet die Route")
    assert_no_horizontal_overflow(driver, "Universum mobile")
    assert_no_js_exceptions(driver, "Universum mobile")

    driver.set_window_size(1280, 800)
    driver.get(urljoin(BASE_URL, "universe/"))
    wait(driver, lambda d: "Universum bereit" in (d.find_element(By.ID, "uStatus").get_attribute("textContent") or ""), "Universum Desktop bereit")
    canvas = driver.find_element(By.ID, "uCanvas")
    sky_label = canvas.get_attribute("aria-label") or ""
    if "Maus bewegen" not in sky_label or "Doppelklick" not in sky_label:
        fail(f"Universum Desktop: neue Steuerungsbeschreibung fehlt: {sky_label!r}")
    canvas.send_keys(Keys.ARROW_RIGHT)
    assert_no_horizontal_overflow(driver, "Universum Desktop")
    assert_no_js_exceptions(driver, "Universum Desktop")

    driver.get(urljoin(BASE_URL, "chaos/?game=zero"))
    wait(driver, lambda d: urlparse(d.current_url).path == "/universe/", "Alter Game-Link leitet ins Universum")
    if driver.find_elements(By.CSS_SELECTOR, "#d119SecretGames"):
        fail("Universum: alter Game-Overlay ist wieder vorhanden")


def test_baukasten(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "baukasten/"))
    wait(driver, lambda d: d.find_element(By.ID, "outfitView").is_displayed(), "Baukasten sichtbar")
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#outfitStack .outfit-slot")) == 5, "Baukasten-Slots")
    dismiss_cookie_note(driver)

    if driver.find_element(By.ID, "appShell").is_displayed():
        fail("Baukasten: Archiv-Shell ist gleichzeitig sichtbar")
    assert_active_mode(driver, "outfit")
    assert_mode_links(driver)

    first = driver.find_element(By.CSS_SELECTOR, "#outfitStack .outfit-slot")
    if first.get_attribute("role") != "button" or first.get_attribute("tabindex") != "0":
        fail("Baukasten: Outfit-Slot ist nicht tastaturbedienbar")
    first.click()
    picker = driver.find_element(By.ID, "outfitPicker")
    wait(driver, lambda d: "open" in (picker.get_attribute("class") or ""), "Baukasten-Picker offen")
    if picker.get_attribute("role") != "dialog" or picker.get_attribute("aria-modal") != "true":
        fail("Baukasten: Picker besitzt keine Dialog-Semantik")
    driver.find_element(By.ID, "outfitPickerClose").click()
    wait(driver, lambda d: "open" not in (picker.get_attribute("class") or ""), "Baukasten-Picker geschlossen")

    first = driver.find_element(By.CSS_SELECTOR, "#outfitStack .outfit-slot")
    first.send_keys(Keys.ENTER)
    wait(driver, lambda d: "open" in (picker.get_attribute("class") or ""), "Baukasten-Picker per Enter offen")
    driver.find_element(By.ID, "outfitPickerClose").click()
    wait(driver, lambda d: "open" not in (picker.get_attribute("class") or ""), "Baukasten-Picker nach Keyboard-Test geschlossen")

    if urlparse(driver.current_url).path != "/baukasten/":
        fail("Baukasten: Picker-Interaktion veraendert unerwartet die Route")
    assert_no_horizontal_overflow(driver, "Baukasten mobile")
    assert_no_js_exceptions(driver, "Baukasten")


def test_localized_direct_routes(driver) -> None:
    checks = [
        ("en/match/", "en", "swipe", "/en/"),
        ("fr/chaos/", "fr", "universe", "/fr/"),
        ("en/baukasten/", "en", "outfit", "/en/"),
    ]
    driver.set_window_size(1024, 768)
    for path, lang, mode, prefix in checks:
        driver.get(urljoin(BASE_URL, path))
        if mode == "universe":
            wait(driver, lambda d: urlparse(d.current_url).path == "/fr/universe/", "FR-Universum-Weiterleitung")
            wait(driver, lambda d: "Univers prêt" in (d.find_element(By.ID, "uStatus").get_attribute("textContent") or ""), "FR-Universum bereit")
            if not driver.find_element(By.ID, "uCanvas").is_displayed():
                fail("FR-Universum: Canvas ist nicht sichtbar")
            if not driver.find_elements(By.CSS_SELECTOR, '.u-mode[aria-current="page"][href="/fr/universe/"]'):
                fail("FR-Universum: aktive Navigation fehlt")
            if driver.find_element(By.TAG_NAME, "html").get_attribute("lang") != lang:
                fail("FR-Universum: HTML-Sprache ist nicht fr")
            assert_no_horizontal_overflow(driver, f"/{path}")
            assert_no_js_exceptions(driver, f"/{path}")
            continue
        target_id = {"swipe": "swipeView", "chaos": "chaosView", "outfit": "outfitView"}[mode]
        wait(driver, lambda d, target_id=target_id: d.find_element(By.ID, target_id).is_displayed(), f"/{path} Modus sichtbar")
        dismiss_cookie_note(driver)
        if driver.find_element(By.TAG_NAME, "html").get_attribute("lang") != lang:
            fail(f"/{path}: HTML-Sprache ist nicht {lang}")
        assert_active_mode(driver, mode)
        assert_mode_links(driver, prefix)
        assert_no_horizontal_overflow(driver, f"/{path}")
        assert_no_js_exceptions(driver, f"/{path}")


def run_case(test_fn) -> None:
    driver = new_driver()
    try:
        test_fn(driver)
    finally:
        driver.quit()


def main() -> None:
    for test_fn in (test_match, test_chaos, test_baukasten, test_localized_direct_routes):
        run_case(test_fn)
    print("Protected-Mode Browser-Smoke: OK — Match, Universum inklusive alter Weiterleitungen und Baukasten in echtem Chromium getestet.")


if __name__ == "__main__":
    main()
