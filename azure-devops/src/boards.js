/**
 * Azure DevOps Boards Module
 * Manage boards, columns, iterations (sprints), and areas
 */

import { AzureDevOpsClient, getEnvVar } from './client.js';

export class BoardsClient {
  constructor(config = {}) {
    this.client = new AzureDevOpsClient(config);
    this.project = config.project || getEnvVar('AZDO_PROJECT');
    this.team = config.team || getEnvVar('AZDO_TEAM') || `${this.project} Team`;
  }

  /**
   * Get all boards for the team
   */
  async listBoards() {
    const endpoint = `/${this.project}/${this.team}/_apis/work/boards`;
    return this.client.get(endpoint);
  }

  /**
   * Get a specific board by name
   * @param {string} boardName - Board name (e.g., 'Stories', 'Backlog items', 'Bugs')
   */
  async getBoard(boardName) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/boards/${encodeURIComponent(boardName)}`;
    return this.client.get(endpoint);
  }

  /**
   * Get board columns
   * @param {string} boardName - Board name
   */
  async getColumns(boardName) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/boards/${encodeURIComponent(boardName)}/columns`;
    return this.client.get(endpoint);
  }

  /**
   * Get board rows (swimlanes)
   * @param {string} boardName - Board name
   */
  async getRows(boardName) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/boards/${encodeURIComponent(boardName)}/rows`;
    return this.client.get(endpoint);
  }

  /**
   * Get all iterations (sprints) for the team
   * @param {string} timeframe - 'current', 'past', or 'future' (optional)
   */
  async listIterations(timeframe = null) {
    let endpoint = `/${this.project}/${this.team}/_apis/work/teamsettings/iterations`;
    if (timeframe) {
      endpoint += `?$timeframe=${timeframe}`;
    }
    return this.client.get(endpoint);
  }

  /**
   * Get current iteration (sprint)
   */
  async getCurrentIteration() {
    const result = await this.listIterations('current');
    return result.value && result.value.length > 0 ? result.value[0] : null;
  }

  /**
   * Get iteration details including work items
   * @param {string} iterationId - Iteration ID
   */
  async getIteration(iterationId) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/teamsettings/iterations/${iterationId}`;
    return this.client.get(endpoint);
  }

  /**
   * Get iteration work items
   * @param {string} iterationId - Iteration ID
   */
  async getIterationWorkItems(iterationId) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/teamsettings/iterations/${iterationId}/workitems`;
    return this.client.get(endpoint);
  }

  /**
   * Get team capacity for an iteration
   * @param {string} iterationId - Iteration ID
   */
  async getCapacity(iterationId) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/teamsettings/iterations/${iterationId}/capacities`;
    return this.client.get(endpoint);
  }

  /**
   * Get all area paths for the project
   * @param {number} depth - Depth of area path tree to return
   */
  async listAreaPaths(depth = 2) {
    const endpoint = `/${this.project}/_apis/wit/classificationnodes/Areas?$depth=${depth}`;
    return this.client.get(endpoint);
  }

  /**
   * Get all iteration paths for the project
   * @param {number} depth - Depth of iteration path tree to return
   */
  async listIterationPaths(depth = 2) {
    const endpoint = `/${this.project}/_apis/wit/classificationnodes/Iterations?$depth=${depth}`;
    return this.client.get(endpoint);
  }

  /**
   * Get team settings
   */
  async getTeamSettings() {
    const endpoint = `/${this.project}/${this.team}/_apis/work/teamsettings`;
    return this.client.get(endpoint);
  }

  /**
   * Get backlog configuration
   */
  async getBacklogConfiguration() {
    const endpoint = `/${this.project}/${this.team}/_apis/work/backlogconfiguration`;
    return this.client.get(endpoint);
  }

  /**
   * Get team members
   */
  async getTeamMembers() {
    const endpoint = `/_apis/projects/${this.project}/teams/${encodeURIComponent(this.team)}/members`;
    return this.client.get(endpoint);
  }

  /**
   * Create an iteration (sprint) at project level
   * @param {string} name - Iteration name (e.g., "Sprint 1")
   * @param {string} startDate - Start date in ISO format (YYYY-MM-DD)
   * @param {string} finishDate - End date in ISO format (YYYY-MM-DD)
   * @param {string} path - Parent path for nested iterations (optional)
   */
  async createIteration(name, startDate, finishDate, path = null) {
    const basePath = path
      ? `/${this.project}/_apis/wit/classificationnodes/Iterations/${encodeURIComponent(path)}`
      : `/${this.project}/_apis/wit/classificationnodes/Iterations`;

    const body = {
      name,
      attributes: {
        startDate: startDate,
        finishDate: finishDate,
      },
    };

    return this.client.post(basePath, body);
  }

  /**
   * Add an existing iteration to a team's settings (so it appears on their board)
   * @param {string} iterationId - The iteration identifier (GUID or path)
   */
  async addIterationToTeam(iterationId) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/teamsettings/iterations`;
    const body = {
      id: iterationId,
    };
    return this.client.post(endpoint, body);
  }

  /**
   * Remove an iteration from a team's settings
   * @param {string} iterationId - The iteration identifier (GUID)
   */
  async removeIterationFromTeam(iterationId) {
    const endpoint = `/${this.project}/${this.team}/_apis/work/teamsettings/iterations/${iterationId}`;
    return this.client.delete(endpoint);
  }

  /**
   * Delete an iteration from the project (permanently)
   * @param {string} iterationPath - The iteration path (e.g., "Sprint 1" or "Release 1\\Sprint 1")
   */
  async deleteIteration(iterationPath) {
    const endpoint = `/${this.project}/_apis/wit/classificationnodes/Iterations/${encodeURIComponent(iterationPath)}`;
    return this.client.delete(endpoint);
  }

  /**
   * Update an iteration's dates
   * @param {string} iterationPath - The iteration path (e.g., "Sprint 1" or "Release 1\\Sprint 1")
   * @param {string} startDate - Start date in ISO format (YYYY-MM-DD)
   * @param {string} finishDate - End date in ISO format (YYYY-MM-DD)
   * @param {string} name - Optional new name for the iteration
   */
  async updateIteration(iterationPath, startDate, finishDate, name = null) {
    const endpoint = `/${this.project}/_apis/wit/classificationnodes/Iterations/${encodeURIComponent(iterationPath)}`;

    // Format dates as full ISO datetime strings for Azure DevOps API
    const formatDateForApi = (dateStr) => {
      if (dateStr.includes('T')) return dateStr; // Already formatted
      return `${dateStr}T00:00:00Z`;
    };

    const body = {
      attributes: {
        startDate: formatDateForApi(startDate),
        finishDate: formatDateForApi(finishDate),
      },
    };

    if (name) {
      body.name = name;
    }

    return this.client.patchJson(endpoint, body);
  }

  /**
   * Generate multiple iterations (sprints) with specified duration
   * @param {Object} options - Generation options
   * @param {Date} options.startDate - First sprint start date
   * @param {Date} options.endDate - Generate sprints until this date
   * @param {number} options.durationWeeks - Duration of each sprint in weeks (default: 2)
   * @param {string} options.namePrefix - Sprint name prefix (default: "Sprint")
   * @param {number} options.startNumber - Starting sprint number (default: 1)
   * @param {boolean} options.addToTeam - Add created iterations to team settings (default: true)
   * @param {string} options.path - Parent path for nested iterations (optional)
   */
  async generateIterations(options) {
    const {
      startDate,
      endDate,
      durationWeeks = 2,
      namePrefix = 'Sprint',
      startNumber = 1,
      addToTeam = true,
      path = null,
    } = options;

    const results = [];
    let currentStart = new Date(startDate);
    let sprintNumber = startNumber;
    const finalDate = new Date(endDate);

    while (currentStart < finalDate) {
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + (durationWeeks * 7) - 1);

      // Don't create sprint if it would extend beyond the end date significantly
      if (currentStart >= finalDate) break;

      const name = `${namePrefix} ${sprintNumber}`;
      const startStr = currentStart.toISOString().split('T')[0];
      const endStr = currentEnd.toISOString().split('T')[0];

      try {
        // Create the iteration at project level
        const iteration = await this.createIteration(name, startStr, endStr, path);

        // Add to team if requested
        if (addToTeam && iteration.identifier) {
          await this.addIterationToTeam(iteration.identifier);
        }

        results.push({
          success: true,
          name,
          startDate: startStr,
          finishDate: endStr,
          id: iteration.identifier,
          path: iteration.path,
        });
      } catch (error) {
        results.push({
          success: false,
          name,
          startDate: startStr,
          finishDate: endStr,
          error: error.message,
        });
      }

      // Move to next sprint
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1);
      sprintNumber++;
    }

    return results;
  }
}

export default BoardsClient;
