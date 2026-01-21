---
name: google-drive
description: Manage Google Drive files and folders. Use when uploading, downloading, syncing files with Google Drive, backing up directories, searching Drive, or sharing files.
allowed-tools: Bash, Read, Write
---

# Google Drive Skill

Manage files and folders on Google Drive with full CRUD operations on My Drive and read-only access to Shared Drives.

## Setup

Two authentication methods are supported:

### Option 1: Service Account (Recommended for automation)

Service accounts are ideal for automation, CI/CD, and server-to-server communication. No browser interaction required.

1. Go to [Google Cloud Console - Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Create a new project or select existing
3. Enable the Google Drive API
4. Create a service account
5. Create and download a JSON key file
6. Place the key file in the skill directory

```bash
# Copy template
cp ~/.claude/skills/google-drive/.env.example ~/.claude/skills/google-drive/.env

# Edit .env
GOOGLE_SERVICE_ACCOUNT_KEY=service-account-key.json
```

**Important**: Service accounts have their own Drive storage. To access a user's Drive:
- Share files/folders with the service account email, OR
- Use domain-wide delegation (Google Workspace) with `GOOGLE_IMPERSONATE_USER`

### Option 2: OAuth2 User Credentials (For personal Drive)

OAuth2 is better when you need to access your personal Google Drive with your own account.

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select existing
3. Enable the Google Drive API
4. Create OAuth 2.0 Client ID (Desktop application)
5. Download or copy Client ID and Client Secret

```bash
# Copy template
cp ~/.claude/skills/google-drive/.env.example ~/.claude/skills/google-drive/.env

# Edit .env and add your credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Then authenticate:

```bash
node ~/.claude/skills/google-drive/src/cli.js auth
```

This opens a browser for Google sign-in. After authorization, the refresh token is saved automatically.

### Check Authentication Status

```bash
node ~/.claude/skills/google-drive/src/cli.js auth --status
```

This shows which authentication method is active and its details.

## CLI Location

```bash
~/.claude/skills/google-drive/src/cli.js
```

## Quick Reference

### Authentication

```bash
# Authenticate (one-time)
node ~/.claude/skills/google-drive/src/cli.js auth

# Check auth status
node ~/.claude/skills/google-drive/src/cli.js auth --status
```

### File Operations

```bash
# List files in root
node ~/.claude/skills/google-drive/src/cli.js file list

# List files in specific folder
node ~/.claude/skills/google-drive/src/cli.js file list <folder-id>

# List with filters
node ~/.claude/skills/google-drive/src/cli.js file list --type "image/png" --limit 50

# Get file info
node ~/.claude/skills/google-drive/src/cli.js file info <file-id>

# Download a file
node ~/.claude/skills/google-drive/src/cli.js file download <file-id> ./local-file.pdf

# Download Google Doc as PDF
node ~/.claude/skills/google-drive/src/cli.js file download <file-id> ./doc.pdf --export pdf

# Upload a file
node ~/.claude/skills/google-drive/src/cli.js file upload ./local-file.pdf

# Upload to specific folder
node ~/.claude/skills/google-drive/src/cli.js file upload ./local-file.pdf <folder-id>

# Upload with custom name
node ~/.claude/skills/google-drive/src/cli.js file upload ./local-file.pdf --name "Report 2024.pdf"

# Delete file (to trash)
node ~/.claude/skills/google-drive/src/cli.js file delete <file-id>

# Permanently delete
node ~/.claude/skills/google-drive/src/cli.js file delete <file-id> --permanent

# Move file
node ~/.claude/skills/google-drive/src/cli.js file move <file-id> <new-folder-id>

# Copy file
node ~/.claude/skills/google-drive/src/cli.js file copy <file-id>
node ~/.claude/skills/google-drive/src/cli.js file copy <file-id> <folder-id> --name "Copy of File"
```

### Folder Operations

```bash
# Create folder in root
node ~/.claude/skills/google-drive/src/cli.js folder create "My Folder"

# Create folder in specific parent
node ~/.claude/skills/google-drive/src/cli.js folder create "Subfolder" <parent-id>

# List folders only
node ~/.claude/skills/google-drive/src/cli.js folder list
node ~/.claude/skills/google-drive/src/cli.js folder list <parent-id>

# Show folder tree
node ~/.claude/skills/google-drive/src/cli.js folder tree
node ~/.claude/skills/google-drive/src/cli.js folder tree <folder-id> --depth 4
```

### Search

```bash
# Full-text search
node ~/.claude/skills/google-drive/src/cli.js search "quarterly report"

# Search with filters
node ~/.claude/skills/google-drive/src/cli.js search "report" --type "application/pdf"
node ~/.claude/skills/google-drive/src/cli.js search "notes" --in <folder-id>

# Include shared drives
node ~/.claude/skills/google-drive/src/cli.js search "meeting" --shared

# Include trashed files
node ~/.claude/skills/google-drive/src/cli.js search "old file" --trashed
```

### Sharing

```bash
# Share with a user (reader access)
node ~/.claude/skills/google-drive/src/cli.js share <file-id> --email user@example.com

# Share with write access
node ~/.claude/skills/google-drive/src/cli.js share <file-id> --email user@example.com --role writer

# Share with anyone who has link
node ~/.claude/skills/google-drive/src/cli.js share <file-id> --type anyone --role reader

# List permissions
node ~/.claude/skills/google-drive/src/cli.js share list <file-id>

# Remove permission
node ~/.claude/skills/google-drive/src/cli.js share remove <file-id> <permission-id>
```

### Shared Drives (Read-Only)

```bash
# List accessible shared drives
node ~/.claude/skills/google-drive/src/cli.js shared list

# List files in shared drive
node ~/.claude/skills/google-drive/src/cli.js shared files <drive-id>

# Download from shared drive
node ~/.claude/skills/google-drive/src/cli.js shared download <file-id> ./local-file.pdf
```

### Backup (Local → Drive)

```bash
# Backup a directory
node ~/.claude/skills/google-drive/src/cli.js backup ./my-project

# Backup to specific folder
node ~/.claude/skills/google-drive/src/cli.js backup ./my-project <drive-folder-id>

# Backup with custom name
node ~/.claude/skills/google-drive/src/cli.js backup ./my-project --name "Project Backup 2024"

# Exclude patterns
node ~/.claude/skills/google-drive/src/cli.js backup ./my-project --exclude "node_modules" --exclude ".git" --exclude "*.log"

# Dry run (preview only)
node ~/.claude/skills/google-drive/src/cli.js backup ./my-project --dry-run

# Skip existing files
node ~/.claude/skills/google-drive/src/cli.js backup ./my-project --skip-existing
```

### Bidirectional Sync

```bash
# Two-way sync
node ~/.claude/skills/google-drive/src/cli.js sync ./local-folder <drive-folder-id>

# Upload only
node ~/.claude/skills/google-drive/src/cli.js sync ./local-folder <drive-folder-id> --direction up

# Download only
node ~/.claude/skills/google-drive/src/cli.js sync ./local-folder <drive-folder-id> --direction down

# Delete orphaned files
node ~/.claude/skills/google-drive/src/cli.js sync ./local-folder <drive-folder-id> --delete

# Dry run
node ~/.claude/skills/google-drive/src/cli.js sync ./local-folder <drive-folder-id> --dry-run

# Exclude patterns
node ~/.claude/skills/google-drive/src/cli.js sync ./local-folder <drive-folder-id> --exclude "*.tmp" --exclude ".DS_Store"

# Check sync status
node ~/.claude/skills/google-drive/src/cli.js sync status ./local-folder <drive-folder-id>
```

## Export Formats

Google Docs files can be exported to various formats:

| Google Type | Available Exports |
|-------------|-------------------|
| Document | pdf, docx, txt, html, odt, rtf, epub |
| Spreadsheet | pdf, xlsx, csv, ods, tsv |
| Presentation | pdf, pptx, odp, txt |
| Drawing | pdf, png, jpeg, svg |

Example:
```bash
node ~/.claude/skills/google-drive/src/cli.js file download <doc-id> ./report.pdf --export pdf
node ~/.claude/skills/google-drive/src/cli.js file download <sheet-id> ./data.xlsx --export xlsx
```

## Sharing Roles

| Role | Permissions |
|------|-------------|
| reader | View only |
| commenter | View and comment |
| writer | View, comment, and edit |
| owner | Full control (cannot be assigned via API) |

## Common MIME Types

| Type | MIME Type |
|------|-----------|
| Folder | application/vnd.google-apps.folder |
| Google Doc | application/vnd.google-apps.document |
| Google Sheet | application/vnd.google-apps.spreadsheet |
| Google Slides | application/vnd.google-apps.presentation |
| PDF | application/pdf |
| Image | image/png, image/jpeg, image/gif |

## Output Format

All commands output JSON for easy parsing:

```json
{
  "id": "1ABC...xyz",
  "name": "My File.pdf",
  "mimeType": "application/pdf",
  "size": 12345,
  "createdTime": "2024-01-15T10:00:00.000Z",
  "modifiedTime": "2024-01-16T14:30:00.000Z",
  "webViewLink": "https://drive.google.com/file/d/1ABC...xyz/view",
  "isFolder": false,
  "shared": true
}
```

## Troubleshooting

### Authentication Errors

**Service Account:**
- "Service account key file not found" → Check GOOGLE_SERVICE_ACCOUNT_KEY path
- "Permission denied" → Share files with service account email or enable domain-wide delegation
- Service account email format: `name@project-id.iam.gserviceaccount.com`

**OAuth2:**
- "Missing OAuth2 credentials" → Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env
- "Not authenticated" → Run `node cli.js auth` to authenticate
- "Authentication expired" → Re-run `node cli.js auth`

### Permission Errors

- Ensure your Google account has access to the file/folder
- For service accounts, files must be shared with the service account email
- For Shared Drives, you only have read access

### Rate Limiting

The CLI automatically retries with exponential backoff on rate limit errors (429/403).

### Large Files

- Downloads stream to disk automatically
- Uploads use resumable upload for reliability

## Access Levels

| Location | Read | Write | Delete | Share |
|----------|------|-------|--------|-------|
| My Drive | ✅ | ✅ | ✅ | ✅ |
| Shared Drives | ✅ | ❌ | ❌ | ❌ |

Shared Drives are **read-only** by design in this skill.
