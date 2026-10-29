"""Release-gate regressions: workflow contracts and real temporary Git repos.

Run ``python -m unittest discover -s scripts -p test_release_quality_gate.py -v``.
The workflow parser requires PyYAML; all publishing commands run exclusively
against a temporary local bare repository, never the production remote.
"""
from __future__ import annotations

import ast
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
INPUT = "rebuild_patch_artifact"
ARTIFACT = "disorder119-rebuild-patch-${{ github.run_id }}"


def workflow(name: str) -> dict:
    # BaseLoader preserves GitHub's literal `on` key (YAML 1.1 SafeLoader
    # interprets it as True), and keeps booleans explicit in contract assertions.
    return yaml.load((WORKFLOWS / name).read_text("utf-8"), Loader=yaml.BaseLoader)


def dependencies(job: dict) -> list[str]:
    value = job.get("needs", [])
    return [value] if isinstance(value, str) else value


def expression(value, context: dict, successful: bool = True) -> bool:
    """Evaluate the small expression subset used by these workflow conditions.

    Parse with Python's AST rather than execute workflow text. Unknown syntax
    fails the test instead of silently assuming a condition passes.
    """
    source = str(value if value is not None else "true").strip()
    if source.startswith("${{"):
        source = source[3:-2].strip()
    # GitHub implicitly requires success() unless an explicit status check is
    # present. This models the critical failed/skipped-dependency behavior.
    status_check = bool(re.search(r"\b(?:always|success|failure|cancelled)\s*\(", source))
    source = re.sub(r"\balways\(\)", "True", source)
    source = re.sub(r"\bsuccess\(\)", repr(successful), source)
    source = re.sub(r"\bfailure\(\)", repr(not successful), source)
    source = re.sub(r"\bcancelled\(\)", "False", source)
    source = re.sub(r"\b(?:inputs|github|needs|steps)\.[A-Za-z_][A-Za-z0-9_.]*", lambda m: repr(context.get(m[0], "")), source)
    source = source.replace("&&", " and ").replace("||", " or ")
    source = re.sub(r"!(?!=)", " not ", source)
    source = re.sub(r"\btrue\b", "True", source)
    source = re.sub(r"\bfalse\b", "False", source)
    tree = ast.parse(source.strip(), mode="eval")

    def evaluate(node):
        if isinstance(node, ast.Expression): return evaluate(node.body)
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not): return not evaluate(node.operand)
        if isinstance(node, ast.BoolOp):
            values = [bool(evaluate(child)) for child in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            left, right = evaluate(node.left), evaluate(node.comparators[0])
            if isinstance(node.ops[0], ast.Eq): return left == right
            if isinstance(node.ops[0], ast.NotEq): return left != right
        raise AssertionError(f"Unsupported release-condition syntax: {ast.dump(node)}")

    return bool(evaluate(tree)) and (successful or status_check)


def selected_steps(job: dict, event: str, artifact: str) -> list[dict]:
    context = {"github.event_name": event, f"inputs.{INPUT}": artifact}
    return [step for step in job["steps"] if expression(step.get("if"), context)]


def shell_step(job: dict, needle: str) -> dict:
    matches = [step for step in job["steps"] if needle in step.get("run", "")]
    if len(matches) != 1:
        raise AssertionError(f"Expected exactly one workflow step running {needle!r}, got {len(matches)}")
    return matches[0]


class WorkflowContractTests(unittest.TestCase):
    def setUp(self):
        self.rebuild = workflow("rebuild.yml")

    def reusable_job(self, filename):
        matches = [(name, job) for name, job in self.rebuild["jobs"].items()
                   if job.get("uses") == f"./.github/workflows/{filename}"]
        self.assertEqual(len(matches), 1, filename)
        return matches[0]

    def test_publication_requires_both_successful_reviews_and_rebuild(self):
        quality_name, quality = self.reusable_job("browser-smoke.yml")
        security_name, security = self.reusable_job("security-gate.yml")
        publish = self.rebuild["jobs"]["publish"]
        self.assertTrue({"rebuild", quality_name, security_name}.issubset(dependencies(publish)))
        context = {"github.event_name": "push", "github.ref": "refs/heads/main"} | {
            f"needs.{name}.result": "success" for name in dependencies(publish)
        }
        self.assertTrue(expression(publish.get("if"), context, successful=True))
        for failed_gate in ("rebuild", quality_name, security_name):
            for result in ("failure", "cancelled", "skipped"):
                with self.subTest(gate=failed_gate, result=result):
                    outcomes = {name: "success" for name in dependencies(publish)}
                    outcomes[failed_gate] = result
                    values = context | {f"needs.{name}.result": value for name, value in outcomes.items()}
                    self.assertFalse(expression(publish.get("if"), values, successful=False))
        for event in ("pull_request", "workflow_dispatch"):
            self.assertFalse(expression(publish.get("if"), context | {"github.event_name": event}))
        self.assertFalse(expression(publish.get("if"), context | {"github.ref": "refs/heads/feature"}))
        for job in (quality, security, publish):
            self.assertNotEqual(job.get("continue-on-error"), "true")

    def test_both_reviews_consume_the_same_successful_build_artifact_without_secrets(self):
        rebuild_job = self.rebuild["jobs"]["rebuild"]
        upload = [step for step in rebuild_job["steps"]
                  if step.get("uses", "").startswith("actions/upload-artifact@")
                  and step.get("with", {}).get("path") == "rebuild.patch"]
        self.assertEqual(len(upload), 1)
        artifact = upload[0]["with"]["name"]
        self.assertEqual(artifact, ARTIFACT)
        self.assertEqual(upload[0]["with"].get("if-no-files-found"), "error")
        for filename in ("browser-smoke.yml", "security-gate.yml"):
            _, job = self.reusable_job(filename)
            self.assertIn("rebuild", dependencies(job))
            self.assertEqual(job["with"][INPUT], artifact)
            self.assertNotIn("secrets", job)
            self.assertNotEqual(job.get("permissions", {}).get("contents"), "write")

    def test_reusable_contract_preserves_standalone_triggers_and_read_only_permissions(self):
        for filename in ("browser-smoke.yml", "security-gate.yml"):
            with self.subTest(workflow=filename):
                config = workflow(filename)
                self.assertTrue({"push", "pull_request", "workflow_dispatch", "workflow_call"}.issubset(config["on"]))
                input_spec = config["on"]["workflow_call"]["inputs"][INPUT]
                self.assertEqual(input_spec["type"], "string")
                self.assertEqual(input_spec.get("required", "false"), "false")
                self.assertEqual(input_spec.get("default", ""), "")
                self.assertEqual(config["permissions"]["contents"], "read")
                self.assertNotIn("secrets", config["on"]["workflow_call"])
                self.assertNotIn("concurrency", config, "Called workflows must not cancel their caller's release group")
                for job in config["jobs"].values():
                    self.assertNotEqual(job.get("permissions", {}).get("contents"), "write")
                    for step in job["steps"]:
                        self.assertNotIn("secrets.", str(step))

    def test_called_modes_load_candidate_before_checks_and_skip_rebuilding_it(self):
        for filename, job_name in (("browser-smoke.yml", "chromium-smoke"), ("security-gate.yml", "security")):
            job = workflow(filename)["jobs"][job_name]
            for event in ("push", "pull_request", "workflow_dispatch"):
                with self.subTest(workflow=filename, event=event):
                    standalone = selected_steps(job, event, "")
                    called = selected_steps(job, event, "prepared-build-123")
                    downloads = [step for step in called if step.get("uses", "").startswith("actions/download-artifact@")]
                    self.assertEqual(len(downloads), 1)
                    self.assertEqual(downloads[0]["with"]["name"], "${{ inputs.rebuild_patch_artifact }}")
                    self.assertNotIn("run-id", downloads[0]["with"])
                    self.assertNotIn("github-token", downloads[0]["with"])
                    self.assertNotIn(downloads[0], standalone)
                    apply_step = shell_step(job, "git apply")
                    self.assertIn(apply_step, called)
                    self.assertNotIn(apply_step, standalone)
                    self.assertNotEqual(apply_step.get("continue-on-error"), "true")
                    self.assertIn("--index", apply_step["run"])
                    self.assertIn("--binary", apply_step["run"])
                    self.assertLess(called.index(downloads[0]), called.index(apply_step))
                    checkout = next(step for step in called if step.get("uses", "").startswith("actions/checkout@"))
                    self.assertIn(checkout.get("with", {}).get("ref", "${{ github.sha }}"), ("${{ github.sha }}",))
                    self.assertLess(called.index(checkout), called.index(apply_step))
                    if filename == "browser-smoke.yml":
                        prepare = shell_step(job, "scripts/repair_catalog_source_integrity.py")
                        build = shell_step(job, "python build_site.py")
                        for step in (prepare, build):
                            self.assertIn(step, standalone)
                            self.assertNotIn(step, called, "Reviewed output must not be regenerated")
                        for command in ("scripts/browser_smoke.py", "scripts/browser_quality_budget.py", "scripts/validate_quality_regression_floors.py"):
                            check = shell_step(job, command)
                            self.assertIn(check, called)
                            self.assertLess(called.index(apply_step), called.index(check))
                    else:
                        check = shell_step(job, "python scripts/security_scan.py")
                        self.assertIn(check, called)
                        self.assertLess(called.index(apply_step), called.index(check))

                    integrity = shell_step(job, "git diff --exit-code")
                    self.assertIn(integrity, called)
                    self.assertNotIn(integrity, standalone)
                    self.assertEqual(called[-1], integrity, "The candidate must stay intact through the last check")
                    self.assertNotEqual(integrity.get("continue-on-error"), "true")


class PreparedPatchIntegrationTests(unittest.TestCase):
    def git(self, root, *args, check=True):
        return subprocess.run(["git", "-C", str(root), *args], check=check, capture_output=True).stdout.decode().strip()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.origin = self.root / "origin.git"
        self.git(self.root, "init", "--bare", "--initial-branch=main", str(self.origin))
        self.seed = self.clone("seed")
        (self.seed / "index.html").write_text("base\n", encoding="utf-8")
        (self.seed / "removed.html").write_text("obsolete\n", encoding="utf-8")
        (self.seed / "photo.webp").write_bytes(b"RIFF\x00before\xff")
        self.commit(self.seed, "base")
        self.git(self.seed, "push", "origin", "main")
        self.base = self.git(self.seed, "rev-parse", "HEAD")
        self.build = self.clone("build")
        (self.build / "index.html").write_text("reviewed\n", encoding="utf-8")
        (self.build / "removed.html").unlink()
        (self.build / "photo.webp").write_bytes(b"RIFF\x00after\xff\x00")
        (self.build / "new.html").write_text("review me too\n", encoding="utf-8")
        self.git(self.build, "add", "-A")
        self.expected_tree = self.git(self.build, "write-tree")
        jobs = workflow("rebuild.yml")["jobs"]
        make_patch = shell_step(jobs["rebuild"], "git diff --cached --binary")
        self.run_shell(self.build, make_patch["run"])
        self.patch = self.build / "rebuild.patch"
        self.assertTrue(self.patch.is_file())
        self.assertGreater(self.patch.stat().st_size, 0)
        self.publish_script = shell_step(jobs["publish"], "git fetch origin main")["run"]
        self.apply_script = shell_step(workflow("browser-smoke.yml")["jobs"]["chromium-smoke"], "git apply")["run"]
        self.integrity_scripts = {
            filename: shell_step(workflow(filename)["jobs"][job_name], "git diff --exit-code")["run"]
            for filename, job_name in (("browser-smoke.yml", "chromium-smoke"), ("security-gate.yml", "security"))
        }

    def clone(self, name):
        destination = self.root / name
        self.git(self.root, "clone", "--quiet", str(self.origin), str(destination))
        self.git(destination, "config", "user.name", "Test")
        self.git(destination, "config", "user.email", "test@example.invalid")
        return destination

    def commit(self, root, message):
        self.git(root, "add", "-A")
        self.git(root, "commit", "--quiet", "-m", message)

    def run_shell(self, root, script, check=True):
        script = script.replace("${{ github.sha }}", self.base if hasattr(self, "base") else "")
        self.assertNotIn("${{", script, "Fixture must expand all GitHub-only expressions")
        env_file = self.root / (root.name + "-environment")
        env = os.environ | {
            "GITHUB_OUTPUT": str(self.root / "outputs"), "GITHUB_SHA": getattr(self, "base", ""),
            "GITHUB_ENV": str(env_file),
        }
        if env_file.exists():
            for line in env_file.read_text("utf-8").splitlines():
                key, _, value = line.partition("=")
                if key == "REVIEWED_TREE":
                    env[key] = value
        return subprocess.run(["bash", "-e", "-o", "pipefail", "-c", script], cwd=root, env=env,
                              check=check, capture_output=True, text=True)

    def test_reviewer_and_publisher_get_identical_binary_added_deleted_candidate(self):
        reviewer = self.clone("reviewer")
        shutil.copyfile(self.patch, reviewer / "rebuild.patch")
        self.run_shell(reviewer, self.apply_script)
        self.assertEqual(self.git(reviewer, "write-tree"), self.expected_tree)
        tracked = self.git(reviewer, "ls-files").splitlines()
        self.assertIn("new.html", tracked)
        self.assertNotIn("removed.html", tracked)
        publisher = self.clone("publisher")
        shutil.copyfile(self.patch, publisher / "rebuild.patch")
        self.run_shell(publisher, self.publish_script)
        self.assertEqual(self.git(self.origin, "rev-parse", "main^{tree}"), self.expected_tree)

    def test_missing_artifact_fails_review_and_publish_without_changing_remote(self):
        reviewer = self.clone("missing-review")
        self.assertNotEqual(self.run_shell(reviewer, self.apply_script, check=False).returncode, 0)
        publisher = self.clone("missing-publish")
        self.assertNotEqual(self.run_shell(publisher, self.publish_script, check=False).returncode, 0)
        self.assertEqual(self.git(self.origin, "rev-parse", "main"), self.base)

    def test_existing_empty_patch_audits_and_publishes_unchanged_base(self):
        reviewer = self.clone("empty-review")
        (reviewer / "rebuild.patch").write_bytes(b"")
        original_tree = self.git(reviewer, "write-tree")
        self.run_shell(reviewer, self.apply_script)
        self.assertEqual(self.git(reviewer, "write-tree"), original_tree)
        publisher = self.clone("empty-publish")
        (publisher / "rebuild.patch").write_bytes(b"")
        self.run_shell(publisher, self.publish_script)
        self.assertEqual(self.git(self.origin, "rev-parse", "main"), self.base)
        output = (self.root / "outputs").read_text("utf-8")
        self.assertIn("revision=" + self.base, output)

    def test_stale_release_cannot_overwrite_concurrent_main_commit(self):
        publisher = self.clone("stale-publish")
        shutil.copyfile(self.patch, publisher / "rebuild.patch")
        (self.seed / "index.html").write_text("newer owner change\n", encoding="utf-8")
        self.commit(self.seed, "newer main")
        self.git(self.seed, "push", "origin", "main")
        newer = self.git(self.origin, "rev-parse", "main")
        self.run_shell(publisher, self.publish_script)
        self.assertEqual(self.git(self.origin, "rev-parse", "main"), newer)
        self.assertEqual(self.git(publisher, "rev-parse", "HEAD"), self.base)

    def test_wrong_checkout_base_rejects_candidate_atomically(self):
        reviewer = self.clone("wrong-base")
        (reviewer / "index.html").write_text("different base\n", encoding="utf-8")
        self.commit(reviewer, "unexpected base")
        unchanged_tree = self.git(reviewer, "write-tree")
        shutil.copyfile(self.patch, reviewer / "rebuild.patch")
        result = self.run_shell(reviewer, self.apply_script, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git(reviewer, "write-tree"), unchanged_tree)
        self.assertFalse((reviewer / "new.html").exists())

    def test_candidate_integrity_allows_untracked_audit_reports(self):
        for number, (filename, guard) in enumerate(self.integrity_scripts.items()):
            with self.subTest(workflow=filename):
                reviewer = self.clone(f"unchanged-{number}")
                shutil.copyfile(self.patch, reviewer / "rebuild.patch")
                self.run_shell(reviewer, self.apply_script)
                (reviewer / ".quality-reports").mkdir()
                (reviewer / ".quality-reports" / "summary.json").write_text('{"passed":true}', encoding="utf-8")
                self.run_shell(reviewer, guard)
                self.assertEqual(self.git(reviewer, "write-tree"), self.expected_tree)

    def test_candidate_integrity_rejects_worktree_and_staged_mutations(self):
        for number, (filename, guard) in enumerate(self.integrity_scripts.items()):
            for staged in (False, True):
                with self.subTest(workflow=filename, mutation="index" if staged else "worktree"):
                    reviewer = self.clone(f"mutated-{number}-{staged}")
                    shutil.copyfile(self.patch, reviewer / "rebuild.patch")
                    self.run_shell(reviewer, self.apply_script)
                    (reviewer / "new.html").write_text("changed after review\n", encoding="utf-8")
                    if staged:
                        self.git(reviewer, "add", "new.html")
                    result = self.run_shell(reviewer, guard, check=False)
                    self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
