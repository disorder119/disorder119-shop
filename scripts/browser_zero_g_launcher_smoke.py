#!/usr/bin/env python3
"""Regression for the real Universe GAME launcher -> Zero-G Runway path."""
from urllib.parse import urljoin

from selenium.webdriver.common.by import By

from browser_smoke import BASE_URL, assert_no_js_exceptions, dismiss_cookie_note, new_driver, wait


def fail(message: str) -> None:
    raise AssertionError(message)


def main() -> None:
    driver = new_driver()
    try:
        driver.set_window_size(1280, 800)
        driver.get(urljoin(BASE_URL, "chaos/"))
        wait(driver, lambda d: d.find_element(By.ID, "chaosView").is_displayed(), "Universum sichtbar")
        wait(driver, lambda d: d.execute_script("return !!window.D119SecretGames"), "Zero-G API geladen")
        dismiss_cookie_note(driver)

        version = driver.execute_script("return window.D119SecretGames && window.D119SecretGames.version")
        if version != "zero-g-runway-v1":
            fail(f"falsche Zero-G-Version: {version!r}")

        launcher = driver.find_element(By.CSS_SELECTOR, "[data-d119-game-launch]")
        if "Zero-G" not in (launcher.get_attribute("aria-label") or ""):
            fail("GAME-Launcher hat noch ein altes/falsches Label")
        launcher.click()

        wait(
            driver,
            lambda d: d.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-view='gate']").is_displayed(),
            "GAME-Button oeffnet Zero-G Startscreen",
        )
        username = driver.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-player-name]")
        username.clear()
        username.send_keys("LAUNCH_TEST")
        driver.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-action='start']").click()

        wait(
            driver,
            lambda d: bool(d.find_elements(By.CSS_SELECTOR, ".d119-runway-canvas"))
            and d.find_element(By.CSS_SELECTOR, ".d119-runway-canvas").is_displayed(),
            "Zero-G Canvas nach GAME-Button bereit",
        )
        canvas = driver.find_element(By.CSS_SELECTOR, ".d119-runway-canvas")
        rect = canvas.rect
        x = rect["x"] + rect["width"] * 0.78
        y = rect["y"] + rect["height"] * 0.62
        driver.execute_script(
            "var c=document.querySelector('.d119-runway-canvas');"
            "c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,clientX:arguments[0],clientY:arguments[1],pointerId:91,pointerType:'mouse',buttons:0}));",
            x,
            y,
        )
        wait(
            driver,
            lambda d: int(d.find_element(By.CSS_SELECTOR, "#d119SecretGames [data-hud='time']").text or "52") < 52,
            "Zero-G Run startet wirklich",
        )
        assert_no_js_exceptions(driver, "Zero-G GAME launcher")
        print("Zero-G Launcher Browser-Smoke: OK")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
