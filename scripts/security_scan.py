#!/usr/bin/env python3
"""Fail CI when tracked files contain common production secrets.

This intentionally uses only the Python standard library so the guard remains
free, deterministic and available in every GitHub Actions run.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ALLOWED_SECRET_EXAMPLES = {
    ".env.example",
    ".dev.vars.example",
}

BLOCKED_TRACKED_NAMES = {
    ".env",
    ".dev.vars",
    "secrets.json",
    "credentials.json",
}

BINARY_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
    ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mov", ".zip",
}

PATTERNS = (
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b")),
    ("Telegram bot token", re.compile(r"\b\d{6,12}:[A-Za-z0-9_-]{20,}\b")),
    ("Stripe secret key", re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
)

SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)\b("
    r"PAYPAL_CLIENT_SECRET|GITHUB_TOKEN|ADMIN_TOKEN|ADMIN_READ_TOKEN|ADMIN_WRITE_TOKEN|"
    r"TURNSTILE_SECRET|TELEGRAM_BOT_TOKEN|RESEND_API_KEY|STRIPE_SECRET_KEY|"
    r"CLOUDFLARE_API_TOKEN"
    r")\b\s*[:=]\s*['\"]([^'\"]+)['\"]"
)

PLACEHOLDER_MARKERS = (
    "example", "placeholder", "replace_me", "change_me", "your_", "<", "${",
    "process.env", "env.", "secrets.", "***",
)


def tracked_files() -> list[Path]:
    proc = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
    )
    return [ROOT / p.decode("utf-8") for p in proc.stdout.split(b"\0") if p]


def looks_like_placeholder(value: str) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return True
    return any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def scan_file(path: Path) -> list[tuple[int, str]]:
    rel = path.relative_to(ROOT)
    if rel.name in ALLOWED_SECRET_EXAMPLES or path.suffix.lower() in BINARY_SUFFIXES:
        return []
    try:
        raw = path.read_bytes()
    except OSError:
        return []
    if b"\0" in raw or len(raw) > 5 * 1024 * 1024:
        return []
    text = raw.decode("utf-8", errors="ignore")
    findings: list[tuple[int, str]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        for label, pattern in PATTERNS:
            if pattern.search(line):
                findings.append((line_no, label))
        for match in SENSITIVE_ASSIGNMENT.finditer(line):
            if not looks_like_placeholder(match.group(2)):
                findings.append((line_no, f"literal value assigned to {match.group(1)}"))
    return findings


def main() -> int:
    problems: list[str] = []
    for path in tracked_files():
        rel = path.relative_to(ROOT)
        lower_name = rel.name.lower()
        if lower_name in BLOCKED_TRACKED_NAMES:
            problems.append(f"{rel}: tracked secret/environment file")
        if path.suffix.lower() in {".pem", ".key", ".p12", ".pfx"}:
            problems.append(f"{rel}: tracked private-key/certificate file")
        for line_no, label in scan_file(path):
            problems.append(f"{rel}:{line_no}: possible {label}")

    if problems:
        print("SECURITY SCAN FAILED", file=sys.stderr)
        for problem in problems:
            print(f" - {problem}", file=sys.stderr)
        print("Rotate any real leaked credential before removing it from Git history.", file=sys.stderr)
        return 1

    print("Security scan passed: no tracked high-risk secret patterns found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
