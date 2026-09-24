#!/usr/bin/env python3
"""Bump the outer Universe loader chain so browsers cannot keep the broken launcher bundle."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IOS = ROOT / "assets" / "ios-zoom-lock.js"
PWA = ROOT / "assets" / "pwa.js"
NEW = "20260924-1"


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
