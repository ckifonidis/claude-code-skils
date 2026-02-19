"""CLI entry point for Schema Scout.

Commands:
    scout index <file>       — Analyze a file and save an index
    scout schema <file>      — Print the schema tree
    scout query <file>       — Show stats for a specific field path
    scout list-paths <file>  — List all field paths
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.markup import escape
from rich.table import Table
from rich.tree import Tree

from schema_scout.analyzer import analyze_file
from schema_scout.index_io import get_index_path, index_exists, load_index, save_index
from schema_scout.models import SchemaNode

app = typer.Typer(
    name="scout",
    help="Schema Scout — Explore the schema and values of any data file.",
    add_completion=False,
)
console = Console()


def _ensure_index(
    file: Path,
    max_rows: int,
    sheet: str | None,
    force: bool = False,
) -> tuple[SchemaNode, dict]:
    """Load existing index or create a new one."""
    # If the file itself is an index, load it directly
    if file.suffix == ".json" and file.name.endswith(".scout-index.json"):
        return load_index(file)

    index_path = get_index_path(file)
    if index_exists(file) and not force:
        console.print(f"[dim]Loading existing index: {index_path.name}[/dim]")
        return load_index(index_path)

    # Create new index
    console.print(f"[bold]Indexing {file.name}...[/bold]")
    schema, rows = analyze_file(file, max_rows=max_rows, sheet_name=sheet)
    saved_path = save_index(schema, file, rows, max_rows, sheet_name=sheet)
    console.print(f"[green]Index saved: {saved_path.name} ({rows} rows analyzed)[/green]")
    metadata = {
        "source_file": str(file.resolve()),
        "source_file_name": file.name,
        "rows_analyzed": rows,
        "max_rows_setting": max_rows,
    }
    return schema, metadata


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

    if node.stats:
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
            parts.append(f"[yellow]~{s.unique_count}+ unique[/yellow]")

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
    """Print detailed stats for a specific field."""
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
        console.print(f"\n[bold]Too many unique values to list all.[/bold]")
        console.print(f"[bold]Estimated unique:[/bold] {s.unique_count}+")
        console.print(f"[bold]Samples:[/bold] {', '.join(escape(str(v)) for v in s.sample_values)}")


# --- CLI Commands ---


@app.command()
def index(
    file: Path = typer.Argument(..., help="File to analyze (XLSX, CSV, or JSON)"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan (default: 10000)"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-index even if index exists"),
) -> None:
    """Analyze a file and save an index for later exploration."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    schema, metadata = _ensure_index(file, max_rows, sheet, force=force)
    console.print()
    tree = _build_rich_tree(schema)
    console.print(tree)


@app.command()
def schema(
    file: Path = typer.Argument(..., help="File or index to show schema for"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
) -> None:
    """Print the full schema tree with types and value summaries."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    schema_root, _ = _ensure_index(file, max_rows, sheet)
    console.print()
    tree = _build_rich_tree(schema_root)
    console.print(tree)


@app.command()
def query(
    file: Path = typer.Argument(..., help="File or index to query"),
    path: str = typer.Option(..., "--path", "-p", help="Dot-separated field path to query"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
) -> None:
    """Show detailed stats for a specific field path."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    schema_root, metadata = _ensure_index(file, max_rows, sheet)
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

    _print_field_detail(node, metadata)


@app.command(name="list-paths")
def list_paths(
    file: Path = typer.Argument(..., help="File or index to list paths for"),
    max_rows: int = typer.Option(10_000, "--max-rows", "-n", help="Maximum rows to scan"),
    sheet: Optional[str] = typer.Option(None, "--sheet", "-s", help="Sheet name for XLSX files"),
) -> None:
    """List all field paths found in the file (one per line)."""
    if not file.exists():
        console.print(f"[red]File not found: {file}[/red]")
        raise typer.Exit(1)

    schema_root, _ = _ensure_index(file, max_rows, sheet)
    paths = schema_root.get_all_paths()
    for p in sorted(paths):
        console.print(p)
    console.print(f"\n[dim]{len(paths)} paths total[/dim]")


if __name__ == "__main__":
    app()
