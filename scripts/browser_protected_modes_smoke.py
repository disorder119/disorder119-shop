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
    # /chaos/ stays the technical route; the user-facing mode is Universe.
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
    universe_label = (universe_button.find_element(By.CSS_SELECTOR, ".mode-rail__label").get_attribute("textContent") or "").strip()
    if universe_label != "Universum-Modus":
        fail(f"Universum: Moduslabel ist {universe_label!r} statt 'Universum-Modus'")
    if not universe_button.find_elements(By.CSS_SELECTOR, ".mode-rail__icon svg"):
        fail("Universum: Planet-/Orbit-Icon fehlt")

    before = len(driver.find_elements(By.CSS_SELECTOR, "#chaosItems > *"))
    driver.find_element(By.ID, "chaosShuffle").click()
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#chaosItems > *")) >= 8, "Universum nach Neu mischen")
    after = len(driver.find_elements(By.CSS_SELECTOR, "#chaosItems > *"))
    if before < 8 or after < 8:
        fail(f"Universum: zu wenige Objekte vor/nach Shuffle ({before}/{after})")

    wait(driver, lambda d: d.execute_script("return !!window.D119SecretGames"), "Dodge-the-Drop-System geladen")
    version = driver.execute_script("return window.D119SecretGames && window.D119SecretGames.version")
    if version != "dodge-the-drop-v1":
        fail(f"Universum: falsche Game-Version {version!r}")

    if driver.find_elements(By.CSS_SELECTOR, ".universe-shooting-star, .d119-warp-control, #universeTurbo, .d119-secret-relic"):
        fail("Universum: alter sichtbarer Game-Einstieg ist wieder vorhanden")
    if not driver.find_elements(By.CSS_SELECTOR, "[data-d119-game-launch]"):
        fail("Universum: sichtbarer GAME-Launcher fehlt")
    if not driver.find_element(By.ID, "d119SecretGames").get_attribute("hidden"):
        fail("Universum: Game-Overlay ist ohne Start sichtbar")

    # Regression for the iPhone screenshot: Universe visuals must not create
    # Safari's blue text/image selection handles while the user drags.
    user_select = driver.find_element(By.ID, "chaosScreen").value_of_css_property("user-select")
    if user_select != "none":
        fail(f"Universum: user-select ist {user_select!r} statt none")
    selection_blocked = driver.execute_script(
        "var n=document.querySelector('#chaosItems')||document.querySelector('#chaosScreen');"
        "var e=new Event('selectstart',{bubbles:true,cancelable:true});"
        "n.dispatchEvent(e); return e.defaultPrevented;"
    )
    if not selection_blocked:
        fail("Universum: selectstart wird nicht blockiert")

    # Desktop regression. Headless Chrome can report a coarse pointer even at
    # desktop width, so the dynamic visual hint may intentionally stay on its
    # touch copy. The canvas aria-label is device-independent and must expose
    # the new desktop controls. We still execute real mouse/right-click events.
    driver.set_window_size(1280, 800)
    driver.get(urljoin(BASE_URL, "chaos/"))
    wait(driver, lambda d: d.find_element(By.ID, "chaosView").is_displayed(), "Universum Desktop sichtbar")
    dismiss_cookie_note(driver)
    sky_label = driver.find_element(By.ID, "chaosSky").get_attribute("aria-label") or ""
    if "Maus bewegen" not in sky_label or "Doppelklick" not in sky_label:
        fail(f"Universum Desktop: neue Steuerungsbeschreibung fehlt: {sky_label!r}")
    driver.execute_script(
        "var c=document.getElementById('chaosSky'); var r=c.getBoundingClientRect();"
        "c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:r.left+r.width*.82,clientY:r.top+r.height*.38,pointerId:41,pointerType:'mouse',buttons:0}));"
        "c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:r.left+r.width*.5,clientY:r.top+r.height*.5,pointerId:42,pointerType:'mouse',button:2,buttons:2}));"
        "c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,clientX:r.left+r.width*.5,clientY:r.top+r.height*.5,pointerId:42,pointerType:'mouse',button:2,buttons:0}));"
    )
    if driver.find_elements(By.CSS_SELECTOR, ".modal-backdrop.open"):
        fail("Universum Desktop: Rechtsklick hat einen Artikel geöffnet")
    assert_no_js_exceptions(driver, "Universum Desktop Mouse-Look")

    # Direct link is deterministic CI only. It must now enter the clothing
    # dodge game; old ?game=raid links are backwards-compatible aliases.
    driver.get(urljoin(BASE_URL, "chaos/?game=dodge"))
    wait(driver, lambda d: d.execute_script("return !!window.D119SecretGames"), "Dodge the Drop am Direktlink geladen")
    wait(
        driver,
        lambda d: d.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-view='gate']").is_displayed(),
        "Dodge-the-Drop-Startscreen sichtbar",
    )
    driver.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-action='start']").click()
    wait(
        driver,
        lambda d: d.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-view='stage']").is_displayed(),
        "Dodge the Drop startet",
    )
    canvas = driver.find_element(By.CSS_SELECTOR, ".d119-dodge-canvas")
    if not canvas.is_displayed():
        fail("Universum: Dodge-the-Drop-Canvas ist nicht sichtbar")
    if canvas.value_of_css_property("touch-action") != "none":
        fail("Universum: Dodge-Canvas besitzt touch-action:none nicht")

    rect = canvas.rect
    cx = rect["x"] + rect["width"] * 0.23
    cy = rect["y"] + rect["height"] * 0.76
    # Mouse movement must steer without pointerdown/click. Then exercise the
    # touch path as well; neither is allowed to throw a browser exception.
    driver.execute_script(
        "var c=document.querySelector('.d119-dodge-canvas');"
        "c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:arguments[0],clientY:arguments[1],pointerId:71,pointerType:'mouse',buttons:0}));"
        "c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:arguments[0]+25,clientY:arguments[1]-35,pointerId:72,pointerType:'touch'}));"
        "c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:arguments[0]+55,clientY:arguments[1]-55,pointerId:72,pointerType:'touch'}));",
        cx,
        cy,
    )
    wait(
        driver,
        lambda d: int(d.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-hud='time']").text or "42") < 42,
        "Dodge the Drop laeuft",
    )
    assert_no_horizontal_overflow(driver, "Universum Dodge the Drop")
    assert_no_js_exceptions(driver, "Universum Dodge the Drop")


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
    print("Protected-Mode Browser-Smoke: OK — Match, Universe Desktop-Mouse-Look, Dodge the Drop + iOS selection guard und Baukasten in echtem Chromium getestet.")


if __name__ == "__main__":
    main()
