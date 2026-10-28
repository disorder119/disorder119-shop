#!/usr/bin/env python3
"""Herkunftspruefung fuer main (Main Integrity Guard, main-integrity.yml).

Jeder Push auf main muss aus einem dieser Wege stammen:
  1. ein gemergter Pull Request nach main (squash, merge-commit oder rebase),
  2. die eigene Automatik dieses Repos (Rebuild-Bot, Schutz-Revert): erkannt
     an der Identitaet des PUSHERS (github-actions[bot]) - nicht an Name oder
     E-Mail im Commit, die jeder frei setzen kann,
  3. ein Verkauf aus dem Shop-Worker (worker.js markCatalogSold): Pusher ist
     der Repo-Eigentuemer, der Commit aendert nur die Statuszeilen genau eines
     Artikels in data/items.json auf SOLD.

Geprueft werden ALLE Commits von before bis after, nicht nur der oberste -
sonst liesse sich ein fremder Commit unter einem harmlosen verstecken.

Zwei Betriebsarten:
  --push    (on: push)     BEFORE/AFTER/ACTOR aus dem Ereignis.
  --audit   (on: schedule) Liest die Push-Aktivitaet von main der letzten
            Stunden (GET /repos/{repo}/activity). Pushes mit "[skip ci]" im
            Commit loesen KEINEN push-Workflow aus; der geplante Lauf faengt
            sie trotzdem. Force-Pushes und Loeschungen von main fallen auf.

Ergebnis: Exit 0 = alles belegt, Exit 1 = unbelegter Push. Fuer den
Self-Heal-Job schreibt das Skript heal_before/heal_after nach GITHUB_OUTPUT
- im Audit nur, wenn der unbelegte Push noch die Spitze von main ist (sonst
waere ein Zuruecksetzen gefaehrlich; dann bleibt der Lauf rot).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

NULL_SHA = "0" * 40
BOT = "github-actions[bot]"
BOT_NACHRICHTEN = (
    "Automatischer Rebuild nach Shop- und SEO-Validierung",
    "Automatischer Schutz-Revert eines unautorisierten main-Push",
)
VERKAUF = re.compile(r"Verkauft: Artikel \d+")
STATUS_ZEILE = re.compile(r'"(public_status|status)": "[^"\\]*"')
MAX_SEITEN = 10


class GitHub:
    def __init__(self, repo: str, token: str):
        self.repo = repo
        self.token = token

    def get(self, pfad: str):
        url = pfad if pfad.startswith("https://") else f"https://api.github.com/repos/{self.repo}{pfad}"
        anfrage = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "disorder119-main-integrity",
        })
        with urllib.request.urlopen(anfrage, timeout=30) as antwort:
            return json.load(antwort)


def range_commits(api, before: str, after: str) -> list[dict]:
    """Alle Commits von before (exklusiv) bis after (inklusive), aelteste zuerst."""
    commits: list[dict] = []
    for seite in range(1, MAX_SEITEN + 1):
        daten = api.get(f"/compare/{before}...{after}?per_page=100&page={seite}")
        if daten.get("status") not in ("ahead", "identical"):
            # behind/diverged: after stammt nicht von before ab (Force-Push).
            raise ValueError(f"main wurde nicht vorgespult (compare-Status {daten.get('status')})")
        teil = daten.get("commits") or []
        commits.extend(teil)
        if len(commits) >= int(daten.get("total_commits") or 0) or not teil:
            break
    else:
        raise ValueError("zu viele Commits in einem Push fuer eine Pruefung")
    return commits


def gemergte_prs(api, sha: str, versuche: int = 12, pause: float = 5.0) -> list[dict]:
    """Gemergte PRs nach main, deren Merge-Commit sha ist. GitHub indexiert die
    Zuordnung manchmal erst Sekunden nach dem Merge - deshalb Wiederholungen."""
    for versuch in range(1, versuche + 1):
        prs = api.get(f"/commits/{sha}/pulls")
        treffer = [pr for pr in prs if pr.get("merged_at") and (pr.get("base") or {}).get("ref") == "main"
                   and pr.get("merge_commit_sha") == sha]
        if treffer or versuch == versuche:
            return treffer
        print(f"PR provenance noch nicht indexiert (Versuch {versuch}/{versuche}); erneuter Check in {pause:g}s.")
        time.sleep(pause)
    return []


def ist_verkauf(commit: dict, eigentuemer: str, pusher: str) -> bool:
    """Shop-Verkauf: nur Statuszeilen eines Artikels in data/items.json auf SOLD."""
    nachricht = ((commit.get("commit") or {}).get("message") or "").strip()
    dateien = commit.get("files") or []
    if not (VERKAUF.fullmatch(nachricht) and eigentuemer and pusher == eigentuemer
            and len(dateien) == 1 and dateien[0].get("filename") == "data/items.json"
            and dateien[0].get("status") == "modified"):
        return False
    patch = dateien[0].get("patch") or ""
    entfernt, neu = [], []
    if not patch:
        return False
    for zeile in patch.splitlines():
        if zeile.startswith("@@") or zeile.startswith(" ") or zeile == "":
            continue
        if zeile.startswith("-"):
            entfernt.append(zeile[1:].strip().rstrip(","))
        elif zeile.startswith("+"):
            neu.append(zeile[1:].strip().rstrip(","))
        else:
            return False
    return (all(STATUS_ZEILE.fullmatch(z) for z in entfernt)
            and sorted(neu) in (['"public_status": "SOLD"'], ['"public_status": "SOLD"', '"status": "Verkauft"'])
            and sorted(z.split(":")[0] for z in entfernt) == sorted(z.split(":")[0] for z in neu))


def pruefe_push(api, *, pusher: str, before: str, after: str, eigentuemer: str,
                art: str = "push", versuche: int = 12, pause: float = 5.0) -> tuple[bool, list[str]]:
    """(ok, Gruende). Gruende nennen jeden unbelegten Commit."""
    if art in ("force_push", "branch_deletion"):
        return False, [f"{art} auf main durch {pusher or 'unbekannt'}"]
    if not before or before == NULL_SHA or not after or after == NULL_SHA:
        return False, ["main ohne vorherigen Stand angelegt/geloescht - keine sichere Pruefung moeglich"]
    try:
        commits = range_commits(api, before, after)
    except ValueError as fehler:
        return False, [str(fehler)]
    # API-Fehler (HTTPError) laufen durch: roter Lauf ohne Revert.
    if not commits:
        return True, ["keine neuen Commits"]

    # 2. Eigene Automatik: der Pusher ist github-actions[bot] (GITHUB_TOKEN eines
    #    Workflows auf main), und jeder Commit ist ein Rebuild oder Schutz-Revert.
    if pusher == BOT:
        fremd = [c["sha"][:9] for c in commits
                 if not ((c.get("commit") or {}).get("message") or "").startswith(BOT_NACHRICHTEN)]
        if not fremd:
            return True, ["Automatik dieses Repos (Rebuild/Schutz-Revert)"]
        return False, [f"github-actions[bot] hat fremde Commits gepusht: {', '.join(fremd)}"]

    # 1. Gemergter PR: der oberste Commit ist Merge-Commit eines PR nach main;
    #    alle anderen Commits gehoeren zu genau diesen PRs.
    prs = gemergte_prs(api, after, versuche=versuche, pause=pause)
    erlaubt = {after}
    nummern = {pr.get("number") for pr in prs}
    gruende = []
    offen = [c for c in commits if c["sha"] not in erlaubt] if prs else list(commits)
    if prs:
        gruende.append("gemergter PR " + ", ".join(f"#{n}" for n in sorted(nummern)))
    unbelegt = []
    for commit in offen:
        sha = commit["sha"]
        if prs:
            zuordnung = api.get(f"/commits/{sha}/pulls")
            if any(pr.get("number") in nummern for pr in zuordnung):
                continue
        # 3. Verkauf aus dem Shop-Worker (braucht die Dateiliste des Commits).
        if ist_verkauf(api.get(f"/commits/{sha}"), eigentuemer, pusher):
            gruende.append(f"Shop-Verkauf {sha[:9]}")
            continue
        unbelegt.append(sha[:9])
    if unbelegt:
        return False, [f"unbelegte Commits: {', '.join(unbelegt)} (Pusher {pusher or 'unbekannt'})"]
    return True, gruende


def ausgabe(**werte):
    ziel = os.environ.get("GITHUB_OUTPUT")
    if not ziel:
        return
    with open(ziel, "a", encoding="utf-8") as fh:
        for name, wert in werte.items():
            fh.write(f"{name}={wert}\n")


def heal_angeheftet(api, after: str) -> bool:
    """Wurde der unbelegte Push schon zurueckgedreht? (Schutz-Revert direkt darauf)"""
    try:
        for c in api.get("/commits?sha=main&per_page=30"):
            msg = (c.get("commit") or {}).get("message") or ""
            if msg.startswith(BOT_NACHRICHTEN[1]) and any(p.get("sha") == after for p in c.get("parents") or []):
                return True
    except urllib.error.HTTPError:
        return False
    return False


def audit(api, eigentuemer: str, stunden: float, jetzt: dt.datetime | None = None) -> int:
    jetzt = jetzt or dt.datetime.now(dt.timezone.utc)
    grenze = jetzt - dt.timedelta(hours=stunden)
    aktivitaeten = api.get("/activity?ref=refs%2Fheads%2Fmain&per_page=100")
    spitze = (api.get("/commits/main") or {}).get("sha")
    fehler = 0
    for a in reversed(aktivitaeten):  # aelteste zuerst
        zeit = dt.datetime.fromisoformat(str(a.get("timestamp", "")).replace("Z", "+00:00"))
        if zeit < grenze:
            continue
        pusher = (a.get("actor") or {}).get("login") or ""
        ok, gruende = pruefe_push(api, pusher=pusher, before=a.get("before") or "", after=a.get("after") or "",
                                  eigentuemer=eigentuemer, art=a.get("activity_type") or "push", versuche=1, pause=0)
        kurz = f"{a.get('activity_type')} {str(a.get('before'))[:9]}..{str(a.get('after'))[:9]} von {pusher}"
        if ok:
            print(f"OK   {kurz}: {'; '.join(gruende)}")
            continue
        if a.get("activity_type") == "push" and heal_angeheftet(api, a.get("after") or ""):
            print(f"GEHEILT {kurz}: bereits per Schutz-Revert zurueckgedreht")
            continue
        fehler += 1
        print(f"FEHLT {kurz}: {'; '.join(gruende)}")
        if a.get("after") == spitze and a.get("activity_type") == "push":
            ausgabe(heal_before=a.get("before"), heal_after=a.get("after"))
    return 1 if fehler else 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--audit", action="store_true")
    p.add_argument("--stunden", type=float, default=3.0)
    args = p.parse_args(argv)
    repo = os.environ["REPO"]
    api = GitHub(repo, os.environ["GH_TOKEN"])
    eigentuemer = repo.split("/")[0]
    if args.audit:
        return audit(api, eigentuemer, args.stunden)
    before, after = os.environ.get("BEFORE", ""), os.environ.get("AFTER", "")
    ok, gruende = pruefe_push(api, pusher=os.environ.get("PUSHER", ""), before=before, after=after, eigentuemer=eigentuemer)
    if ok:
        print("Provenance OK:", "; ".join(gruende))
        return 0
    print("UNAUTHORIZED MAIN PUSH:", "; ".join(gruende))
    ausgabe(heal_before=before, heal_after=after)
    return 1


if __name__ == "__main__":
    sys.exit(main())
