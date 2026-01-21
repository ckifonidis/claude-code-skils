/**
 * Folder Operations for Google Drive
 * Handles create, list, and tree operations
 */

import { createDriveClient } from './client.js';

/**
 * Folder operations client
 */
export class FoldersClient {
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
   * Create a folder
   */
  async create(name, parentId = null) {
    await this.ensureInit();

    const result = await this.client.createFolder(name, parentId);

    return formatFolder(result);
  }

  /**
   * List folders only
   */
  async list(parentId = null) {
    await this.ensureInit();

    const result = await this.client.listFolders(parentId);

    return result.files.map(formatFolder);
  }

  /**
   * Get folder tree (recursive listing)
   */
  async tree(folderId = null, options = {}) {
    await this.ensureInit();

    const {
      depth = 3,
      includeFiles = false,
    } = options;

    const rootId = folderId || this.client.getDefaultFolder();

    return this.buildTree(rootId, depth, includeFiles);
  }

  /**
   * Build folder tree recursively
   */
  async buildTree(folderId, depth, includeFiles, currentDepth = 0) {
    if (currentDepth >= depth) {
      return null;
    }

    // Get folder info
    let folder;
    if (folderId === 'root' || !folderId) {
      folder = { id: 'root', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder' };
    } else {
      folder = await this.client.getFile(folderId, 'id, name, mimeType');
    }

    // List children
    const query = includeFiles ? null : 'application/vnd.google-apps.folder';
    const result = await this.client.listFiles({
      folderId,
      mimeType: query,
      pageSize: 1000,
    });

    // Separate folders and files
    const folders = result.files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    const files = result.files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

    // Recursively get children for folders
    const children = [];

    for (const childFolder of folders) {
      const subtree = await this.buildTree(childFolder.id, depth, includeFiles, currentDepth + 1);
      if (subtree) {
        children.push(subtree);
      } else {
        children.push({
          id: childFolder.id,
          name: childFolder.name,
          type: 'folder',
          children: [],
        });
      }
    }

    // Add files if requested
    if (includeFiles) {
      for (const file of files) {
        children.push({
          id: file.id,
          name: file.name,
          type: 'file',
          mimeType: file.mimeType,
          size: file.size,
        });
      }
    }

    return {
      id: folder.id,
      name: folder.name,
      type: 'folder',
      children,
    };
  }

  /**
   * Print tree in ASCII format
   */
  printTree(tree, prefix = '', isLast = true) {
    const lines = [];
    const connector = isLast ? '└── ' : '├── ';
    const extension = isLast ? '    ' : '│   ';

    const icon = tree.type === 'folder' ? '📁 ' : '📄 ';
    lines.push(prefix + connector + icon + tree.name);

    if (tree.children) {
      tree.children.forEach((child, index) => {
        const childIsLast = index === tree.children.length - 1;
        const childLines = this.printTree(child, prefix + extension, childIsLast);
        lines.push(...childLines);
      });
    }

    return lines;
  }

  /**
   * Get tree as formatted string
   */
  async getTreeString(folderId = null, options = {}) {
    const tree = await this.tree(folderId, options);

    const icon = '📁 ';
    const lines = [icon + tree.name];

    if (tree.children) {
      tree.children.forEach((child, index) => {
        const isLast = index === tree.children.length - 1;
        const childLines = this.printTree(child, '', isLast);
        lines.push(...childLines);
      });
    }

    return lines.join('\n');
  }

  /**
   * Find folder by path (e.g., "Projects/2024/Reports")
   */
  async findByPath(path, parentId = null) {
    await this.ensureInit();

    const parts = path.split('/').filter(p => p.trim());
    let currentId = parentId || 'root';

    for (const part of parts) {
      const result = await this.client.listFiles({
        folderId: currentId,
        mimeType: 'application/vnd.google-apps.folder',
        name: part,
      });

      const folder = result.files.find(f => f.name === part);
      if (!folder) {
        return null;
      }
      currentId = folder.id;
    }

    return this.client.getFile(currentId).then(formatFolder);
  }

  /**
   * Create folder path (create all folders in path if they don't exist)
   */
  async createPath(path, parentId = null) {
    await this.ensureInit();

    const parts = path.split('/').filter(p => p.trim());
    let currentId = parentId || 'root';
    const created = [];

    for (const part of parts) {
      // Check if folder exists
      const result = await this.client.listFiles({
        folderId: currentId,
        mimeType: 'application/vnd.google-apps.folder',
        name: part,
      });

      const folder = result.files.find(f => f.name === part);

      if (folder) {
        currentId = folder.id;
      } else {
        // Create folder
        const newFolder = await this.client.createFolder(part, currentId);
        currentId = newFolder.id;
        created.push({
          id: newFolder.id,
          name: part,
        });
      }
    }

    return {
      id: currentId,
      path,
      created,
    };
  }
}

/**
 * Format folder for output
 */
function formatFolder(folder) {
  return {
    id: folder.id,
    name: folder.name,
    createdTime: folder.createdTime,
    modifiedTime: folder.modifiedTime,
    parents: folder.parents,
    webViewLink: folder.webViewLink,
  };
}

/**
 * Create and initialize FoldersClient
 */
export async function createFoldersClient() {
  const client = new FoldersClient();
  await client.init();
  return client;
}

export default FoldersClient;
