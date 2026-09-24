// Dateien im Shop-Repository lesen und schreiben - schnell und auch ueber 1 MiB.
//
// Zwei Grenzen bestimmen den Weg:
//   - Die Contents-API liefert Dateien ueber 1 MiB ohne Inhalt aus. items.json
//     lag im September 2026 mit 1.043.869 Byte nur 4,7 KB darunter.
//   - Ein Cloudflare Worker hat im kostenlosen Tarif 10 ms Rechenzeit je
//     Anfrage. Base64 fuer 1 MB kostet dort bis zu 87 ms (gemessen), Rohtext
//     und JSON.parse zusammen gut 3 ms.
// Deshalb: SHA aus dem Verzeichnis, Inhalt als Roh-Blob; geschrieben wird ueber
// die Git-Datenschnittstelle mit UTF-8-Blobs, ganz ohne Base64.

export const SHOP_REPO = Object.freeze({
  owner: "disorder119",
  repo: "disorder119-shop",
  branch: "main",
});

export class GithubError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function headers(env, userAgent, accept = "application/vnd.github+json") {
  if (!env?.GITHUB_TOKEN) throw new GithubError("github_token_missing");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: accept,
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function base(repo) {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
}

async function gh(env, repo, path, { method = "GET", body, userAgent = "disorder119-shop-worker", accept } = {}) {
  const res = await fetch(`${base(repo)}${path}`, {
    method,
    headers: { ...headers(env, userAgent, accept), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GithubError(`github_${method.toLowerCase()}_${res.status}`, res.status);
  return res;
}

async function ghJson(env, repo, path, options) {
  return (await gh(env, repo, path, options)).json();
}

/** Stand eines Zweigs: Commit und Baum. */
export async function branchHead(env, { repo = SHOP_REPO, userAgent } = {}) {
  const ref = await ghJson(env, repo, `/git/ref/heads/${encodeURIComponent(repo.branch)}`, { userAgent });
  const commitSha = String(ref?.object?.sha || "");
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new GithubError("github_ref_invalid");
  const commit = await ghJson(env, repo, `/git/commits/${commitSha}`, { userAgent });
  const treeSha = String(commit?.tree?.sha || "");
  if (!/^[0-9a-f]{40}$/.test(treeSha)) throw new GithubError("github_commit_invalid");
  return { commitSha, treeSha };
}

/** Eine Datei als Text, optional genau auf einem Commit-Stand. */
export async function readRepoFile(env, path, { userAgent = "disorder119-shop-worker", repo = SHOP_REPO, ref } = {}) {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const entries = await ghJson(env, repo, `/contents/${dir}?ref=${encodeURIComponent(ref || repo.branch)}`, { userAgent });
  const entry = Array.isArray(entries) ? entries.find(e => e?.name === name && e?.type === "file") : null;
  if (!entry?.sha) throw new GithubError("github_file_missing");
  const blob = await gh(env, repo, `/git/blobs/${entry.sha}`, { userAgent, accept: "application/vnd.github.raw+json" });
  return { text: await blob.text(), sha: String(entry.sha) };
}

/**
 * Neuer Commit auf `parent` mit geaenderten Dateien. files:
 *   { path, text }       - Textdatei (UTF-8, ohne Base64)
 *   { path, base64 }     - Binaerdatei (Bild), bereits Base64
 *   { path, remove: true }
 */
export async function createCommit(env, { parent, baseTree, files, message, repo = SHOP_REPO, userAgent }) {
  const tree = [];
  for (const file of files) {
    if (file.remove) {
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await ghJson(env, repo, "/git/blobs", {
      method: "POST",
      userAgent,
      body: file.text !== undefined
        ? { content: file.text, encoding: "utf-8" }
        : { content: file.base64, encoding: "base64" },
    });
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await ghJson(env, repo, "/git/trees", { method: "POST", userAgent, body: { base_tree: baseTree, tree } });
  const commit = await ghJson(env, repo, "/git/commits", {
    method: "POST",
    userAgent,
    body: { message, tree: newTree.sha, parents: [parent] },
  });
  return String(commit.sha);
}

/** Die letzten Commits, die eine Datei geaendert haben - fuer den Verlauf in der Admin-App. */
export async function recentCommits(env, path, { limit = 12, repo = SHOP_REPO, userAgent } = {}) {
  const rows = await ghJson(env, repo, `/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(repo.branch)}&per_page=${limit}`, { userAgent });
  return (Array.isArray(rows) ? rows : []).map(row => ({
    sha: String(row?.sha || "").slice(0, 40),
    message: String(row?.commit?.message || "").split("\n")[0].slice(0, 200),
    date: row?.commit?.author?.date || null,
    author: String(row?.commit?.author?.name || "").slice(0, 80),
  }));
}

/** Zweig nur vorspulen - hat ihn inzwischen jemand weiterbewegt, false. */
export async function fastForward(env, commitSha, { repo = SHOP_REPO, userAgent } = {}) {
  try {
    await gh(env, repo, `/git/refs/heads/${encodeURIComponent(repo.branch)}`, {
      method: "PATCH",
      userAgent,
      body: { sha: commitSha, force: false },
    });
    return true;
  } catch (err) {
    if (err instanceof GithubError && (err.status === 422 || err.status === 409)) return false;
    throw err;
  }
}

/**
 * Commit ueber einen Pull Request nach main bringen. Nur gemergte Pull
 * Requests laesst der Main-Waechter stehen - ein direkter Push waere sofort
 * zurueckgedreht. Liefert false, wenn der PR wegen eines Konflikts nicht
 * mergebar ist (dann neu aufsetzen).
 */
export async function mergeViaPullRequest(env, commitSha, { title, body = "", repo = SHOP_REPO, userAgent }) {
  const branch = `admin/katalog-${Date.now().toString(36)}-${commitSha.slice(0, 7)}`;
  await ghJson(env, repo, "/git/refs", { method: "POST", userAgent, body: { ref: `refs/heads/${branch}`, sha: commitSha } });
  try {
    const pr = await ghJson(env, repo, "/pulls", {
      method: "POST",
      userAgent,
      body: { title, head: branch, base: repo.branch, body, maintainer_can_modify: false },
    });
    try {
      const merged = await ghJson(env, repo, `/pulls/${pr.number}/merge`, {
        method: "PUT",
        userAgent,
        body: { merge_method: "squash", sha: commitSha, commit_title: title },
      });
      return { merged: true, number: pr.number, url: pr.html_url, sha: String(merged.sha || "") };
    } catch (err) {
      await gh(env, repo, `/pulls/${pr.number}`, { method: "PATCH", userAgent, body: { state: "closed" } }).catch(() => {});
      if (err instanceof GithubError && (err.status === 405 || err.status === 409)) return { merged: false };
      throw err;
    }
  } finally {
    await gh(env, repo, `/git/refs/heads/${branch}`, { method: "DELETE", userAgent }).catch(() => {});
  }
}
