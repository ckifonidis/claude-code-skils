"""Data models for Schema Scout schema representation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FieldStats:
    """Statistics for a single field (leaf node in the schema tree).

    Tracks type distribution, value counts, and ranges for a specific path.
    """

    path: str
    types_seen: dict[str, int] = field(default_factory=dict)
    total_count: int = 0
    null_count: int = 0
    unique_count: int | None = 0
    unique_values: list[Any] | None = None
    sample_values: list[Any] | None = None
    value_counts: dict[str, int] | None = None
    min_value: Any = None
    max_value: Any = None

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "types_seen": self.types_seen,
            "total_count": self.total_count,
            "null_count": self.null_count,
            "unique_count": self.unique_count,
            "unique_values": self.unique_values,
            "sample_values": self.sample_values,
            "value_counts": self.value_counts,
            "min_value": self.min_value,
            "max_value": self.max_value,
        }

    @classmethod
    def from_dict(cls, data: dict) -> FieldStats:
        return cls(**data)


@dataclass
class SchemaNode:
    """A node in the schema tree.

    Intermediate nodes have children. Leaf nodes have stats.
    """

    name: str
    full_path: str
    children: dict[str, SchemaNode] = field(default_factory=dict)
    stats: FieldStats | None = None
    is_array: bool = False
    is_json_column: bool = False
    occurrence_count: int = 0

    def to_dict(self) -> dict:
        result: dict[str, Any] = {
            "name": self.name,
            "full_path": self.full_path,
            "occurrence_count": self.occurrence_count,
        }
        if self.is_array:
            result["is_array"] = True
        if self.is_json_column:
            result["is_json_column"] = True
        if self.children:
            result["children"] = {
                k: v.to_dict() for k, v in sorted(self.children.items())
            }
        if self.stats:
            result["stats"] = self.stats.to_dict()
        return result

    @classmethod
    def from_dict(cls, data: dict) -> SchemaNode:
        children = {}
        if "children" in data:
            children = {
                k: SchemaNode.from_dict(v) for k, v in data["children"].items()
            }
        stats = None
        if "stats" in data:
            stats = FieldStats.from_dict(data["stats"])
        return cls(
            name=data["name"],
            full_path=data["full_path"],
            children=children,
            stats=stats,
            is_array=data.get("is_array", False),
            is_json_column=data.get("is_json_column", False),
            occurrence_count=data.get("occurrence_count", 0),
        )

    def get_all_paths(self) -> list[str]:
        """Return all leaf paths under this node."""
        paths = []
        if self.stats and not self.children:
            paths.append(self.full_path)
        for child in self.children.values():
            paths.extend(child.get_all_paths())
        return paths

    def find_node(self, path: str) -> SchemaNode | None:
        """Find a node by its full path (dot-separated)."""
        if self.full_path == path:
            return self
        for child in self.children.values():
            result = child.find_node(path)
            if result is not None:
                return result
        return None
