"""CLI entry point for Schema Scout.

Commands:
    scout index <file>       — Analyze a file and save an index
    scout schema <file>      — Print the schema tree
    scout query <file>       — Show stats for a specific field path
    scout list-paths <file>  — List all field paths
"""

from __future__ import annotations

import enum
import json
import sys
from pathlib import Path
from typing import Any, Optional

import typer
from rich.console import Console
from rich.markup import escape
from rich.table import Table
from rich.tree import Tree

from schema_scout.analyzer import MAX_UNIQUE_VALUES, analyze_file
from schema_scout.index_io import get_index_path, index_exists, load_index, save_index
from schema_scout.models import SchemaNode

app = typer.Typer(
    name="scout",
    help="Schema Scout — Explore the schema and values of any data file.",
    add_completion=False,
)
console = Console()


class OutputFormat(str, enum.Enum):
    """Output format for CLI commands."""
    rich = "rich"
    json_ = "json"
    plain = "plain"


def _write_json(data: Any) -> None:
    """Write JSON to stdout (bypasses Rich console to avoid markup)."""
    sys.stdout.write(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    sys.stdout.write("\n")


def _write_plain(text: str) -> None:
    """Write plain text to stdout (no Rich markup)."""
    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")


def _ensure_index(
    file: Path,
    max_rows: int,
    sheet: str | None,
    force: bool = False,
    quiet: bool = False,
) -> tuple[SchemaNode, dict]:
    """Load existing index or create a new one."""
    # If the file itself is an index, load it directly
    if file.suffix == ".json" and file.name.endswith(".scout-index.json"):
        return load_index(file)

    index_path = get_index_path(file)
    if index_exists(file) and not force:
        if not quiet:
            console.print(f"[dim]Loading existing index: {index_path.name}[/dim]")
        return load_index(index_path)

    # Create new index
    if not quiet:
        console.print(f"[bold]Indexing {file.name}...[/bold]")
    schema, rows = analyze_file(file, max_rows=max_rows, sheet_name=sheet)
    saved_path = save_index(schema, file, rows, max_rows, sheet_name=sheet)
    if not quiet:
        console.print(f"[green]Index saved: {saved_path.name} ({rows} rows analyzed)[/green]")
    metadata = {
        "source_file": str(file.resolve()),
        "source_file_name": file.name,
        "rows_analyzed": rows,
        "max_rows_setting": max_rows,
    }
    return schema, metadata


# --- Rich output helpers ---


def _build_rich_tree(node: SchemaNode, tree: Tree | None = None, depth: int = 0) -> Tree:
    """Build a rich Tree from a SchemaNode for display."""
    label = _node_label(node)
    if tree is None:
        tree = Tree(label)
        current = tree
    else:
        current = tree.add(label)

    for child in sorted(node.children.values(), key=lambda n: n.name):
        _build_rich_tree(child, current, depth + 1)

    return tree


def _node_label(node: SchemaNode) -> str:
    """Format a single node as a rich-compatible label string."""
    parts = []

    if node.name == "root":
        return "[bold]root[/bold]"

    name = node.name
    if node.is_array:
        name = "[]"
    if node.is_json_column:
        name = f"{name} [dim](JSON)[/dim]"

    parts.append(f"[bold]{name}[/bold]")

    # Skip inline stats for branch nodes (nodes with children) — the tree
    # structure is more informative. This prevents JSON columns with a few
    # unparseable rows from dumping raw JSON strings into the label.
    if node.stats and not node.children:
        s = node.stats
        # Type info
        types = ", ".join(f"{t}" for t in sorted(s.types_seen.keys()))
        parts.append(f"[cyan]{escape(types)}[/cyan]")

        # Value summary
        if s.unique_values is not None:
            count = len(s.unique_values)
            if count <= 10:
                vals = ", ".join(escape(str(v)) for v in s.unique_values)
                parts.append(f"[green]{count} values: {vals}[/green]")
            else:
                parts.append(f"[green]{count} unique values[/green]")
        elif s.sample_values is not None:
            parts.append("[yellow]many unique values[/yellow]")

        # Range for numerics
        if s.min_value is not None and s.max_value is not None:
            if s.min_value != s.max_value:
                parts.append(f"[dim]range: {escape(str(s.min_value))} .. {escape(str(s.max_value))}[/dim]")

        # Null info
        if s.null_count > 0:
            pct = s.null_count / s.total_count * 100 if s.total_count else 0
            parts.append(f"[dim]nulls: {s.null_count} ({pct:.0f}%)[/dim]")

    return " | ".join(parts)


def _print_field_detail(node: SchemaNode, metadata: dict) -> None:
    """Print detailed stats for a specific field (Rich format)."""
    console.print()
    console.print(f"[bold]Path:[/bold] {escape(node.full_path)}")
    console.print(f"[bold]Rows with this field:[/bold] {node.occurrence_count} / {metadata.get('rows_analyzed', '?')}")

    if not node.stats:
        if node.children:
            console.print("[dim]This is a branch node (has children). Use a more specific path to see values.[/dim]")
            console.print()
            console.print("[bold]Children:[/bold]")
            for child in sorted(node.children.values(), key=lambda n: n.name):
                console.print(f"  {child.full_path}")
        return

    s = node.stats
    console.print()

    # Types
    type_table = Table(title="Types", show_header=True, header_style="bold")
    type_table.add_column("Type")
    type_table.add_column("Count", justify="right")
    type_table.add_column("%", justify="right")
    for t, count in sorted(s.types_seen.items(), key=lambda x: -x[1]):
        pct = count / s.total_count * 100 if s.total_count else 0
        type_table.add_row(t, str(count), f"{pct:.1f}%")
    console.print(type_table)

    # Nulls
    if s.null_count > 0:
        pct = s.null_count / s.total_count * 100 if s.total_count else 0
        console.print(f"\n[bold]Nulls:[/bold] {s.null_count} / {s.total_count} ({pct:.1f}%)")

    # Range
    if s.min_value is not None:
        console.print(f"[bold]Min:[/bold] {s.min_value}")
    if s.max_value is not None:
        console.print(f"[bold]Max:[/bold] {s.max_value}")

    # Values
    if s.value_counts:
        console.print()
        val_table = Table(title=f"Values ({len(s.value_counts)} unique)", show_header=True, header_style="bold")
        val_table.add_column("Value")
        val_table.add_column("Count", justify="right")
        val_table.add_column("%", justify="right")
        total_non_null = s.total_count - s.null_count
        for val, count in sorted(s.value_counts.items(), key=lambda x: -x[1]):
            pct = count / total_non_null * 100 if total_non_null else 0
            val_table.add_row(escape(str(val)), str(count), f"{pct:.1f}%")
        console.print(val_table)
    elif s.sample_values:
        console.print(f"\n[bold]Too many unique values to list all (>{MAX_UNIQUE_VALUES}).[/bold]")
        console.print(f"[bold]Samples:[/bold] {', '.join(escape(str(v)) for v in s.sample_values)}")


# --- Plain text output helpers ---


def _plain_tree(node: SchemaNode, prefix: str = "", is_last: bool = True, is_root: bool = True) -> str:
    """Build a plain-text tree (no Rich markup) for piping."""
    lines: list[str] = []

    if is_root:
        lines.append("root")
    else:
        connector = "`-- " if is_last else "|-- "
        label = _plain_node_label(node)
        lines.append(f"{prefix}{connector}{label}")

    children = sorted(node.children.values(), key=lambda n: n.name)
    for i, child in enumerate(children):
        is_child_last = i == len(children) - 1
        child_prefix = prefix if is_root else (prefix + ("    " if is_last else "|   "))
        lines.append(_plain_tree(child, child_prefix, is_child_last, is_root=False))

    return "\n".join(lines)


def _plain_node_label(node: SchemaNode) -> str:
    """Format a single node as plain text (no markup)."""
    parts: list[str] = []

    name = "[]" if node.is_array else node.name
    if node.is_json_column:
        name = f"{name} (JSON)"
    parts.append(name)

    if node.stats and not node.children:
        s = node.stats
        types = ", ".join(sorted(s.types_seen.keys()))
        parts.append(types)

        if s.unique_values is not None:
            count = len(s.unique_values)
            if count <= 10:
                vals = ", ".join(str(v) for v in s.unique_values)
                parts.append(f"{count} values: {vals}")
            else:
                parts.append(f"{count} unique values")
        elif s.sample_values is not None:
            parts.append("many unique values")

        if s.min_value is not None and s.max_value is not None:
            if s.min_value != s.max_value:
                parts.append(f"range: {s.min_value} .. {s.max_value}")

        if s.null_count > 0:
            pct = s.null_count / s.total_count * 100 if s.total_count else 0
            parts.append(f"nulls: {s.null_count} ({pct:.0f}%)")

    return " | ".join(parts)


# --- CLI Commands ---


@app.command()
def index(
    file: Path = typer.Argument(..., help="File to analyze (XLSX, CSV, or JSON)"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan (default: 10000)"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-index even if index exists"),
    fmt: OutputFormat = typer.Option(OutputFormat.rich, "--format", "-F", help="Output format: rich, json, plain"),
) -> None:
    """Analyze a file and save an index for later exploration."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    quiet = fmt != OutputFormat.rich
    schema, metadata = _ensure_index(file, max_rows, sheet, force=force, quiet=quiet)

    if fmt == OutputFormat.json_:
        _write_json(schema.to_dict())
    elif fmt == OutputFormat.plain:
        _write_plain(_plain_tree(schema))
    else:
        console.print()
        tree = _build_rich_tree(schema)
        console.print(tree)


@app.command()
def schema(
    file: Path = typer.Argument(..., help="File or index to show schema for"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
    fmt: OutputFormat = typer.Option(OutputFormat.rich, "--format", "-F", help="Output format: rich, json, plain"),
) -> None:
    """Print the full schema tree with types and value summaries."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    quiet = fmt != OutputFormat.rich
    schema_root, _ = _ensure_index(file, max_rows, sheet, quiet=quiet)

    if fmt == OutputFormat.json_:
        _write_json(schema_root.to_dict())
    elif fmt == OutputFormat.plain:
        _write_plain(_plain_tree(schema_root))
    else:
        console.print()
        tree = _build_rich_tree(schema_root)
        console.print(tree)


@app.command()
def query(
    file: Path = typer.Argument(..., help="File or index to query"),
    path: str = typer.Option(..., "--path", "-p", help="Dot-separated field path to query"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
    fmt: OutputFormat = typer.Option(OutputFormat.rich, "--format", "-F", help="Output format: rich, json, plain"),
) -> None:
    """Show detailed stats for a specific field path."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    quiet = fmt != OutputFormat.rich
    schema_root, metadata = _ensure_index(file, max_rows, sheet, quiet=quiet)
    node = schema_root.find_node(path)
    if node is None:
        console.print(f"[red]Path not found: {path}[/red]")
        console.print("[dim]Available paths:[/dim]")
        all_paths = schema_root.get_all_paths()
        # Show paths that partially match
        matches = [p for p in all_paths if path.lower() in p.lower()]
        for p in (matches or all_paths)[:20]:
            console.print(f"  {p}")
        if len(all_paths) > 20:
            console.print(f"  ... and {len(all_paths) - 20} more")
        raise typer.Exit(1)

    if fmt == OutputFormat.json_:
        _write_json(node.to_dict())
    elif fmt == OutputFormat.plain:
        _write_plain(_plain_query(node, metadata))
    else:
        _print_field_detail(node, metadata)


@app.command(name="list-paths")
def list_paths(
    file: Path = typer.Argument(..., help="File or index to list paths for"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
    fmt: OutputFormat = typer.Option(OutputFormat.rich, "--format", "-F", help="Output format: rich, json, plain"),
) -> None:
    """List all field paths found in the file (one per line)."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    quiet = fmt != OutputFormat.rich
    schema_root, _ = _ensure_index(file, max_rows, sheet, quiet=quiet)
    paths = sorted(schema_root.get_all_paths())

    if fmt == OutputFormat.json_:
        _write_json(paths)
    elif fmt == OutputFormat.plain:
        _write_plain("\n".join(paths))
    else:
        for p in paths:
            console.print(p)
        console.print(f"\n[dim]{len(paths)} paths total[/dim]")


def _plain_query(node: SchemaNode, metadata: dict) -> str:
    """Format query output as plain text."""
    lines: list[str] = []
    lines.append(f"Path: {node.full_path}")
    lines.append(f"Rows with this field: {node.occurrence_count} / {metadata.get('rows_analyzed', '?')}")

    if not node.stats:
        if node.children:
            lines.append("(branch node — has children)")
            for child in sorted(node.children.values(), key=lambda n: n.name):
                lines.append(f"  {child.full_path}")
        return "\n".join(lines)

    s = node.stats
    lines.append("")
    lines.append("Types:")
    for t, count in sorted(s.types_seen.items(), key=lambda x: -x[1]):
        pct = count / s.total_count * 100 if s.total_count else 0
        lines.append(f"  {t}: {count} ({pct:.1f}%)")

    if s.null_count > 0:
        pct = s.null_count / s.total_count * 100 if s.total_count else 0
        lines.append(f"Nulls: {s.null_count} / {s.total_count} ({pct:.1f}%)")

    if s.min_value is not None:
        lines.append(f"Min: {s.min_value}")
    if s.max_value is not None:
        lines.append(f"Max: {s.max_value}")

    if s.value_counts:
        lines.append(f"\nValues ({len(s.value_counts)} unique):")
        total_non_null = s.total_count - s.null_count
        for val, count in sorted(s.value_counts.items(), key=lambda x: -x[1]):
            pct = count / total_non_null * 100 if total_non_null else 0
            lines.append(f"  {val}: {count} ({pct:.1f}%)")
    elif s.sample_values:
        lines.append(f"\nToo many unique values to list all (>{MAX_UNIQUE_VALUES}).")
        lines.append(f"Samples: {', '.join(str(v) for v in s.sample_values)}")

    return "\n".join(lines)


if __name__ == "__main__":
    app()
