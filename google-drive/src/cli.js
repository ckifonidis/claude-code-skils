#!/usr/bin/env node

/**
 * Google Drive CLI
 * Command-line interface for Google Drive operations
 */

import { writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { authenticate, checkAuthStatus } from './auth.js';
import { createFilesClient } from './files.js';
import { createFoldersClient } from './folders.js';
import { createSearchClient } from './search.js';
import { createShareClient } from './share.js';
import { createSharedDrivesClient } from './shared.js';
import { createBackupClient } from './backup.js';
import { createSyncClient } from './sync.js';

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const subCommand = args[1];

/**
 * Parse flags and options from args
 */
function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('--')) {
        // Handle JSON values
        if (nextArg.startsWith('{') || nextArg.startsWith('[')) {
          try {
            options[key] = JSON.parse(nextArg);
          } catch {
            options[key] = nextArg;
          }
        } else if (nextArg === 'true') {
          options[key] = true;
        } else if (nextArg === 'false') {
          options[key] = false;
        } else if (!isNaN(nextArg) && nextArg !== '') {
          options[key] = Number(nextArg);
        } else {
          options[key] = nextArg;
        }
        i++;
      } else {
        options[key] = true;
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { options, positional };
}

/**
 * Format output as JSON
 */
function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Error handler
 */
function handleError(error) {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exit(1);
}

/**
 * Print usage
 */
function printUsage() {
  console.log(`
Google Drive CLI - Manage files and folders on Google Drive

USAGE:
  node cli.js <command> <subcommand> [options]

SETUP:
  1. Create OAuth2 credentials at https://console.cloud.google.com/apis/credentials
  2. Copy .env.example to .env and add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
  3. Run: node cli.js auth

COMMANDS:

  auth                           Authenticate with Google Drive
    --status                     Check authentication status

  file                           File operations
    list [folder-id]             List files in folder
      --type <mime-type>         Filter by MIME type
      --name <pattern>           Filter by name
      --limit <n>                Max results (default: 100)

    info <file-id>               Get file metadata

    download <file-id> [path]    Download a file
      --export <format>          Export Google Docs (pdf, docx, xlsx, etc.)

    upload <local-path> [parent] Upload a file
      --name <name>              Custom name on Drive
      --convert                  Convert to Google Docs format

    delete <file-id>             Move file to trash
      --permanent                Permanently delete

    move <file-id> <parent-id>   Move file to different folder

    copy <file-id> [parent-id]   Copy a file
      --name <new-name>          Name for the copy

  folder                         Folder operations
    create <name> [parent-id]    Create a folder
    list [parent-id]             List folders only
    tree [folder-id]             Show folder tree
      --depth <n>                Max depth (default: 3)

  search <query>                 Search files
    --type <mime-type>           Filter by type
    --in <folder-id>             Search in folder
    --trashed                    Include trashed
    --shared                     Include shared drives
    --limit <n>                  Max results

  share <file-id>                Share a file
    --email <email>              User email
    --role <role>                reader, writer, commenter
    --type <type>                user, group, domain, anyone

    list <file-id>               List permissions
    remove <file-id> <perm-id>   Remove permission

  shared                         Shared Drives (read-only)
    list                         List accessible shared drives
    files <drive-id>             List files in shared drive
    download <file-id> [path]    Download from shared drive

  backup <local-dir> [folder-id] Backup directory to Drive
    --name <name>                Folder name on Drive
    --exclude <pattern>          Exclude pattern
    --dry-run                    Preview only
    --skip-existing              Skip existing files

  sync <local-dir> <folder-id>   Bidirectional sync
    --direction <dir>            up, down, both (default: both)
    --delete                     Delete orphaned files
    --dry-run                    Preview only
    --exclude <pattern>          Exclude pattern

    status <local-dir>           Show sync status

EXAMPLES:
  # Authenticate
  node cli.js auth

  # List files in root
  node cli.js file list

  # Upload a file
  node cli.js file upload ./report.pdf

  # Download a Google Doc as PDF
  node cli.js file download abc123 ./doc.pdf --export pdf

  # Search for files
  node cli.js search "quarterly report"

  # Share with a user
  node cli.js share abc123 --email user@example.com --role writer

  # Backup a folder
  node cli.js backup ./projects 1ABC...xyz --exclude "node_modules" --exclude ".git"

  # Two-way sync
  node cli.js sync ./local-folder 1ABC...xyz --delete
`);
}

/**
 * Main execution
 */
async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  // Parse args - need different slicing for different commands
  // Commands with subcommands (file, folder, share, shared, sync): slice(2) to skip command + subcommand
  // Commands without subcommands (auth, search, backup): slice(1) to include options after command
  const commandsWithSubcommands = ['file', 'folder', 'share', 'shared', 'sync', 'backup'];
  const sliceFrom = commandsWithSubcommands.includes(command) ? 2 : 1;
  const { options, positional } = parseArgs(args.slice(sliceFrom));

  try {
    switch (command) {
      // ========================================
      // Authentication
      // ========================================
      case 'auth': {
        if (options.status) {
          const status = await checkAuthStatus();
          output(status);
        } else {
          const result = await authenticate();
          output(result);
        }
        break;
      }

      // ========================================
      // File Operations
      // ========================================
      case 'file': {
        const client = await createFilesClient();

        switch (subCommand) {
          case 'list': {
            const folderId = positional[0];
            const files = await client.list({
              folderId,
              type: options.type,
              name: options.name,
              limit: options.limit,
            });
            output(files);
            break;
          }

          case 'info': {
            const fileId = positional[0];
            if (!fileId) throw new Error('File ID required');
            const info = await client.info(fileId);
            output(info);
            break;
          }

          case 'download': {
            const fileId = positional[0];
            const localPath = positional[1];
            if (!fileId) throw new Error('File ID required');

            const result = await client.download(fileId, {
              exportFormat: options.export,
            });

            if (localPath) {
              writeFileSync(localPath, result.data);
              output({
                success: true,
                savedTo: localPath,
                name: result.name,
                size: result.data.length,
                exported: result.exported || false,
              });
            } else {
              // Output file info (for large files, just metadata)
              output({
                name: result.name,
                mimeType: result.mimeType,
                size: result.data.length,
                exported: result.exported || false,
                hint: 'Provide a path to save the file',
              });
            }
            break;
          }

          case 'upload': {
            const localPath = positional[0];
            const parentId = positional[1];
            if (!localPath) throw new Error('Local path required');

            const result = await client.upload(localPath, {
              parentId,
              name: options.name,
              convert: options.convert,
            });
            output(result);
            break;
          }

          case 'delete': {
            const fileId = positional[0];
            if (!fileId) throw new Error('File ID required');
            const result = await client.delete(fileId, {
              permanent: options.permanent,
            });
            output(result);
            break;
          }

          case 'move': {
            const fileId = positional[0];
            const newParentId = positional[1];
            if (!fileId || !newParentId) {
              throw new Error('Usage: file move <file-id> <new-parent-id>');
            }
            const result = await client.move(fileId, newParentId);
            output(result);
            break;
          }

          case 'copy': {
            const fileId = positional[0];
            const parentId = positional[1];
            if (!fileId) throw new Error('File ID required');
            const result = await client.copy(fileId, {
              parentId,
              name: options.name,
            });
            output(result);
            break;
          }

          default:
            throw new Error(`Unknown file subcommand: ${subCommand}`);
        }
        break;
      }

      // ========================================
      // Folder Operations
      // ========================================
      case 'folder': {
        const client = await createFoldersClient();

        switch (subCommand) {
          case 'create': {
            const name = positional[0];
            const parentId = positional[1];
            if (!name) throw new Error('Folder name required');
            const result = await client.create(name, parentId);
            output(result);
            break;
          }

          case 'list': {
            const parentId = positional[0];
            const folders = await client.list(parentId);
            output(folders);
            break;
          }

          case 'tree': {
            const folderId = positional[0];
            const tree = await client.tree(folderId, {
              depth: options.depth || 3,
              includeFiles: options.files,
            });
            output(tree);
            break;
          }

          default:
            throw new Error(`Unknown folder subcommand: ${subCommand}`);
        }
        break;
      }

      // ========================================
      // Search
      // ========================================
      case 'search': {
        const query = subCommand;
        if (!query) throw new Error('Search query required');

        const client = await createSearchClient();
        const result = await client.search({
          fullText: query,
          mimeType: options.type,
          folderId: options.in,
          trashed: options.trashed,
          shared: options.shared,
          limit: options.limit,
        });
        output(result);
        break;
      }

      // ========================================
      // Sharing
      // ========================================
      case 'share': {
        const client = await createShareClient();

        if (subCommand === 'list') {
          const fileId = positional[0];
          if (!fileId) throw new Error('File ID required');
          const perms = await client.list(fileId);
          output(perms);
        } else if (subCommand === 'remove') {
          const fileId = positional[0];
          const permId = positional[1];
          if (!fileId || !permId) {
            throw new Error('Usage: share remove <file-id> <permission-id>');
          }
          const result = await client.remove(fileId, permId);
          output(result);
        } else {
          // Share a file
          const fileId = subCommand;
          if (!fileId) throw new Error('File ID required');

          const result = await client.share(fileId, {
            email: options.email,
            role: options.role || 'reader',
            type: options.type || 'user',
            sendNotification: options.notify !== false,
            message: options.message,
          });
          output(result);
        }
        break;
      }

      // ========================================
      // Shared Drives (Read-only)
      // ========================================
      case 'shared': {
        const client = await createSharedDrivesClient();

        switch (subCommand) {
          case 'list': {
            const drives = await client.list();
            output(drives);
            break;
          }

          case 'files': {
            const driveId = positional[0];
            if (!driveId) throw new Error('Drive ID required');
            const result = await client.files(driveId, {
              folderId: options.folder,
              limit: options.limit,
            });
            output(result);
            break;
          }

          case 'download': {
            const fileId = positional[0];
            const localPath = positional[1];
            if (!fileId) throw new Error('File ID required');

            const result = await client.download(fileId);

            if (localPath) {
              writeFileSync(localPath, result.data);
              output({
                success: true,
                savedTo: localPath,
                name: result.name,
                size: result.data.length,
                source: 'shared-drive',
              });
            } else {
              output({
                name: result.name,
                mimeType: result.mimeType,
                size: result.data.length,
                hint: 'Provide a path to save the file',
              });
            }
            break;
          }

          default:
            throw new Error(`Unknown shared subcommand: ${subCommand}`);
        }
        break;
      }

      // ========================================
      // Backup
      // ========================================
      case 'backup': {
        const localDir = subCommand;
        const folderId = positional[0];
        if (!localDir) throw new Error('Local directory required');

        const client = await createBackupClient();

        // Handle multiple exclude patterns
        const excludePatterns = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--exclude' && args[i + 1]) {
            excludePatterns.push(args[i + 1]);
          }
        }

        const result = await client.backup(localDir, {
          parentId: folderId,
          name: options.name,
          exclude: excludePatterns.length > 0 ? excludePatterns : (options.exclude ? [options.exclude] : []),
          dryRun: options['dry-run'],
          skipExisting: options['skip-existing'],
          verbose: options.verbose,
        });
        output(result);
        break;
      }

      // ========================================
      // Sync
      // ========================================
      case 'sync': {
        const client = await createSyncClient();

        if (subCommand === 'status') {
          const localDir = positional[0];
          const folderId = positional[1];
          if (!localDir) throw new Error('Local directory required');

          // Handle multiple exclude patterns
          const excludePatterns = [];
          for (let i = 0; i < args.length; i++) {
            if (args[i] === '--exclude' && args[i + 1]) {
              excludePatterns.push(args[i + 1]);
            }
          }

          const status = await client.status(localDir, folderId, {
            exclude: excludePatterns,
          });
          output(status);
        } else {
          const localDir = subCommand;
          const folderId = positional[0];
          if (!localDir || !folderId) {
            throw new Error('Usage: sync <local-dir> <drive-folder-id>');
          }

          // Handle multiple exclude patterns
          const excludePatterns = [];
          for (let i = 0; i < args.length; i++) {
            if (args[i] === '--exclude' && args[i + 1]) {
              excludePatterns.push(args[i + 1]);
            }
          }

          const result = await client.sync(localDir, folderId, {
            direction: options.direction || 'both',
            delete: options.delete,
            dryRun: options['dry-run'],
            exclude: excludePatterns.length > 0 ? excludePatterns : (options.exclude ? [options.exclude] : []),
            conflictResolution: options.conflict || 'newer',
          });
          output(result);
        }
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}. Run with --help for usage.`);
    }
  } catch (error) {
    handleError(error);
  }
}

main();
