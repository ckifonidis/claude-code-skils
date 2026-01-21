/**
 * Azure DevOps API Client
 * Core client for making authenticated requests to Azure DevOps REST API
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const API_VERSION = '7.1';

// Load .env file from skill directory
function loadEnvFile() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dirname, '..', '.env');

  if (!existsSync(envPath)) {
    return {};
  }

  const envVars = {};
  const content = readFileSync(envPath, 'utf-8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    envVars[key] = value;
  }

  return envVars;
}

// Load env file once at module load
const envConfig = loadEnvFile();

// Helper to get config value (env file takes precedence, then system env)
export function getEnvVar(key) {
  return envConfig[key] || process.env[key];
}

export class AzureDevOpsClient {
  constructor(config = {}) {
    this.organization = config.organization || getEnvVar('AZDO_ORGANIZATION');
    this.project = config.project || getEnvVar('AZDO_PROJECT');
    this.pat = config.pat || getEnvVar('AZDO_PAT');

    if (!this.organization) {
      throw new Error('Azure DevOps organization is required. Set AZDO_ORGANIZATION in .env file or environment.');
    }
    if (!this.pat) {
      throw new Error('Azure DevOps PAT is required. Set AZDO_PAT in .env file or environment.');
    }

    this.baseUrl = `https://dev.azure.com/${this.organization}`;
  }

  /**
   * Get authorization header for API requests
   */
  getAuthHeader() {
    const token = Buffer.from(`:${this.pat}`).toString('base64');
    return `Basic ${token}`;
  }

  /**
   * Make an API request
   */
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint}`;

    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}api-version=${API_VERSION}`;

    // Determine content type - only PATCH uses json-patch+json
    let contentType = 'application/json';
    if (options.method === 'PATCH') {
      contentType = 'application/json-patch+json';
    }

    const response = await fetch(fullUrl, {
      ...options,
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': contentType,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure DevOps API error (${response.status}): ${error}`);
    }

    const responseContentType = response.headers.get('content-type');
    if (responseContentType && responseContentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  /**
   * GET request
   */
  async get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post(endpoint, data) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * PATCH request (used for work item updates)
   */
  async patch(endpoint, data) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  /**
   * PATCH request with regular JSON content type (for non-work-item updates like iterations)
   */
  async patchJson(endpoint, data) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * DELETE request
   */
  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  /**
   * Upload a file as an attachment
   * @param {string} endpoint - API endpoint
   * @param {Buffer} fileBuffer - File content as buffer
   * @param {string} fileName - Name of the file
   */
  async uploadFile(endpoint, fileBuffer, fileName) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint}`;

    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}api-version=${API_VERSION}&fileName=${encodeURIComponent(fileName)}`;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure DevOps API error (${response.status}): ${error}`);
    }

    return response.json();
  }
}

export default AzureDevOpsClient;
