#!/usr/bin/env python3
"""Real-browser regression coverage for Disorder119's protected creative modes.

This suite is deliberately test-only. It does not patch Match, Universe or
Baukasten and never touches config/mode-guard.json. The existing mode guard
protects source-level identity; these checks add runtime proof that all three
protected modes still render and respond in a real Chromium session. Universe
also verifies that the new games stay hidden during normal browsing, direct
game links work, and mobile VOID RUN actually counts collected merchandise.
"""
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
    # /chaos/ remains the stable technical route for backwards compatibility;
    # the user-facing mode is Universe Mode / Universum-Modus.
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "chaos/"))
    wait(driver, lambda d: d.find_element(By.ID, "chaosView").is_displayed(), "Universum sichtbar")
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#chaosItems > *")) >= 8, "Universum-Objekte")
    dismiss_cookie_note(driver)

    if driver.find_element(By.ID, "appShell").is_displayed():
        fail("Universum: Archiv-Shell ist gleichzeitig sichtbar")
    assert_active_mode(driver, "chaos")
    assert_mode_links(driver)

    universe_button = driver.find_element(By.CSS_SELECTOR, '#modeRail [data-mode-view="chaos"]')
    universe_label_el = universe_button.find_element(By.CSS_SELECTOR, ".mode-rail__label")
    universe_label = (universe_label_el.get_attribute("textContent") or "").strip()
    if universe_label != "Universum-Modus":
        fail(f"Universum: Moduslabel ist {universe_label!r} statt 'Universum-Modus'")
    if not universe_button.find_elements(By.CSS_SELECTOR, ".mode-rail__icon svg"):
        fail("Universum: neues Planet-/Orbit-Icon fehlt")

    before = len(driver.find_elements(By.CSS_SELECTOR, "#chaosItems > *"))
    driver.find_element(By.ID, "chaosShuffle").click()
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#chaosItems > *")) >= 8, "Universum nach Neu mischen")
    after = len(driver.find_elements(By.CSS_SELECTOR, "#chaosItems > *"))
    if before < 8 or after < 8:
        fail(f"Universum: zu wenige Objekte vor/nach Shuffle ({before}/{after})")
    if urlparse(driver.current_url).path != "/chaos/":
        fail("Universum: Neu mischen veraendert unerwartet die Route")

    # Games are now Easter eggs, not a permanent shop control. The normal
    # Universe must not show the old Warp/Turbo affordances at all.
    wait(driver, lambda d: d.execute_script("return !!window.D119SecretGames"), "Secret-Game-System geladen")
    if driver.find_elements(By.CSS_SELECTOR, ".universe-shooting-star, .d119-warp-control, #universeTurbo"):
        fail("Universum: alter sichtbarer Warp-/Turbo-Einstieg ist wieder vorhanden")
    if not driver.find_element(By.ID, "d119SecretGames").get_attribute("hidden"):
        fail("Universum: Secret-Game-Hub ist ohne Entdeckung sichtbar")

    # Persist a legitimate nickname and exercise the explicit deep link. This
    # makes the otherwise rare Easter egg deterministic in CI without making
    # it common for real visitors.
    driver.execute_script("localStorage.setItem('d119_secret_player','CI_PLAYER')")
    driver.get(urljoin(BASE_URL, "chaos/?game=warp"))
    wait(driver, lambda d: d.execute_script("return !!window.D119SecretGames"), "Secret-Game-System am Direktlink geladen")
    wait(
        driver,
        lambda d: d.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-view='stage']").is_displayed(),
        "VOID RUN startet ueber Direktlink",
    )
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, ".d119-warp-item")) > 0, "VOID RUN Produkt erscheint")

    # Regression for the reported phone bug: target the centre of a rendered
    # merchandise sprite with a pointer move and require the Warenwert/SCORE to
    # leave zero. Using the actual DOM rectangle makes this robust to random
    # trajectories and proves the mobile collision path rather than a helper.
    def aim_at_live_item(d):
        items = [el for el in d.find_elements(By.CSS_SELECTOR, ".d119-warp-item") if el.is_displayed()]
        if not items:
            return False
        rect = items[0].rect
        x = rect["x"] + rect["width"] / 2
        y = rect["y"] + rect["height"] / 2
        d.execute_script(
            "var f=document.querySelector('.d119-warp-field');"
            "f.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:arguments[0],clientY:arguments[1],pointerId:7,pointerType:'touch'}));",
            x,
            y,
        )
        return True

    wait(driver, aim_at_live_item, "VOID RUN Ziel anvisierbar")
    wait(
        driver,
        lambda d: (d.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-hud='score']").text.strip() not in ("", "0 €")),
        "mobiler Warenwert steigt nach Treffer",
    )

    # The field itself owns touch interaction so Safari cannot steal the drag
    # gesture for page scrolling/zooming while the game is active.
    field = driver.find_element(By.CSS_SELECTOR, ".d119-warp-field")
    if field.value_of_css_property("touch-action") != "none":
        fail("Universum: VOID RUN Spielfeld ist nicht fuer Touch-Eingabe abgesichert")

    assert_no_horizontal_overflow(driver, "Universum mobile Secret-Game")
    assert_no_js_exceptions(driver, "Universum")


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

    # Keyboard path is protected too: Enter on a slot must reopen the picker.
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
        ("fr/chaos/", "fr", "chaos", "/fr/"),
        ("en/baukasten/", "en", "outfit", "/en/"),
    ]
    driver.set_window_size(1024, 768)
    for path, lang, mode, prefix in checks:
        driver.get(urljoin(BASE_URL, path))
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
    print("Protected-Mode Browser-Smoke: OK — Match, versteckte Universe-Games inkl. mobilem Warenwert und Baukasten in echtem Chromium getestet.")


if __name__ == "__main__":
    main()
