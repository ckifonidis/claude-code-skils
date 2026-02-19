"""Index serialization — save/load schema analysis to/from JSON files.

Index files allow instant re-exploration without re-reading the source file.
Saved next to the source file with a .scout-index.json suffix.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from schema_scout.models import SchemaNode


def get_index_path(source_path: Path) -> Path:
    """Get the index file path for a given source file.

    Example: data.xlsx -> data.xlsx.scout-index.json
    """
    return source_path.parent / f"{source_path.name}.scout-index.json"


def save_index(
    schema: SchemaNode,
    source_path: Path,
    rows_analyzed: int,
    max_rows: int,
    sheet_name: str | None = None,
    output_path: Path | None = None,
) -> Path:
    """Save a schema analysis to a JSON index file.

    Returns the path where the index was saved.
    """
    index_path = output_path or get_index_path(source_path)

    data: dict[str, Any] = {
        "schema_scout_version": "1.0",
        "source_file": source_path.name,
        "source_file_name": source_path.name,
        "rows_analyzed": rows_analyzed,
        "max_rows_setting": max_rows,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    if sheet_name:
        data["sheet_name"] = sheet_name

    data["schema"] = schema.to_dict()

    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    return index_path


def load_index(index_path: Path) -> tuple[SchemaNode, dict[str, Any]]:
    """Load a schema analysis from a JSON index file.

    Returns (schema_root, metadata_dict).
    """
    with open(index_path, encoding="utf-8") as f:
        data = json.load(f)

    schema = SchemaNode.from_dict(data["schema"])
    metadata = {k: v for k, v in data.items() if k != "schema"}
    return schema, metadata


def index_exists(source_path: Path) -> bool:
    """Check if an index file already exists for a source file."""
    return get_index_path(source_path).exists()
