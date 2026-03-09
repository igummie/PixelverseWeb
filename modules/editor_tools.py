from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field


ALLOWED_ITEM_TYPES = {"seed", "block", "furniture", "clothes"}


def normalize_item_type(value: Any, default: str = "seed") -> str:
    normalized_default = str(default or "seed").strip().lower()
    if normalized_default not in ALLOWED_ITEM_TYPES:
        normalized_default = "seed"

    text = str(value or normalized_default).strip().lower()
    if text not in ALLOWED_ITEM_TYPES:
        return normalized_default
    return text


class SaveTexture47ConfigBody(BaseModel):
    atlasId: str = Field(min_length=1, max_length=64)
    columns: int = Field(ge=1, le=512)
    rows: int = Field(ge=1, le=512)
    maskOrder: list[Any] = Field(default_factory=list)
    maskVariants: dict[str, list[Any]] = Field(default_factory=dict)
    tint: str | None = None
    tintAlpha: float | None = None


class SaveRegularAtlasTextureEntry(BaseModel):
    blockId: int = Field(ge=0)
    atlasId: Any
    texture: dict[str, Any] = Field(default_factory=dict)


class SaveRegularAtlasTexturesBody(BaseModel):
    updates: list[SaveRegularAtlasTextureEntry] = Field(default_factory=list)


class SaveBlocksDataBody(BaseModel):
    blocks: list[dict[str, Any]] = Field(default_factory=list)


class SaveBlocksDocumentBody(BaseModel):
    VERSION: int = Field(default=1, ge=1)
    atlases: list[dict[str, Any]] = Field(default_factory=list)
    blocks: list[dict[str, Any]] = Field(default_factory=list)


class SaveSeedsDataBody(BaseModel):
    atlases: list[dict[str, Any]] | None = None
    seeds: list[dict[str, Any]] = Field(default_factory=list)


def normalize_name(value: str | None, fallback: str = "") -> str:
    return (value or fallback).strip().lower()


def resolve_item_id(value: Any, *keys: str, default: int = -1) -> int:
    if isinstance(value, dict):
        for key in keys:
            if key not in value:
                continue
            try:
                return int(value.get(key))
            except Exception:
                continue
    try:
        return int(default)
    except Exception:
        return -1


def sanitize_asset_filename(filename: str) -> str:
    name = Path(filename or "").name
    if not name:
        return ""

    stem = re.sub(r"[^a-zA-Z0-9_-]+", "_", Path(name).stem).strip("_")
    ext = Path(name).suffix.lower()
    if not stem or not ext:
        return ""

    return f"{stem}{ext}"


def normalize_atlas_id_value(value: Any) -> int | str | None:
    if isinstance(value, bool):
        return None

    if isinstance(value, int):
        return value

    if isinstance(value, float) and value.is_integer():
        return int(value)

    text = str(value or "").strip()
    if not text:
        return None

    if re.fullmatch(r"-?[0-9]+", text):
        try:
            return int(text)
        except Exception:
            return None

    lowered = text.lower()
    if re.fullmatch(r"[a-z0-9_-]+", lowered):
        return lowered

    return None


def normalize_texture47_id(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    if not text:
        return None

    if re.fullmatch(r"[a-z0-9_-]+", text):
        return text

    return None


def normalize_atlas_texture_rect(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None

    try:
        x = int(value.get("x", 0))
        y = int(value.get("y", 0))
        w = int(value.get("w", 0))
        h = int(value.get("h", 0))
    except Exception:
        return None

    if x < 0 or y < 0 or w <= 0 or h <= 0:
        return None

    return {
        "x": x,
        "y": y,
        "w": w,
        "h": h,
    }

def normalize_atlas_texture_variants(value: Any) -> list[dict[str, int]] | None:
    """Return a list of normalized texture rects or ``None`` if invalid.

    Used by the atlas/block editors when users specify multiple alternate
    textures for a single block. Each entry must be an object compatible with
    :func:`normalize_atlas_texture_rect`.  Empty or malformed lists are treated
    as ``None`` so that they are omitted from the final payload.
    """

    if not isinstance(value, list):
        return None

    variants: list[dict[str, int]] = []
    for entry in value:
        rect = normalize_atlas_texture_rect(entry)
        if rect:
            variants.append(rect)

    return variants if variants else None


def compact_block_for_storage(block: dict[str, Any]) -> dict[str, Any]:
    compacted: dict[str, Any] = {}
    block_item_id = resolve_item_id(block, "ITEM_ID", "ID", default=-1)
    if block_item_id < 0:
        block_item_id = 0

    key_order = [
        "ITEM_ID",
        "ITEM_TYPE",
        "ID",
        "NAME",
        "BLOCK_TYPE",
        "ATLAS_ID",
        "TEXTURE47_ID",
        "ATLAS_TEXTURE",
        "ATLAS_TEXTURE_VARIANTS",
        "ANIM_FRAMES",
        "ANIM_FIRST_SECONDS",
        "TOUGHNESS",
        "GEM_CHANCE",
        "GEM_AMOUNT",
        "GEM_AMOUNT_VAR",
        "SEED_IDS",
        "SEED_DROP_ID",
        "SEED_DROP_CHANCE",
        "SEED_DROPS",
        "PLACEABLE",
        "BREAKABLE",
    ]

    atlas_id_value = block.get("ATLAS_ID")
    normalized_atlas_id = normalize_atlas_id_value(atlas_id_value)
    if normalized_atlas_id is not None:
        atlas_id_value = normalized_atlas_id

    texture47_id = normalize_texture47_id(block.get("TEXTURE47_ID"))

    uses_texture47 = bool(texture47_id) or (isinstance(atlas_id_value, str) and bool(str(atlas_id_value).strip()))

    normalized_values: dict[str, Any] = {}
    for key, value in block.items():
        next_value = value
        if key in {"ITEM_ID", "ID"}:
            next_value = int(block_item_id)

        if key == "ITEM_TYPE":
            next_value = normalize_item_type(value, "block")

        if key == "ATLAS_ID":
            next_value = atlas_id_value

        if key == "TEXTURE47_ID":
            next_value = texture47_id

        if key == "ATLAS_TEXTURE_VARIANTS":
            # coerce each entry to a normalized rect list; drop if invalid/empty
            variants = normalize_atlas_texture_variants(value)
            if variants is None:
                # treat as absent
                continue
            next_value = variants

        # Texture47 blocks derive tile data from mask config, so explicit atlas
        # rect (or any regular atlas variants) is redundant and therefore
        # stripped out.
        if key == "ATLAS_TEXTURE" and uses_texture47:
            continue
        if key == "ATLAS_TEXTURE_VARIANTS" and uses_texture47:
            continue

        # Keep payload compact by omitting false boolean flags. BREAKABLE is intentionally
        # excluded here because runtime currently defaults missing BREAKABLE to true.
        if isinstance(next_value, bool) and next_value is False and key != "BREAKABLE":
            continue

        normalized_values[key] = next_value

    normalized_values["ITEM_ID"] = int(block_item_id)
    normalized_values["ID"] = int(block_item_id)
    normalized_values["ITEM_TYPE"] = "block"

    if texture47_id is not None:
        normalized_values["TEXTURE47_ID"] = texture47_id

    for key in key_order:
        if key in normalized_values:
            compacted[key] = normalized_values.pop(key)

    for key in sorted(normalized_values.keys()):
        compacted[key] = normalized_values[key]

    return compacted


def compact_blocks_payload_for_storage(payload: dict[str, Any]) -> None:
    blocks = payload.get("blocks")
    if not isinstance(blocks, list):
        return

    compacted_blocks: list[Any] = []
    for block in blocks:
        if isinstance(block, dict):
            compacted_blocks.append(compact_block_for_storage(block))
            continue
        compacted_blocks.append(block)

    payload["blocks"] = compacted_blocks


def normalize_growth_percent(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
    except Exception:
        numeric = fallback
    numeric = max(0.0, min(100.0, numeric))
    return round(numeric, 4)


def sanitize_tree_stage_entry(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    try:
        stage = int(value.get("STAGE", 0))
    except Exception:
        stage = 0
    if stage <= 0:
        return None

    atlas_id = normalize_atlas_id_value(value.get("ATLAS_ID"))
    texture = normalize_atlas_texture_rect(value.get("ATLAS_TEXTURE"))

    output: dict[str, Any] = {
        "STAGE": stage,
        "GROWTH_PERCENT": normalize_growth_percent(value.get("GROWTH_PERCENT", 0.0)),
    }
    if atlas_id is not None:
        output["ATLAS_ID"] = atlas_id
    if texture is not None:
        output["ATLAS_TEXTURE"] = texture

    return output


def sanitize_seed_drop_entry(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        try:
            seed_id = int(value)
        except Exception:
            return None
        if seed_id < 0:
            return None
        return {"ITEM_ID": seed_id, "SEED_ID": seed_id, "CHANCE": 1.0, "COUNT": 1}

    seed_id = resolve_item_id(value, "ITEM_ID", "SEED_ID", "ID", "id", default=-1)
    if seed_id < 0:
        return None

    try:
        chance = float(value.get("CHANCE", value.get("chance", 1.0)))
    except Exception:
        chance = 1.0
    chance = max(0.0, min(1.0, chance))

    try:
        count = int(value.get("COUNT", value.get("count", 1)))
    except Exception:
        count = 1

    try:
        min_count = int(value.get("MIN", value.get("min", count)))
    except Exception:
        min_count = count

    try:
        max_count = int(value.get("MAX", value.get("max", count)))
    except Exception:
        max_count = count

    min_count = max(0, min_count)
    max_count = max(min_count, max_count)

    output: dict[str, Any] = {
        "ITEM_ID": seed_id,
        "SEED_ID": seed_id,
        "CHANCE": round(chance, 4),
    }

    if min_count == max_count:
        output["COUNT"] = min_count
    else:
        output["MIN"] = min_count
        output["MAX"] = max_count

    return output


def sanitize_fruit_drop_entry(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        try:
            item_id = int(value)
        except Exception:
            return None
        if item_id < 0:
            return None
        return {
            "ITEM_TYPE": "seed",
            "ITEM_ID": item_id,
            "CHANCE": 1.0,
            "MIN": 1,
            "MAX": 1,
        }

    item_id = -1
    for key in ("ITEM_ID", "item_id", "ID", "SEED_ID", "id"):
        if key not in value:
            continue
        try:
            item_id = int(value.get(key))
            break
        except Exception:
            continue
    if item_id < 0:
        return None

    item_type = normalize_item_type(
        value.get("ITEM_TYPE", value.get("item_type", value.get("TYPE", value.get("type", "seed")))),
        default="seed",
    )

    try:
        chance = float(value.get("CHANCE", value.get("chance", 1.0)))
    except Exception:
        chance = 1.0
    chance = max(0.0, min(1.0, chance))

    try:
        count = int(value.get("COUNT", value.get("count", 1)))
    except Exception:
        count = 1

    try:
        min_count = int(value.get("MIN", value.get("min", count)))
    except Exception:
        min_count = count

    try:
        max_count = int(value.get("MAX", value.get("max", count)))
    except Exception:
        max_count = count

    min_count = max(0, min_count)
    max_count = max(min_count, max_count)

    return {
        "ITEM_TYPE": item_type,
        "ITEM_ID": int(item_id),
        "CHANCE": round(chance, 4),
        "MIN": int(min_count),
        "MAX": int(max_count),
    }


def normalize_tint_color(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    if re.fullmatch(r"#[0-9a-fA-F]{6}", text):
        return text.lower()

    if re.fullmatch(r"#[0-9a-fA-F]{8}", text):
        return text.lower()

    return ""


def sanitize_seed_entry(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    seed_id = resolve_item_id(value, "ITEM_ID", "SEED_ID", "ID", default=-1)
    if seed_id < 0:
        return None

    name = str(value.get("NAME", "")).strip()
    if not name:
        name = f"SEED_{seed_id}"

    try:
        growtime = max(0, int(value.get("GROWTIME", 0)))
    except Exception:
        growtime = 0

    seed_atlas_id = normalize_atlas_id_value(value.get("SEED_ATLAS_ID"))
    seed_atlas_texture = normalize_atlas_texture_rect(value.get("SEED_ATLAS_TEXTURE"))
    seed_tint = normalize_tint_color(value.get("SEED_TINT"))

    tree_stages: list[dict[str, Any]] = []
    tree_drops: list[dict[str, Any]] = []
    fruit_drops: list[dict[str, Any]] = []
    tree_name = ""
    tree_tint = ""
    # gem settings default to 0
    tree_gem_chance = 0.0
    tree_gem_amount = 0
    tree_gem_amount_var = 0

    raw_tree = value.get("TREE")
    raw_stages: Any = value.get("TREE_STAGES", [])
    raw_tree_drops: Any = value.get("TREE_DROPS", [])
    raw_fruit_drops: Any = value.get("FRUIT_DROPS", [])

    if isinstance(raw_tree, dict):
        tree_name = str(raw_tree.get("NAME", "")).strip()
        tree_tint = normalize_tint_color(raw_tree.get("TINT"))
        if isinstance(raw_tree.get("STAGES"), list):
            raw_stages = raw_tree.get("STAGES", [])
        if isinstance(raw_tree.get("DROPS"), list):
            raw_tree_drops = raw_tree.get("DROPS", [])
        if isinstance(raw_tree.get("FRUIT_DROPS"), list):
            raw_fruit_drops = raw_tree.get("FRUIT_DROPS", [])

        # gem drop settings inside TREE
        try:
            tree_gem_chance = float(raw_tree.get("GEM_CHANCE", raw_tree.get("TREE_GEM_CHANCE", 0.0)))
        except Exception:
            tree_gem_chance = 0.0
        try:
            tree_gem_amount = int(raw_tree.get("GEM_AMOUNT", raw_tree.get("TREE_GEM_AMOUNT", 0)))
        except Exception:
            tree_gem_amount = 0
        try:
            tree_gem_amount_var = int(raw_tree.get("GEM_AMOUNT_VAR", raw_tree.get("TREE_GEM_AMOUNT_VAR", 0)))
        except Exception:
            tree_gem_amount_var = 0

    if isinstance(raw_stages, list):
        for raw_stage in raw_stages:
            stage = sanitize_tree_stage_entry(raw_stage)
            if stage is not None:
                tree_stages.append(stage)

    if isinstance(raw_tree_drops, list):
        for raw_drop in raw_tree_drops:
            drop = sanitize_seed_drop_entry(raw_drop)
            if drop is not None:
                tree_drops.append(drop)

    if isinstance(raw_fruit_drops, list):
        for raw_fruit_drop in raw_fruit_drops:
            fruit_drop = sanitize_fruit_drop_entry(raw_fruit_drop)
            if fruit_drop is not None:
                fruit_drops.append(fruit_drop)

    tree_stages.sort(key=lambda entry: int(entry.get("STAGE", 0)))

    output: dict[str, Any] = {
        "ITEM_ID": seed_id,
        "ITEM_TYPE": "seed",
        "SEED_ID": seed_id,
        "NAME": name,
        "GROWTIME": growtime,
    }

    if fruit_drops:
        output["FRUIT_DROPS"] = fruit_drops

    if seed_atlas_id is not None:
        output["SEED_ATLAS_ID"] = seed_atlas_id
    if seed_atlas_texture is not None:
        output["SEED_ATLAS_TEXTURE"] = seed_atlas_texture
    if seed_tint:
        output["SEED_TINT"] = seed_tint
    # only create TREE object if there are any settings to persist
    if tree_name or tree_tint or tree_stages or tree_drops or tree_gem_chance or tree_gem_amount or tree_gem_amount_var:
        output["TREE"] = {}
        if tree_name:
            output["TREE"]["NAME"] = tree_name
        if tree_tint:
            output["TREE"]["TINT"] = tree_tint
        if tree_stages:
            output["TREE"]["STAGES"] = tree_stages
        if tree_drops:
            output["TREE"]["DROPS"] = tree_drops
        # include gem settings even if zero so they are explicit when edited
        output["TREE"]["GEM_CHANCE"] = float(tree_gem_chance)
        output["TREE"]["GEM_AMOUNT"] = int(tree_gem_amount)
        output["TREE"]["GEM_AMOUNT_VAR"] = int(tree_gem_amount_var)

    return output


def load_texture47_configs(public_dir: Path, atlas_ids: set[str]) -> dict[str, dict[str, Any]]:
    configs: dict[str, dict[str, Any]] = {}
    config_dir = public_dir / "assets" / "texture47" / "configs"
    fallback_dir = public_dir / "assets" / "texture47"

    for atlas_id in atlas_ids:
        if not re.fullmatch(r"[a-z0-9_-]+", atlas_id):
            continue

        candidates = [
            config_dir / f"{atlas_id}.json",
            fallback_dir / f"{atlas_id}.json",
        ]

        loaded: dict[str, Any] | None = None
        for path in candidates:
            if not path.exists() or not path.is_file():
                continue

            try:
                with path.open("r", encoding="utf-8") as handle:
                    parsed = json.load(handle)
                if isinstance(parsed, dict):
                    loaded = parsed
                    break
            except Exception:
                continue

        if loaded is not None:
            configs[atlas_id] = loaded

    return configs


def _trigger_refresh(refresh_callback: Callable[..., None]) -> None:
    try:
        refresh_callback(force=True)
    except TypeError:
        refresh_callback(True)


def register_editor_routes(
    app: FastAPI,
    *,
    public_dir: Path,
    blocks_path: Path,
    seeds_path: Path,
    load_blocks_payload: Callable[[], dict[str, Any]],
    load_seeds_payload: Callable[[], dict[str, Any]],
    refresh_block_definitions_if_changed: Callable[..., None],
) -> None:
    @app.post("/api/tools/atlases/upload")
    async def upload_regular_atlas(file: UploadFile = File(...)) -> dict[str, Any]:
        allowed_extensions = {".png", ".svg", ".jpg", ".jpeg", ".webp"}
        safe_name = sanitize_asset_filename(file.filename or "")
        if not safe_name:
            raise HTTPException(status_code=400, detail="Invalid upload filename")

        ext = Path(safe_name).suffix.lower()
        if ext not in allowed_extensions:
            raise HTTPException(status_code=400, detail="Unsupported atlas file type")

        atlas_dir = public_dir / "assets" / "atlases"
        atlas_dir.mkdir(parents=True, exist_ok=True)

        output_path = (atlas_dir / safe_name).resolve()
        if not str(output_path).startswith(str(atlas_dir.resolve())):
            raise HTTPException(status_code=400, detail="Invalid upload path")

        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        if len(data) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 8MB)")

        with output_path.open("wb") as handle:
            handle.write(data)

        suggested_atlas_id = normalize_atlas_id_value(Path(safe_name).stem)
        return {
            "ok": True,
            "src": f"/assets/atlases/{safe_name}",
            "filename": safe_name,
            "suggestedAtlasId": suggested_atlas_id,
        }

    @app.post("/api/tools/texture47/save")
    def save_texture47_config(payload: SaveTexture47ConfigBody) -> dict[str, Any]:
        atlas_id = normalize_name(payload.atlasId)
        if not re.fullmatch(r"[a-z0-9_-]+", atlas_id):
            raise HTTPException(status_code=400, detail="Invalid atlas id")

        sanitized_mask_order: list[int | None] = []
        for value in payload.maskOrder:
            try:
                mask = int(value)
            except Exception:
                sanitized_mask_order.append(None)
                continue

            if 0 <= mask <= 255:
                sanitized_mask_order.append(mask)
            else:
                sanitized_mask_order.append(None)

        sanitized_mask_variants: dict[str, list[int]] = {}
        if isinstance(payload.maskVariants, dict):
            for key, values in payload.maskVariants.items():
                try:
                    mask = int(key)
                except Exception:
                    continue

                if mask < 0 or mask > 255:
                    continue

                if not isinstance(values, list):
                    continue

                variants: list[int] = []
                for raw in values:
                    try:
                        tile_index = int(raw)
                    except Exception:
                        continue

                    if tile_index >= 0 and tile_index not in variants:
                        variants.append(tile_index)

                if variants:
                    sanitized_mask_variants[str(mask)] = variants

        output = {
            "columns": int(payload.columns),
            "rows": int(payload.rows),
            "maskOrder": sanitized_mask_order,
            "maskVariants": sanitized_mask_variants,
        }

        tint = normalize_tint_color(payload.tint)
        if tint:
            output["tint"] = tint

        if payload.tintAlpha is not None:
            try:
                tint_alpha = float(payload.tintAlpha)
            except Exception:
                tint_alpha = 0.0
            tint_alpha = max(0.0, min(1.0, tint_alpha))
            if tint_alpha > 0:
                output["tintAlpha"] = round(tint_alpha, 4)

        texture47_dir = public_dir / "assets" / "texture47" / "configs"
        texture47_dir.mkdir(parents=True, exist_ok=True)
        output_path = (texture47_dir / f"{atlas_id}.json").resolve()

        if not str(output_path).startswith(str(texture47_dir.resolve())):
            raise HTTPException(status_code=400, detail="Invalid atlas id")

        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(output, handle, indent=2)
            handle.write("\n")

        return {
            "ok": True,
            "path": f"assets/texture47/configs/{atlas_id}.json",
            "saved": output,
        }

    @app.get("/api/tools/texture47/atlases")
    def list_texture47_atlases() -> dict[str, Any]:
        texture47_dir = public_dir / "assets" / "texture47"
        atlases: list[str] = []

        if texture47_dir.exists() and texture47_dir.is_dir():
            for file_path in sorted(texture47_dir.glob("*.png")):
                name = file_path.stem.strip().lower()
                if name and re.fullmatch(r"[a-z0-9_-]+", name):
                    atlases.append(name)

        return {
            "atlases": atlases,
        }

    @app.get("/api/tools/blocks/editor-data")
    def get_blocks_editor_data() -> dict[str, Any]:
        payload = load_blocks_payload()
        atlases = payload.get("atlases", [])
        blocks = payload.get("blocks", [])
        seeds_payload = load_seeds_payload()
        seeds = seeds_payload.get("seeds", []) if isinstance(seeds_payload, dict) else []

        return {
            "atlases": atlases if isinstance(atlases, list) else [],
            "blocks": blocks if isinstance(blocks, list) else [],
            "seeds": seeds if isinstance(seeds, list) else [],
        }

    @app.post("/api/tools/blocks/save-textures")
    def save_regular_atlas_textures(payload: SaveRegularAtlasTexturesBody) -> dict[str, Any]:
        try:
            with blocks_path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Failed to read blocks.json: {error}")

        if not isinstance(raw, dict):
            raise HTTPException(status_code=500, detail="Invalid blocks.json payload")

        atlases = raw.get("atlases", [])
        blocks = raw.get("blocks", [])
        if not isinstance(atlases, list) or not isinstance(blocks, list):
            raise HTTPException(status_code=500, detail="Invalid blocks.json structure")

        allowed_atlas_ids = {
            normalized
            for atlas in atlases
            for normalized in [normalize_atlas_id_value(atlas.get("ATLAS_ID") if isinstance(atlas, dict) else None)]
            if normalized is not None
        }

        block_index_by_id: dict[int, int] = {}
        for index, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            block_id = resolve_item_id(block, "ITEM_ID", "ID", default=-1)
            if block_id < 0:
                continue
            block_index_by_id[block_id] = index

        updated_block_ids: list[int] = []
        for update in payload.updates:
            block_id = int(update.blockId)
            atlas_id = normalize_atlas_id_value(update.atlasId)
            texture_rect = normalize_atlas_texture_rect(update.texture)

            if block_id not in block_index_by_id:
                raise HTTPException(status_code=400, detail=f"Unknown block id: {block_id}")

            if atlas_id is None:
                raise HTTPException(status_code=400, detail=f"Invalid atlas id for block {block_id}")

            if allowed_atlas_ids and atlas_id not in allowed_atlas_ids:
                raise HTTPException(status_code=400, detail=f"Atlas id {atlas_id!r} is not defined in blocks.json atlases")

            if texture_rect is None:
                raise HTTPException(status_code=400, detail=f"Invalid texture rect for block {block_id}")

            block = blocks[block_index_by_id[block_id]]
            if not isinstance(block, dict):
                raise HTTPException(status_code=500, detail=f"Invalid block payload for id {block_id}")

            block["ATLAS_ID"] = atlas_id
            block["ATLAS_TEXTURE"] = texture_rect
            updated_block_ids.append(block_id)

        compact_blocks_payload_for_storage(raw)

        with blocks_path.open("w", encoding="utf-8") as handle:
            json.dump(raw, handle, indent=2)
            handle.write("\n")

        _trigger_refresh(refresh_block_definitions_if_changed)

        return {
            "ok": True,
            "path": "data/blocks.json",
            "updatedBlockIds": updated_block_ids,
            "updatedCount": len(updated_block_ids),
        }

    @app.post("/api/tools/blocks/save-data")
    def save_blocks_data(payload: SaveBlocksDataBody) -> dict[str, Any]:
        try:
            with blocks_path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Failed to read blocks.json: {error}")

        if not isinstance(raw, dict):
            raise HTTPException(status_code=500, detail="Invalid blocks.json payload")

        blocks = raw.get("blocks", [])
        if not isinstance(blocks, list):
            raise HTTPException(status_code=500, detail="Invalid blocks.json structure")

        block_index_by_id: dict[int, int] = {}
        for index, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            block_id = resolve_item_id(block, "ITEM_ID", "ID", default=-1)
            if block_id < 0:
                continue
            block_index_by_id[block_id] = index

        updated_block_ids: list[int] = []
        for edited_block in payload.blocks:
            if not isinstance(edited_block, dict):
                raise HTTPException(status_code=400, detail="Each block must be an object")

            try:
                block_id = int(edited_block.get("ITEM_ID", edited_block.get("ID")))
            except Exception:
                raise HTTPException(status_code=400, detail="Edited block is missing a valid ID")

            edited_block["ITEM_ID"] = block_id
            edited_block["ID"] = block_id
            edited_block["ITEM_TYPE"] = "block"

            compacted = compact_block_for_storage(edited_block)
            if block_id not in block_index_by_id:
                block_index_by_id[block_id] = len(blocks)
                blocks.append(compacted)
            else:
                blocks[block_index_by_id[block_id]] = compacted

            updated_block_ids.append(block_id)

        compact_blocks_payload_for_storage(raw)

        with blocks_path.open("w", encoding="utf-8") as handle:
            json.dump(raw, handle, indent=2)
            handle.write("\n")

        _trigger_refresh(refresh_block_definitions_if_changed)

        return {
            "ok": True,
            "path": "data/blocks.json",
            "updatedBlockIds": updated_block_ids,
            "updatedCount": len(updated_block_ids),
        }

    @app.post("/api/tools/blocks/save-document")
    def save_blocks_document(payload: SaveBlocksDocumentBody) -> dict[str, Any]:
        atlases: list[dict[str, Any]] = []
        seen_atlas_keys: set[str] = set()
        for atlas in payload.atlases:
            if not isinstance(atlas, dict):
                raise HTTPException(status_code=400, detail="Each atlas must be an object")

            normalized_id = normalize_atlas_id_value(atlas.get("ATLAS_ID"))
            if normalized_id is None:
                raise HTTPException(status_code=400, detail="Atlas is missing a valid ATLAS_ID")

            key = f"n:{normalized_id}" if isinstance(normalized_id, int) else f"s:{normalized_id}"
            if key in seen_atlas_keys:
                raise HTTPException(status_code=400, detail=f"Duplicate atlas id: {normalized_id!r}")
            seen_atlas_keys.add(key)

            next_atlas = dict(atlas)
            next_atlas["ATLAS_ID"] = normalized_id
            atlases.append(next_atlas)

        blocks: list[dict[str, Any]] = []
        seen_block_ids: set[int] = set()
        for block in payload.blocks:
            if not isinstance(block, dict):
                raise HTTPException(status_code=400, detail="Each block must be an object")

            try:
                block_id = int(block.get("ITEM_ID", block.get("ID")))
            except Exception:
                raise HTTPException(status_code=400, detail="Each block must contain a valid integer ID")

            if block_id < 0:
                raise HTTPException(status_code=400, detail=f"Invalid block id: {block_id}")

            if block_id in seen_block_ids:
                raise HTTPException(status_code=400, detail=f"Duplicate block id: {block_id}")
            seen_block_ids.add(block_id)

            next_block = dict(block)
            next_block["ITEM_ID"] = block_id
            next_block["ID"] = block_id
            next_block["ITEM_TYPE"] = "block"
            blocks.append(compact_block_for_storage(next_block))

        output = {
            "VERSION": int(payload.VERSION),
            "atlases": atlases,
            "blocks": blocks,
        }
        compact_blocks_payload_for_storage(output)

        with blocks_path.open("w", encoding="utf-8") as handle:
            json.dump(output, handle, indent=2)
            handle.write("\n")

        _trigger_refresh(refresh_block_definitions_if_changed)

        return {
            "ok": True,
            "path": "data/blocks.json",
            "atlasCount": len(atlases),
            "blockCount": len(blocks),
        }

    @app.get("/api/tools/seeds/editor-data")
    def get_seeds_editor_data() -> dict[str, Any]:
        blocks_payload = load_blocks_payload()
        seeds_payload = load_seeds_payload()

        block_atlases = blocks_payload.get("atlases", []) if isinstance(blocks_payload, dict) else []
        seed_atlases = seeds_payload.get("atlases", []) if isinstance(seeds_payload, dict) else []
        blocks = blocks_payload.get("blocks", []) if isinstance(blocks_payload, dict) else []
        seeds = seeds_payload.get("seeds", []) if isinstance(seeds_payload, dict) else []

        merged_atlases: list[dict[str, Any]] = []
        seen_atlas_ids: set[str] = set()
        for source in (block_atlases, seed_atlases):
            if not isinstance(source, list):
                continue
            for atlas in source:
                if not isinstance(atlas, dict):
                    continue
                atlas_id = normalize_atlas_id_value(atlas.get("ATLAS_ID"))
                if atlas_id is None:
                    continue
                key = f"{type(atlas_id).__name__}:{atlas_id}"
                if key in seen_atlas_ids:
                    continue
                seen_atlas_ids.add(key)
                merged_atlases.append(dict(atlas))

        return {
            "atlases": merged_atlases,
            "seedAtlases": seed_atlases if isinstance(seed_atlases, list) else [],
            "blocks": blocks if isinstance(blocks, list) else [],
            "seeds": seeds if isinstance(seeds, list) else [],
        }

    @app.post("/api/tools/seeds/save-data")
    def save_seeds_data(payload: SaveSeedsDataBody) -> dict[str, Any]:
        existing = load_seeds_payload()
        output: dict[str, Any] = {}

        sanitized_seeds: list[dict[str, Any]] = []
        seen_ids: set[int] = set()
        for raw_seed in payload.seeds:
            seed = sanitize_seed_entry(raw_seed)
            if seed is None:
                raise HTTPException(status_code=400, detail="Each seed must include a valid non-negative SEED_ID")

            seed_id = int(seed.get("ITEM_ID", seed.get("SEED_ID", -1)))
            if seed_id in seen_ids:
                raise HTTPException(status_code=400, detail=f"Duplicate seed id: {seed_id}")
            seen_ids.add(seed_id)
            sanitized_seeds.append(seed)

        sanitized_seeds.sort(key=lambda entry: int(entry.get("ITEM_ID", entry.get("SEED_ID", 0))))
        output["seeds"] = sanitized_seeds

        if isinstance(payload.atlases, list):
            output["atlases"] = [dict(entry) for entry in payload.atlases if isinstance(entry, dict)]

        # Preserve any future top-level metadata except legacy VERSION key.
        if isinstance(existing, dict):
            for key, value in existing.items():
                if key in {"seeds", "atlases", "VERSION"}:
                    continue
                output[key] = value

            if "atlases" not in output and isinstance(existing.get("atlases"), list):
                output["atlases"] = [dict(entry) for entry in existing.get("atlases", []) if isinstance(entry, dict)]

        with seeds_path.open("w", encoding="utf-8") as handle:
            json.dump(output, handle, indent=2)
            handle.write("\n")

        return {
            "ok": True,
            "path": "data/seeds.json",
            "atlasCount": len(output.get("atlases", [])) if isinstance(output.get("atlases", []), list) else 0,
            "seedCount": len(sanitized_seeds),
        }
