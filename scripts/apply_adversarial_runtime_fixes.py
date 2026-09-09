#!/usr/bin/env python3
"""Apply runtime fixes proven by adversarial and backend reliability checks.

Protected Match/Chaos/Baukasten behaviour is not modified. Browser layering
fixes remain scoped to shared overlays. Commerce hardening only replaces the
fragile GitHub Contents inline-content assumption with the dedicated catalog
loader, preserving all checkout/rental business rules.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
CSS = BASE / "assets" / "app.css"
WORKER = BASE / "shop-worker" / "worker.js"
PICKER_MARKER = "ADVERSARIAL_MODAL_LAYERING"
QUICKVIEW_MARKER = "ADVERSARIAL_QUICKVIEW_LAYERING"
CATALOG_LOADER_IMPORT = 'import { loadGithubCatalog } from "./catalog-loader.js";'

PICKER_OVERRIDE = r'''

  /* ADVERSARIAL_MODAL_LAYERING
     The one-time global mode hint is z-index 281 while the Baukasten picker
     used 260. On a first visit the hint's close button could therefore sit on
     top of the open picker and intercept its close control. Keep the fixed
     mode rail (300) above the picker, but place an *open* picker above the
     hint. No layout, styling or protected-mode behaviour changes. */
  .outfit-picker.open { z-index: 290; }
'''

QUICKVIEW_OVERRIDE = r'''

  /* ADVERSARIAL_QUICKVIEW_LAYERING
     The shared product quickview used z-index 50 while the global mode rail is
     300. In Chaos this allowed a rail tab to physically cover the modal close
     button. A modal must own pointer/focus interaction while open, so only the
     open backdrop is raised above the rail. */
  .modal-backdrop.open { z-index: 320; }
'''

OLD_CATALOG_LOADER = '''async function loadItems(env) {
  const url = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.itemsPath}?ref=${CONFIG.githubBranch}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`catalog_load_${res.status}`);
  const file = await res.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\\n/g, "")), c => c.charCodeAt(0)));
  return { items: JSON.parse(text), sha: file.sha };
}
'''

NEW_CATALOG_LOADER = '''async function loadItems(env) {
  return loadGithubCatalog({
    owner: CONFIG.githubOwner,
    repo: CONFIG.githubRepo,
    branch: CONFIG.githubBranch,
    path: CONFIG.itemsPath,
    headers: ghHeaders(env),
  });
}
'''


def apply_overlay_fixes() -> list[str]:
    text = CSS.read_text(encoding="utf-8")
    changed = []
    if PICKER_MARKER not in text:
        text = text.rstrip() + PICKER_OVERRIDE + "\n"
        changed.append("Baukasten-Picker vs. Erstbesuchs-Hinweis")
    if QUICKVIEW_MARKER not in text:
        text = text.rstrip() + QUICKVIEW_OVERRIDE + "\n"
        changed.append("Quickview vs. Modusleiste")
    if changed:
        CSS.write_text(text, encoding="utf-8")
    return changed


def apply_catalog_loader() -> bool:
    text = WORKER.read_text(encoding="utf-8")
    changed = False

    if CATALOG_LOADER_IMPORT not in text:
        anchor = '} from "./commerce-core.js";\n'
        if anchor not in text:
            raise SystemExit("Commerce-Core-Importanker fuer Catalog Loader fehlt.")
        text = text.replace(anchor, anchor + CATALOG_LOADER_IMPORT + "\n", 1)
        changed = True

    if NEW_CATALOG_LOADER not in text:
        if OLD_CATALOG_LOADER not in text:
            raise SystemExit("Catalog-Loader-Anker in shop-worker/worker.js fehlt.")
        text = text.replace(OLD_CATALOG_LOADER, NEW_CATALOG_LOADER, 1)
        changed = True

    if changed:
        WORKER.write_text(text, encoding="utf-8")
    return changed


def main() -> None:
    changed = apply_overlay_fixes()
    if apply_catalog_loader():
        changed.append("GitHub-Katalog-Loader mit Blob-Fallback")

    if not changed:
        print("Adversarial Runtime-Fixes bereits aktuell.")
        return
    print("Adversarial Runtime-Fixes angewendet: " + ", ".join(changed) + ".")


if __name__ == "__main__":
    main()
