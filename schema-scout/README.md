# Schema Scout

**Explore the schema and values of any data file.**

Schema Scout reads your data files (XLSX, CSV, JSON), detects nested JSON structures inside cells, and builds a schema tree showing every field with its type and possible values. It answers the question: *"What can this field contain?"*

## Why?

When you have API request/response data in spreadsheets or JSON exports, understanding the structure is painful:
- Columns may contain JSON strings with deeply nested objects
- You need to know what values a field can take (to build enums, validation, etc.)
- You want to quickly find if a field is always present, what types it uses, what the range is

Schema Scout does this automatically. Point it at a file, and it tells you everything.

## Quick Start

### 1. Install

**Option A: Global install with uv (recommended)**

```bash
git clone <repo-url>
uv tool install --editable ./schema-scout
```

This puts `scout` on your PATH — use it from anywhere, no venv activation needed.

**Option B: Project-local venv**

```bash
cd schema-scout
uv venv && uv pip install -e .
# Or: python -m venv .venv && .venv/bin/pip install -e .
```

Requires Python 3.10+.

### 2. Index a file

```bash
scout index mydata.xlsx
```

This scans the file (default: first 10,000 rows), detects JSON in cells, and saves an index file next to it (`mydata.xlsx.scout-index.json`).

### 3. Explore

**Option A: Use the CLI**

```bash
# Show the full schema tree
scout schema mydata.xlsx

# Query a specific field
scout query mydata.xlsx --path "response.payload.status"

# List all field paths
scout list-paths mydata.xlsx
```

**Option B: Use the Claude Code skill** (recommended for exploration)

If you're using Claude Code in this project directory, just say:

> "Explore mydata.xlsx"

Claude will automatically index the file and help you navigate the schema conversationally. You can ask things like:
- "What values can `payload.status` take?"
- "Show me all fields under `response.data`"
- "Give me the status values as a TypeScript enum"

## CLI Commands

### `scout index <file>`

Analyze a file and save an index for later exploration.

```bash
scout index data.xlsx                    # Default: scan 10,000 rows
scout index data.xlsx --max-rows 50000   # Scan more rows
scout index data.xlsx --sheet "Sheet2"   # Specific sheet (XLSX only)
scout index data.xlsx --force             # Re-index even if index exists
```

**Output:** Prints the schema tree and saves a `.scout-index.json` file next to the source file.

### `scout schema <file>`

Print the full schema tree with types and value summaries.

```bash
scout schema data.xlsx
```

If no index exists, it creates one automatically.

**Example output:**

```
root
├── id | string | ~10000+ unique
├── status | string | 4 values: ACTIVE, PENDING, CLOSED, BLOCKED
├── amount | float | range: 0.50 .. 15000.00
├── request_body (JSON)
│   ├── customerId | string | ~5000+ unique
│   └── type | string | 3 values: CREDIT, DEBIT, PREPAID
└── response_body (JSON)
    ├── payload
    │   ├── balance | float | range: 0.0 .. 50000.0
    │   └── cards[]
    │       ├── cardNumber | string | ~8000+ unique
    │       └── status | string | 2 values: ACTIVE, BLOCKED
    └── error | null | nulls: 9800 (98%)
```

### `scout query <file> --path <path>`

Show detailed stats for a specific field.

```bash
scout query data.xlsx --path "response_body.payload.interestRate"
```

**Example output:**

```
Path: response_body.payload.interestRate
Rows with this field: 99 / 100

          Types
┌───────┬───────┬────────┐
│ Type  │ Count │      % │
├───────┼───────┼────────┤
│ float │    99 │ 100.0% │
└───────┴───────┴────────┘
Min: 10.28
Max: 19.89

   Values (10 unique)
┌───────┬───────┬───────┐
│ Value │ Count │     % │
├───────┼───────┼───────┤
│ 19.89 │    42 │ 42.4% │
│ 18.08 │    22 │ 22.2% │
│ 18.89 │    11 │ 11.1% │
│ ...   │       │       │
└───────┴───────┴───────┘
```

### `scout list-paths <file>`

List all field paths found in the file (one per line). Useful for scripting or grepping.

```bash
scout list-paths data.xlsx
# Output:
# id
# status
# request_body.customerId
# request_body.type
# response_body.payload.balance
# response_body.payload.cards[].cardNumber
# ...
```

## Supported File Formats

| Format | Extensions | How it's read |
|--------|-----------|---------------|
| Excel | `.xlsx` | `openpyxl` in streaming read-only mode. First row = headers. |
| CSV | `.csv` | Standard `csv.DictReader`. UTF-8 with BOM support. |
| JSON | `.json` | JSON array or newline-delimited JSON (NDJSON). |
| NDJSON | `.ndjson`, `.jsonl` | One JSON object per line. |

## How JSON Detection Works

Schema Scout automatically detects JSON strings inside any cell:

1. For every string value in every cell, it tries to parse it as JSON
2. If it parses as an object (`{...}`) or array (`[...]`), it recursively walks the structure
3. This applies at any depth — if a JSON value contains another JSON string, that gets expanded too
4. A column is marked as "(JSON)" in the schema if >30% of its non-empty values parse as JSON

**This is fully automatic and pattern-agnostic.** Schema Scout doesn't care what your columns are called or what the JSON structure looks like.

## Sensitive Data — Use the CLI

> **If your data contains sensitive or confidential information (customer data, PII, financial records, internal API responses), use the CLI directly in your terminal — NOT through AI assistants like Claude Code.**

When you use Schema Scout through Claude Code (or any AI tool), the CLI output — including sample values, unique value lists, and field statistics — is sent to the AI provider's API. This means customer IDs, IP addresses, account numbers, and any other values in your data will leave your machine.

**The CLI runs 100% locally.** Nothing is sent anywhere. Here's the safe workflow:

```bash
# Step 1: Index the file (runs locally, saves index next to the file)
scout index mydata.xlsx

# Step 2: See the full structure
scout schema mydata.xlsx

# Step 3: Drill into a specific field
scout query mydata.xlsx --path "response_text_data.payload.productGroups"

# Step 4: List all available paths (useful for finding the right --path value)
scout list-paths mydata.xlsx
```

A typical workflow looks like:
1. Run `scout schema` to see the full tree and understand the structure
2. Spot a field you want to know more about
3. Run `scout list-paths` if you need the exact path syntax
4. Run `scout query --path "..."` to get detailed stats (type distribution, all values, ranges)
5. Repeat for other fields

The Claude Code skill is convenient for conversational exploration and code generation (e.g. "give me this as a TypeScript enum"), but only use it with non-sensitive data.

## Data Sanitization

Schema Scout automatically cleans up noisy data:

- **Empty columns are pruned**: Top-level columns that are 100% null (common in XLSX files with trailing empty columns) are automatically removed from the schema and index.
- **No absolute paths**: Index files store only the source filename, not your full filesystem path, so they're safe to share.

**Privacy note:** Index files contain sample values and unique value lists extracted from your data. If your data contains PII (IP addresses, usernames, customer IDs, etc.), those samples will appear in the index. Be mindful of this when sharing index files.

## How Indexing Works

When you index a file, Schema Scout:

1. Reads rows (up to `--max-rows` limit)
2. For each cell, detects and expands JSON structures
3. For each field path found, tracks:
   - **Types**: what Python types appeared (string, int, float, bool, null)
   - **Unique values**: all values if <=50 unique, otherwise 10 samples
   - **Value counts**: how many times each value appeared (if <=50 unique)
   - **Range**: min/max for numeric fields
   - **Null count**: how many rows had null/missing values
4. Saves everything as a `.scout-index.json` file next to the source

The index file is a plain JSON file. You can open it in any editor or read it programmatically.

**Re-indexing:** Use `--force` to overwrite an existing index. Useful if you want to scan more rows.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `--max-rows` / `-n` | 10,000 | Maximum rows to scan. Increase for more accuracy, decrease for speed. |
| `--sheet` / `-s` | (first sheet) | Sheet name for XLSX files with multiple sheets. |
| `--force` / `-f` | false | Re-index even if an index file already exists. |

## Troubleshooting

**"Unsupported file format"**
Schema Scout supports `.xlsx`, `.csv`, `.json`, `.ndjson`, and `.jsonl`. Other formats are not supported.

**"File not found"**
Provide the full path to the file, or run `scout` from the directory containing the file.

**Too many columns showing as `_col_N`**
This means the XLSX file has columns without headers. Schema Scout auto-generates names like `_col_0`, `_col_1`, etc. for unnamed columns. Note: top-level columns that are entirely null are automatically pruned from the schema and index, so empty trailing columns won't clutter the output.

**Index file is too large**
The index file size depends on the number of unique field paths and values. If it's too large, reduce `--max-rows` or the data may simply have many unique paths.

**Slow indexing**
For large files, reduce `--max-rows`. 10,000 rows is usually enough to understand the schema. Increase only if you need more accurate value distributions.
