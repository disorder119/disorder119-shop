#!/usr/bin/env python3
"""Old Zero-G links must stay compatible without reviving the retired game."""
from urllib.parse import urljoin, urlparse

from selenium.webdriver.common.by import By

from browser_smoke import BASE_URL, assert_no_js_exceptions, new_driver, wait


def main() -> None:
    driver = new_driver()
    try:
        driver.set_window_size(1280, 800)
        driver.get(urljoin(BASE_URL, "chaos/?game=zero"))
        wait(driver, lambda d: urlparse(d.current_url).path == "/universe/", "Alter Zero-G-Link weitergeleitet")
        wait(
            driver,
            lambda d: "Universum bereit" in (d.find_element(By.ID, "uStatus").get_attribute("textContent") or ""),
            "Universum nach alter Game-Route bereit",
        )
        if not driver.find_element(By.ID, "uCanvas").is_displayed():
            raise AssertionError("Universum-Canvas ist nicht sichtbar")
        if driver.find_elements(By.CSS_SELECTOR, "[data-d119-game-launch], #d119SecretGames, .d119-runway-canvas"):
            raise AssertionError("Entfernter Zero-G-Launcher oder Runway wird wieder ausgeliefert")
        assert_no_js_exceptions(driver, "Alter Zero-G-Direktlink")
        print("Zero-G Legacy Browser-Smoke: OK — alter Game-Link zeigt auf das gamefreie Universum.")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
