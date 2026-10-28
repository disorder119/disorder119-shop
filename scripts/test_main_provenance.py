"""Tests fuer scripts/main_provenance.py (Main Integrity Guard) ohne Netz."""
import datetime as dt
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main_provenance as mp  # noqa: E402

A, B, C, D, E = ("a" * 40, "b" * 40, "c" * 40, "d" * 40, "e" * 40)
VERKAUF_PATCH = '@@ -10,2 +10,2 @@\n-    "public_status": "AVAILABLE",\n+    "public_status": "SOLD",\n-    "status": "Verfuegbar",\n+    "status": "Verkauft",'


def commit(sha, msg, files=None):
    return {"sha": sha, "commit": {"message": msg, "author": {"name": "disorder119-bot", "email": "actions@users.noreply.github.com"}},
            "files": files or [], "parents": []}


class FakeApi:
    def __init__(self, commits, prs=None, einzeln=None, activity=None, spitze=None, verlauf=None):
        self.commits = commits
        self.prs = prs or {}
        self.einzeln = einzeln or {}
        self.activity = activity or []
        self.spitze = spitze
        self.verlauf = verlauf or []
        self.aufrufe = []

    def get(self, pfad):
        self.aufrufe.append(pfad)
        if pfad.startswith("/compare/"):
            status = "diverged" if "diverged" in self.commits else "ahead"
            liste = [c for c in self.commits if isinstance(c, dict)]
            return {"status": status, "total_commits": len(liste), "commits": liste}
        if pfad.endswith("/pulls"):
            return self.prs.get(pfad.split("/")[2], [])
        if pfad.startswith("/activity"):
            return self.activity
        if pfad == "/commits/main":
            return {"sha": self.spitze}
        if pfad.startswith("/commits?sha=main"):
            return self.verlauf
        if pfad.startswith("/commits/"):
            return self.einzeln.get(pfad.split("/")[2], {})
        raise AssertionError(pfad)


def pr(nummer, merge_sha):
    return {"number": nummer, "merged_at": "2026-10-28T10:00:00Z", "base": {"ref": "main"}, "merge_commit_sha": merge_sha}


class Pruefung(unittest.TestCase):
    def pruefe(self, api, pusher="disorder119", before=A, after=C, art="push"):
        return mp.pruefe_push(api, pusher=pusher, before=before, after=after, eigentuemer="disorder119", art=art, versuche=1, pause=0)

    def test_squash_merge(self):
        api = FakeApi([commit(C, "Kasse (#321)")], prs={C: [pr(321, C)]})
        ok, gruende = self.pruefe(api)
        self.assertTrue(ok, gruende)

    def test_merge_commit_mit_pr_commits(self):
        api = FakeApi([commit(B, "Teil 1"), commit(C, "Merge pull request #311")], prs={C: [pr(311, C)], B: [pr(311, C)]})
        self.assertTrue(self.pruefe(api)[0])

    def test_fremder_commit_unter_einem_pr_merge_faellt_auf(self):
        api = FakeApi([commit(B, "boese"), commit(C, "Merge pull request #311")], prs={C: [pr(311, C)], B: []},
                      einzeln={B: commit(B, "boese", [{"filename": "assets/app.js", "status": "modified", "patch": "+x"}])})
        ok, gruende = self.pruefe(api)
        self.assertFalse(ok)
        self.assertIn("bbbbbbbbb", gruende[0])

    def test_gefaelschter_rebuild_name_reicht_nicht(self):
        # Name/E-Mail "disorder119-bot"/actions@... und die Rebuild-Nachricht -
        # aber gepusht von einem Menschen/Token: unbelegt.
        api = FakeApi([commit(C, "Automatischer Rebuild nach Shop- und SEO-Validierung")], einzeln={C: commit(C, "Automatischer Rebuild nach Shop- und SEO-Validierung")})
        self.assertFalse(self.pruefe(api, pusher="disorder119")[0])

    def test_echter_rebuild_vom_bot(self):
        api = FakeApi([commit(C, "Automatischer Rebuild nach Shop- und SEO-Validierung")])
        self.assertTrue(self.pruefe(api, pusher="github-actions[bot]")[0])
        api2 = FakeApi([commit(B, "irgendwas"), commit(C, "Automatischer Rebuild nach Shop- und SEO-Validierung")])
        self.assertFalse(self.pruefe(api2, pusher="github-actions[bot]")[0])

    def test_verkauf_nur_vom_eigentuemer_und_nur_status(self):
        verkauf = commit(C, "Verkauft: Artikel 238", [{"filename": "data/items.json", "status": "modified", "patch": VERKAUF_PATCH}])
        self.assertTrue(self.pruefe(FakeApi([verkauf], einzeln={C: verkauf}))[0])
        self.assertFalse(self.pruefe(FakeApi([verkauf], einzeln={C: verkauf}), pusher="jemand-anders")[0])
        preis = commit(C, "Verkauft: Artikel 238", [{"filename": "data/items.json", "status": "modified", "patch": '@@ -1 +1 @@\n-    "price": 90,\n+    "price": 1,'}])
        self.assertFalse(self.pruefe(FakeApi([preis], einzeln={C: preis}))[0])

    def test_verkauf_kann_keinen_fremden_commit_verstecken(self):
        verkauf = commit(C, "Verkauft: Artikel 1", [{"filename": "data/items.json", "status": "modified", "patch": VERKAUF_PATCH}])
        boese = commit(B, "x", [{"filename": "shop-worker/worker.js", "status": "modified", "patch": "+y"}])
        api = FakeApi([boese, verkauf], einzeln={B: boese, C: verkauf})
        ok, gruende = self.pruefe(api)
        self.assertFalse(ok)
        self.assertIn("bbbbbbbbb", gruende[0])

    def test_force_push_und_neuanlage(self):
        self.assertFalse(self.pruefe(FakeApi([]), art="force_push")[0])
        self.assertFalse(self.pruefe(FakeApi(["diverged", commit(C, "x")]))[0])
        self.assertFalse(self.pruefe(FakeApi([]), before=mp.NULL_SHA)[0])


class Audit(unittest.TestCase):
    def test_skip_ci_push_wird_im_geplanten_lauf_gefunden_und_geheilt(self):
        jetzt = dt.datetime(2026, 10, 28, 12, 0, tzinfo=dt.timezone.utc)
        aktiv = [
            {"activity_type": "push", "before": B, "after": C, "timestamp": "2026-10-28T11:30:00Z", "actor": {"login": "eindringling"}},
            {"activity_type": "pr_merge", "before": A, "after": B, "timestamp": "2026-10-28T11:00:00Z", "actor": {"login": "disorder119"}},
            {"activity_type": "push", "before": D, "after": E, "timestamp": "2026-10-27T01:00:00Z", "actor": {"login": "alt"}},
        ]

        class Api(FakeApi):
            def get(self, pfad):
                if pfad.startswith("/compare/" + A):
                    return {"status": "ahead", "total_commits": 1, "commits": [commit(B, "PR (#1)")]}
                if pfad.startswith("/compare/" + B):
                    return {"status": "ahead", "total_commits": 1, "commits": [commit(C, "boese [skip ci]")]}
                return super().get(pfad)

        api = Api([], prs={B: [pr(1, B)]}, einzeln={C: commit(C, "boese [skip ci]")}, activity=aktiv, spitze=C)
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".txt") as out:
            pfad = out.name
        os.environ["GITHUB_OUTPUT"] = pfad
        try:
            self.assertEqual(mp.audit(api, "disorder119", 3, jetzt), 1)
            with open(pfad, encoding="utf-8") as fh:
                inhalt = fh.read()
            self.assertIn(f"heal_before={B}", inhalt)
            self.assertIn(f"heal_after={C}", inhalt)
        finally:
            os.environ.pop("GITHUB_OUTPUT", None)
            os.unlink(pfad)
        self.assertFalse(any(E in p for p in api.aufrufe), "alte Pushes ausserhalb des Fensters werden nicht geprueft")

    def test_schon_geheilter_push_ist_kein_alarm(self):
        jetzt = dt.datetime(2026, 10, 28, 12, 0, tzinfo=dt.timezone.utc)
        aktiv = [{"activity_type": "push", "before": B, "after": C, "timestamp": "2026-10-28T11:30:00Z", "actor": {"login": "x"}}]
        revert = {"sha": D, "commit": {"message": "Automatischer Schutz-Revert eines unautorisierten main-Push"}, "parents": [{"sha": C}]}
        api = FakeApi([commit(C, "boese")], einzeln={C: commit(C, "boese")}, activity=aktiv, spitze=D, verlauf=[revert])
        self.assertEqual(mp.audit(api, "disorder119", 3, jetzt), 0)


if __name__ == "__main__":
    unittest.main()
