/**
 * Shared Drives (Team Drives) Operations
 * Read-only access to shared drives
 */

import { createDriveClient } from './client.js';

/**
 * Shared Drives operations client (read-only)
 */
export class SharedDrivesClient {
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
   * List all accessible shared drives
   */
  async list() {
    await this.ensureInit();

    const drives = await this.client.listSharedDrives();

    return drives.map(drive => ({
      id: drive.id,
      name: drive.name,
      createdTime: drive.createdTime,
    }));
  }

  /**
   * List files in a shared drive (read-only)
   */
  async files(driveId, options = {}) {
    await this.ensureInit();

    const { folderId = null, limit = 100 } = options;

    const result = await this.client.listSharedDriveFiles(driveId, {
      folderId,
      pageSize: limit,
    });

    return {
      files: result.files.map(formatFile),
      hasMore: !!result.nextPageToken,
    };
  }

  /**
   * Get file info from shared drive
   */
  async fileInfo(fileId) {
    await this.ensureInit();

    const file = await this.client.getFile(fileId,
      'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners'
    );

    return formatFile(file);
  }

  /**
   * Download file from shared drive (read-only operation)
   */
  async download(fileId) {
    await this.ensureInit();

    // This uses the same download method as regular files
    // since it's a read-only operation
    const file = await this.client.getFile(fileId, 'id, name, mimeType, size');

    // Check if it's a Google Docs type that needs export
    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      throw new Error(
        `Cannot download Google ${getDocType(file.mimeType)} directly. ` +
        `Use the regular 'file download' command with --export option.`
      );
    }

    const result = await this.client.downloadFile(fileId);

    return {
      data: result.data,
      name: result.name,
      mimeType: result.mimeType,
      size: result.size,
      source: 'shared-drive',
    };
  }

  /**
   * Search within shared drives
   */
  async search(query, options = {}) {
    await this.ensureInit();

    const { limit = 100 } = options;

    const result = await this.client.search({
      query,
      includeShared: true,
      pageSize: limit,
    });

    // Filter to only include files from shared drives
    // (files that have driveId field)
    return {
      files: result.files.map(formatFile),
      hasMore: !!result.nextPageToken,
    };
  }

  /**
   * Get folder tree in a shared drive
   */
  async tree(driveId, options = {}) {
    await this.ensureInit();

    const { depth = 2 } = options;

    return this.buildTree(driveId, null, depth, 0);
  }

  /**
   * Build tree recursively (internal)
   */
  async buildTree(driveId, folderId, maxDepth, currentDepth) {
    if (currentDepth >= maxDepth) {
      return null;
    }

    // List files in this folder
    const result = await this.client.listSharedDriveFiles(driveId, {
      folderId: folderId,
      pageSize: 1000,
    });

    const folders = result.files.filter(
      f => f.mimeType === 'application/vnd.google-apps.folder'
    );
    const files = result.files.filter(
      f => f.mimeType !== 'application/vnd.google-apps.folder'
    );

    const children = [];

    for (const folder of folders) {
      const subtree = await this.buildTree(driveId, folder.id, maxDepth, currentDepth + 1);
      if (subtree) {
        children.push(subtree);
      } else {
        children.push({
          id: folder.id,
          name: folder.name,
          type: 'folder',
          children: [],
        });
      }
    }

    for (const file of files) {
      children.push({
        id: file.id,
        name: file.name,
        type: 'file',
        mimeType: file.mimeType,
        size: file.size,
      });
    }

    return {
      id: folderId || driveId,
      name: folderId ? 'Folder' : 'Root',
      type: 'folder',
      children,
    };
  }
}

/**
 * Format file for output
 */
function formatFile(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? parseInt(file.size, 10) : null,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    owners: file.owners?.map(o => o.emailAddress) || [],
  };
}

/**
 * Get document type name
 */
function getDocType(mimeType) {
  const types = {
    'application/vnd.google-apps.document': 'Document',
    'application/vnd.google-apps.spreadsheet': 'Spreadsheet',
    'application/vnd.google-apps.presentation': 'Presentation',
    'application/vnd.google-apps.drawing': 'Drawing',
  };
  return types[mimeType] || 'Document';
}

/**
 * Create and initialize SharedDrivesClient
 */
export async function createSharedDrivesClient() {
  const client = new SharedDrivesClient();
  await client.init();
  return client;
}

export default SharedDrivesClient;
