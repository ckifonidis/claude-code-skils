/**
 * File Operations for Google Drive
 * Handles list, info, download, upload, delete, move, copy
 */

import { createDriveClient } from './client.js';
import { createReadStream, createWriteStream, statSync } from 'fs';
import { basename } from 'path';
import { Readable } from 'stream';

// MIME type mappings for export
const EXPORT_FORMATS = {
  // Google Docs
  'application/vnd.google-apps.document': {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    html: 'text/html',
    odt: 'application/vnd.oasis.opendocument.text',
    rtf: 'application/rtf',
    epub: 'application/epub+zip',
  },
  // Google Sheets
  'application/vnd.google-apps.spreadsheet': {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    tsv: 'text/tab-separated-values',
  },
  // Google Slides
  'application/vnd.google-apps.presentation': {
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odp: 'application/vnd.oasis.opendocument.presentation',
    txt: 'text/plain',
  },
  // Google Drawings
  'application/vnd.google-apps.drawing': {
    pdf: 'application/pdf',
    png: 'image/png',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
  },
};

/**
 * File operations client
 */
export class FilesClient {
  constructor() {
    this.client = null;
  }

  async init() {
    this.client = await createDriveClient();
    return this;
  }

  /**
   * List files in a folder
   */
  async list(options = {}) {
    await this.ensureInit();

    const {
      folderId,
      type,
      name,
      limit = 100,
    } = options;

    const result = await this.client.listFiles({
      folderId,
      mimeType: type,
      name,
      pageSize: limit,
    });

    return result.files.map(formatFile);
  }

  /**
   * Get file info
   */
  async info(fileId) {
    await this.ensureInit();

    const file = await this.client.getFile(fileId);
    return formatFile(file);
  }

  /**
   * Download a file
   */
  async download(fileId, options = {}) {
    await this.ensureInit();

    const { exportFormat } = options;

    // Get file info first
    const file = await this.client.getFile(fileId, 'id, name, mimeType, size');

    // Check if it's a Google Docs type that needs export
    const isGoogleDoc = file.mimeType.startsWith('application/vnd.google-apps.');

    if (isGoogleDoc) {
      if (!exportFormat) {
        throw new Error(
          `File is a Google ${getGoogleDocType(file.mimeType)}. ` +
          `Please specify --export format. Available: ${getAvailableExports(file.mimeType)}`
        );
      }

      const formats = EXPORT_FORMATS[file.mimeType];
      if (!formats || !formats[exportFormat]) {
        throw new Error(
          `Export format '${exportFormat}' not supported for ${getGoogleDocType(file.mimeType)}. ` +
          `Available: ${getAvailableExports(file.mimeType)}`
        );
      }

      const exportMimeType = formats[exportFormat];
      const data = await this.client.exportFile(fileId, exportMimeType);

      return {
        data,
        name: `${file.name}.${exportFormat}`,
        mimeType: exportMimeType,
        exported: true,
        originalMimeType: file.mimeType,
      };
    }

    // Regular file download
    const result = await this.client.downloadFile(fileId);
    return result;
  }

  /**
   * Upload a file
   */
  async upload(localPath, options = {}) {
    await this.ensureInit();

    const {
      parentId,
      name,
      convert = false,
    } = options;

    const fileName = name || basename(localPath);
    const stats = statSync(localPath);
    const fileStream = createReadStream(localPath);

    // Determine MIME type
    const mimeType = getMimeType(localPath);

    const result = await this.client.uploadFile({
      name: fileName,
      content: fileStream,
      mimeType,
      parentId,
      convert,
      fileSize: stats.size, // Pass file size for progress tracking
    });

    return {
      ...formatFile(result),
      uploadedFrom: localPath,
      size: stats.size,
    };
  }

  /**
   * Upload from buffer/string
   */
  async uploadContent(content, options = {}) {
    await this.ensureInit();

    const {
      name,
      parentId,
      mimeType = 'text/plain',
      convert = false,
    } = options;

    if (!name) {
      throw new Error('Name is required when uploading content');
    }

    const stream = Readable.from([content]);

    const result = await this.client.uploadFile({
      name,
      content: stream,
      mimeType,
      parentId,
      convert,
    });

    return formatFile(result);
  }

  /**
   * Delete a file
   */
  async delete(fileId, options = {}) {
    await this.ensureInit();

    const { permanent = false } = options;

    await this.client.deleteFile(fileId, permanent);

    return {
      success: true,
      fileId,
      action: permanent ? 'permanently deleted' : 'moved to trash',
    };
  }

  /**
   * Move a file
   */
  async move(fileId, newParentId) {
    await this.ensureInit();

    const result = await this.client.moveFile(fileId, newParentId);
    return formatFile(result);
  }

  /**
   * Copy a file
   */
  async copy(fileId, options = {}) {
    await this.ensureInit();

    const { name, parentId } = options;

    const result = await this.client.copyFile(fileId, { name, parentId });
    return formatFile(result);
  }

  async ensureInit() {
    if (!this.client) {
      await this.init();
    }
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
    parents: file.parents,
    webViewLink: file.webViewLink,
    shared: file.shared || false,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    isGoogleDoc: file.mimeType?.startsWith('application/vnd.google-apps.') || false,
  };
}

/**
 * Get Google Doc type name from MIME type
 */
function getGoogleDocType(mimeType) {
  const types = {
    'application/vnd.google-apps.document': 'Document',
    'application/vnd.google-apps.spreadsheet': 'Spreadsheet',
    'application/vnd.google-apps.presentation': 'Presentation',
    'application/vnd.google-apps.drawing': 'Drawing',
    'application/vnd.google-apps.form': 'Form',
    'application/vnd.google-apps.folder': 'Folder',
  };
  return types[mimeType] || 'Document';
}

/**
 * Get available export formats for a MIME type
 */
function getAvailableExports(mimeType) {
  const formats = EXPORT_FORMATS[mimeType];
  return formats ? Object.keys(formats).join(', ') : 'none';
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const mimeTypes = {
    // Text
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    md: 'text/markdown',

    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',

    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // Archives
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',

    // Other
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Create and initialize FilesClient
 */
export async function createFilesClient() {
  const client = new FilesClient();
  await client.init();
  return client;
}

export default FilesClient;
