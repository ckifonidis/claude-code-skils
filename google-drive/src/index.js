/**
 * Google Drive Skill - Module Exports
 * Provides programmatic access to all Google Drive operations
 */

// Core modules
export { DriveClient, createDriveClient } from './client.js';
export {
  getEnvVar,
  updateEnvFile,
  createOAuth2Client,
  getAuthenticatedClient,
  checkAuthStatus,
  authenticate,
} from './auth.js';

// Operation modules
export { FilesClient, createFilesClient } from './files.js';
export { FoldersClient, createFoldersClient } from './folders.js';
export { SearchClient, createSearchClient } from './search.js';
export { ShareClient, createShareClient } from './share.js';
export { SharedDrivesClient, createSharedDrivesClient } from './shared.js';
export { BackupClient, createBackupClient } from './backup.js';
export { SyncClient, createSyncClient } from './sync.js';

/**
 * Create a unified client with all operations
 */
export async function createClient() {
  const { createFilesClient } = await import('./files.js');
  const { createFoldersClient } = await import('./folders.js');
  const { createSearchClient } = await import('./search.js');
  const { createShareClient } = await import('./share.js');
  const { createSharedDrivesClient } = await import('./shared.js');
  const { createBackupClient } = await import('./backup.js');
  const { createSyncClient } = await import('./sync.js');

  return {
    files: await createFilesClient(),
    folders: await createFoldersClient(),
    search: await createSearchClient(),
    share: await createShareClient(),
    sharedDrives: await createSharedDrivesClient(),
    backup: await createBackupClient(),
    sync: await createSyncClient(),
  };
}

export default {
  createClient,
  createDriveClient,
  createFilesClient,
  createFoldersClient,
  createSearchClient,
  createShareClient,
  createSharedDrivesClient,
  createBackupClient,
  createSyncClient,
};
