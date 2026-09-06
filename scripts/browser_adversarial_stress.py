#!/usr/bin/env python3
"""Adversarial real-browser stress checks for Disorder119.

This suite is intentionally test-only. It does not patch the protected Match,
Chaos or Baukasten source and never touches config/mode-guard.json. It extends
the existing Chromium smoke suite with repeated transitions, browser history,
modal cleanup, corrupt localStorage, resize/orientation stress, rapid input and
coarse performance budgets.
"""
from __future__ import annotations

import time
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


def visible(driver, element_id: str) -> bool:
    return driver.find_element(By.ID, element_id).is_displayed()


def assert_single_mode_view(driver, expected: str) -> None:
    ids = {"classic": "appShell", "swipe": "swipeView", "chaos": "chaosView", "outfit": "outfitView"}
    visible_modes = [mode for mode, element_id in ids.items() if visible(driver, element_id)]
    if visible_modes != [expected]:
        fail(f"Mode-State inkonsistent: erwartet {expected}, sichtbar {visible_modes}")
    if "open" in (driver.find_element(By.ID, "outfitPicker").get_attribute("class") or ""):
        fail(f"{expected}: geschlossener Baukasten-Picker blieb offen")
    if "open" in (driver.find_element(By.ID, "modalBackdrop").get_attribute("class") or ""):
        fail(f"{expected}: Quickview-Backdrop blieb offen")
    if driver.execute_script("return document.body.style.overflow || ''"):
        fail(f"{expected}: Body-Scroll-Lock blieb ohne offenes Modal aktiv")


def click_mode(driver, mode: str, path: str) -> None:
    if mode == "classic":
        candidates = driver.find_elements(By.CSS_SELECTOR, "[data-enter-classic]")
        trigger = next((el for el in candidates if el.is_displayed()), None)
        if trigger is None:
            fail("Kein sichtbarer Archiv-Zurueck-Link im aktiven Modus")
        trigger.click()
    else:
        driver.find_element(By.CSS_SELECTOR, f'#modeRail [data-mode-view="{mode}"]').click()
    wait(driver, lambda d: urlparse(d.current_url).path == path, f"Mode-Route {path}")
    expected = {"swipe": "swipe", "chaos": "chaos", "outfit": "outfit", "classic": "classic"}[mode]
    wait(driver, lambda d: visible(d, {"classic": "appShell", "swipe": "swipeView", "chaos": "chaosView", "outfit": "outfitView"}[expected]), f"Mode {expected} sichtbar")
    assert_single_mode_view(driver, expected)


def install_listener_tracker(driver) -> None:
    script = r'''
      (() => {
        const originalAdd = EventTarget.prototype.addEventListener;
        const originalRemove = EventTarget.prototype.removeEventListener;
        const registry = new WeakMap();
        const counts = Object.create(null);
        function bucket(target, type) {
          let byType = registry.get(target);
          if (!byType) { byType = new Map(); registry.set(target, byType); }
          let set = byType.get(type);
          if (!set) { set = new Set(); byType.set(type, set); }
          return set;
        }
        function tracked(target) { return target === window || target === document; }
        EventTarget.prototype.addEventListener = function(type, listener, options) {
          if (listener && tracked(this)) {
            const set = bucket(this, type);
            if (!set.has(listener)) { set.add(listener); counts[type] = (counts[type] || 0) + 1; }
          }
          return originalAdd.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function(type, listener, options) {
          if (listener && tracked(this)) {
            const set = bucket(this, type);
            if (set.has(listener)) { set.delete(listener); counts[type] = Math.max(0, (counts[type] || 0) - 1); }
          }
          return originalRemove.call(this, type, listener, options);
        };
        window.__d119ListenerCounts = counts;
      })();
    '''
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": script})


def test_repeated_modes_history_and_listener_cleanup(driver) -> None:
    install_listener_tracker(driver)
    driver.set_window_size(390, 844)
    driver.get(BASE_URL)
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 3, "Archiv geladen")
    dismiss_cookie_note(driver)
    assert_single_mode_view(driver, "classic")
    baseline = driver.execute_script("return Object.assign({}, window.__d119ListenerCounts || {})")

    for _ in range(5):
        click_mode(driver, "swipe", "/match/")
        click_mode(driver, "chaos", "/chaos/")
        click_mode(driver, "outfit", "/baukasten/")
        click_mode(driver, "classic", "/")

    time.sleep(0.25)
    after = driver.execute_script("return Object.assign({}, window.__d119ListenerCounts || {})")
    for event_type in ("mousemove", "deviceorientation"):
        if int(after.get(event_type, 0)) > int(baseline.get(event_type, 0)):
            fail(f"Globaler Listener-Leak nach wiederholten Moduswechseln: {event_type} {baseline.get(event_type, 0)} -> {after.get(event_type, 0)}")

    click_mode(driver, "swipe", "/match/")
    click_mode(driver, "chaos", "/chaos/")
    click_mode(driver, "outfit", "/baukasten/")
    driver.back()
    wait(driver, lambda d: urlparse(d.current_url).path == "/chaos/" and visible(d, "chaosView"), "Back -> Chaos")
    assert_single_mode_view(driver, "chaos")
    driver.back()
    wait(driver, lambda d: urlparse(d.current_url).path == "/match/" and visible(d, "swipeView"), "Back -> Match")
    assert_single_mode_view(driver, "swipe")
    driver.back()
    wait(driver, lambda d: urlparse(d.current_url).path == "/" and visible(d, "appShell"), "Back -> Archiv")
    assert_single_mode_view(driver, "classic")
    driver.forward()
    wait(driver, lambda d: urlparse(d.current_url).path == "/match/" and visible(d, "swipeView"), "Forward -> Match")
    assert_single_mode_view(driver, "swipe")
    assert_no_js_exceptions(driver, "Repeated Modes/History")


def test_baukasten_open_close_and_state_recovery(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "baukasten/"))
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#outfitStack .outfit-slot")) == 5, "Baukasten-Slots")
    dismiss_cookie_note(driver)
    picker = driver.find_element(By.ID, "outfitPicker")

    for _ in range(10):
        first = driver.find_element(By.CSS_SELECTOR, "#outfitStack .outfit-slot")
        first.send_keys(Keys.ENTER)
        wait(driver, lambda d: "open" in (picker.get_attribute("class") or ""), "Baukasten-Picker per Enter offen")
        wait(driver, lambda d: d.switch_to.active_element.get_attribute("id") == "outfitPickerSearch", "Fokus im Baukasten-Picker")
        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        wait(driver, lambda d: "open" not in (picker.get_attribute("class") or ""), "Baukasten-Picker per Escape geschlossen")
        if driver.switch_to.active_element.get_attribute("class") is None or "outfit-slot" not in (driver.switch_to.active_element.get_attribute("class") or ""):
            fail("Baukasten: Fokus wird nach Escape nicht an den Slot zurueckgegeben")

    # The visual mouse/touch listener is intentionally attached to the existing
    # frame/body child carrying data-slot; the row itself is the keyboard
    # alternative. Exercise the real pointer target instead of synthesising a
    # click on the keyboard-only row container.
    for _ in range(10):
        target = driver.find_element(By.CSS_SELECTOR, "#outfitStack .outfit-slot [data-slot]")
        driver.execute_script("arguments[0].click()", target)
        wait(driver, lambda d: "open" in (picker.get_attribute("class") or ""), "Baukasten-Picker per Maus offen")
        driver.find_element(By.ID, "outfitPickerClose").click()
        wait(driver, lambda d: "open" not in (picker.get_attribute("class") or ""), "Baukasten-Picker per Button geschlossen")

    driver.execute_script("localStorage.setItem('disorder119_outfit', '{not-json')")
    driver.refresh()
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#outfitStack .outfit-slot")) == 5, "Baukasten nach kaputtem LocalStorage")
    assert_no_js_exceptions(driver, "Baukasten corrupt localStorage")
    driver.execute_script("localStorage.setItem('disorder119_outfit', JSON.stringify({top:999999,jacket:999998,bottom:999997,shoes:999996,accessory:999995}))")
    driver.refresh()
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#outfitStack .outfit-slot")) == 5, "Baukasten nach stale IDs")
    if any("outfit-slot--empty" not in (el.get_attribute("class") or "") for el in driver.find_elements(By.CSS_SELECTOR, "#outfitStack .outfit-slot")):
        fail("Baukasten: unbekannte gespeicherte Produkt-IDs erzeugen Ghost Items")
    assert_no_horizontal_overflow(driver, "Baukasten Stress mobile")
    assert_no_js_exceptions(driver, "Baukasten Stress")


def assert_control_in_viewport(driver, element_id: str, label: str) -> None:
    ok = driver.execute_script(
        "const e=document.getElementById(arguments[0]); if(!e) return false; const r=e.getBoundingClientRect(); return r.width>0&&r.height>0&&r.left>=-2&&r.top>=-2&&r.right<=innerWidth+2&&r.bottom<=innerHeight+2;",
        element_id,
    )
    if not ok:
        fail(f"{label}: Control #{element_id} liegt ausserhalb des Viewports")


def test_chaos_resize_modal_cleanup_and_reduced_motion(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "chaos/"))
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#chaosItems .chaos-item")) >= 8, "Chaos geladen")
    dismiss_cookie_note(driver)

    for width, height in ((390, 844), (844, 390), (430, 932), (932, 430), (1024, 768), (1440, 900), (390, 844)):
        driver.set_window_size(width, height)
        driver.find_element(By.ID, "chaosShuffle").click()
        wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#chaosItems .chaos-item")) >= 8, f"Chaos nach Resize {width}x{height}")
        assert_control_in_viewport(driver, "chaosShuffle", f"Chaos {width}x{height}")
        assert_no_horizontal_overflow(driver, f"Chaos {width}x{height}")

    driver.set_window_size(390, 844)
    for i in range(10):
        item = driver.find_element(By.CSS_SELECTOR, "#chaosItems .chaos-item")
        driver.execute_script("arguments[0].click()", item)
        backdrop = driver.find_element(By.ID, "modalBackdrop")
        wait(driver, lambda d: "open" in (backdrop.get_attribute("class") or ""), f"Chaos Quickview {i+1} offen")
        driver.find_element(By.ID, "modalClose").click()
        wait(driver, lambda d: "open" not in (backdrop.get_attribute("class") or ""), f"Chaos Quickview {i+1} geschlossen")
        if driver.execute_script("return document.body.style.overflow || ''"):
            fail(f"Chaos Quickview {i+1}: Scroll Lock blieb aktiv")
        if urlparse(driver.current_url).path != "/chaos/":
            fail(f"Chaos Quickview {i+1}: Route wurde veraendert")

    assert_no_js_exceptions(driver, "Chaos Resize/Modal")

    driver.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "chaos/"))
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#chaosItems .chaos-item")) >= 8, "Chaos reduced-motion geladen")
    time.sleep(0.2)
    transform = driver.execute_script("return document.getElementById('chaosItems').style.transform || ''")
    if transform:
        fail(f"Chaos: prefers-reduced-motion wird auf Mobile nicht respektiert ({transform})")
    assert_no_js_exceptions(driver, "Chaos reduced-motion")


def test_rapid_match_and_storage_fallbacks(driver) -> None:
    driver.set_window_size(390, 844)
    driver.get(urljoin(BASE_URL, "match/"))
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#swipeStage .swipe-card")) == 1, "Match geladen")
    dismiss_cookie_note(driver)
    driver.execute_script("const b=document.getElementById('swipeNope'); for(let i=0;i<10;i++) b.click();")
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#swipeStage .swipe-card, #swipeStage .swipe-summary")) == 1, "Match nach Rapid Input stabil")
    if urlparse(driver.current_url).path != "/match/":
        fail("Match Rapid Input veraendert unerwartet die Route")
    assert_no_js_exceptions(driver, "Match Rapid Input")

    driver.get(BASE_URL)
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 3, "Archiv fuer Storage-Test")
    driver.execute_script("localStorage.setItem('disorder119_cart','{bad-json')")
    driver.refresh()
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 3, "Archiv nach kaputtem Cart-State")
    assert_no_js_exceptions(driver, "Cart corrupt localStorage")

    driver.execute_script("localStorage.setItem('d119_rental_cart_v2','{bad-json')")
    driver.get(urljoin(BASE_URL, "mieten/"))
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 1, "Rental nach kaputtem LocalStorage")
    assert_no_js_exceptions(driver, "Rental corrupt localStorage")


def test_coarse_performance_budget(driver) -> None:
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": "window.__d119LongTasks=[];try{new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__d119LongTasks.push(e.duration))).observe({type:'longtask',buffered:true})}catch(e){}"})
    driver.set_window_size(390, 844)
    driver.get(BASE_URL)
    wait(driver, lambda d: len(d.find_elements(By.CSS_SELECTOR, "#grid .plate")) >= 3, "Performance Archiv")
    dismiss_cookie_note(driver)
    node_count = int(driver.execute_script("return document.getElementsByTagName('*').length"))
    image_resources = int(driver.execute_script("return performance.getEntriesByType('resource').filter(e=>e.initiatorType==='img').length"))
    if node_count > 6000:
        fail(f"Performance: unerwartet grosser initialer DOM ({node_count} Nodes)")
    if image_resources > 80:
        fail(f"Performance: zu viele initial geladene Bilder ({image_resources})")

    search = driver.find_element(By.ID, "searchInput")
    for query in ("Prada", "Y3", "Comme des Garcons", "", "Yohji"):
        search.send_keys(Keys.CONTROL, "a")
        search.send_keys(query)
        time.sleep(0.08)
    time.sleep(0.2)
    tasks = driver.execute_script("return (window.__d119LongTasks || []).slice()") or []
    if tasks and max(float(x) for x in tasks) > 1000:
        fail(f"Performance: Long Task ueber 1000ms ({max(tasks):.1f}ms)")
    if sum(float(x) for x in tasks) > 5000:
        fail(f"Performance: kumulierte Long Tasks ueber 5s ({sum(tasks):.1f}ms)")
    assert_no_js_exceptions(driver, "Performance Budget")


def run_case(test_fn) -> None:
    driver = new_driver()
    try:
        test_fn(driver)
    finally:
        driver.quit()


def main() -> None:
    for test_fn in (
        test_repeated_modes_history_and_listener_cleanup,
        test_baukasten_open_close_and_state_recovery,
        test_chaos_resize_modal_cleanup_and_reduced_motion,
        test_rapid_match_and_storage_fallbacks,
        test_coarse_performance_budget,
    ):
        run_case(test_fn)
    print("Adversarial Browser-Stress: OK — 20x Mode-/Modal-Zyklen, History, globale Listener-Cleanup, Resize/Landscape, reduced-motion, corrupt State, Rapid Input und grobes Performance-Budget bestanden.")


if __name__ == "__main__":
    main()
