/**
 * Azure DevOps Work Items Module
 * CRUD operations for work items (tasks, bugs, user stories, etc.)
 */

import { AzureDevOpsClient, getEnvVar } from './client.js';

export class WorkItemsClient {
  constructor(config = {}) {
    this.client = new AzureDevOpsClient(config);
    this.project = config.project || getEnvVar('AZDO_PROJECT');
  }

  /**
   * Get a single work item by ID
   * @param {number} id - Work item ID
   * @param {string[]} fields - Optional list of fields to return
   * @param {string} expand - Optional expand options: None, Relations, Fields, Links, All
   */
  async get(id, fields = null, expand = null) {
    let endpoint = `/${this.project}/_apis/wit/workitems/${id}`;
    const params = [];
    if (fields && fields.length) {
      params.push(`fields=${fields.join(',')}`);
    }
    if (expand) {
      params.push(`$expand=${expand}`);
    }
    if (params.length) {
      endpoint += `?${params.join('&')}`;
    }
    return this.client.get(endpoint);
  }

  /**
   * Get multiple work items by IDs
   * @param {number[]} ids - Array of work item IDs
   * @param {string[]} fields - Optional list of fields to return
   */
  async getMany(ids, fields = null) {
    let endpoint = `/${this.project}/_apis/wit/workitems?ids=${ids.join(',')}`;
    if (fields && fields.length) {
      endpoint += `&fields=${fields.join(',')}`;
    }
    return this.client.get(endpoint);
  }

  /**
   * Create a new work item
   * @param {string} type - Work item type (Task, Bug, User Story, Feature, Epic, etc.)
   * @param {object} fields - Field values to set
   */
  async create(type, fields) {
    const operations = Object.entries(fields).map(([field, value]) => ({
      op: 'add',
      path: `/fields/${field}`,
      value: value,
    }));

    const endpoint = `/${this.project}/_apis/wit/workitems/$${encodeURIComponent(type)}`;
    return this.client.patch(endpoint, operations);
  }

  /**
   * Update a work item
   * @param {number} id - Work item ID
   * @param {object} fields - Field values to update
   */
  async update(id, fields) {
    const operations = Object.entries(fields).map(([field, value]) => ({
      op: 'replace',
      path: `/fields/${field}`,
      value: value,
    }));

    const endpoint = `/${this.project}/_apis/wit/workitems/${id}`;
    return this.client.patch(endpoint, operations);
  }

  /**
   * Delete a work item (moves to recycle bin)
   * @param {number} id - Work item ID
   * @param {boolean} destroy - If true, permanently deletes the work item
   */
  async delete(id, destroy = false) {
    const endpoint = `/${this.project}/_apis/wit/workitems/${id}${destroy ? '?destroy=true' : ''}`;
    return this.client.delete(endpoint);
  }

  /**
   * Query work items using WIQL (Work Item Query Language)
   * @param {string} wiql - WIQL query string
   * @param {boolean} returnFullItems - If true, returns full work items instead of just IDs
   */
  async query(wiql, returnFullItems = true) {
    const endpoint = `/${this.project}/_apis/wit/wiql`;
    const result = await this.client.post(endpoint, { query: wiql });

    if (returnFullItems && result.workItems && result.workItems.length > 0) {
      const ids = result.workItems.map(wi => wi.id);
      // Azure DevOps limits batch requests to 200 items
      const batches = [];
      for (let i = 0; i < ids.length; i += 200) {
        batches.push(ids.slice(i, i + 200));
      }
      const items = [];
      for (const batch of batches) {
        const batchResult = await this.getMany(batch);
        items.push(...batchResult.value);
      }
      return { ...result, workItems: items };
    }

    return result;
  }

  /**
   * List work items by type in the current project
   * @param {string} type - Work item type (optional)
   * @param {string} state - Filter by state (optional)
   * @param {string} assignedTo - Filter by assigned user (optional)
   * @param {number} top - Maximum number of items to return
   */
  async list({ type = null, state = null, assignedTo = null, areaPath = null, iterationPath = null, top = 100 } = {}) {
    const conditions = [`[System.TeamProject] = '${this.project}'`];

    if (type) {
      conditions.push(`[System.WorkItemType] = '${type}'`);
    }
    if (state) {
      conditions.push(`[System.State] = '${state}'`);
    }
    if (assignedTo) {
      conditions.push(`[System.AssignedTo] = '${assignedTo}'`);
    }
    if (areaPath) {
      conditions.push(`[System.AreaPath] UNDER '${areaPath}'`);
    }
    if (iterationPath) {
      conditions.push(`[System.IterationPath] UNDER '${iterationPath}'`);
    }

    const wiql = `
      SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo], [System.WorkItemType]
      FROM WorkItems
      WHERE ${conditions.join(' AND ')}
      ORDER BY [System.ChangedDate] DESC
    `;

    const result = await this.query(wiql, true);
    return result.workItems ? result.workItems.slice(0, top) : [];
  }

  /**
   * Add a comment to a work item
   * @param {number} id - Work item ID
   * @param {string} text - Comment text
   */
  async addComment(id, text) {
    const endpoint = `/${this.project}/_apis/wit/workitems/${id}/comments`;
    return this.client.post(endpoint, { text });
  }

  /**
   * Get comments for a work item
   * @param {number} id - Work item ID
   */
  async getComments(id) {
    const endpoint = `/${this.project}/_apis/wit/workitems/${id}/comments`;
    return this.client.get(endpoint);
  }

  /**
   * Add a link/relation to a work item
   * @param {number} id - Work item ID
   * @param {string} relationType - Relation type (e.g., 'System.LinkTypes.Hierarchy-Forward' for parent)
   * @param {string} targetUrl - URL of the target work item
   */
  async addLink(id, relationType, targetId) {
    const targetUrl = `${this.client.baseUrl}/${this.project}/_apis/wit/workitems/${targetId}`;
    const operations = [{
      op: 'add',
      path: '/relations/-',
      value: {
        rel: relationType,
        url: targetUrl,
      },
    }];
    const endpoint = `/${this.project}/_apis/wit/workitems/${id}`;
    return this.client.patch(endpoint, operations);
  }

  /**
   * Get available work item types for the project
   */
  async getTypes() {
    const endpoint = `/${this.project}/_apis/wit/workitemtypes`;
    return this.client.get(endpoint);
  }

  /**
   * Get available states for a work item type
   * @param {string} type - Work item type
   */
  async getStates(type) {
    const endpoint = `/${this.project}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`;
    return this.client.get(endpoint);
  }

  /**
   * Upload an attachment and link it to a work item
   * @param {number} id - Work item ID
   * @param {Buffer} fileBuffer - File content as buffer
   * @param {string} fileName - Name of the file
   * @param {string} comment - Optional comment for the attachment
   */
  async addAttachment(id, fileBuffer, fileName, comment = null) {
    // Step 1: Upload the attachment to Azure DevOps
    const uploadEndpoint = `/${this.project}/_apis/wit/attachments`;
    const attachment = await this.client.uploadFile(uploadEndpoint, fileBuffer, fileName);

    // Step 2: Link the attachment to the work item
    const operations = [{
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'AttachedFile',
        url: attachment.url,
        attributes: {
          comment: comment || fileName,
        },
      },
    }];

    const endpoint = `/${this.project}/_apis/wit/workitems/${id}`;
    return this.client.patch(endpoint, operations);
  }

  /**
   * Get attachments for a work item
   * @param {number} id - Work item ID
   */
  async getAttachments(id) {
    const item = await this.get(id, null, 'Relations');
    const relations = item.relations || [];
    return relations.filter(r => r.rel === 'AttachedFile').map(r => ({
      url: r.url,
      name: r.attributes?.name || r.url.split('/').pop(),
      comment: r.attributes?.comment,
    }));
  }
}

export default WorkItemsClient;
