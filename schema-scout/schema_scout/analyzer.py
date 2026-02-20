"""Schema analyzer — the core engine of Schema Scout.

Scans rows from any file reader, detects JSON in any cell, recursively walks
all structures, and builds a schema tree with value statistics.

Fully pattern-agnostic: makes zero assumptions about column names,
JSON structure, or nesting patterns.
"""

from __future__ import annotations

import json
import random
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

from schema_scout.models import FieldStats, SchemaNode


# Thresholds
MAX_UNIQUE_VALUES = 50  # Keep all values if unique count <= this
SAMPLE_SIZE = 10  # Number of samples to keep when above threshold
JSON_DETECTION_THRESHOLD = 0.3  # Mark column as JSON if >30% of non-empty values parse
SPARSE_COLUMN_THRESHOLD = 0.05  # Prune unnamed columns with <5% non-null values


class _FieldCollector:
    """Collects values and stats for a single field path during scanning."""

    __slots__ = (
        "counter", "samples", "types", "total", "null_count",
        "min_val", "max_val", "capped", "_seen_count",
    )

    def __init__(self) -> None:
        self.counter: Counter = Counter()
        self.samples: list[str] = []
        self.types: Counter = Counter()
        self.total: int = 0
        self.null_count: int = 0
        self.min_val: Any = None
        self.max_val: Any = None
        self.capped: bool = False
        # Number of non-null values seen since capping (for reservoir sampling)
        self._seen_count: int = 0

    def add(self, value: Any, type_name: str) -> None:
        self.total += 1
        self.types[type_name] += 1

        if value is None:
            self.null_count += 1
            return

        # Track min/max for numeric types
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if self.min_val is None or value < self.min_val:
                self.min_val = value
            if self.max_val is None or value > self.max_val:
                self.max_val = value

        # Track unique values (with cap)
        if not self.capped:
            str_val = str(value)
            self.counter[str_val] += 1
            if len(self.counter) > MAX_UNIQUE_VALUES:
                self.capped = True
                self.samples = random.sample(
                    list(self.counter.keys()),
                    min(SAMPLE_SIZE, len(self.counter)),
                )
                self._seen_count = len(self.counter)
        else:
            # Algorithm R reservoir sampling: each new item replaces a random
            # existing sample with probability SAMPLE_SIZE / _seen_count,
            # giving every item an equal chance of being in the final sample.
            self._seen_count += 1
            j = random.randrange(self._seen_count)
            if j < SAMPLE_SIZE:
                self.samples[j] = str(value)

    def to_field_stats(self, path: str) -> FieldStats:
        stats = FieldStats(
            path=path,
            types_seen=dict(self.types),
            total_count=self.total,
            null_count=self.null_count,
        )

        if not self.capped:
            stats.unique_count = len(self.counter)
            stats.unique_values = sorted(self.counter.keys(), key=lambda x: -self.counter[x])
            stats.value_counts = dict(self.counter.most_common())
        else:
            # When capped, exact unique count is unknown — report None
            stats.unique_count = None
            stats.sample_values = self.samples

        stats.min_value = self.min_val
        stats.max_value = self.max_val
        return stats


def _classify_type(value: Any) -> str:
    """Return a human-readable type name for a value."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _try_parse_json(value: str) -> Any:
    """Try to parse a string as JSON. Returns parsed result or None.

    Only checks strings starting with '{' or '[' — these are the only
    characters that can begin a JSON object or array. Strings starting
    with '"' are skipped because JSON-encoded primitives ("true", "123")
    are not useful to expand, and the check would cause many wasted
    json.loads calls on normal string values.
    """
    if not value or len(value) < 2:
        return None
    first = value[0]
    if first not in ('{', '['):
        return None
    try:
        parsed = json.loads(value)
        if isinstance(parsed, (dict, list)):
            return parsed
        return None
    except (json.JSONDecodeError, ValueError):
        return None


def _repair_encoding(value: str) -> str:
    """Attempt to fix double-encoded UTF-8 strings.

    Detects strings where UTF-8 bytes were misinterpreted as Windows-1252
    (the most common culprit — Excel, ODBC drivers, older Windows tools),
    producing garbled text (e.g., 'Î•Î¥Î¡Î©' instead of 'ΕΥΡΩ').

    Uses a character-to-byte mapping that covers ALL 256 byte values,
    including the 5 undefined cp1252 positions (0x81, 0x8D, 0x8F, 0x90, 0x9D)
    which Python's cp1252 codec rejects.
    """
    try:
        byte_list = []
        for c in value:
            byte_val = _CP1252_CHAR_TO_BYTE.get(c)
            if byte_val is not None:
                byte_list.append(byte_val)
            else:
                # Character has no cp1252/latin-1 byte equivalent — bail out
                return value
        repaired = bytes(byte_list).decode("utf-8")
        if repaired != value:
            return repaired
    except (UnicodeDecodeError, ValueError):
        pass
    return value


# Reverse mapping: Unicode character -> original byte value.
# Covers the full 0x00-0xFF range including cp1252 remappings in 0x80-0x9F
# (e.g., U+2022 BULLET -> byte 0x95) AND the 5 undefined positions
# (0x81, 0x8D, 0x8F, 0x90, 0x9D) which map to their Latin-1 control chars.
_CP1252_CHAR_TO_BYTE: dict[str, int] = {}
for _byte in range(256):
    # cp1252 remaps 0x80-0x9F to specific Unicode chars (U+20AC, U+2018, etc.)
    # but leaves 5 positions undefined — for those, fall back to latin-1
    try:
        _char = bytes([_byte]).decode("cp1252")
    except UnicodeDecodeError:
        _char = bytes([_byte]).decode("latin-1")
    _CP1252_CHAR_TO_BYTE[_char] = _byte


# Default max recursion depth for nested JSON walks
MAX_WALK_DEPTH = 50


def _walk_value(
    value: Any,
    path: str,
    collectors: dict[str, _FieldCollector],
    occurrence_paths: set[str],
    json_parse_counts: dict[str, list[int]] | None = None,
    depth: int = 0,
) -> None:
    """Recursively walk a value and collect stats for all paths.

    Handles nested objects, arrays, and JSON-in-JSON (strings that contain JSON).
    Stops recursion at MAX_WALK_DEPTH to avoid stack overflow on deeply nested data.
    """
    if depth > MAX_WALK_DEPTH:
        # Too deep — record as-is to avoid stack overflow
        collector = collectors.setdefault(path, _FieldCollector())
        collector.add(str(value), "string")
        occurrence_paths.add(path)
        return

    if value is None or (isinstance(value, str) and value.strip().lower() == "null"):
        collector = collectors.setdefault(path, _FieldCollector())
        collector.add(None, "null")
        occurrence_paths.add(path)
        return

    # Check for JSON-in-JSON: if a string value is itself valid JSON
    if isinstance(value, str):
        parsed = _try_parse_json(value)
        if parsed is not None:
            # Track JSON parse success for this top-level column
            if json_parse_counts is not None:
                top_col = path.split(".")[0].split("[]")[0]
                json_parse_counts.setdefault(top_col, [0, 0])[0] += 1
            _walk_value(parsed, path, collectors, occurrence_paths, json_parse_counts, depth + 1)
            return
        # Plain string — repair double-encoded UTF-8 before recording
        collector = collectors.setdefault(path, _FieldCollector())
        collector.add(_repair_encoding(value), "string")
        occurrence_paths.add(path)
        return

    if isinstance(value, dict):
        occurrence_paths.add(path)
        for key, child_val in value.items():
            child_path = f"{path}.{key}" if path else key
            _walk_value(child_val, child_path, collectors, occurrence_paths, json_parse_counts, depth + 1)
        return

    if isinstance(value, list):
        array_path = f"{path}[]"
        occurrence_paths.add(path)
        occurrence_paths.add(array_path)
        # Track array length
        len_path = f"{path}[]._length"
        len_collector = collectors.setdefault(len_path, _FieldCollector())
        len_collector.add(len(value), "int")
        for item in value:
            _walk_value(item, array_path, collectors, occurrence_paths, json_parse_counts, depth + 1)
        return

    # Primitive types (int, float, bool)
    type_name = _classify_type(value)
    collector = collectors.setdefault(path, _FieldCollector())
    collector.add(value, type_name)
    occurrence_paths.add(path)


def analyze_rows(
    rows: Iterator[dict[str, Any]],
    max_rows: int = 10_000,
    show_progress: bool = True,
) -> tuple[SchemaNode, int]:
    """Analyze rows and build a schema tree with value statistics.

    Args:
        rows: Iterator of row dicts from any reader.
        max_rows: Maximum rows to process.
        show_progress: Whether to show a progress bar.

    Returns:
        Tuple of (root SchemaNode, number of rows analyzed).
    """
    collectors: dict[str, _FieldCollector] = {}
    path_occurrences: Counter = Counter()  # path -> number of rows containing it
    # Track per-column JSON parse rates: col_name -> [json_count, total_non_null]
    json_parse_counts: dict[str, list[int]] = {}
    rows_analyzed = 0

    if show_progress:
        progress = Progress(
            SpinnerColumn(),
            TextColumn("[bold blue]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TextColumn("{task.fields[rows]} rows"),
        )
        task = progress.add_task("Scanning...", total=max_rows, rows=0)
        progress.start()

    try:
        for row in rows:
            if rows_analyzed >= max_rows:
                break
            rows_analyzed += 1

            # Track which paths appear in this row
            row_paths: set[str] = set()

            for col_name, cell_value in row.items():
                # Track total non-null values per column for JSON threshold check
                if cell_value is not None and not (isinstance(cell_value, str) and cell_value.strip().lower() == "null"):
                    json_parse_counts.setdefault(col_name, [0, 0])[1] += 1
                _walk_value(cell_value, col_name, collectors, row_paths, json_parse_counts)

            for p in row_paths:
                path_occurrences[p] += 1

            if show_progress:
                progress.update(task, completed=rows_analyzed, rows=rows_analyzed)
    finally:
        if show_progress:
            progress.stop()

    # Prune top-level columns that are entirely null (no real data)
    top_level_paths = {p for p in collectors if "." not in p and "[]" not in p}
    empty_columns: set[str] = set()
    for col in top_level_paths:
        c = collectors[col]
        if c.null_count == c.total and c.total > 0:
            # Check no sub-paths have actual data either
            has_children = any(
                p.startswith(f"{col}.") or p.startswith(f"{col}[]")
                for p in collectors
                if p != col
            )
            if not has_children:
                empty_columns.add(col)

    if empty_columns:
        for col in empty_columns:
            del collectors[col]
            path_occurrences.pop(col, None)

    # Prune sparse unnamed columns (overflow artifacts from XLSX padding).
    # Unnamed columns matching _col_N with very low non-null rates are
    # almost always noise from a single overflow row.
    sparse_columns: set[str] = set()
    for col in top_level_paths - empty_columns:
        if col in collectors and re.match(r"^_col_\d+$", col):
            c = collectors[col]
            non_null_rate = (c.total - c.null_count) / rows_analyzed if rows_analyzed > 0 else 0
            if non_null_rate < SPARSE_COLUMN_THRESHOLD:
                sparse_columns.add(col)

    if sparse_columns:
        for col in sparse_columns:
            to_remove = [
                p for p in collectors
                if p == col or p.startswith(f"{col}.") or p.startswith(f"{col}[]")
            ]
            for p in to_remove:
                del collectors[p]
                path_occurrences.pop(p, None)

    # Build schema tree
    root = SchemaNode(name="root", full_path="")
    root.occurrence_count = rows_analyzed

    for path, collector in collectors.items():
        # Skip internal length tracking paths for tree building
        if path.endswith("._length"):
            continue

        parts = _split_path(path)
        current = root
        built_path = ""

        for i, part in enumerate(parts):
            built_path = f"{built_path}.{part}" if built_path else part
            is_array_marker = part == "[]"

            if part not in current.children:
                node = SchemaNode(
                    name=part,
                    full_path=built_path,
                    is_array=is_array_marker,
                    occurrence_count=path_occurrences.get(built_path, 0),
                )
                current.children[part] = node
            current = current.children[part]

        # Attach stats to leaf-like nodes
        current.stats = collector.to_field_stats(path)
        if not current.occurrence_count:
            current.occurrence_count = collector.total

    # Detect JSON columns using the actual parse rate vs the threshold
    for name, child in root.children.items():
        if child.children and name in json_parse_counts:
            json_count, total_non_null = json_parse_counts[name]
            json_rate = json_count / total_non_null if total_non_null > 0 else 0.0
            if json_rate >= JSON_DETECTION_THRESHOLD:
                child.is_json_column = True

    return root, rows_analyzed


def _split_path(path: str) -> list[str]:
    """Split a dot-separated path, keeping [] as separate parts.

    'col.data.items[].name' -> ['col', 'data', 'items', '[]', 'name']
    """
    parts = []
    for segment in path.split("."):
        if segment.endswith("[]"):
            parts.append(segment[:-2])
            parts.append("[]")
        else:
            parts.append(segment)
    # Filter empty strings
    return [p for p in parts if p]


def analyze_file(
    path: Path,
    max_rows: int = 10_000,
    sheet_name: str | None = None,
    show_progress: bool = True,
) -> tuple[SchemaNode, int]:
    """Convenience function: read a file and analyze it in one step."""
    from schema_scout.readers import read_file

    rows = read_file(path, max_rows=max_rows, sheet_name=sheet_name)
    return analyze_rows(rows, max_rows=max_rows, show_progress=show_progress)
