/**
 * Sharing Operations for Google Drive
 * Permission management for files and folders
 */

import { createDriveClient } from './client.js';

// Valid role types
const VALID_ROLES = ['reader', 'writer', 'commenter', 'owner'];

// Valid permission types
const VALID_TYPES = ['user', 'group', 'domain', 'anyone'];

/**
 * Share operations client
 */
export class ShareClient {
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
   * Share a file with a user
   */
  async share(fileId, options = {}) {
    await this.ensureInit();

    const {
      email = null,
      role = 'reader',
      type = 'user',
      sendNotification = true,
      message = null,
    } = options;

    // Validate role
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}. Valid roles: ${VALID_ROLES.join(', ')}`);
    }

    // Validate type
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`Invalid type: ${type}. Valid types: ${VALID_TYPES.join(', ')}`);
    }

    // Email required for user/group types
    if ((type === 'user' || type === 'group') && !email) {
      throw new Error(`Email is required for type: ${type}`);
    }

    const result = await this.client.createPermission(fileId, {
      email,
      role,
      type,
      sendNotification,
      message,
    });

    return formatPermission(result);
  }

  /**
   * Share with a specific user
   */
  async shareWithUser(fileId, email, role = 'reader', options = {}) {
    return this.share(fileId, {
      ...options,
      email,
      role,
      type: 'user',
    });
  }

  /**
   * Share with a group
   */
  async shareWithGroup(fileId, groupEmail, role = 'reader', options = {}) {
    return this.share(fileId, {
      ...options,
      email: groupEmail,
      role,
      type: 'group',
    });
  }

  /**
   * Share with anyone who has the link
   */
  async shareWithAnyone(fileId, role = 'reader') {
    return this.share(fileId, {
      role,
      type: 'anyone',
      sendNotification: false,
    });
  }

  /**
   * Share with entire domain
   */
  async shareWithDomain(fileId, domain, role = 'reader') {
    await this.ensureInit();

    const result = await this.client.createPermission(fileId, {
      role,
      type: 'domain',
      domain,
      sendNotification: false,
    });

    return formatPermission(result);
  }

  /**
   * List permissions on a file
   */
  async list(fileId) {
    await this.ensureInit();

    const permissions = await this.client.listPermissions(fileId);

    return permissions.map(formatPermission);
  }

  /**
   * Remove a permission
   */
  async remove(fileId, permissionId) {
    await this.ensureInit();

    await this.client.deletePermission(fileId, permissionId);

    return {
      success: true,
      fileId,
      permissionId,
      message: 'Permission removed',
    };
  }

  /**
   * Remove all permissions except owner
   */
  async removeAll(fileId) {
    await this.ensureInit();

    const permissions = await this.client.listPermissions(fileId);
    const removed = [];

    for (const perm of permissions) {
      if (perm.role !== 'owner') {
        await this.client.deletePermission(fileId, perm.id);
        removed.push(perm.id);
      }
    }

    return {
      success: true,
      fileId,
      removedCount: removed.length,
      removedIds: removed,
    };
  }

  /**
   * Get sharing summary for a file
   */
  async summary(fileId) {
    await this.ensureInit();

    const file = await this.client.getFile(fileId, 'id, name, shared, webViewLink');
    const permissions = await this.client.listPermissions(fileId);

    const summary = {
      fileId: file.id,
      fileName: file.name,
      isShared: file.shared,
      webViewLink: file.webViewLink,
      permissions: permissions.map(formatPermission),
      stats: {
        total: permissions.length,
        owners: permissions.filter(p => p.role === 'owner').length,
        writers: permissions.filter(p => p.role === 'writer').length,
        readers: permissions.filter(p => p.role === 'reader').length,
        commenters: permissions.filter(p => p.role === 'commenter').length,
        anyoneWithLink: permissions.some(p => p.type === 'anyone'),
      },
    };

    return summary;
  }

  /**
   * Make file private (remove link sharing)
   */
  async makePrivate(fileId) {
    await this.ensureInit();

    const permissions = await this.client.listPermissions(fileId);
    let removed = 0;

    for (const perm of permissions) {
      if (perm.type === 'anyone' || perm.type === 'domain') {
        await this.client.deletePermission(fileId, perm.id);
        removed++;
      }
    }

    return {
      success: true,
      fileId,
      message: removed > 0 ? 'Link sharing disabled' : 'File was already private',
      removedPermissions: removed,
    };
  }
}

/**
 * Format permission for output
 */
function formatPermission(perm) {
  return {
    id: perm.id,
    type: perm.type,
    role: perm.role,
    email: perm.emailAddress || null,
    displayName: perm.displayName || null,
    expirationTime: perm.expirationTime || null,
  };
}

/**
 * Create and initialize ShareClient
 */
export async function createShareClient() {
  const client = new ShareClient();
  await client.init();
  return client;
}

export default ShareClient;
