/**
 * Bidirectional Sync Operations for Google Drive
 * Two-way sync between local directory and Drive folder
 */

import { createDriveClient } from './client.js';
import {
  readdirSync, statSync, readFileSync, writeFileSync,
  existsSync, mkdirSync, unlinkSync, rmdirSync,
  createReadStream, createWriteStream
} from 'fs';
import { join, dirname, basename } from 'path';
import { createHash } from 'crypto';

// Sync state file name (stored in local directory)
const SYNC_STATE_FILE = '.gdrive-sync-state.json';

/**
 * Sync operations client
 */
export class SyncClient {
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
   * Perform bidirectional sync
   */
  async sync(localPath, driveFolderId, options = {}) {
    await this.ensureInit();

    const {
      direction = 'both',  // 'up', 'down', 'both'
      delete: deleteOrphans = false,
      dryRun = false,
      exclude = [],
      conflictResolution = 'newer',  // 'newer', 'local', 'remote'
    } = options;

    // Validate local path
    if (!existsSync(localPath)) {
      if (direction === 'down' || direction === 'both') {
        mkdirSync(localPath, { recursive: true });
      } else {
        throw new Error(`Local path does not exist: ${localPath}`);
      }
    }

    const results = {
      localPath,
      driveFolderId,
      direction,
      dryRun,
      uploaded: [],
      downloaded: [],
      deleted: { local: [], remote: [] },
      conflicts: [],
      errors: [],
      stats: {
        uploadedFiles: 0,
        downloadedFiles: 0,
        deletedLocal: 0,
        deletedRemote: 0,
        conflicts: 0,
        errors: 0,
      },
    };

    // Load or create sync state
    const stateFile = join(localPath, SYNC_STATE_FILE);
    const state = loadSyncState(stateFile);

    // Scan both locations
    const local = await this.scanLocalDirectory(localPath, exclude);
    const remote = await this.scanDriveFolder(driveFolderId, exclude);

    // Build comparison
    const comparison = this.compareFileSets(local, remote, state);

    // Process sync actions based on direction
    if (direction === 'up' || direction === 'both') {
      // Upload new/modified local files
      for (const file of comparison.toUpload) {
        try {
          if (!dryRun) {
            await this.uploadFile(localPath, file, driveFolderId);
          }
          results.uploaded.push(file);
          results.stats.uploadedFiles++;
        } catch (error) {
          results.errors.push({ action: 'upload', file: file.path, error: error.message });
          results.stats.errors++;
        }
      }

      // Delete remote files that don't exist locally
      if (deleteOrphans) {
        for (const file of comparison.onlyRemote) {
          try {
            if (!dryRun) {
              await this.client.deleteFile(file.id);
            }
            results.deleted.remote.push(file);
            results.stats.deletedRemote++;
          } catch (error) {
            results.errors.push({ action: 'delete-remote', file: file.path, error: error.message });
            results.stats.errors++;
          }
        }
      }
    }

    if (direction === 'down' || direction === 'both') {
      // Download new/modified remote files
      for (const file of comparison.toDownload) {
        try {
          if (!dryRun) {
            await this.downloadFile(file, localPath);
          }
          results.downloaded.push(file);
          results.stats.downloadedFiles++;
        } catch (error) {
          results.errors.push({ action: 'download', file: file.path, error: error.message });
          results.stats.errors++;
        }
      }

      // Delete local files that don't exist on Drive
      if (deleteOrphans) {
        for (const file of comparison.onlyLocal) {
          try {
            if (!dryRun) {
              const fullPath = join(localPath, file.path);
              unlinkSync(fullPath);
            }
            results.deleted.local.push(file);
            results.stats.deletedLocal++;
          } catch (error) {
            results.errors.push({ action: 'delete-local', file: file.path, error: error.message });
            results.stats.errors++;
          }
        }
      }
    }

    // Handle conflicts
    for (const conflict of comparison.conflicts) {
      try {
        const resolved = await this.resolveConflict(
          conflict, localPath, driveFolderId, conflictResolution, dryRun
        );
        results.conflicts.push({ ...conflict, resolution: resolved });
        results.stats.conflicts++;
      } catch (error) {
        results.errors.push({ action: 'resolve-conflict', file: conflict.path, error: error.message });
        results.stats.errors++;
      }
    }

    // Save sync state
    if (!dryRun) {
      const newState = this.buildSyncState(local, remote);
      saveSyncState(stateFile, newState);
    }

    return results;
  }

  /**
   * Get sync status without making changes
   */
  async status(localPath, driveFolderId, options = {}) {
    await this.ensureInit();

    const { exclude = [] } = options;

    if (!existsSync(localPath)) {
      return {
        error: `Local path does not exist: ${localPath}`,
        localPath,
        driveFolderId,
      };
    }

    const stateFile = join(localPath, SYNC_STATE_FILE);
    const state = loadSyncState(stateFile);

    const local = await this.scanLocalDirectory(localPath, exclude);
    const remote = await this.scanDriveFolder(driveFolderId, exclude);

    const comparison = this.compareFileSets(local, remote, state);

    return {
      localPath,
      driveFolderId,
      local: {
        files: local.files.length,
        folders: local.folders.length,
        totalSize: local.files.reduce((sum, f) => sum + f.size, 0),
      },
      remote: {
        files: remote.files.length,
        folders: remote.folders.length,
        totalSize: remote.files.reduce((sum, f) => sum + (f.size || 0), 0),
      },
      changes: {
        toUpload: comparison.toUpload.map(f => f.path),
        toDownload: comparison.toDownload.map(f => f.path),
        onlyLocal: comparison.onlyLocal.map(f => f.path),
        onlyRemote: comparison.onlyRemote.map(f => f.path),
        conflicts: comparison.conflicts.map(f => f.path),
      },
      lastSync: state.lastSync || 'Never',
    };
  }

  /**
   * Compare local and remote file sets
   */
  compareFileSets(local, remote, state) {
    const result = {
      toUpload: [],
      toDownload: [],
      onlyLocal: [],
      onlyRemote: [],
      conflicts: [],
      inSync: [],
    };

    const localByPath = new Map(local.files.map(f => [f.path, f]));
    const remoteByPath = new Map(remote.files.map(f => [f.path, f]));
    const stateByPath = new Map((state.files || []).map(f => [f.path, f]));

    // Check local files
    for (const [path, localFile] of localByPath) {
      const remoteFile = remoteByPath.get(path);
      const stateFile = stateByPath.get(path);

      if (!remoteFile) {
        // File only exists locally
        if (stateFile) {
          // Was synced before, deleted remotely
          result.onlyLocal.push(localFile);
        } else {
          // New local file
          result.toUpload.push(localFile);
        }
      } else {
        // File exists in both locations
        const localMod = localFile.modifiedTime;
        const remoteMod = new Date(remoteFile.modifiedTime).getTime();

        if (stateFile) {
          const stateMod = stateFile.modifiedTime;
          const localChanged = localMod > stateMod + 1000;
          const remoteChanged = remoteMod > stateMod + 1000;

          if (localChanged && remoteChanged) {
            // Both changed - conflict
            result.conflicts.push({
              path,
              local: localFile,
              remote: remoteFile,
              localModified: new Date(localMod).toISOString(),
              remoteModified: remoteFile.modifiedTime,
            });
          } else if (localChanged) {
            result.toUpload.push(localFile);
          } else if (remoteChanged) {
            result.toDownload.push(remoteFile);
          } else {
            result.inSync.push({ path, local: localFile, remote: remoteFile });
          }
        } else {
          // No previous state - compare timestamps
          if (Math.abs(localMod - remoteMod) < 1000) {
            result.inSync.push({ path, local: localFile, remote: remoteFile });
          } else if (localMod > remoteMod) {
            result.toUpload.push(localFile);
          } else {
            result.toDownload.push(remoteFile);
          }
        }
      }
    }

    // Check remote files not in local
    for (const [path, remoteFile] of remoteByPath) {
      if (!localByPath.has(path)) {
        const stateFile = stateByPath.get(path);
        if (stateFile) {
          // Was synced before, deleted locally
          result.onlyRemote.push(remoteFile);
        } else {
          // New remote file
          result.toDownload.push(remoteFile);
        }
      }
    }

    return result;
  }

  /**
   * Resolve a conflict between local and remote versions
   */
  async resolveConflict(conflict, localPath, driveFolderId, strategy, dryRun) {
    const { local, remote, path } = conflict;

    let resolution;
    if (strategy === 'local') {
      resolution = 'upload-local';
      if (!dryRun) {
        await this.uploadFile(localPath, local, driveFolderId);
      }
    } else if (strategy === 'remote') {
      resolution = 'download-remote';
      if (!dryRun) {
        await this.downloadFile(remote, localPath);
      }
    } else {
      // 'newer' strategy - keep whichever is newer
      const localMod = local.modifiedTime;
      const remoteMod = new Date(remote.modifiedTime).getTime();

      if (localMod > remoteMod) {
        resolution = 'upload-local (newer)';
        if (!dryRun) {
          await this.uploadFile(localPath, local, driveFolderId);
        }
      } else {
        resolution = 'download-remote (newer)';
        if (!dryRun) {
          await this.downloadFile(remote, localPath);
        }
      }
    }

    return resolution;
  }

  /**
   * Upload a local file to Drive
   */
  async uploadFile(localBasePath, fileInfo, driveFolderId) {
    const fullPath = join(localBasePath, fileInfo.path);
    const dirPath = dirname(fileInfo.path);

    // Ensure parent folders exist on Drive
    let parentId = driveFolderId;
    if (dirPath && dirPath !== '.') {
      parentId = await this.ensureDrivePath(driveFolderId, dirPath);
    }

    // Check if file already exists
    const existingFiles = await this.client.listFiles({
      folderId: parentId,
      name: fileInfo.name,
    });
    const existing = existingFiles.files.find(f => f.name === fileInfo.name);

    const fileStream = createReadStream(fullPath);
    const mimeType = getMimeType(fileInfo.name);

    if (existing) {
      // Update existing file
      await this.client.updateFile(existing.id, {
        content: fileStream,
        mimeType,
      });
    } else {
      // Create new file
      await this.client.uploadFile({
        name: fileInfo.name,
        content: fileStream,
        mimeType,
        parentId,
      });
    }
  }

  /**
   * Download a remote file to local
   */
  async downloadFile(fileInfo, localBasePath) {
    const fullPath = join(localBasePath, fileInfo.path);
    const dirPath = dirname(fullPath);

    // Ensure local directory exists
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    // Download file content
    const result = await this.client.downloadFile(fileInfo.id);

    // Write to local file
    writeFileSync(fullPath, result.data);
  }

  /**
   * Ensure Drive folder path exists, creating folders as needed
   */
  async ensureDrivePath(rootId, path) {
    const parts = path.split('/').filter(p => p && p !== '.');
    let currentId = rootId;

    for (const part of parts) {
      const existing = await this.client.listFiles({
        folderId: currentId,
        mimeType: 'application/vnd.google-apps.folder',
        name: part,
      });

      const folder = existing.files.find(f => f.name === part);
      if (folder) {
        currentId = folder.id;
      } else {
        const newFolder = await this.client.createFolder(part, currentId);
        currentId = newFolder.id;
      }
    }

    return currentId;
  }

  /**
   * Scan local directory
   */
  async scanLocalDirectory(dirPath, exclude = [], basePath = '') {
    const result = { files: [], folders: [] };
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip sync state file
      if (entry.name === SYNC_STATE_FILE) continue;

      const fullPath = join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      // Check exclusions
      if (shouldExclude(relativePath, exclude)) continue;

      if (entry.isDirectory()) {
        result.folders.push({ name: entry.name, path: relativePath });
        const subResult = await this.scanLocalDirectory(fullPath, exclude, relativePath);
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
   * Scan Drive folder
   */
  async scanDriveFolder(folderId, exclude = [], basePath = '') {
    const result = { files: [], folders: [] };
    const response = await this.client.listFiles({ folderId, pageSize: 1000 });

    for (const file of response.files) {
      const relativePath = basePath ? `${basePath}/${file.name}` : file.name;

      if (shouldExclude(relativePath, exclude)) continue;

      if (file.mimeType === 'application/vnd.google-apps.folder') {
        result.folders.push({ id: file.id, name: file.name, path: relativePath });
        const subResult = await this.scanDriveFolder(file.id, exclude, relativePath);
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

  /**
   * Build sync state from current file sets
   */
  buildSyncState(local, remote) {
    const files = [];
    const localByPath = new Map(local.files.map(f => [f.path, f]));
    const remoteByPath = new Map(remote.files.map(f => [f.path, f]));

    // Add all files from both sets
    const allPaths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);
    for (const path of allPaths) {
      const localFile = localByPath.get(path);
      const remoteFile = remoteByPath.get(path);

      files.push({
        path,
        modifiedTime: Math.max(
          localFile?.modifiedTime || 0,
          remoteFile ? new Date(remoteFile.modifiedTime).getTime() : 0
        ),
        localSize: localFile?.size,
        remoteId: remoteFile?.id,
      });
    }

    return {
      lastSync: new Date().toISOString(),
      files,
    };
  }
}

/**
 * Load sync state from file
 */
function loadSyncState(stateFile) {
  if (existsSync(stateFile)) {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf-8'));
    } catch {
      return { files: [] };
    }
  }
  return { files: [] };
}

/**
 * Save sync state to file
 */
function saveSyncState(stateFile, state) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/**
 * Check if path should be excluded
 */
function shouldExclude(path, patterns) {
  for (const pattern of patterns) {
    if (pattern.startsWith('*')) {
      if (path.endsWith(pattern.slice(1))) return true;
    } else if (pattern.endsWith('*')) {
      if (path.startsWith(pattern.slice(0, -1))) return true;
    } else if (path === pattern || path.includes(`/${pattern}/`) ||
               path.startsWith(`${pattern}/`) || path.endsWith(`/${pattern}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const types = {
    txt: 'text/plain', html: 'text/html', css: 'text/css',
    js: 'application/javascript', json: 'application/json',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', pdf: 'application/pdf',
    doc: 'application/msword', zip: 'application/zip',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Create and initialize SyncClient
 */
export async function createSyncClient() {
  const client = new SyncClient();
  await client.init();
  return client;
}

export default SyncClient;
