/**
 * Search Operations for Google Drive
 * Full-text search and advanced query support
 */

import { createDriveClient } from './client.js';

/**
 * Search operations client
 */
export class SearchClient {
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
   * Search files with various filters
   */
  async search(options = {}) {
    await this.ensureInit();

    const {
      query = null,          // Raw query string (name contains 'x')
      fullText = null,       // Full-text content search
      name = null,           // Name filter
      mimeType = null,       // MIME type filter
      folderId = null,       // Search in specific folder
      modifiedAfter = null,  // Modified after date
      modifiedBefore = null, // Modified before date
      owner = null,          // Owner email
      trashed = false,       // Include trashed files
      shared = false,        // Include shared drives
      limit = 100,
    } = options;

    // Build query parts
    const queryParts = [];

    if (query) {
      queryParts.push(query);
    }

    if (fullText) {
      queryParts.push(`fullText contains '${escapeQuery(fullText)}'`);
    }

    if (name) {
      queryParts.push(`name contains '${escapeQuery(name)}'`);
    }

    if (mimeType) {
      queryParts.push(`mimeType = '${mimeType}'`);
    }

    if (folderId) {
      queryParts.push(`'${folderId}' in parents`);
    }

    if (modifiedAfter) {
      queryParts.push(`modifiedTime > '${modifiedAfter}'`);
    }

    if (modifiedBefore) {
      queryParts.push(`modifiedTime < '${modifiedBefore}'`);
    }

    if (owner) {
      queryParts.push(`'${owner}' in owners`);
    }

    if (!trashed) {
      queryParts.push('trashed = false');
    }

    const q = queryParts.join(' and ');

    const result = await this.client.search({
      query: q || undefined,
      includeShared: shared,
      pageSize: limit,
    });

    return {
      files: result.files.map(formatSearchResult),
      query: q,
      hasMore: !!result.nextPageToken,
    };
  }

  /**
   * Full-text search
   */
  async fullText(text, options = {}) {
    return this.search({
      ...options,
      fullText: text,
    });
  }

  /**
   * Search by name
   */
  async byName(name, options = {}) {
    return this.search({
      ...options,
      name,
    });
  }

  /**
   * Search by MIME type
   */
  async byType(mimeType, options = {}) {
    return this.search({
      ...options,
      mimeType,
    });
  }

  /**
   * Search for recently modified files
   */
  async recent(days = 7, options = {}) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const dateStr = date.toISOString();

    return this.search({
      ...options,
      modifiedAfter: dateStr,
    });
  }

  /**
   * Search for documents only
   */
  async documents(options = {}) {
    await this.ensureInit();

    const docTypes = [
      'application/vnd.google-apps.document',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    const mimeQueries = docTypes.map(t => `mimeType = '${t}'`).join(' or ');

    return this.search({
      ...options,
      query: `(${mimeQueries})`,
    });
  }

  /**
   * Search for spreadsheets only
   */
  async spreadsheets(options = {}) {
    await this.ensureInit();

    const sheetTypes = [
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ];

    const mimeQueries = sheetTypes.map(t => `mimeType = '${t}'`).join(' or ');

    return this.search({
      ...options,
      query: `(${mimeQueries})`,
    });
  }

  /**
   * Search for images only
   */
  async images(options = {}) {
    return this.search({
      ...options,
      query: "mimeType contains 'image/'",
    });
  }

  /**
   * Search for videos only
   */
  async videos(options = {}) {
    return this.search({
      ...options,
      query: "mimeType contains 'video/'",
    });
  }

  /**
   * Search in shared drives
   */
  async inSharedDrives(options = {}) {
    return this.search({
      ...options,
      shared: true,
    });
  }

  /**
   * Build a query string from options (for advanced users)
   */
  buildQuery(options) {
    const parts = [];

    if (options.name) {
      parts.push(`name contains '${escapeQuery(options.name)}'`);
    }

    if (options.nameExact) {
      parts.push(`name = '${escapeQuery(options.nameExact)}'`);
    }

    if (options.fullText) {
      parts.push(`fullText contains '${escapeQuery(options.fullText)}'`);
    }

    if (options.mimeType) {
      parts.push(`mimeType = '${options.mimeType}'`);
    }

    if (options.mimeTypeContains) {
      parts.push(`mimeType contains '${options.mimeTypeContains}'`);
    }

    if (options.parent) {
      parts.push(`'${options.parent}' in parents`);
    }

    if (options.owner) {
      parts.push(`'${options.owner}' in owners`);
    }

    if (options.modifiedAfter) {
      parts.push(`modifiedTime > '${options.modifiedAfter}'`);
    }

    if (options.modifiedBefore) {
      parts.push(`modifiedTime < '${options.modifiedBefore}'`);
    }

    if (options.createdAfter) {
      parts.push(`createdTime > '${options.createdAfter}'`);
    }

    if (options.createdBefore) {
      parts.push(`createdTime < '${options.createdBefore}'`);
    }

    if (options.starred === true) {
      parts.push('starred = true');
    }

    if (options.trashed === true) {
      parts.push('trashed = true');
    } else if (options.trashed === false) {
      parts.push('trashed = false');
    }

    if (options.visibility) {
      parts.push(`visibility = '${options.visibility}'`);
    }

    return parts.join(' and ');
  }
}

/**
 * Escape special characters in query strings
 */
function escapeQuery(str) {
  return str.replace(/'/g, "\\'");
}

/**
 * Format search result for output
 */
function formatSearchResult(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? parseInt(file.size, 10) : null,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    owners: file.owners?.map(o => o.emailAddress) || [],
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
  };
}

/**
 * Create and initialize SearchClient
 */
export async function createSearchClient() {
  const client = new SearchClient();
  await client.init();
  return client;
}

export default SearchClient;
