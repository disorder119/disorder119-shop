export const MAX_CATALOG_BYTES = 20 * 1024 * 1024;

function catalogError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function decodeBase64Utf8(content) {
  if (typeof content !== "string" || !content.trim()) throw catalogError("catalog_content_missing");
  try {
    const binary = atob(content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    if (bytes.byteLength > MAX_CATALOG_BYTES) throw catalogError("catalog_too_large");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    if (err?.code === "catalog_too_large") throw err;
    throw catalogError("catalog_decode_invalid");
  }
}

function validateItems(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_CATALOG_BYTES) throw catalogError("catalog_too_large");
  let items;
  try {
    items = JSON.parse(text);
  } catch {
    throw catalogError("catalog_json_invalid");
  }
  if (!Array.isArray(items)) throw catalogError("catalog_shape_invalid");
  return items;
}

async function responseJson(response, errorPrefix) {
  if (!response.ok) throw catalogError(`${errorPrefix}_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw catalogError(`${errorPrefix}_invalid_json`);
  }
}

export async function loadGithubCatalog({ owner, repo, branch, path, headers, fetchImpl = fetch }) {
  const contentsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`;
  const file = await responseJson(await fetchImpl(contentsUrl, { headers }), "catalog_load");

  if (!file || typeof file !== "object" || Array.isArray(file)) throw catalogError("catalog_file_invalid");
  if (Number.isFinite(Number(file.size)) && Number(file.size) > MAX_CATALOG_BYTES) throw catalogError("catalog_too_large");
  if (!/^[0-9a-f]{40}$/i.test(String(file.sha || ""))) throw catalogError("catalog_sha_invalid");

  let encoded = null;
  if (String(file.encoding || "").toLowerCase() === "base64" && typeof file.content === "string" && file.content.trim()) {
    encoded = file.content;
  } else {
    const blobUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(file.sha)}`;
    const blob = await responseJson(await fetchImpl(blobUrl, { headers }), "catalog_blob");
    if (String(blob?.encoding || "").toLowerCase() !== "base64" || typeof blob?.content !== "string" || !blob.content.trim()) {
      throw catalogError("catalog_blob_invalid");
    }
    if (Number.isFinite(Number(blob.size)) && Number(blob.size) > MAX_CATALOG_BYTES) throw catalogError("catalog_too_large");
    encoded = blob.content;
  }

  const text = decodeBase64Utf8(encoded);
  return { items: validateItems(text), sha: String(file.sha) };
}
