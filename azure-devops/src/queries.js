/**
 * Azure DevOps Queries Module
 * Manage and run saved queries
 */

import { AzureDevOpsClient, getEnvVar } from './client.js';
import { WorkItemsClient } from './workItems.js';

export class QueriesClient {
  constructor(config = {}) {
    this.client = new AzureDevOpsClient(config);
    this.workItems = new WorkItemsClient(config);
    this.project = config.project || getEnvVar('AZDO_PROJECT');
  }

  /**
   * List all queries in the project
   * @param {string} folder - Optional folder path to list queries from
   * @param {number} depth - Depth of folder hierarchy to return
   */
  async list(folder = null, depth = 2) {
    let endpoint = `/${this.project}/_apis/wit/queries`;
    if (folder) {
      endpoint += `/${encodeURIComponent(folder)}`;
    }
    endpoint += `?$depth=${depth}&$expand=all`;
    return this.client.get(endpoint);
  }

  /**
   * Get a specific query by ID or path
   * @param {string} queryIdOrPath - Query ID (GUID) or path
   */
  async get(queryIdOrPath) {
    const endpoint = `/${this.project}/_apis/wit/queries/${encodeURIComponent(queryIdOrPath)}`;
    return this.client.get(endpoint);
  }

  /**
   * Run a saved query by ID or path
   * @param {string} queryIdOrPath - Query ID (GUID) or path
   * @param {boolean} returnFullItems - If true, returns full work items
   */
  async run(queryIdOrPath, returnFullItems = true) {
    // First get the query to get its WIQL
    const query = await this.get(queryIdOrPath);

    if (query.queryType === 'flat') {
      // Flat query - run WIQL
      return this.workItems.query(query.wiql, returnFullItems);
    } else if (query.queryType === 'oneHop' || query.queryType === 'tree') {
      // Hierarchical query
      const endpoint = `/${this.project}/_apis/wit/wiql/${query.id}`;
      const result = await this.client.get(endpoint);

      if (returnFullItems && result.workItemRelations && result.workItemRelations.length > 0) {
        const ids = [...new Set(result.workItemRelations
          .filter(r => r.target)
          .map(r => r.target.id))];
        if (ids.length > 0) {
          const items = await this.workItems.getMany(ids);
          return { ...result, workItems: items.value };
        }
      }
      return result;
    }

    throw new Error(`Unknown query type: ${query.queryType}`);
  }

  /**
   * Create a new query
   * @param {string} name - Query name
   * @param {string} folder - Folder path (e.g., 'Shared Queries/Sprint Queries')
   * @param {string} wiql - WIQL query string
   */
  async create(name, folder, wiql) {
    const endpoint = `/${this.project}/_apis/wit/queries/${encodeURIComponent(folder)}`;
    return this.client.post(endpoint, {
      name,
      wiql,
      queryType: 'flat',
    });
  }

  /**
   * Delete a query
   * @param {string} queryIdOrPath - Query ID or path
   */
  async delete(queryIdOrPath) {
    const endpoint = `/${this.project}/_apis/wit/queries/${encodeURIComponent(queryIdOrPath)}`;
    return this.client.delete(endpoint);
  }

  /**
   * Get shared queries
   */
  async getSharedQueries(depth = 2) {
    return this.list('Shared Queries', depth);
  }

  /**
   * Get my queries (personal queries)
   */
  async getMyQueries(depth = 2) {
    return this.list('My Queries', depth);
  }
}

export default QueriesClient;
