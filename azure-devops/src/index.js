/**
 * Azure DevOps Skill - Main Entry Point
 * Export all modules for programmatic use
 */

export { AzureDevOpsClient } from './client.js';
export { WorkItemsClient } from './workItems.js';
export { BoardsClient } from './boards.js';
export { QueriesClient } from './queries.js';

// Convenience factory function
export function createClient(config = {}) {
  return {
    workItems: new (await import('./workItems.js')).WorkItemsClient(config),
    boards: new (await import('./boards.js')).BoardsClient(config),
    queries: new (await import('./queries.js')).QueriesClient(config),
  };
}
