/**
 * Google Drive API Client
 * Wrapper around googleapis for Drive operations
 */

import { google } from 'googleapis';
import { getAuthenticatedClient, getEnvVar } from './auth.js';

// Retry configuration for rate limiting
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute API call with exponential backoff retry
 */
async function withRetry(fn, retries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it's a rate limit error (403 or 429)
      const status = error.response?.status || error.code;
      if (status === 403 || status === 429) {
        if (attempt < retries) {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.error(`Rate limited, retrying in ${backoffMs}ms...`);
          await sleep(backoffMs);
          continue;
        }
      }

      // For other errors, don't retry
      throw error;
    }
  }

  throw lastError;
}

/**
 * Google Drive Client class
 */
export class DriveClient {
  constructor(auth = null) {
    this.auth = auth;
    this.drive = null;
    this.defaultFolder = getEnvVar('GOOGLE_DRIVE_DEFAULT_FOLDER') || 'root';
  }

  /**
   * Initialize the Drive API client
   */
  async init() {
    if (!this.auth) {
      this.auth = await getAuthenticatedClient();
    }
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    return this;
  }

  /**
   * Ensure client is initialized
   */
  async ensureInit() {
    if (!this.drive) {
      await this.init();
    }
  }

  /**
   * Get the default parent folder ID
   */
  getDefaultFolder() {
    return this.defaultFolder;
  }

  // ========================================
  // File Operations
  // ========================================

  /**
   * List files in a folder
   */
  async listFiles(options = {}) {
    await this.ensureInit();

    const {
      folderId = this.defaultFolder,
      pageSize = 100,
      query = null,
      mimeType = null,
      name = null,
      orderBy = 'modifiedTime desc',
      includeShared = false,
      pageToken = null,
    } = options;

    // Build query
    const queryParts = [];

    // Only filter by parent if a specific folder ID is provided (not 'root')
    // This ensures shared files are visible for service accounts
    if (folderId && folderId !== 'root') {
      queryParts.push(`'${folderId}' in parents`);
    }
    // Note: We don't filter by 'root' in parents because:
    // 1. Service accounts see shared files which aren't in their root
    // 2. OAuth users can still see all their files without this filter

    if (mimeType) {
      queryParts.push(`mimeType = '${mimeType}'`);
    }

    if (name) {
      queryParts.push(`name contains '${name}'`);
    }

    if (query) {
      queryParts.push(query);
    }

    // Don't include trashed files by default
    queryParts.push('trashed = false');

    const q = queryParts.join(' and ');

    return withRetry(async () => {
      const response = await this.drive.files.list({
        q,
        pageSize,
        pageToken,
        orderBy,
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, iconLink, owners, shared)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: includeShared,
      });

      return response.data;
    });
  }

  /**
   * Get file metadata
   */
  async getFile(fileId, fields = null) {
    await this.ensureInit();

    const defaultFields = 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, webContentLink, iconLink, owners, shared, permissions, description';

    return withRetry(async () => {
      const response = await this.drive.files.get({
        fileId,
        fields: fields || defaultFields,
        supportsAllDrives: true,
      });

      return response.data;
    });
  }

  /**
   * Download file content
   */
  async downloadFile(fileId, destPath = null) {
    await this.ensureInit();

    const file = await this.getFile(fileId, 'id, name, mimeType, size');

    return withRetry(async () => {
      const response = await this.drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      );

      return {
        data: Buffer.from(response.data),
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
      };
    });
  }

  /**
   * Export Google Docs file to specified format
   */
  async exportFile(fileId, mimeType) {
    await this.ensureInit();

    return withRetry(async () => {
      const response = await this.drive.files.export(
        { fileId, mimeType },
        { responseType: 'arraybuffer' }
      );

      return Buffer.from(response.data);
    });
  }

  /**
   * Upload a file
   */
  async uploadFile(options) {
    await this.ensureInit();

    const {
      name,
      content,
      mimeType = 'application/octet-stream',
      parentId = this.defaultFolder,
      description = null,
      convert = false,
      fileSize = null,
    } = options;

    const fileMetadata = {
      name,
      parents: [parentId],
    };

    if (description) {
      fileMetadata.description = description;
    }

    const media = {
      mimeType,
      body: content,
    };

    // Simple upload without extra options
    return withRetry(async () => {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    });
  }

  /**
   * Update file content or metadata
   */
  async updateFile(fileId, options) {
    await this.ensureInit();

    const {
      name = null,
      content = null,
      mimeType = null,
      description = null,
      addParents = null,
      removeParents = null,
    } = options;

    const updateParams = {
      fileId,
      fields: 'id, name, mimeType, size, modifiedTime, parents, webViewLink',
      supportsAllDrives: true,
    };

    if (name || description !== null) {
      updateParams.requestBody = {};
      if (name) updateParams.requestBody.name = name;
      if (description !== null) updateParams.requestBody.description = description;
    }

    if (addParents) updateParams.addParents = addParents;
    if (removeParents) updateParams.removeParents = removeParents;

    if (content) {
      updateParams.media = {
        mimeType: mimeType || 'application/octet-stream',
        body: content,
      };
    }

    return withRetry(async () => {
      const response = await this.drive.files.update(updateParams);
      return response.data;
    });
  }

  /**
   * Delete a file (move to trash)
   */
  async deleteFile(fileId, permanent = false) {
    await this.ensureInit();

    return withRetry(async () => {
      if (permanent) {
        await this.drive.files.delete({
          fileId,
          supportsAllDrives: true,
        });
      } else {
        await this.drive.files.update({
          fileId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
      }

      return { success: true, fileId, permanent };
    });
  }

  /**
   * Copy a file
   */
  async copyFile(fileId, options = {}) {
    await this.ensureInit();

    const {
      name = null,
      parentId = null,
    } = options;

    const requestBody = {};
    if (name) requestBody.name = name;
    if (parentId) requestBody.parents = [parentId];

    return withRetry(async () => {
      const response = await this.drive.files.copy({
        fileId,
        requestBody,
        fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    });
  }

  /**
   * Move a file to a different folder
   */
  async moveFile(fileId, newParentId) {
    await this.ensureInit();

    // Get current parents
    const file = await this.getFile(fileId, 'parents');
    const previousParents = file.parents ? file.parents.join(',') : '';

    return withRetry(async () => {
      const response = await this.drive.files.update({
        fileId,
        addParents: newParentId,
        removeParents: previousParents,
        fields: 'id, name, mimeType, parents, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    });
  }

  // ========================================
  // Folder Operations
  // ========================================

  /**
   * Create a folder
   */
  async createFolder(name, parentId = null) {
    await this.ensureInit();

    const fileMetadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId || this.defaultFolder],
    };

    return withRetry(async () => {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, mimeType, createdTime, modifiedTime, parents, webViewLink',
        supportsAllDrives: true,
      });

      return response.data;
    });
  }

  /**
   * List folders only
   */
  async listFolders(parentId = null) {
    return this.listFiles({
      folderId: parentId,
      mimeType: 'application/vnd.google-apps.folder',
    });
  }

  // ========================================
  // Search
  // ========================================

  /**
   * Search files
   */
  async search(options = {}) {
    await this.ensureInit();

    const {
      query,
      fullText = null,
      mimeType = null,
      folderId = null,
      includeTrashed = false,
      includeShared = false,
      pageSize = 100,
      pageToken = null,
    } = options;

    const queryParts = [];

    if (query) {
      queryParts.push(query);
    }

    if (fullText) {
      queryParts.push(`fullText contains '${fullText}'`);
    }

    if (mimeType) {
      queryParts.push(`mimeType = '${mimeType}'`);
    }

    if (folderId) {
      queryParts.push(`'${folderId}' in parents`);
    }

    if (!includeTrashed) {
      queryParts.push('trashed = false');
    }

    const q = queryParts.join(' and ');

    return withRetry(async () => {
      const response = await this.drive.files.list({
        q,
        pageSize,
        pageToken,
        orderBy: 'modifiedTime desc',
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: includeShared,
      });

      return response.data;
    });
  }

  // ========================================
  // Permissions / Sharing
  // ========================================

  /**
   * List permissions on a file
   */
  async listPermissions(fileId) {
    await this.ensureInit();

    return withRetry(async () => {
      const response = await this.drive.permissions.list({
        fileId,
        fields: 'permissions(id, type, role, emailAddress, displayName, expirationTime)',
        supportsAllDrives: true,
      });

      return response.data.permissions || [];
    });
  }

  /**
   * Create a permission (share)
   */
  async createPermission(fileId, options) {
    await this.ensureInit();

    const {
      email = null,
      role = 'reader',  // reader, writer, commenter
      type = 'user',    // user, group, domain, anyone
      sendNotification = true,
      message = null,
    } = options;

    const permission = { role, type };
    if (email) permission.emailAddress = email;

    return withRetry(async () => {
      const response = await this.drive.permissions.create({
        fileId,
        requestBody: permission,
        sendNotificationEmail: sendNotification,
        emailMessage: message,
        fields: 'id, type, role, emailAddress, displayName',
        supportsAllDrives: true,
      });

      return response.data;
    });
  }

  /**
   * Delete a permission
   */
  async deletePermission(fileId, permissionId) {
    await this.ensureInit();

    return withRetry(async () => {
      await this.drive.permissions.delete({
        fileId,
        permissionId,
        supportsAllDrives: true,
      });

      return { success: true, fileId, permissionId };
    });
  }

  // ========================================
  // Shared Drives
  // ========================================

  /**
   * List shared drives (Team Drives)
   */
  async listSharedDrives(pageSize = 100) {
    await this.ensureInit();

    return withRetry(async () => {
      const response = await this.drive.drives.list({
        pageSize,
        fields: 'drives(id, name, createdTime)',
      });

      return response.data.drives || [];
    });
  }

  /**
   * List files in a shared drive
   */
  async listSharedDriveFiles(driveId, options = {}) {
    await this.ensureInit();

    const {
      folderId = null,
      pageSize = 100,
      pageToken = null,
    } = options;

    const queryParts = ['trashed = false'];

    if (folderId) {
      queryParts.push(`'${folderId}' in parents`);
    }

    const q = queryParts.join(' and ');

    return withRetry(async () => {
      const response = await this.drive.files.list({
        q,
        pageSize,
        pageToken,
        driveId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        orderBy: 'modifiedTime desc',
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink)',
      });

      return response.data;
    });
  }

  // ========================================
  // Utility
  // ========================================

  /**
   * Get About info (quota, user info)
   */
  async getAbout() {
    await this.ensureInit();

    return withRetry(async () => {
      const response = await this.drive.about.get({
        fields: 'user, storageQuota',
      });

      return response.data;
    });
  }
}

/**
 * Create and initialize a DriveClient
 */
export async function createDriveClient() {
  const client = new DriveClient();
  await client.init();
  return client;
}

export default DriveClient;
