import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const admin = fs.readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
const adminSw = fs.readFileSync(new URL("../admin/sw.js", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = admin.indexOf(marker);
  assert.notEqual(start, -1, `function ${name} fehlt`);
  const braceStart = admin.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = braceStart; i < admin.length; i++) {
    const c = admin[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return admin.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} ist unvollständig`);
}

const helperNames = [
  "ghHeaders",
  "githubFailure",
  "githubDelay",
  "githubContentType",
  "githubIsJsonContentType",
  "githubReadText",
  "githubRateLimitDetail",
  "githubErrorFromResponse",
  "githubJsonFromResponse",
  "githubRetryable",
  "githubJsonFetch",
  "readGithubContentsPayload",
];

function makeContext(fetchImpl = async () => {
  throw new TypeError("mock fetch not configured");
}) {
  const context = {
    fetch: fetchImpl,
    Response,
    Headers,
    Date,
    Number,
    String,
    Promise,
    Error,
    TextDecoder,
    TextEncoder,
    setTimeout: (fn) => {
      queueMicrotask(fn);
      return 1;
    },
    clearTimeout: () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    helperNames.map(extractFunction).join("\n") +
      "\nthis.__helpers = {" + helperNames.join(",") + "};",
    context
  );
  return context;
}

test("fine-grained PAT uses documented Bearer headers", () => {
  const { __helpers } = makeContext();
  const headers = __helpers.ghHeaders("mock-fine-grained-token");
  assert.equal(headers.Authorization, "Bearer mock-fine-grained-token");
  assert.equal(headers.Accept, "application/vnd.github+json");
  assert.equal(headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(admin.includes('Authorization: "token " + pat'), false);
});

test("malformed JSON is retried and never leaks parser EOF text", async () => {
  let calls = 0;
  const context = makeContext(async () => {
    calls++;
    if (calls === 1) {
      return new Response('{"sha":', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response('{"sha":"ok"}', {
      status: 200,
      headers: { "Content-Type": "application/vnd.github+json" },
    });
  });
  const result = await context.__helpers.githubJsonFetch("https://api.github.com/mock", {}, "GitHub-Verbindung", 1);
  assert.equal(result.sha, "ok");
  assert.equal(calls, 2);

  calls = 0;
  context.fetch = async () => {
    calls++;
    return new Response('{"sha":', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await assert.rejects(
    context.__helpers.githubJsonFetch("https://api.github.com/mock", {}, "GitHub-Verbindung", 1),
    (err) => {
      assert.equal(err.code, "MALFORMED_JSON");
      assert.match(err.message, /unvollständiges JSON/);
      assert.equal(/Unexpected EOF|Unexpected end/i.test(err.message), false);
      return true;
    }
  );
  assert.equal(calls, 3);
});

test("empty and 204 responses never invoke a JSON parser", async () => {
  let calls = 0;
  const context = makeContext(async () => {
    calls++;
    return new Response("", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  await assert.rejects(
    context.__helpers.githubJsonFetch("https://api.github.com/mock", {}, "GitHub-Verbindung", 1),
    (err) => err.code === "EMPTY" && /leere Antwort/.test(err.message)
  );
  assert.equal(calls, 3);

  const noContent = {
    ok: true,
    status: 204,
    headers: new Headers({ "Content-Type": "application/json" }),
    text() {
      throw new Error("204 body must not be read");
    },
  };
  await assert.rejects(
    context.__helpers.githubJsonFromResponse(noContent, "GitHub-Verbindung"),
    (err) => err.code === "EMPTY" && /HTTP 204/.test(err.message)
  );
});

test("Content-Type is checked before JSON.parse", async () => {
  const context = makeContext();
  const response = new Response("<html>proxy error</html>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
  await assert.rejects(
    context.__helpers.githubJsonFromResponse(response, "GitHub-Verbindung"),
    (err) => err.code === "CONTENT_TYPE" && /text\/html/.test(err.message)
  );
});

test("auth, permission and rate-limit failures are classified", async () => {
  const context = makeContext();

  await assert.rejects(
    context.__helpers.githubJsonFromResponse(
      new Response('{"message":"Bad credentials"}', {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      "GitHub-Verbindung"
    ),
    (err) => err.code === "AUTH"
  );

  await assert.rejects(
    context.__helpers.githubJsonFromResponse(
      new Response('{"message":"Resource not accessible"}', {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": "42",
        },
      }),
      "GitHub-Verbindung"
    ),
    (err) => err.code === "PERMISSION"
  );

  await assert.rejects(
    context.__helpers.githubJsonFromResponse(
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": "0",
          "Retry-After": "60",
        },
      }),
      "GitHub-Verbindung"
    ),
    (err) => err.code === "RATE_LIMIT" && /60 Sekunden/.test(err.message)
  );
});

test("network/CORS-style TypeError is retried then becomes a useful message", async () => {
  let calls = 0;
  const context = makeContext(async () => {
    calls++;
    throw new TypeError("Load failed");
  });
  await assert.rejects(
    context.__helpers.githubJsonFetch("https://api.github.com/mock", {}, "GitHub-Verbindung", 1),
    (err) => err.code === "NETWORK" && /api\.github\.com/.test(err.message) && /CORS/.test(err.message)
  );
  assert.equal(calls, 3);
});

test("large Contents API response follows git_url blob fallback", async () => {
  let capturedHeaders = null;
  const context = makeContext(async (_url, options) => {
    capturedHeaders = options.headers;
    return new Response('{"encoding":"base64","content":"W10="}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const content = await context.__helpers.readGithubContentsPayload(
    {
      encoding: "none",
      content: "",
      git_url: "https://api.github.com/repos/disorder119/disorder119-shop/git/blobs/mock",
    },
    "mock-fine-grained-token"
  );
  assert.equal(content, "W10=");
  assert.equal(capturedHeaders.Authorization, "Bearer mock-fine-grained-token");
});

test("save path uses the same guarded response parser", () => {
  assert.match(admin, /githubJsonFromResponse\(res, "GitHub-Speichern"\)/);
  assert.equal(/\bres\.json\s*\(/.test(admin), false);
  assert.match(admin, /if \(!data \|\| !data\.content \|\| !data\.content\.sha\)/);
});

test("verifyAndBoot has actionable UI branches", async () => {
  const verifySource = extractFunction("verifyAndBoot");
  const helperSource = extractFunction("githubFailure");
  const ui = {
    Promise,
    Error,
    lastError: "",
    currentPat: "",
    boot() {},
    showError(_id, message) {
      ui.lastError = message;
    },
    fetchItems() {
      return Promise.reject(Object.assign(new Error("GitHub-Rate-Limit erreicht. Bitte später erneut versuchen."), { code: "RATE_LIMIT" }));
    },
  };
  vm.createContext(ui);
  vm.runInContext(helperSource + "\n" + verifySource + "\nthis.__verifyAndBoot = verifyAndBoot;", ui);
  await ui.__verifyAndBoot("mock-fine-grained-token", "setupError").catch(() => {});
  assert.match(ui.lastError, /Rate-Limit/);

  ui.fetchItems = () => Promise.reject(
    Object.assign(new Error("Netzwerkzugriff auf api.github.com fehlgeschlagen. Internetverbindung, Content-Blocker oder CORS prüfen."), { code: "NETWORK" })
  );
  await ui.__verifyAndBoot("mock-fine-grained-token", "setupError").catch(() => {});
  assert.match(ui.lastError, /api\.github\.com/);
  assert.match(ui.lastError, /CORS/);
});

test("admin PWA invalidates the pre-fix Safari cache and remains narrow", () => {
  assert.match(adminSw, /CACHE_NAME = CACHE_PREFIX \+ "v2"/);
  assert.match(adminSw, /ADMIN_GITHUB_RESPONSE_V3 cache invalidation/);
  assert.match(adminSw, /url\.origin !== self\.location\.origin/);
  assert.match(adminSw, /request\.method !== "GET"/);
  assert.equal(adminSw.includes("api.github.com"), false);
  assert.equal(adminSw.includes("data/items.json"), false);
});
