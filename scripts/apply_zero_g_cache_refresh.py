#!/usr/bin/env python3
"""Bump the outer Universe loader chain so browsers cannot keep the broken launcher bundle."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IOS = ROOT / "assets" / "ios-zoom-lock.js"
PWA = ROOT / "assets" / "pwa.js"
NEW = "20260924-1"
TEMP_LOCK_MARKER = "d119_temp_private_until"


def replace_version(path: Path, old: str, new: str, expected: int, label: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if new in text and old not in text:
        return False
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"FEHLER: {label}: erwartete {expected} Vorkommen von {old!r}, gefunden {count}")
    path.write_text(text.replace(old, new), encoding="utf-8")
    return True


def main() -> None:
    changed = False
    changed |= replace_version(
        IOS,
        "20260923-3",
        NEW,
        2,
        "Universe-Upgrade CSS/JS Cache-Bust",
    )

    # During a short maintenance window assets/pwa.js can intentionally be a
    # temporary access-lock wrapper. Its normal PWA runtime is preserved in
    # assets/pwa-runtime.js and must not be rewritten by this historical
    # Universe cache-bust migration. Once the wrapper is removed, the regular
    # guarded replacement below is active again.
    pwa_text = PWA.read_text(encoding="utf-8")
    if TEMP_LOCK_MARKER in pwa_text:
        print("Temporärer Site-Lock erkannt; PWA-Loader-Cache-Bust wird ausgelassen.")
    else:
        changed |= replace_version(
            PWA,
            "20260923-3",
            NEW,
            1,
            "iOS/Universe Loader Cache-Bust",
        )

    print("Zero-G Cache-Pfad aktualisiert." if changed else "Zero-G Cache-Pfad bereits aktuell.")


if __name__ == "__main__":
    main()
