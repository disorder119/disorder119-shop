#!/usr/bin/env python3
"""Lokaler, deterministischer Import freigestellter Produktfotos.

Das Programm verwendet weder KI noch Netzwerk-APIs. Standardmaessig wird nur
eine Zuordnungsvorschau erzeugt. Erst ``--mode apply`` veraendert die Website.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Sequence


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parent.parent
DEFAULT_SOURCE = Path(r"D:\Doppelkontrolle\Produktfotos - Kopie (2)")
SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}
PRODUCT_PHOTO_FOLDER_NAME = "produktfotos"
WORKFLOW_FOLDERS = {
    "bereits hochgeladen",
    "bereits verkauft",
    "sold",
    "verkauft",
}
DEFAULT_MAX_MIB = 2.0
DEFAULT_MAX_EDGE = 2400
DEFAULT_OWNER = "DISORDER119"
CONFIRM_TEXT = "JA-BILDER-ERSETZEN"
SEQUENCE_PATTERNS = (
    re.compile(r"^(.*?)\s*\((\d+)\)\s*$"),
    re.compile(r"^(.*?)[\s_-]+(\d+)\s*$"),
)


class ImportFailure(RuntimeError):
    """Verstaendlicher, erwarteter Abbruch."""


@dataclass(frozen=True)
class SourcePhoto:
    path: Path
    relative: str
    exact_key: str
    group_key: str
    group_relative: str
    group_name: str
    sequence: int


@dataclass
class PlanRow:
    website_id: int
    article: str
    title: str
    brand: str
    current_gallery: list[str]
    current_look: str
    target_gallery: list[str]
    target_look: str
    manager_item_id: int | None
    manager_match: str
    status: str
    method: str
    reason: str
    source_group: str
    sources: list[str] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        return self.status == "READY" and bool(self.sources)


@dataclass
class ConversionResult:
    website_id: int
    source: str
    target: str
    width: int
    height: int
    quality: int
    bytes: int
    sha256: str
    copyright_embedded: bool
    source_bytes: int = 0
    source_mtime_ns: int = 0


def normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", " und ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def split_sequence(stem: str) -> tuple[str, int]:
    value = stem.strip()
    for pattern in SEQUENCE_PATTERNS:
        match = pattern.match(value)
        if match and match.group(1).strip():
            return match.group(1).strip(), int(match.group(2))
    return value, 1


def canonical_relative_no_extension(relative: str | Path) -> str:
    parts = re.split(r"[\\/]", str(relative))
    clean = [part for part in parts if part not in ("", ".")]
    if not clean:
        return ""
    clean[-1] = Path(clean[-1]).stem
    return "/".join(normalize_text(part) for part in clean)


def canonical_relative_loose(relative: str | Path) -> str:
    parts = re.split(r"[\\/]", str(relative))
    clean = [part for part in parts if part not in ("", ".")]
    if not clean:
        return ""
    clean[-1] = Path(clean[-1]).stem
    normalized = [normalize_text(part) for part in clean]
    normalized = [part for part in normalized if part not in WORKFLOW_FOLDERS]
    return "/".join(normalized)


def source_group_parts(relative: Path) -> tuple[str, str, int]:
    base, sequence = split_sequence(relative.stem)
    parent = "/".join(normalize_text(part) for part in relative.parent.parts)
    group_name = normalize_text(base)
    group_key = f"{parent}/{group_name}" if parent else group_name
    display = (relative.parent / base).as_posix()
    return group_key, display, sequence


def relative_after_product_photos(value: object) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parts = list(PureWindowsPath(raw).parts)
    except (TypeError, ValueError):
        return None
    indexes = [i for i, part in enumerate(parts) if normalize_text(part) == PRODUCT_PHOTO_FOLDER_NAME]
    if not indexes:
        return None
    tail = parts[indexes[-1] + 1 :]
    return "/".join(tail) if tail else None


class SourceIndex:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.photos: list[SourcePhoto] = []
        self.by_exact: dict[str, list[SourcePhoto]] = defaultdict(list)
        self.by_loose: dict[str, list[SourcePhoto]] = defaultdict(list)
        self.by_group: dict[str, list[SourcePhoto]] = defaultdict(list)
        self.groups_by_name: dict[str, set[str]] = defaultdict(set)
        self.groups_by_article_tag: dict[str, set[str]] = defaultdict(set)

    def scan(self) -> "SourceIndex":
        if not self.root.is_dir():
            raise ImportFailure(f"Quellordner nicht gefunden: {self.root}")
        for path in sorted(self.root.rglob("*"), key=lambda p: str(p).casefold()):
            if not path.is_file() or path.suffix.casefold() not in SUPPORTED_EXTENSIONS:
                continue
            relative_path = path.relative_to(self.root)
            group_key, group_relative, sequence = source_group_parts(relative_path)
            photo = SourcePhoto(
                path=path,
                relative=relative_path.as_posix(),
                exact_key=canonical_relative_no_extension(relative_path),
                group_key=group_key,
                group_relative=group_relative,
                group_name=normalize_text(split_sequence(relative_path.stem)[0]),
                sequence=sequence,
            )
            self.photos.append(photo)
            self.by_exact[photo.exact_key].append(photo)
            self.by_loose[canonical_relative_loose(relative_path)].append(photo)
            self.by_group[photo.group_key].append(photo)
            self.groups_by_name[photo.group_name].add(photo.group_key)
            for article_tag in re.findall(r"#\s*0*(\d+)", split_sequence(relative_path.stem)[0]):
                self.groups_by_article_tag[article_tag].add(photo.group_key)
        for group in self.by_group.values():
            group.sort(key=lambda p: (p.sequence, p.relative.casefold()))
        if not self.photos:
            raise ImportFailure(f"Keine Bilddateien im Quellordner gefunden: {self.root}")
        return self

    def exact(self, relative: str) -> SourcePhoto | None:
        matches = self.by_exact.get(canonical_relative_no_extension(relative), [])
        if len(matches) == 1:
            return matches[0]
        loose_matches = self.by_loose.get(canonical_relative_loose(relative), [])
        return loose_matches[0] if len(loose_matches) == 1 else None

    def unique_group_by_name(self, value: object) -> list[SourcePhoto] | None:
        keys = sorted(self.groups_by_name.get(normalize_text(value), set()))
        return self.by_group[keys[0]] if len(keys) == 1 else None

    def group_by_display(self, value: str) -> list[SourcePhoto] | None:
        wanted = canonical_relative_no_extension(value)
        keys = [
            key
            for key, rows in self.by_group.items()
            if canonical_relative_no_extension(rows[0].group_relative) == wanted
        ]
        return self.by_group[keys[0]] if len(keys) == 1 else None

    def unique_group_by_article(self, article: object) -> list[SourcePhoto] | None:
        raw = re.sub(r"\D", "", str(article or ""))
        candidates = [raw]
        if len(raw) == 4 and raw.startswith("2"):
            candidates.append(str(int(raw[1:])))
        keys: set[str] = set()
        for candidate in candidates:
            keys.update(self.groups_by_article_tag.get(candidate, set()))
        return self.by_group[next(iter(keys))] if len(keys) == 1 else None


def discover_databases() -> list[Path]:
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    preferred = (
        local
        / "Disorder119ManagerStudio"
        / "profiles"
        / "default_3_0"
        / "database"
        / "disorder119.db"
    )
    legacy = (
        local
        / "Disorder119Manager"
        / "profiles"
        / "default_1_3"
        / "database"
        / "disorder119.db"
    )
    return [path for path in (preferred, legacy) if path.is_file()]


class ManagerCatalog:
    IMAGE_PATH_FIELDS = (
        "original_import_path",
        "original_file_path",
        "image_origin",
        "file_path",
        "current_file_path",
    )

    def __init__(self, database: Path) -> None:
        self.database = database
        self.items: list[dict] = []
        self.by_id: dict[int, dict] = {}
        self.by_article: dict[str, list[dict]] = defaultdict(list)
        self.by_title: dict[str, list[dict]] = defaultdict(list)
        self.by_title_brand: dict[tuple[str, str], list[dict]] = defaultdict(list)
        self.images_by_item: dict[int, list[dict]] = defaultdict(list)

    def load(self) -> "ManagerCatalog":
        if not self.database.is_file():
            raise ImportFailure(f"Manager-Datenbank nicht gefunden: {self.database}")
        uri = self.database.resolve().as_uri() + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            item_columns = {row[1] for row in connection.execute("PRAGMA table_info(items)")}
            image_columns = {row[1] for row in connection.execute("PRAGMA table_info(item_images)")}
            required_items = {"id", "article_number", "title", "brand"}
            required_images = {"id", "item_id", "sort_order"}
            if not required_items.issubset(item_columns) or not required_images.issubset(image_columns):
                raise ImportFailure("Die Manager-Datenbank hat nicht das erwartete Katalogschema.")
            item_fields = [
                name
                for name in (
                    "id",
                    "article_number",
                    "source_article_number",
                    "original_article_number",
                    "title",
                    "brand",
                    "status",
                    "shooting_folder",
                )
                if name in item_columns
            ]
            image_fields = [
                name
                for name in (
                    "id",
                    "item_id",
                    "sort_order",
                    "is_main",
                    *self.IMAGE_PATH_FIELDS,
                )
                if name in image_columns
            ]
            self.items = [
                dict(row)
                for row in connection.execute(f"SELECT {','.join(item_fields)} FROM items")
            ]
            images = [
                dict(row)
                for row in connection.execute(
                    f"SELECT {','.join(image_fields)} FROM item_images ORDER BY item_id, sort_order, id"
                )
            ]
        finally:
            connection.close()

        for item in self.items:
            item_id = int(item["id"])
            self.by_id[item_id] = item
            for field_name in ("article_number", "source_article_number", "original_article_number"):
                value = str(item.get(field_name) or "").strip()
                if value and item not in self.by_article[value]:
                    self.by_article[value].append(item)
            title_key = normalize_text(item.get("title"))
            brand_key = normalize_text(item.get("brand"))
            if title_key:
                self.by_title[title_key].append(item)
                self.by_title_brand[(title_key, brand_key)].append(item)
        for image in images:
            self.images_by_item[int(image["item_id"])].append(image)
        return self

    def resolve_item(
        self,
        website_item: dict,
        reserved_item_ids: set[int] | None = None,
    ) -> tuple[dict | None, str]:
        reserved_item_ids = reserved_item_ids or set()
        website_id = int(website_item.get("id") or 0)
        direct = self.by_id.get(website_id)
        title_key = normalize_text(website_item.get("title"))
        brand_key = normalize_text(website_item.get("brand"))
        article = str(website_item.get("article") or "").strip()
        article_candidates = [article]
        if len(article) == 4 and article.startswith("2") and article.isdigit():
            article_candidates.append(str(int(article[1:])))
        direct_articles = {
            str(direct.get(field_name) or "").strip()
            for field_name in (
                "article_number",
                "source_article_number",
                "original_article_number",
            )
        } if direct else set()
        if (
            direct
            and (
                (
                    normalize_text(direct.get("title")) == title_key
                    and normalize_text(direct.get("brand")) == brand_key
                )
                or (
                    bool(direct_articles.intersection(article_candidates))
                    and (
                        not normalize_text(direct.get("brand"))
                        or normalize_text(direct.get("brand")) == brand_key
                    )
                )
            )
        ):
            return direct, "id_exact"

        title_brand = self.by_title_brand.get((title_key, brand_key), [])
        if len(title_brand) == 1 and (
            int(title_brand[0]["id"]) not in reserved_item_ids
            or int(title_brand[0]["id"]) == website_id
        ):
            return title_brand[0], "title_brand_exact"

        title_only = self.by_title.get(title_key, [])
        if len(title_only) == 1 and (
            int(title_only[0]["id"]) not in reserved_item_ids
            or int(title_only[0]["id"]) == website_id
        ):
            return title_only[0], "title_exact"

        article_rows: list[dict] = []
        for candidate in article_candidates:
            for row in self.by_article.get(candidate, []):
                if row not in article_rows:
                    article_rows.append(row)
        title_rows = [
            row
            for row in article_rows
            if normalize_text(row.get("title")) == title_key
        ]
        if len(title_rows) == 1:
            return title_rows[0], "article_title_exact"
        brand_rows = [
            row
            for row in article_rows
            if brand_key and normalize_text(row.get("brand")) == brand_key
        ]
        if len(brand_rows) == 1:
            return brand_rows[0], "article_alias_brand"
        if (
            len(article_rows) == 1
            and len(article) == 4
            and article.startswith("2")
            and article.isdigit()
            and str(article_rows[0].get("article_number") or "")
            == str(int(article[1:]))
        ):
            return article_rows[0], "article_block_alias_unique"
        return None, "none"

    def exact_source_photos(
        self, item_id: int, source_index: SourceIndex
    ) -> tuple[list[SourcePhoto], int, list[str]]:
        photos: list[SourcePhoto] = []
        expected_keys: set[str] = set()
        missing: list[str] = []
        seen_paths: set[Path] = set()
        for image in self.images_by_item.get(item_id, []):
            relative = None
            for field_name in self.IMAGE_PATH_FIELDS:
                relative = relative_after_product_photos(image.get(field_name))
                if relative:
                    break
            if not relative:
                continue
            key = canonical_relative_no_extension(relative)
            if key in expected_keys:
                continue
            expected_keys.add(key)
            photo = source_index.exact(relative)
            if photo is None:
                missing.append(relative)
            elif photo.path not in seen_paths:
                seen_paths.add(photo.path)
                photos.append(photo)
        return photos, len(expected_keys), missing


def load_website_items(repo_root: Path) -> list[dict]:
    path = repo_root / "data" / "items.json"
    if not path.is_file():
        raise ImportFailure(f"Website-Katalog nicht gefunden: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ImportFailure("data/items.json enthaelt keine Artikelliste.")
    return data


def load_overrides(path: Path | None) -> dict[int, str]:
    if path is None:
        return {}
    if not path.is_file():
        raise ImportFailure(f"Zuordnungsdatei nicht gefunden: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    overrides: dict[int, str] = {}
    for row in rows:
        raw_id = str(row.get("website_id") or "").strip()
        group = str(row.get("override_source_group") or "").strip()
        if raw_id.isdigit() and group:
            overrides[int(raw_id)] = group
    return overrides


def target_gallery_for(item: dict, count: int) -> list[str]:
    current = [str(path) for path in (item.get("gallery") or []) if path]
    if current:
        parent = PurePosixPath(current[0]).parent
        targets = current[:count]
        used_numbers = {
            int(PurePosixPath(path).stem)
            for path in current
            if PurePosixPath(path).parent == parent and PurePosixPath(path).stem.isdigit()
        }
        next_number = max(used_numbers, default=-1) + 1
        while len(targets) < count:
            while next_number in used_numbers:
                next_number += 1
            targets.append((parent / f"{next_number}.webp").as_posix())
            used_numbers.add(next_number)
            next_number += 1
        return targets
    parent = PurePosixPath("assets") / "img" / str(item.get("id"))
    return [(parent / f"{index}.webp").as_posix() for index in range(count)]


def make_plan(
    website_items: list[dict],
    managers: list[ManagerCatalog],
    source_index: SourceIndex,
    overrides: dict[int, str],
    keep_look: bool,
) -> list[PlanRow]:
    rows: list[PlanRow] = []
    reserved_by_manager: list[set[int]] = []
    for manager in managers:
        reserved_by_manager.append(
            {
                int(website_item.get("id") or 0)
                for website_item in website_items
                if int(website_item.get("id") or 0) in manager.by_id
                and normalize_text(
                    manager.by_id[int(website_item.get("id") or 0)].get("title")
                )
                == normalize_text(website_item.get("title"))
                and normalize_text(
                    manager.by_id[int(website_item.get("id") or 0)].get("brand")
                )
                == normalize_text(website_item.get("brand"))
            }
        )
    method_priority = {
        "id_exact": 0,
        "title_brand_exact": 1,
        "title_exact": 2,
        "article_title_exact": 3,
        "article_alias_brand": 4,
        "article_block_alias_unique": 5,
    }
    for website_item in website_items:
        website_id = int(website_item.get("id") or 0)
        candidates: list[tuple[int, int, ManagerCatalog, dict, str]] = []
        for index, manager in enumerate(managers):
            item, match = manager.resolve_item(
                website_item,
                reserved_by_manager[index],
            )
            if item:
                candidates.append(
                    (method_priority.get(match, 99), index, manager, item, match)
                )
        if candidates:
            _, _, selected_manager, manager_item, manager_match = min(candidates)
        else:
            selected_manager = None
            manager_item = None
            manager_match = "none"
        sources: list[SourcePhoto] = []
        status = "UNMATCHED"
        method = "none"
        reason = "Keine eindeutige Quelle gefunden."

        override = overrides.get(website_id)
        if override:
            override_group = source_index.group_by_display(override)
            if override_group:
                sources = override_group
                status = "READY"
                method = "manual_override"
                reason = "Manuell freigegebene Quellgruppe."
            else:
                status = "AMBIGUOUS"
                method = "manual_override_missing"
                reason = f"Manuelle Quellgruppe wurde nicht eindeutig gefunden: {override}"

        if not sources and not override and manager_item:
            exact, expected_count, missing = selected_manager.exact_source_photos(
                int(manager_item["id"]), source_index
            )
            if exact and len(exact) == expected_count:
                sources = exact
                status = "READY"
                method = "manager_paths_exact"
                reason = f"Alle {len(exact)} Manager-Originalpfade stimmen exakt ueberein."
            elif exact:
                matched_groups = {photo.group_key for photo in exact}
                article_group = source_index.unique_group_by_article(
                    website_item.get("article")
                )
                article_group_key = article_group[0].group_key if article_group else ""
                if len(matched_groups) == 1:
                    sources = source_index.by_group[next(iter(matched_groups))]
                    status = "READY"
                    method = "manager_group_complete"
                    reason = (
                        f"{len(exact)} Manager-Pfade bestaetigen dieselbe Quellgruppe; "
                        f"alle {len(sources)} vorhandenen Freisteller werden verwendet."
                    )
                elif article_group and article_group_key in matched_groups:
                    sources = article_group
                    status = "READY"
                    method = "manager_article_group"
                    reason = (
                        "Mehrere fehlerhafte Manager-Pfade gefunden; die eindeutige "
                        "Artikelnummer waehlt die passende Quellgruppe."
                    )
                else:
                    sources = exact
                    status = "PARTIAL"
                    method = "manager_paths_partial"
                    reason = (
                        f"Nur {len(exact)} von {expected_count} Manager-Originalen gefunden; "
                        f"fehlt: {', '.join(missing[:3])}"
                    )

        if not sources and not override and manager_item:
            title_group = source_index.unique_group_by_name(manager_item.get("title"))
            if title_group:
                sources = title_group
                status = "READY"
                method = "manager_title_unique"
                reason = "Manager-Titel stimmt eindeutig mit genau einer Quellgruppe ueberein."

        if not sources and not override:
            title_group = source_index.unique_group_by_name(website_item.get("title"))
            if title_group:
                sources = title_group
                status = "READY"
                method = "website_title_unique"
                reason = "Website-Titel stimmt eindeutig mit genau einer Quellgruppe ueberein."

        if not sources and not override:
            article_group = source_index.unique_group_by_article(
                website_item.get("article")
            )
            if article_group:
                sources = article_group
                status = "READY"
                method = "shooting_article_unique"
                reason = (
                    "Die Shooting-Artikelnummer stimmt eindeutig mit genau einer "
                    "Quellgruppe ueberein."
                )

        target_gallery = target_gallery_for(website_item, len(sources)) if sources else []
        existing_look = str(website_item.get("look") or "")
        target_look = existing_look if keep_look or not target_gallery else target_gallery[0]
        rows.append(
            PlanRow(
                website_id=website_id,
                article=str(website_item.get("article") or ""),
                title=str(website_item.get("title") or ""),
                brand=str(website_item.get("brand") or ""),
                current_gallery=[str(path) for path in (website_item.get("gallery") or [])],
                current_look=existing_look,
                target_gallery=target_gallery,
                target_look=target_look,
                manager_item_id=int(manager_item["id"]) if manager_item else None,
                manager_match=manager_match,
                status=status,
                method=method,
                reason=reason,
                source_group=sources[0].group_relative if sources else "",
                sources=[photo.relative for photo in sources],
            )
        )

    rows_by_source: dict[str, list[PlanRow]] = defaultdict(list)
    for row in rows:
        if row.ready:
            for source in row.sources:
                rows_by_source[source].append(row)
    for source, collisions in rows_by_source.items():
        unique_rows = {row.website_id: row for row in collisions}
        if len(unique_rows) < 2:
            continue
        brands = {normalize_text(row.brand) for row in unique_rows.values()}
        title_tokens = [
            set(normalize_text(row.title).split()) - {"nr"}
            for row in unique_rows.values()
        ]
        same_product = (
            len(brands) == 1
            and all(brands)
            and all(title_tokens)
            and all(
                left.issubset(right) or right.issubset(left)
                for left in title_tokens
                for right in title_tokens
            )
        )
        if same_product:
            continue
        collision_ids = ", ".join(str(item_id) for item_id in sorted(unique_rows))
        for row in unique_rows.values():
            row.status = "AMBIGUOUS"
            row.method = "source_collision"
            row.reason = (
                f"Dieselbe Quelle waere mehreren Website-Artikeln zugeordnet "
                f"({collision_ids}); Beispiel: {source}"
            )
    return rows


def write_plan(
    output_dir: Path,
    rows: list[PlanRow],
    source_index: SourceIndex,
    databases: list[Path],
    max_mib: float,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row.status] += 1
    ready_photos = sum(len(row.sources) for row in rows if row.ready)
    used_sources = {
        source
        for row in rows
        if row.ready
        for source in row.sources
    }
    unused_groups = [
        {
            "source_group": photos[0].group_relative,
            "photo_count": len(photos),
            "sources": [photo.relative for photo in photos],
        }
        for photos in source_index.by_group.values()
        if not any(photo.relative in used_sources for photo in photos)
    ]
    unused_groups.sort(key=lambda row: row["source_group"].casefold())
    payload = {
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_root": str(source_index.root),
        "manager_databases": [str(database) for database in databases],
        "max_mib_per_gallery_image": max_mib,
        "summary": {
            "website_items": len(rows),
            "ready_items": counts["READY"],
            "ready_photo_assignments": ready_photos,
            "unique_ready_source_photos": len(used_sources),
            "unused_source_photos": len(source_index.photos) - len(used_sources),
            "unused_source_groups": len(unused_groups),
            "partial_items": counts["PARTIAL"],
            "ambiguous_items": counts["AMBIGUOUS"],
            "unmatched_items": counts["UNMATCHED"],
            "absolute_max_output_gib": round(ready_photos * max_mib / 1024, 3),
        },
        "unused_sources_without_website_item": unused_groups,
        "items": [asdict(row) for row in rows],
    }
    json_path = output_dir / "fotoimport_plan.json"
    csv_path = output_dir / "fotoimport_zuordnung.csv"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        fields = [
            "website_id",
            "article",
            "title",
            "brand",
            "status",
            "method",
            "manager_item_id",
            "source_count",
            "current_gallery_count",
            "source_group",
            "reason",
            "override_source_group",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter=";")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "website_id": row.website_id,
                    "article": row.article,
                    "title": row.title,
                    "brand": row.brand,
                    "status": row.status,
                    "method": row.method,
                    "manager_item_id": row.manager_item_id or "",
                    "source_count": len(row.sources),
                    "current_gallery_count": len(row.current_gallery),
                    "source_group": row.source_group,
                    "reason": row.reason,
                    "override_source_group": "",
                }
            )
    return json_path, csv_path


def require_pillow():
    try:
        from PIL import Image, ImageOps, features
    except ImportError as exc:
        raise ImportFailure(
            "Pillow fehlt. Einmalig lokal installieren: py -3 -m pip install Pillow"
        ) from exc
    if not features.check("webp"):
        raise ImportFailure("Diese Pillow-Installation unterstuetzt WebP nicht.")
    return Image, ImageOps


def copyright_metadata(Image, owner: str) -> tuple[object, bytes, str]:
    year = datetime.now().year
    notice = f"Copyright {year} {owner}. Alle Rechte vorbehalten."
    exif = Image.Exif()
    exif[270] = "Freigestelltes Produktfoto fuer DISORDER119"
    exif[305] = "DISORDER119 Local Photo Importer"
    exif[315] = owner
    exif[33432] = notice
    xmp = (
        '<?xpacket begin="\ufeff"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" '
        f'dc:rights="{notice}" xmpRights:Marked="True" xmpRights:Owner="{owner}"/>'
        '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    ).encode("utf-8")
    return exif, xmp, notice


def encode_webp(
    source: Path, max_bytes: int, max_edge: int, owner: str
) -> tuple[bytes, int, int, int, bool]:
    Image, ImageOps = require_pillow()
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
        image = image.convert("RGBA" if has_alpha else "RGB")
        image.thumbnail(
            (max_edge, max_edge),
            Image.Resampling.LANCZOS,
            reducing_gap=3.0,
        )

    exif, xmp, notice = copyright_metadata(Image, owner)
    minimum_quality = 72
    chosen: tuple[bytes, int] | None = None
    for resize_round in range(9):
        qualities: Sequence[int]
        if resize_round == 0:
            qualities = (100, 98, 96, 94, 92, 90, 88, 85, 82, 78, 74, minimum_quality)
        else:
            qualities = (92, 88, 84, 80, 76, minimum_quality)
        for quality in qualities:
            buffer = io.BytesIO()
            image.save(
                buffer,
                format="WEBP",
                quality=quality,
                method=6,
                exact=True,
                exif=exif,
                xmp=xmp,
            )
            payload = buffer.getvalue()
            if len(payload) <= max_bytes:
                chosen = (payload, quality)
                break
        if chosen:
            break
        ratio = max(
            0.72,
            min(0.92, (max_bytes / max(1, len(payload))) ** 0.5 * 0.97),
        )
        new_size = (
            max(320, int(image.width * ratio)),
            max(320, int(image.height * ratio)),
        )
        if new_size == image.size:
            break
        image = image.resize(new_size, Image.Resampling.LANCZOS)
    if chosen is None:
        raise ImportFailure(
            f"Bild kann nicht unter {max_bytes / 1024 / 1024:.2f} MiB gebracht werden: {source}"
        )

    payload, quality = chosen
    embedded = False
    try:
        with Image.open(io.BytesIO(payload)) as verification:
            embedded = notice in str(verification.getexif().get(33432, ""))
    except Exception:
        embedded = False
    return payload, image.width, image.height, quality, embedded


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=path.parent,
        prefix=path.name + ".",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def make_thumbnail(webp_payload: bytes, owner: str) -> bytes:
    Image, _ = require_pillow()
    with Image.open(io.BytesIO(webp_payload)) as opened:
        thumb = opened.convert("RGBA")
        thumb.thumbnail((220, 293), Image.Resampling.LANCZOS, reducing_gap=3.0)
        exif, xmp, _ = copyright_metadata(Image, owner)
        buffer = io.BytesIO()
        thumb.save(
            buffer,
            format="WEBP",
            quality=80,
            method=6,
            exact=True,
            exif=exif,
            xmp=xmp,
        )
        return buffer.getvalue()


def make_display_preview(webp_payload: bytes, owner: str) -> bytes:
    Image, _ = require_pillow()
    with Image.open(io.BytesIO(webp_payload)) as opened:
        preview = opened.convert("RGBA")
        preview.thumbnail((960, 960), Image.Resampling.LANCZOS, reducing_gap=3.0)
        exif, xmp, _ = copyright_metadata(Image, owner)
        buffer = io.BytesIO()
        preview.save(
            buffer,
            format="WEBP",
            quality=90,
            method=6,
            exact=True,
            exif=exif,
            xmp=xmp,
        )
        return buffer.getvalue()


def thumb_path(target: str) -> str:
    path = PurePosixPath(target)
    return (path.parent / "thumbs" / path.name).as_posix()


def display_path(target: str) -> str:
    path = PurePosixPath(target)
    return (path.parent / "display" / path.name).as_posix()


def build_display_previews(
    rows: list[PlanRow], staging_root: Path, owner: str, workers: int
) -> None:
    jobs = []
    for row in rows:
        if not row.target_gallery:
            continue
        source = staging_root / Path(*PurePosixPath(row.target_gallery[0]).parts)
        target = staging_root / Path(*PurePosixPath(display_path(row.target_gallery[0])).parts)
        jobs.append((source, target))

    def work(job: tuple[Path, Path]) -> Path:
        source, target = job
        if not source.is_file():
            raise ImportFailure(f"Galeriebild fuer Anzeigevorschau fehlt: {source}")
        atomic_write(target, make_display_preview(source.read_bytes(), owner))
        return target

    print(f"Erzeuge {len(jobs)} schnelle Produkt-Anzeigevorschauen ...", flush=True)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [executor.submit(work, job) for job in jobs]
        for position, future in enumerate(as_completed(futures), 1):
            future.result()
            if position % 25 == 0 or position == len(jobs):
                print(f"Anzeigevorschauen: {position}/{len(jobs)}", flush=True)


def select_ready_rows(
    rows: list[PlanRow], item_ids: set[int], limit_items: int
) -> list[PlanRow]:
    selected = [
        row
        for row in rows
        if row.ready and (not item_ids or row.website_id in item_ids)
    ]
    if limit_items > 0:
        selected = selected[:limit_items]
    return selected


def convert_rows(
    rows: list[PlanRow],
    source_index: SourceIndex,
    staging_root: Path,
    max_mib: float,
    max_edge: int,
    owner: str,
    workers: int,
    progress_path: Path,
    log_path: Path,
) -> list[ConversionResult]:
    max_bytes = int(max_mib * 1024 * 1024)
    jobs: list[tuple[PlanRow, SourcePhoto, str]] = []
    seen_jobs: set[tuple[str, str]] = set()
    by_relative = {photo.relative: photo for photo in source_index.photos}
    for row in rows:
        for source_relative, target in zip(row.sources, row.target_gallery):
            job_key = (source_relative, target)
            if job_key in seen_jobs:
                continue
            seen_jobs.add(job_key)
            jobs.append((row, by_relative[source_relative], target))
    if not jobs:
        raise ImportFailure(
            "Keine eindeutig zugeordneten Bilder fuer die Konvertierung ausgewaehlt."
        )

    progress_path.parent.mkdir(parents=True, exist_ok=True)
    completed: dict[str, ConversionResult] = {}
    if progress_path.is_file():
        for line in progress_path.read_text(encoding="utf-8").splitlines():
            try:
                saved = ConversionResult(**json.loads(line))
                completed[saved.target] = saved
            except (TypeError, ValueError, json.JSONDecodeError):
                continue

    def append_record(result: ConversionResult) -> None:
        with progress_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(asdict(result), ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def reusable(
        result: ConversionResult, source: SourcePhoto, target: str
    ) -> bool:
        destination = staging_root / Path(*PurePosixPath(target).parts)
        thumbnail = staging_root / Path(*PurePosixPath(thumb_path(target)).parts)
        if result.source != source.relative or not destination.is_file() or not thumbnail.is_file():
            return False
        stat = source.path.stat()
        if result.source_bytes and result.source_bytes != stat.st_size:
            return False
        if result.source_mtime_ns and result.source_mtime_ns != stat.st_mtime_ns:
            return False
        if destination.stat().st_size > max_bytes:
            return False
        return hashlib.sha256(destination.read_bytes()).hexdigest() == result.sha256

    def recover_existing(
        row: PlanRow, source: SourcePhoto, target: str
    ) -> ConversionResult | None:
        destination = staging_root / Path(*PurePosixPath(target).parts)
        thumbnail = staging_root / Path(*PurePosixPath(thumb_path(target)).parts)
        if not destination.is_file() or not thumbnail.is_file():
            return None
        payload = destination.read_bytes()
        if len(payload) > max_bytes:
            return None
        try:
            Image, _ = require_pillow()
            with Image.open(io.BytesIO(payload)) as opened:
                width, height = opened.size
                embedded = owner in str(opened.getexif().get(33432, ""))
        except Exception:
            return None
        if not embedded:
            return None
        source_stat = source.path.stat()
        return ConversionResult(
            website_id=row.website_id,
            source=source.relative,
            target=target,
            width=width,
            height=height,
            quality=-1,
            bytes=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
            copyright_embedded=True,
            source_bytes=source_stat.st_size,
            source_mtime_ns=source_stat.st_mtime_ns,
        )

    resumed: list[ConversionResult] = []
    pending: list[tuple[PlanRow, SourcePhoto, str]] = []
    for row, source, target in jobs:
        saved = completed.get(target)
        if saved and reusable(saved, source, target):
            resumed.append(saved)
        else:
            recovered = recover_existing(row, source, target)
            if recovered:
                append_record(recovered)
                resumed.append(recovered)
            else:
                pending.append((row, source, target))

    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n{datetime.now():%Y-%m-%d %H:%M:%S} START: "
            f"{len(resumed)}/{len(jobs)} wiederaufgenommen, "
            f"{len(pending)} verbleibend.\n"
        )
    if resumed:
        print(
            f"Wiederaufnahme: {len(resumed)} bereits fertige Fotos geprueft; "
            "sie werden nicht erneut konvertiert.",
            flush=True,
        )

    def work(job: tuple[PlanRow, SourcePhoto, str]) -> ConversionResult:
        row, source, target = job
        payload, width, height, quality, embedded = encode_webp(
            source.path,
            max_bytes,
            max_edge,
            owner,
        )
        destination = staging_root / Path(*PurePosixPath(target).parts)
        atomic_write(destination, payload)
        atomic_write(
            staging_root / Path(*PurePosixPath(thumb_path(target)).parts),
            make_thumbnail(payload, owner),
        )
        source_stat = source.path.stat()
        return ConversionResult(
            website_id=row.website_id,
            source=source.relative,
            target=target,
            width=width,
            height=height,
            quality=quality,
            bytes=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
            copyright_embedded=embedded,
            source_bytes=source_stat.st_size,
            source_mtime_ns=source_stat.st_mtime_ns,
        )

    results: list[ConversionResult] = list(resumed)
    total = len(jobs)
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(work, job): job for job in pending}
        for new_position, future in enumerate(as_completed(futures), 1):
            result = future.result()
            results.append(result)
            append_record(result)
            position = len(resumed) + new_position
            elapsed = max(0.001, time.monotonic() - started)
            seconds_left = elapsed / new_position * (total - position)
            finish_at = datetime.now() + timedelta(seconds=seconds_left)
            message = (
                f"[{position:>4}/{total}] #{result.website_id} {result.target} "
                f"{result.width}x{result.height}, "
                f"{result.bytes / 1024:.0f} KiB, Q{result.quality} | "
                f"ETA {finish_at:%H:%M} ({timedelta(seconds=int(seconds_left))})"
            )
            print(message, flush=True)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {message}\n")
    results.sort(key=lambda result: (result.website_id, result.target))
    return results


def write_staged_items(
    repo_root: Path,
    staging_root: Path,
    selected: list[PlanRow],
) -> Path:
    items = load_website_items(repo_root)
    changes = {row.website_id: row for row in selected}
    for item in items:
        row = changes.get(int(item.get("id") or 0))
        if row:
            item["gallery"] = row.target_gallery
            if row.target_look:
                item["look"] = row.target_look
    destination = staging_root / "data" / "items.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return destination


def git_read_head(repo_root: Path, relative: str) -> bytes | None:
    process = subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={repo_root.as_posix()}",
            "-C",
            str(repo_root),
            "show",
            f"HEAD:{relative}",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return process.stdout if process.returncode == 0 else None


def expose_tracked_sparse_paths(repo_root: Path, relatives: list[str]) -> None:
    base = [
        "git",
        "-c",
        f"safe.directory={repo_root.as_posix()}",
        "-C",
        str(repo_root),
    ]
    listed = subprocess.run(
        [*base, "ls-files", "-z", "--", "assets/img"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if listed.returncode != 0:
        return
    tracked = {
        value.decode("utf-8", errors="surrogateescape")
        for value in listed.stdout.split(b"\0")
        if value
    }
    selected = sorted(set(relatives).intersection(tracked))
    for start in range(0, len(selected), 100):
        subprocess.run(
            [
                *base,
                "update-index",
                "--no-skip-worktree",
                "--",
                *selected[start : start + 100],
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )


def backup_file(repo_root: Path, backup_root: Path, relative: str) -> None:
    destination = backup_root / Path(*PurePosixPath(relative).parts)
    source = repo_root / Path(*PurePosixPath(relative).parts)
    if source.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return
    payload = git_read_head(repo_root, relative)
    if payload is not None:
        atomic_write(destination, payload)


def apply_staging(
    repo_root: Path,
    staging_root: Path,
    selected: list[PlanRow],
    run_root: Path,
    run_build: bool,
    prune_stale: bool,
    backup_assets: bool,
) -> tuple[Path, list[str]]:
    backup_root = run_root / "backup_vor_import"
    backup_file(repo_root, backup_root, "data/items.json")
    old_gallery_paths = {
        path
        for row in selected
        for path in row.current_gallery
        if path.startswith("assets/img/")
    }
    old_look_paths = {
        row.current_look
        for row in selected
        if row.current_look.startswith("assets/img/")
    }
    old_asset_paths = old_gallery_paths | old_look_paths
    if backup_assets:
        for relative in sorted(old_asset_paths):
            backup_file(repo_root, backup_root, relative)
            if relative in old_gallery_paths:
                backup_file(repo_root, backup_root, thumb_path(relative))

    staged_relatives = [
        staged.relative_to(staging_root).as_posix()
        for staged in staging_root.rglob("*")
        if staged.is_file()
    ]
    staged_items = json.loads(
        (staging_root / "data" / "items.json").read_text(encoding="utf-8")
    )
    referenced_assets: set[str] = set()
    for item in staged_items:
        gallery = [str(path) for path in (item.get("gallery") or []) if path]
        referenced_assets.update(gallery)
        referenced_assets.update(thumb_path(path) for path in gallery)
        look = str(item.get("look") or "")
        if look:
            referenced_assets.add(look)
    stale_candidates = old_asset_paths | {
        thumb_path(path) for path in old_gallery_paths
    }
    stale_paths = sorted(stale_candidates - referenced_assets) if prune_stale else []
    expose_tracked_sparse_paths(
        repo_root,
        [
            relative
            for relative in [*staged_relatives, *stale_paths]
            if relative.startswith("assets/img/")
        ],
    )
    for staged in sorted(staging_root.rglob("*")):
        if not staged.is_file():
            continue
        relative = staged.relative_to(staging_root)
        destination = repo_root / relative
        atomic_write(destination, staged.read_bytes())

    for relative in stale_paths:
        stale = repo_root / Path(*PurePosixPath(relative).parts)
        if stale.is_file():
            stale.unlink()

    if run_build:
        process = subprocess.run(
            [sys.executable, "build_site.py"],
            cwd=repo_root,
            check=False,
        )
        if process.returncode != 0:
            raise ImportFailure(
                "Die Bilder und items.json wurden uebernommen, aber build_site.py ist "
                f"fehlgeschlagen. Backup: {backup_root}"
            )
    return backup_root, stale_paths


def write_conversion_manifest(
    run_root: Path,
    results: list[ConversionResult],
    selected: list[PlanRow],
    owner: str,
) -> Path:
    payload = {
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "copyright_owner": owner,
        "items": [row.website_id for row in selected],
        "images": [asdict(result) for result in results],
        "total_bytes": sum(result.bytes for result in results),
    }
    path = run_root / "fotoimport_manifest.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def parse_item_ids(raw: str) -> set[int]:
    values: set[int] = set()
    for token in re.split(r"[,;\s]+", raw.strip()):
        if not token:
            continue
        if not token.isdigit():
            raise ImportFailure(f"Ungueltige Website-ID: {token}")
        values.add(int(token))
    return values


def print_summary(
    rows: list[PlanRow],
    source_index: SourceIndex,
    json_path: Path,
    csv_path: Path,
) -> None:
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row.status] += 1
    ready_photos = sum(len(row.sources) for row in rows if row.ready)
    unique_sources = {
        source
        for row in rows
        if row.ready
        for source in row.sources
    }
    print("\nZUORDNUNGSVORSCHAU")
    print("-------------------")
    print(f"Quelldateien:        {len(source_index.photos)}")
    print(f"Website-Artikel:     {len(rows)}")
    print(f"Sicher zugeordnet:   {counts['READY']} Artikel / {ready_photos} Bildzuordnungen")
    print(f"Eindeutige Quellen:  {len(unique_sources)} von {len(source_index.photos)} Fotos")
    print(f"Ohne Website-Artikel:{len(source_index.photos) - len(unique_sources):>5} Fotos")
    print(f"Teilweise:            {counts['PARTIAL']}")
    print(f"Mehrdeutig:           {counts['AMBIGUOUS']}")
    print(f"Nicht zugeordnet:     {counts['UNMATCHED']}")
    print(f"JSON-Bericht:         {json_path}")
    print(f"Excel-Pruefliste:     {csv_path}")


def self_test() -> None:
    assert normalize_text("H&M  x  Maison Margiéla") == "h und m x maison margiela"
    assert split_sequence("Prada Bunny (12)") == ("Prada Bunny", 12)
    assert split_sequence("Prada Bunny_3") == ("Prada Bunny", 3)
    assert canonical_relative_no_extension(
        r"Shooting 1\sold\Foo (1).PNG"
    ) == "shooting 1/sold/foo 1"
    Image, _ = require_pillow()
    with tempfile.TemporaryDirectory(prefix="disorder119-photo-test-") as temporary:
        source = Path(temporary) / "test.png"
        image = Image.new("RGBA", (800, 1000), (0, 0, 0, 0))
        image.save(source)
        payload, width, height, quality, embedded = encode_webp(
            source,
            int(0.2 * 1024 * 1024),
            600,
            "DISORDER119 TEST",
        )
        assert len(payload) <= int(0.2 * 1024 * 1024)
        assert max(width, height) <= 600
        assert quality >= 72
        assert embedded
        repo = Path(temporary) / "repo"
        run_root = Path(temporary) / "run"
        staging = run_root / "staging"
        (repo / "data").mkdir(parents=True)
        (repo / "data" / "items.json").write_text("[]\n", encoding="utf-8")
        old_directory = repo / "assets" / "img" / "1"
        (old_directory / "thumbs").mkdir(parents=True)
        for relative in ("0.webp", "1.webp", "look.webp", "thumbs/0.webp", "thumbs/1.webp"):
            (old_directory / relative).write_bytes(b"old")
        staged_directory = staging / "assets" / "img" / "1"
        (staged_directory / "thumbs").mkdir(parents=True)
        (staged_directory / "0.webp").write_bytes(b"new")
        (staged_directory / "thumbs" / "0.webp").write_bytes(b"thumb")
        (staging / "data").mkdir(parents=True)
        staged_items = [
            {
                "id": 1,
                "gallery": ["assets/img/1/0.webp"],
                "look": "assets/img/1/0.webp",
            }
        ]
        (staging / "data" / "items.json").write_text(
            json.dumps(staged_items),
            encoding="utf-8",
        )
        row = PlanRow(
            website_id=1,
            article="1",
            title="Test",
            brand="Test",
            current_gallery=["assets/img/1/0.webp", "assets/img/1/1.webp"],
            current_look="assets/img/1/look.webp",
            target_gallery=["assets/img/1/0.webp"],
            target_look="assets/img/1/0.webp",
            manager_item_id=1,
            manager_match="id_exact",
            status="READY",
            method="manager_paths_exact",
            reason="test",
            source_group="test",
            sources=["test (1).png"],
        )
        backup, stale = apply_staging(
            repo,
            staging,
            [row],
            run_root,
            run_build=False,
            prune_stale=True,
            backup_assets=True,
        )
        assert (repo / "assets" / "img" / "1" / "0.webp").read_bytes() == b"new"
        assert not (repo / "assets" / "img" / "1" / "1.webp").exists()
        assert not (repo / "assets" / "img" / "1" / "look.webp").exists()
        assert "assets/img/1/1.webp" in stale
        assert (backup / "assets" / "img" / "1" / "1.webp").read_bytes() == b"old"
    print("Selbsttest erfolgreich.")


def interactive_arguments(args: argparse.Namespace) -> argparse.Namespace:
    print("1  Nur sichere Zuordnung pruefen (empfohlen)")
    print("2  Zwei Artikel als Test konvertieren, Website unveraendert lassen")
    print("3  Alle sicher zugeordneten Bilder anwenden und Website neu bauen")
    print("0  Abbrechen")
    choice = input("\nAuswahl: ").strip()
    if choice == "0":
        raise ImportFailure("Abgebrochen.")
    if choice == "1":
        args.mode = "plan"
    elif choice == "2":
        args.mode = "stage"
        args.limit_items = 2
    elif choice == "3":
        print("\nVor dem Anwenden wird eine Sicherung angelegt.")
        confirmation = input(
            f"Zum Fortfahren exakt {CONFIRM_TEXT} eingeben: "
        ).strip()
        if confirmation != CONFIRM_TEXT:
            raise ImportFailure("Bestaetigung stimmt nicht; nichts wurde veraendert.")
        args.mode = "apply"
        args.confirm = confirmation
    else:
        raise ImportFailure("Unbekannte Auswahl; nichts wurde veraendert.")
    return args


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Freigestellte Fotos lokal, eindeutig und ohne KI/Codex-Tokens "
            "in die DISORDER119-Website uebernehmen."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Wurzelordner der freigestellten Fotos",
    )
    parser.add_argument(
        "--database",
        type=Path,
        help="Manager-SQLite-Datenbank; Standard: aktuelles Studio-Profil",
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=REPO_ROOT,
        help="Website-Repository",
    )
    parser.add_argument(
        "--mode",
        choices=("plan", "stage", "apply"),
        default="plan",
    )
    parser.add_argument(
        "--mapping",
        type=Path,
        help="Bearbeitete fotoimport_zuordnung.csv mit manuellen Overrides",
    )
    parser.add_argument(
        "--items",
        default="",
        help="Nur diese Website-IDs, z. B. 9364,9358",
    )
    parser.add_argument(
        "--limit-items",
        type=int,
        default=0,
        help="Hoechstens N sicher zugeordnete Artikel",
    )
    parser.add_argument(
        "--max-mib",
        type=float,
        default=DEFAULT_MAX_MIB,
        help="Harte Obergrenze je Galeriebild in MiB",
    )
    parser.add_argument(
        "--max-edge",
        type=int,
        default=DEFAULT_MAX_EDGE,
        help="Maximale lange Bildkante in Pixel",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=2,
        help="Parallele lokale Konvertierungen",
    )
    parser.add_argument(
        "--owner",
        default=DEFAULT_OWNER,
        help="Rechteinhaber fuer EXIF/XMP und Hash-Manifest",
    )
    parser.add_argument(
        "--keep-look",
        action="store_true",
        help="Altes Outfit-Baukasten-Bild beibehalten",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="Nach apply build_site.py nicht ausfuehren",
    )
    parser.add_argument(
        "--keep-stale-assets",
        action="store_true",
        help="Nicht mehr referenzierte alte Bilder nach apply behalten",
    )
    parser.add_argument(
        "--keep-staging",
        action="store_true",
        help="Konvertierte Zwischenkopie nach erfolgreichem apply behalten",
    )
    parser.add_argument(
        "--skip-asset-backup",
        action="store_true",
        help="Alte Bilder nicht extra kopieren; nur in frischem Git-Branch verwenden",
    )
    parser.add_argument("--confirm", default="", help=argparse.SUPPRESS)
    parser.add_argument("--interactive", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Lokalen Funktions-Selbsttest ausfuehren",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.self_test:
            self_test()
            return 0
        if args.interactive:
            args = interactive_arguments(args)
        if args.max_mib <= 0 or args.max_edge < 320 or args.workers < 1:
            raise ImportFailure("max-mib, max-edge oder workers ist ungueltig.")
        repo_root = args.repo.resolve()
        if not (repo_root / "build_site.py").is_file():
            raise ImportFailure(f"Kein DISORDER119-Website-Repository: {repo_root}")
        source_root = args.source.resolve()
        databases = [args.database.resolve()] if args.database else discover_databases()
        if not databases:
            raise ImportFailure("Keine lokale Disorder119-Manager-Datenbank gefunden.")

        print(f"Quelle:     {source_root}")
        for index, database in enumerate(databases):
            print(f"Manager-DB{index + 1}: {database}")
        print(f"Website:    {repo_root}")
        print("Scanne lokale Daten ...", flush=True)
        source_index = SourceIndex(source_root).scan()
        managers = [ManagerCatalog(database).load() for database in databases]
        website_items = load_website_items(repo_root)
        overrides = load_overrides(args.mapping)
        rows = make_plan(
            website_items,
            managers,
            source_index,
            overrides,
            args.keep_look,
        )

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        run_root = repo_root / ".photo-import" / f"lauf-{timestamp}"
        plan_json, plan_csv = write_plan(
            run_root,
            rows,
            source_index,
            databases,
            args.max_mib,
        )
        print_summary(rows, source_index, plan_json, plan_csv)
        if args.mode == "plan":
            print("\nNur Vorschau: An der Website wurde nichts veraendert.")
            return 0

        item_ids = parse_item_ids(args.items)
        selected = select_ready_rows(rows, item_ids, args.limit_items)
        if item_ids:
            missing_ids = sorted(item_ids - {row.website_id for row in selected})
            if missing_ids:
                raise ImportFailure(
                    f"Diese IDs sind nicht sicher zugeordnet: "
                    f"{', '.join(map(str, missing_ids))}"
                )
        owner = args.owner.strip() or DEFAULT_OWNER
        resume_key = (
            f"{args.max_edge}px-{int(args.max_mib * 1024)}kib-"
            f"{normalize_text(owner).replace(' ', '-') or 'owner'}"
        )
        resume_root = repo_root / ".photo-import" / "wiederaufnahme" / resume_key
        staging_root = resume_root / "staging"
        progress_path = resume_root / "fertige_fotos.jsonl"
        log_path = resume_root / "fotoimport.log"
        print(
            f"\nKonvertiere {sum(len(row.sources) for row in selected)} Fotos "
            f"fuer {len(selected)} Artikel ..."
        )
        print(f"Fortschritt: {progress_path}")
        print(f"Protokoll:   {log_path}")
        results = convert_rows(
            selected,
            source_index,
            staging_root,
            args.max_mib,
            args.max_edge,
            owner,
            args.workers,
            progress_path,
            log_path,
        )
        build_display_previews(selected, staging_root, owner, args.workers)
        write_staged_items(repo_root, staging_root, selected)
        manifest = write_conversion_manifest(
            run_root,
            results,
            selected,
            owner,
        )
        print(f"\nManifest: {manifest}")
        print(f"Staging:  {staging_root}")
        if args.mode == "stage":
            print("Testkonvertierung fertig. An der Website wurde nichts veraendert.")
            return 0

        if args.confirm != CONFIRM_TEXT:
            raise ImportFailure(
                f"Apply braucht die bewusste Bestaetigung --confirm {CONFIRM_TEXT}. "
                "Bis hierhin wurde nur im ignorierten Staging-Ordner gearbeitet."
            )
        backup, stale_paths = apply_staging(
            repo_root,
            staging_root,
            selected,
            run_root,
            not args.no_build,
            not args.keep_stale_assets,
            not args.skip_asset_backup,
        )
        if not args.keep_staging and staging_root.is_relative_to(run_root):
            shutil.rmtree(staging_root)
        print("\nImport lokal angewendet.")
        print(f"Sicherung: {backup}")
        print(f"Wiederaufnahme-Daten: {resume_root}")
        print(f"Nicht mehr referenzierte Altdateien entfernt: {len(stale_paths)}")
        print("Noch nicht online: Bitte Git-Aenderungen pruefen, committen und pushen.")
        return 0
    except ImportFailure as exc:
        print(f"\nABBRUCH: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print(
            "\nAbgebrochen; laufende Website-Dateien wurden nicht automatisch geloescht.",
            file=sys.stderr,
        )
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
