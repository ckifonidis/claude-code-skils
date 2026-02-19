"""Schema analyzer — the core engine of Schema Scout.

Scans rows from any file reader, detects JSON in any cell, recursively walks
all structures, and builds a schema tree with value statistics.

Fully pattern-agnostic: makes zero assumptions about column names,
JSON structure, or nesting patterns.
"""

from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

from schema_scout.models import FieldStats, SchemaNode


# Thresholds
MAX_UNIQUE_VALUES = 50  # Keep all values if unique count <= this
SAMPLE_SIZE = 10  # Number of samples to keep when above threshold
JSON_DETECTION_THRESHOLD = 0.3  # Mark column as JSON if >30% of non-empty values parse


class _FieldCollector:
    """Collects values and stats for a single field path during scanning."""

    __slots__ = ("counter", "samples", "types", "total", "null_count", "min_val", "max_val", "capped")

    def __init__(self) -> None:
        self.counter: Counter = Counter()
        self.samples: list[Any] = []
        self.types: Counter = Counter()
        self.total: int = 0
        self.null_count: int = 0
        self.min_val: Any = None
        self.max_val: Any = None
        self.capped: bool = False

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
                # Keep a random sample
                self.samples = random.sample(list(self.counter.keys()), min(SAMPLE_SIZE, len(self.counter)))
        elif len(self.samples) < SAMPLE_SIZE:
            # Reservoir sampling for additional samples
            str_val = str(value)
            if str_val not in self.samples:
                self.samples.append(str_val)

    def to_field_stats(self, path: str) -> FieldStats:
        unique_count = len(self.counter) if not self.capped else self.total - self.null_count
        # If capped, we don't know the exact unique count, estimate from what we saw
        if self.capped:
            # Use total non-null as upper bound
            unique_count = self.total - self.null_count

        stats = FieldStats(
            path=path,
            types_seen=dict(self.types),
            total_count=self.total,
            null_count=self.null_count,
            unique_count=unique_count if not self.capped else unique_count,
        )

        if not self.capped:
            stats.unique_values = sorted(self.counter.keys(), key=lambda x: -self.counter[x])
            stats.value_counts = dict(self.counter.most_common())
            stats.unique_count = len(self.counter)
        else:
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
    """Try to parse a string as JSON. Returns parsed result or None."""
    if not value or len(value) < 2:
        return None
    first = value[0]
    if first not in ('{', '[', '"'):
        return None
    try:
        parsed = json.loads(value)
        # Only consider dicts and lists as "JSON structures" worth expanding
        if isinstance(parsed, (dict, list)):
            return parsed
        return None
    except (json.JSONDecodeError, ValueError):
        return None


def _walk_value(
    value: Any,
    path: str,
    collectors: dict[str, _FieldCollector],
    occurrence_paths: set[str],
) -> None:
    """Recursively walk a value and collect stats for all paths.

    Handles nested objects, arrays, and JSON-in-JSON (strings that contain JSON).
    """
    if value is None or (isinstance(value, str) and value.strip().lower() == "null"):
        collector = collectors.setdefault(path, _FieldCollector())
        collector.add(None, "null")
        occurrence_paths.add(path)
        return

    # Check for JSON-in-JSON: if a string value is itself valid JSON
    if isinstance(value, str):
        parsed = _try_parse_json(value)
        if parsed is not None:
            _walk_value(parsed, path, collectors, occurrence_paths)
            return
        # Plain string
        collector = collectors.setdefault(path, _FieldCollector())
        collector.add(value, "string")
        occurrence_paths.add(path)
        return

    if isinstance(value, dict):
        occurrence_paths.add(path)
        for key, child_val in value.items():
            child_path = f"{path}.{key}" if path else key
            _walk_value(child_val, child_path, collectors, occurrence_paths)
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
            _walk_value(item, array_path, collectors, occurrence_paths)
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
                _walk_value(cell_value, col_name, collectors, row_paths)

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

    # Detect JSON columns (mark top-level nodes that were mostly JSON)
    for name, child in root.children.items():
        if child.children:
            # Has sub-structure, likely was a JSON column
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
