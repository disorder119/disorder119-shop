"""Publish only a verified public Git snapshot to the existing storefront Worker.

Requires explicit --activate, a matching main HEAD and a dedicated CI token.
It does not change routes, DNS, D1, backend credentials or account plans.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import tomllib
import urllib.error
import urllib.request

from export_storefront_assets import ROOT, export, git

ACCOUNT = "e66f363fbc068ad9a20c87aefa217f35"
WORKER = "disorder119-storefront-security"
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{WORKER}"
BASE = "https://disorder119.com"
UA = "Disorder119-Hosting-Migration/1.0"


def api(path, method="GET", body=None):
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    req = urllib.request.Request(API + path, method=method,
        headers={"Authorization": "Bearer " + token, "User-Agent": UA, "Content-Type": "application/json"},
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Cloudflare {method} {path} HTTP {exc.code}") from None
    if not result.get("success"):
        raise RuntimeError("Cloudflare rejected the operation.")
    return result["result"]


def validate_config(config):
    assert config["name"] == WORKER and config["main"] == "storefront-assets.js"
    assert config["workers_dev"] is False and config["preview_urls"] is False
    assert config["assets"] == {"directory": "../.storefront-build/public", "binding": "ASSETS",
        "run_worker_first": True, "html_handling": "auto-trailing-slash", "not_found_handling": "none"}
    assert config["services"] == [{"binding": "BESUCH", "service": "disorder119-shop-worker"}]
    assert config["routes"] == [
        {"pattern": "disorder119.com/*", "zone_name": "disorder119.com"},
        {"pattern": "www.disorder119.com/*", "zone_name": "disorder119.com"}]
    assert not set(config).intersection({"d1_databases", "kv_namespaces", "triggers", "r2_buckets", "vars"})


def verify_manifest(build):
    manifest = json.loads((build / "manifest.json").read_text("utf-8"))
    public = build / "public"
    expected = {r["path"] for r in manifest["files"]}
    actual = {p.relative_to(public).as_posix() for p in public.rglob("*") if p.is_file()}
    assert expected == actual, "Unexpected or missing public upload file."
    assert len(expected) == manifest["asset_count"]
    for row in manifest["files"]:
        path = public / row["path"]
        assert not path.is_symlink() and path.resolve().is_relative_to(public.resolve())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"], "Modified exported asset."
    return manifest


def main_head():
    result = git(ROOT, "ls-remote", "origin", "refs/heads/main").decode().split()
    if len(result) != 2:
        raise RuntimeError("Cannot verify current main HEAD.")
    return result[0]


def current_versions():
    deployments = api("/deployments")["deployments"]
    if not deployments:
        raise RuntimeError("No existing storefront deployment to roll back to.")
    return deployments[0]["versions"]


def deploy_versions(versions, message):
    return api("/deployments", "POST", {"strategy": "percentage", "versions": versions,
        "annotations": {"workers/message": message}})


def check_public(revision, manifest):
    entries = {r["path"]: r for r in manifest["files"]}
    paths = ["/", "/en/", "/fr/", "/cart/", "/kasse/", "/widerruf/", "/agb/",
             "/feed/google-merchant.xml", "/google7945c4dc594a9a9c.html",
             "/.well-known/apple-developer-merchantid-domain-association", "/data/catalog.json"]
    rows = json.loads((ROOT / ".storefront-build/public/data/catalog.json").read_text("utf-8"))
    for item in rows[:3]:
        paths.append("/artikel/" + str(item["article"]) + "/")
        if item.get("gallery"):
            paths.append("/" + item["gallery"][0].lstrip("/"))
    results = []
    for path in paths:
        req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Cache-Control": "no-cache", "DNT": "1"})
        with urllib.request.urlopen(req, timeout=40) as response:
            body = response.read()
            assert response.status == 200, path
            assert response.headers.get("X-Disorder119-Hosting") == "cloudflare-assets", path
            assert response.headers.get("X-Disorder119-Release") == revision, path
            assert response.headers.get("X-Content-Type-Options") == "nosniff", path
            assert "frame-ancestors 'none'" in response.headers.get("Content-Security-Policy", ""), path
            if path == "/data/catalog.json":
                assert json.loads(body) == rows, "Public catalog changed."
            elif path.lstrip("/") in entries:
                assert hashlib.sha256(body).hexdigest() == entries[path.lstrip("/")]["sha256"], path
            results.append({"path": path, "status": response.status})
    # This is deliberately a health GET, never a payment, email or shipment.
    with urllib.request.urlopen(urllib.request.Request("https://api.disorder119.com/health", headers={"User-Agent": UA}), timeout=30) as response:
        assert response.status == 200
    return results


def activate_and_verify(version, previous, revision, manifest, state_path):
    state = {"source_commit": revision, "previous_versions": previous, "candidate_version": version,
             "routes_changed": False, "backend_changed": False, "billing_changed": False,
             "activation_attempted": True, "verified": False}

    def save():
        state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    save()
    try:
        # A timeout is ambiguous: the server may have applied the request.
        # The same observation/rollback handling therefore covers this POST.
        deploy_versions([{"version_id": version, "percentage": 100}], "Storefront hosting " + revision)
        for attempt in range(6):
            try:
                state["public_checks"] = check_public(revision, manifest)
                break
            except Exception:
                if attempt == 5:
                    raise RuntimeError("Public deployment checks failed.") from None
                time.sleep(5)
        state["verified"] = True
    except Exception as exc:
        state["failure_type"] = type(exc).__name__
        try:
            current = current_versions()
            if current == [{"version_id": version, "percentage": 100}]:
                deploy_versions(previous, "Automatic rollback after failed storefront checks")
                if current_versions() != previous:
                    raise RuntimeError("Rollback verification failed.")
                state["rolled_back"] = True
            elif current == previous:
                state["previous_version_still_active"] = True
            else:
                state["rollback_skipped_newer_deployment"] = True
        except Exception:
            state["rollback_unverified_requires_operator"] = True
        save()
        raise RuntimeError("Deployment failed; inspect the saved rollback status.") from None
    save()
    return state


def publish(args):
    config = ROOT / "shop-worker/wrangler.storefront.toml"
    validate_config(tomllib.loads(config.read_text("utf-8")))
    revision = git(ROOT, "rev-parse", "--verify", args.revision + "^{commit}").decode().strip()
    assert re.fullmatch("[a-f0-9]{40}", revision)
    # Worker source and allowlists must be exactly the same revision as assets.
    assert not git(ROOT, "status", "--porcelain", "--untracked-files=no"), "Tracked working tree must be clean."
    assert git(ROOT, "rev-parse", "HEAD").decode().strip() == revision
    if not (ROOT / ".storefront-build").exists():
        export(ROOT, ROOT / ".storefront-build", revision, args.node)
    manifest = verify_manifest(ROOT / ".storefront-build")
    assert manifest["source_commit"] == revision
    cli = ROOT / "tools/storefront-publish/node_modules/wrangler/bin/wrangler.js"
    base = [args.node, str(cli), "--config", str(config)]
    env = dict(os.environ, WRANGLER_SEND_METRICS="false", CI="true", CLOUDFLARE_ACCOUNT_ID=ACCOUNT)
    if not args.activate:
        subprocess.run(base + ["versions", "upload", "--dry-run", "--var", "RELEASE_SHA:" + revision,
                              "--upload-source-maps=false"], env=env, check=True)
        print("Dry run passed; no upload, deployment, DNS or plan changes.")
        return
    if main_head() != revision:
        raise RuntimeError("Stale build; main moved. No deployment performed.")
    previous = current_versions()
    # Upload does not activate the version and does not touch existing routes.
    process = subprocess.run(base + ["versions", "upload", "--var", "RELEASE_SHA:" + revision,
        "--tag", revision[:12], "--message", "Public storefront " + revision, "--upload-source-maps=false"],
        env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(process.stdout)
    if process.returncode:
        # Wrangler masks credentials. Do not print the environment or API headers.
        print(process.stderr)
        raise RuntimeError("Inactive version upload failed; current deployment was not changed.")
    ids = re.findall(r"Worker Version ID:\s*([a-f0-9-]{36})", process.stdout)
    if len(ids) != 1:
        raise RuntimeError("No unambiguous uploaded version. Current deployment was not changed.")
    version = ids[0]
    if main_head() != revision or current_versions() != previous:
        raise RuntimeError("Concurrent main/deployment change detected; inactive version was not activated.")
    state_path = ROOT / ".storefront-build/deployment.json"
    state = activate_and_verify(version, previous, revision, manifest, state_path)
    print(json.dumps(state, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--activate", action="store_true")
    parser.add_argument("--node", default="node")
    publish(parser.parse_args())
