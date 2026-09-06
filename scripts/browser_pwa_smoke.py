#!/usr/bin/env python3
"""Real Chromium smoke test for the installable Disorder119 PWA."""
from __future__ import annotations

import os
import signal
import time

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver import ChromeOptions
from selenium.webdriver.support.ui import WebDriverWait

BASE_URL = os.environ.get("D119_SMOKE_URL", "http://127.0.0.1:4173").rstrip("/") + "/"
WAIT = 15


def fail(message: str) -> None:
    raise AssertionError(message)


def options() -> ChromeOptions:
    opts = ChromeOptions()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=390,844")
    opts.page_load_strategy = "eager"
    return opts


def wait(driver, fn, label: str):
    try:
        return WebDriverWait(driver, WAIT).until(fn)
    except TimeoutException as exc:
        raise AssertionError("Timeout: " + label) from exc


def stop_test_server() -> None:
    raw = os.environ.get("D119_SERVER_PID", "").strip()
    if not raw:
        fail("D119_SERVER_PID fehlt; Offline-Test verweigert eine nur emulierte Netztrennung")
    try:
        pid = int(raw)
        os.kill(pid, signal.SIGTERM)
    except (ValueError, ProcessLookupError) as exc:
        fail("Testserver konnte fuer echten Offline-Test nicht beendet werden: " + str(exc))
    time.sleep(0.35)


def main() -> None:
    driver = webdriver.Chrome(options=options())
    driver.set_page_load_timeout(20)
    driver.set_script_timeout(20)
    try:
        driver.get(BASE_URL)
        manifest_href = driver.execute_script("return document.querySelector('link[rel=manifest]') && document.querySelector('link[rel=manifest]').getAttribute('href');")
        if manifest_href != "/manifest.webmanifest":
            fail("Manifest-Link fehlt im echten Browser")

        manifest = driver.execute_async_script(
            """
            var done = arguments[arguments.length - 1];
            fetch('/manifest.webmanifest', {cache:'no-store'})
              .then(function(r){ return r.json(); })
              .then(function(m){ done(m); })
              .catch(function(e){ done({__error:String(e)}); });
            """
        )
        if manifest.get("__error"):
            fail("Manifest konnte nicht geladen werden: " + manifest["__error"])
        if manifest.get("display") != "standalone" or manifest.get("scope") != "/" or manifest.get("start_url") != "/":
            fail("Manifest ist nicht rootweit standalone-installierbar")

        ready = driver.execute_async_script(
            """
            var done = arguments[arguments.length - 1];
            if (!('serviceWorker' in navigator)) { done({error:'unsupported'}); return; }
            var timeout = setTimeout(function(){ done({error:'timeout'}); }, 12000);
            navigator.serviceWorker.ready.then(function(reg){
              clearTimeout(timeout);
              done({scope:reg.scope, active:!!reg.active});
            }).catch(function(e){ clearTimeout(timeout); done({error:String(e)}); });
            """
        )
        if ready.get("error"):
            fail("Service Worker wurde nicht aktiv: " + ready["error"])
        if not ready.get("active") or not ready.get("scope", "").endswith("/"):
            fail("Service Worker ist nicht mit Root-Scope aktiv")

        driver.refresh()
        wait(driver, lambda d: d.execute_script("return !!navigator.serviceWorker.controller;"), "Service Worker kontrolliert die App")

        # Do not merely ask Chrome to emulate offline while localhost may still
        # be reachable. Stop the actual HTTP server, then additionally mark the
        # browser offline. Every successful request below must therefore come
        # through the installed app's Service Worker/cache.
        stop_test_server()
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd("Network.emulateNetworkConditions", {
            "offline": True,
            "latency": 0,
            "downloadThroughput": 0,
            "uploadThroughput": 0,
            "connectionType": "none",
        })
        try:
            driver.get(BASE_URL + "?pwa-offline-smoke=1")
        except WebDriverException as exc:
            fail("Precached App-Shell startet bei echtem Serverausfall nicht: " + str(exc))
        if "Disorder119" not in driver.title:
            fail("Offline-Start liefert nicht die Disorder119-App")

        offline_catalog = driver.execute_async_script(
            """
            var done = arguments[arguments.length - 1];
            fetch('/data/catalog.json')
              .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
              .then(function(items){ done({count:Array.isArray(items) ? items.length : -1}); })
              .catch(function(e){ done({error:String(e)}); });
            """
        )
        if offline_catalog.get("error"):
            fail("Produktkatalog ist offline nicht verfügbar: " + offline_catalog["error"])
        if offline_catalog.get("count", -1) < 100:
            fail("Offline-Katalog ist unerwartet leer/unvollständig: " + str(offline_catalog))

        try:
            driver.get(BASE_URL + "nicht-im-cache-pwa-test/")
        except WebDriverException as exc:
            fail("Offline-Fallback wird bei unbekannter Route nicht vom Service Worker geliefert: " + str(exc))
        body = driver.execute_script("return document.body && document.body.innerText || ''; ")
        if "Du bist gerade offline" not in body:
            fail("Offline-Fallback-Seite wurde nicht ausgeliefert")

        print("Browser-PWA: OK — Manifest, Root-Service-Worker, echter Offline-App-Start, Produktkatalog und Offline-Fallback funktionieren.")
    finally:
        try:
            driver.execute_cdp_cmd("Network.emulateNetworkConditions", {
                "offline": False,
                "latency": 0,
                "downloadThroughput": -1,
                "uploadThroughput": -1,
                "connectionType": "wifi",
            })
        except Exception:
            pass
        driver.quit()


if __name__ == "__main__":
    main()
