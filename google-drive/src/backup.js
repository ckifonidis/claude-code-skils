/**
 * Backup Operations for Google Drive
 * One-way sync from local directory to Drive
 */

import { createDriveClient } from './client.js';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, basename, relative } from 'path';

/**
 * Backup operations client
 */
export class BackupClient {
  constructor() {
    this.client = null;
  }

  async init() {
    this.client = await createDriveClient();
    return this;
  }

  async ensureInit() {
    if (!this.client) {
      await this.init();
    }
  }

  /**
   * Backup a local directory to Google Drive
   */
  async backup(localPath, options = {}) {
    await this.ensureInit();

    const {
      parentId = null,
      name = null,
      exclude = [],
      dryRun = false,
      skipExisting = false,
      verbose = false,
    } = options;

    // Validate local path exists
    if (!existsSync(localPath)) {
      throw new Error(`Local path does not exist: ${localPath}`);
    }

    const stats = statSync(localPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${localPath}`);
    }

    const folderName = name || basename(localPath);
    const results = {
      folderName,
      localPath,
      dryRun,
      created: { folders: [], files: [] },
      skipped: { folders: [], files: [] },
      errors: [],
      stats: { folders: 0, files: 0, bytes: 0 },
    };

    // Create or find root backup folder
    let rootFolderId;
    if (dryRun) {
      rootFolderId = 'dry-run-folder-id';
      results.created.folders.push({ name: folderName, id: rootFolderId });
    } else {
      const existingFolders = await this.client.listFolders(parentId);
      const existing = existingFolders.files.find(f => f.name === folderName);

      if (existing && skipExisting) {
        rootFolderId = existing.id;
        results.skipped.folders.push({ name: folderName, id: rootFolderId });
      } else if (existing) {
        rootFolderId = existing.id;
      } else {
        const folder = await this.client.createFolder(folderName, parentId);
        rootFolderId = folder.id;
        results.created.folders.push({ name: folderName, id: rootFolderId });
      }
    }
    results.stats.folders++;

    // Recursively backup directory
    await this.backupDirectory(localPath, rootFolderId, '', results, {
      exclude,
      dryRun,
      skipExisting,
      verbose,
    });

    return results;
  }

  /**
   * Recursively backup a directory
   */
  async backupDirectory(localDir, parentId, relativePath, results, options) {
    const { exclude, dryRun, skipExisting, verbose } = options;

    const entries = readdirSync(localDir, { withFileTypes: true });

    for (const entry of entries) {
      const localPath = join(localDir, entry.name);
      const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      // Check exclusions
      if (shouldExclude(entryRelPath, exclude)) {
        if (verbose) {
          console.log(`Excluding: ${entryRelPath}`);
        }
        continue;
      }

      try {
        if (entry.isDirectory()) {
          // Create folder
          let folderId;

          if (dryRun) {
            folderId = 'dry-run-folder-id';
            results.created.folders.push({ name: entry.name, path: entryRelPath });
          } else {
            // Check if folder exists
            const existingFolders = await this.client.listFolders(parentId);
            const existing = existingFolders.files.find(f => f.name === entry.name);

            if (existing) {
              folderId = existing.id;
              if (skipExisting) {
                results.skipped.folders.push({ name: entry.name, path: entryRelPath, id: folderId });
              }
            } else {
              const folder = await this.client.createFolder(entry.name, parentId);
              folderId = folder.id;
              results.created.folders.push({ name: entry.name, path: entryRelPath, id: folderId });
            }
          }
          results.stats.folders++;

          // Recurse into subdirectory
          await this.backupDirectory(localPath, folderId, entryRelPath, results, options);

        } else if (entry.isFile()) {
          // Upload file
          const fileStats = statSync(localPath);
          const mimeType = getMimeType(entry.name);

          if (dryRun) {
            results.created.files.push({
              name: entry.name,
              path: entryRelPath,
              size: fileStats.size,
            });
          } else {
            // Check if file exists
            if (skipExisting) {
              const existingFiles = await this.client.listFiles({
                folderId: parentId,
                name: entry.name,
              });
              const existing = existingFiles.files.find(f => f.name === entry.name);

              if (existing) {
                results.skipped.files.push({
                  name: entry.name,
                  path: entryRelPath,
                  size: fileStats.size,
                  id: existing.id,
                });
                results.stats.files++;
                results.stats.bytes += fileStats.size;
                continue;
              }
            }

            // Upload file
            const { createReadStream } = await import('fs');
            const fileStream = createReadStream(localPath);

            const uploaded = await this.client.uploadFile({
              name: entry.name,
              content: fileStream,
              mimeType,
              parentId,
            });

            results.created.files.push({
              name: entry.name,
              path: entryRelPath,
              size: fileStats.size,
              id: uploaded.id,
            });
          }

          results.stats.files++;
          results.stats.bytes += fileStats.size;
        }
      } catch (error) {
        results.errors.push({
          path: entryRelPath,
          error: error.message,
        });
      }
    }
  }

  /**
   * Get backup status - compare local directory with Drive folder
   */
  async status(localPath, driveFolderId) {
    await this.ensureInit();

    if (!existsSync(localPath)) {
      throw new Error(`Local path does not exist: ${localPath}`);
    }

    const local = await this.scanLocalDirectory(localPath);
    const remote = await this.scanDriveFolder(driveFolderId);

    const status = {
      localPath,
      driveFolderId,
      local: { files: local.files.length, folders: local.folders.length },
      remote: { files: remote.files.length, folders: remote.folders.length },
      toUpload: [],
      toUpdate: [],
      onlyOnDrive: [],
    };

    // Find files to upload (exist locally but not on Drive)
    for (const localFile of local.files) {
      const remoteFile = remote.files.find(f => f.path === localFile.path);
      if (!remoteFile) {
        status.toUpload.push(localFile);
      } else if (localFile.modifiedTime > new Date(remoteFile.modifiedTime).getTime()) {
        status.toUpdate.push({ local: localFile, remote: remoteFile });
      }
    }

    // Find files only on Drive
    for (const remoteFile of remote.files) {
      const localFile = local.files.find(f => f.path === remoteFile.path);
      if (!localFile) {
        status.onlyOnDrive.push(remoteFile);
      }
    }

    return status;
  }

  /**
   * Scan local directory recursively
   */
  async scanLocalDirectory(dirPath, basePath = '') {
    const result = { files: [], folders: [] };
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        result.folders.push({ name: entry.name, path: relativePath });
        const subResult = await this.scanLocalDirectory(fullPath, relativePath);
        result.files.push(...subResult.files);
        result.folders.push(...subResult.folders);
      } else if (entry.isFile()) {
        const stats = statSync(fullPath);
        result.files.push({
          name: entry.name,
          path: relativePath,
          size: stats.size,
          modifiedTime: stats.mtimeMs,
        });
      }
    }

    return result;
  }

  /**
   * Scan Drive folder recursively
   */
  async scanDriveFolder(folderId, basePath = '') {
    const result = { files: [], folders: [] };
    const response = await this.client.listFiles({ folderId, pageSize: 1000 });

    for (const file of response.files) {
      const relativePath = basePath ? `${basePath}/${file.name}` : file.name;

      if (file.mimeType === 'application/vnd.google-apps.folder') {
        result.folders.push({ id: file.id, name: file.name, path: relativePath });
        const subResult = await this.scanDriveFolder(file.id, relativePath);
        result.files.push(...subResult.files);
        result.folders.push(...subResult.folders);
      } else {
        result.files.push({
          id: file.id,
          name: file.name,
          path: relativePath,
          size: file.size ? parseInt(file.size, 10) : 0,
          modifiedTime: file.modifiedTime,
        });
      }
    }

    return result;
  }
}

/**
 * Check if path should be excluded
 */
function shouldExclude(path, excludePatterns) {
  for (const pattern of excludePatterns) {
    // Simple pattern matching
    if (pattern.startsWith('*')) {
      // Wildcard at start (e.g., *.log)
      const ext = pattern.slice(1);
      if (path.endsWith(ext)) return true;
    } else if (pattern.endsWith('*')) {
      // Wildcard at end
      const prefix = pattern.slice(0, -1);
      if (path.startsWith(prefix)) return true;
    } else if (pattern.includes('*')) {
      // Wildcard in middle
      const [before, after] = pattern.split('*');
      if (path.startsWith(before) && path.endsWith(after)) return true;
    } else {
      // Exact match or path contains pattern
      if (path === pattern || path.includes(`/${pattern}/`) ||
          path.startsWith(`${pattern}/`) || path.endsWith(`/${pattern}`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimeTypes = {
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Create and initialize BackupClient
 */
export async function createBackupClient() {
  const client = new BackupClient();
  await client.init();
  return client;
}

export default BackupClient;
