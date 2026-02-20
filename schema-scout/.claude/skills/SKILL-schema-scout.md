---
name: schema-scout
description: Explore the schema and values of any data file (XLSX, CSV, JSON) using Schema Scout
user_invocable: true
arguments:
  - name: file
    description: Path to the file to explore (optional - can be provided in conversation)
    required: false
---

# Schema Scout File Explorer Skill

You are helping the user explore the structure and values of data files using Schema Scout.

## Context

Schema Scout is a Python CLI tool that indexes data files (XLSX, CSV, JSON), detects JSON structures embedded in cells, and builds a schema tree with value statistics. The user wants to understand what fields exist in their data and what values those fields can take — so they can use that information in their code.

## Setup

`scout` is installed globally via `uv tool install` and available on PATH — run it directly, no venv activation needed.

If `scout` is not found, install it from the project root:
```bash
uv tool install --editable /path/to/schema-scout
```

## Workflow

### Step 1: Locate the file

If the user provides a filename without a full path, look for it in:
1. The current working directory
2. Nearby directories containing `.xlsx`, `.csv`, or `.json` data files

Use Glob to find the file if needed.

### Step 2: Index the file (if needed)

Check if a `.scout-index.json` file already exists next to the source file. If not, run:

```bash
<project_root>/.venv/bin/scout index <file_path> --max-rows 10000
```

The user can request a different row limit (up to 100,000). Use `--force` to re-index.

For XLSX files with multiple sheets, use `--sheet <name>` to specify which sheet.

### Step 3: Read the index

After indexing, read the generated `.scout-index.json` file using the Read tool. This JSON file contains the full schema tree with value statistics.

### Step 4: Present the schema

Show the user a clean, formatted overview of the schema. Use a tree-like format:

```
root
├── column_name (type) — N unique values
├── json_column (JSON detected)
│   ├── field1 (string) — values: ["A", "B", "C"]
│   ├── field2 (float) — range: 0.0 .. 1000.0
│   └── nested_object
│       ├── sub_field1 (int) — 5 unique values
│       └── sub_field2 (string) — 150+ unique (samples: ...)
```

Guidelines for presenting:
- Show the type(s) for each field
- For fields with few unique values (<=50): list them all
- For fields with many unique values: show count + samples
- For numeric fields: show the range (min..max)
- Highlight fields that are always null
- Mark columns where JSON was auto-detected

### Step 5: Answer follow-up questions

The user will ask about specific fields. Use the index data to answer:

- **"What values can X take?"** — List all unique values with counts/percentages
- **"What type is X?"** — Show the type distribution
- **"Show me fields under X"** — Show the sub-tree
- **"Which fields are always present?"** — Compare occurrence_count to rows_analyzed
- **"Give me X as a TypeScript/C#/Python type"** — Generate appropriate code

### Formatting values for code

When the user wants to copy values into their code, format them appropriately:

**As a list/array:**
```typescript
const statuses = ["ACTIVE", "PENDING", "CLOSED", "BLOCKED"];
```

**As an enum (TypeScript):**
```typescript
enum Status {
  ACTIVE = "ACTIVE",
  PENDING = "PENDING",
  CLOSED = "CLOSED",
  BLOCKED = "BLOCKED",
}
```

**As an enum (C#):**
```csharp
public enum Status { Active, Pending, Closed, Blocked }
```

**As a type union:**
```typescript
type Status = "ACTIVE" | "PENDING" | "CLOSED" | "BLOCKED";
```

Always ask the user what language/format they prefer if not obvious from context.

## CLI Reference

```
scout index <file> [--max-rows N] [--sheet NAME] [--force]
scout schema <file_or_index> [--max-rows N] [--sheet NAME]
scout query <file_or_index> --path "field.path" [--max-rows N]
scout list-paths <file_or_index> [--max-rows N]
```

## Important Notes

- The tool is **pattern-agnostic**: it works on any file structure, not tied to specific APIs or schemas
- JSON in cells is **auto-detected**: any string that parses as JSON is recursively expanded
- JSON-in-JSON is handled: if a JSON string value is itself valid JSON, it gets expanded too
- Large files: default is 10,000 rows. User can increase to 100,000 with `--max-rows`
- Index files are cached next to the source file. Use `--force` to re-index
- The tool DOES NOT upload or send any data anywhere — everything runs locally
- **Auto-cleanup**: Top-level null columns are pruned; XLSX overflow columns (trailing unnamed headers) are trimmed; sparse `_col_N` columns (<5% non-null) are removed
- **Encoding repair**: Double-encoded UTF-8 strings (common from Excel/ODBC pipelines) are automatically detected and repaired (e.g., garbled Greek/Cyrillic text is restored)
