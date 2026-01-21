/**
 * Google Drive Authentication Handler
 * Supports both OAuth2 (user credentials) and Service Account authentication
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { URL } from 'url';
import open from 'open';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

// OAuth2 scopes needed for full Drive access
const SCOPES = [
  'https://www.googleapis.com/auth/drive',           // Full Drive access for My Drive
  'https://www.googleapis.com/auth/drive.readonly',  // Read-only for Shared Drives
];

// Redirect URI for OAuth2 flow (localhost callback)
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

/**
 * Determine which authentication method to use
 * Priority: Service Account > OAuth2
 */
export function getAuthMethod() {
  const serviceAccountPath = getEnvVar('GOOGLE_SERVICE_ACCOUNT_KEY');
  const clientId = getEnvVar('GOOGLE_CLIENT_ID');
  const refreshToken = getEnvVar('GOOGLE_REFRESH_TOKEN');

  if (serviceAccountPath && existsSync(resolveKeyPath(serviceAccountPath))) {
    return 'service-account';
  }

  if (clientId && refreshToken) {
    return 'oauth2';
  }

  if (clientId) {
    return 'oauth2-pending'; // OAuth2 configured but not authenticated
  }

  return 'none';
}

/**
 * Resolve service account key path (relative to skill dir or absolute)
 */
function resolveKeyPath(keyPath) {
  if (isAbsolute(keyPath)) {
    return keyPath;
  }
  return join(__dirname, '..', keyPath);
}

/**
 * Load environment variables from .env file
 */
function loadEnvFile() {
  if (!existsSync(ENV_PATH)) {
    return {};
  }

  const envVars = {};
  const content = readFileSync(ENV_PATH, 'utf-8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
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

/**
 * Get environment variable (env file takes precedence)
 */
export function getEnvVar(key) {
  return envConfig[key] || process.env[key];
}

/**
 * Update a value in the .env file
 */
export function updateEnvFile(key, value) {
  let content = '';

  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, 'utf-8');
  }

  const lines = content.split('\n');
  let found = false;

  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) return line;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return line;

    const lineKey = trimmed.slice(0, eqIndex).trim();
    if (lineKey === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${key}=${value}`);
  }

  writeFileSync(ENV_PATH, newLines.join('\n'));

  // Update in-memory config
  envConfig[key] = value;
}

/**
 * Create OAuth2 client
 */
export function createOAuth2Client() {
  const clientId = getEnvVar('GOOGLE_CLIENT_ID');
  const clientSecret = getEnvVar('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing OAuth2 credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env file.\n' +
      'Get credentials from: https://console.cloud.google.com/apis/credentials'
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

/**
 * Create Service Account client
 */
export function createServiceAccountClient() {
  const keyPath = getEnvVar('GOOGLE_SERVICE_ACCOUNT_KEY');

  if (!keyPath) {
    throw new Error(
      'Missing service account key. Please set GOOGLE_SERVICE_ACCOUNT_KEY in .env file.'
    );
  }

  const resolvedPath = resolveKeyPath(keyPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Service account key file not found: ${resolvedPath}\n` +
      'Please check the GOOGLE_SERVICE_ACCOUNT_KEY path in .env file.'
    );
  }

  const keyFile = JSON.parse(readFileSync(resolvedPath, 'utf-8'));

  // Check if we need to impersonate a user (for accessing their Drive)
  const impersonateUser = getEnvVar('GOOGLE_IMPERSONATE_USER');

  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: SCOPES,
    clientOptions: impersonateUser ? { subject: impersonateUser } : undefined,
  });

  return auth;
}

/**
 * Get authenticated client (auto-detects auth method)
 */
export async function getAuthenticatedClient() {
  const authMethod = getAuthMethod();

  switch (authMethod) {
    case 'service-account': {
      const auth = createServiceAccountClient();
      return auth;
    }

    case 'oauth2': {
      const oauth2Client = createOAuth2Client();
      const refreshToken = getEnvVar('GOOGLE_REFRESH_TOKEN');

      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      // Force token refresh to validate
      try {
        await oauth2Client.getAccessToken();
      } catch (error) {
        throw new Error(
          'Authentication expired or invalid. Please run "gdrive auth" again.\n' +
          `Details: ${error.message}`
        );
      }

      return oauth2Client;
    }

    case 'oauth2-pending':
      throw new Error(
        'OAuth2 credentials found but not authenticated.\n' +
        'Please run "node cli.js auth" to complete authentication.'
      );

    default:
      throw new Error(
        'No authentication configured. Please set up either:\n' +
        '1. Service Account: Set GOOGLE_SERVICE_ACCOUNT_KEY in .env\n' +
        '2. OAuth2: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then run "node cli.js auth"'
      );
  }
}

/**
 * Check if currently authenticated
 */
export async function checkAuthStatus() {
  const authMethod = getAuthMethod();

  try {
    switch (authMethod) {
      case 'service-account': {
        const auth = createServiceAccountClient();
        const client = await auth.getClient();
        await client.getAccessToken();

        const keyPath = getEnvVar('GOOGLE_SERVICE_ACCOUNT_KEY');
        const resolvedPath = resolveKeyPath(keyPath);
        const keyFile = JSON.parse(readFileSync(resolvedPath, 'utf-8'));

        return {
          authenticated: true,
          method: 'service-account',
          serviceAccountEmail: keyFile.client_email,
          projectId: keyFile.project_id,
          impersonating: getEnvVar('GOOGLE_IMPERSONATE_USER') || null,
        };
      }

      case 'oauth2': {
        const client = await getAuthenticatedClient();
        const tokenInfo = await client.getAccessToken();

        return {
          authenticated: true,
          method: 'oauth2',
          tokenExpiry: tokenInfo.res?.data?.expiry_date || 'unknown',
        };
      }

      case 'oauth2-pending':
        return {
          authenticated: false,
          method: 'oauth2',
          reason: 'OAuth2 configured but not authenticated. Run "node cli.js auth"',
        };

      default:
        return {
          authenticated: false,
          method: 'none',
          reason: 'No authentication configured',
        };
    }
  } catch (error) {
    return {
      authenticated: false,
      method: authMethod,
      reason: error.message,
    };
  }
}

/**
 * Perform OAuth2 authentication flow
 * Opens browser for user to authorize, then captures the code via local server
 */
export async function authenticate() {
  const oauth2Client = createOAuth2Client();

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to always get refresh token
  });

  console.log('Opening browser for authentication...');
  console.log('If browser does not open, visit this URL:\n');
  console.log(authUrl);
  console.log('\n');

  // Open browser
  await open(authUrl);

  // Start local server to capture callback
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/oauth2callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1 style="color: #d93025;">Authentication Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window.</p>
            </body></html>
          `);
          server.close();
          reject(new Error(`Authentication failed: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1 style="color: #1a73e8;">Authentication Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
            </body></html>
          `);
          server.close();
          resolve(code);
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Waiting for authentication callback on port ${REDIRECT_PORT}...`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out. Please try again.'));
    }, 5 * 60 * 1000);
  });

  // Exchange code for tokens
  console.log('Exchanging authorization code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh token received. This can happen if you have already authorized this app.\n' +
      'Go to https://myaccount.google.com/permissions and remove the app, then try again.'
    );
  }

  // Save refresh token to .env
  updateEnvFile('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);

  console.log('Authentication successful! Refresh token saved to .env file.');

  return {
    success: true,
    message: 'Authentication successful',
  };
}

export default {
  getEnvVar,
  updateEnvFile,
  getAuthMethod,
  createOAuth2Client,
  createServiceAccountClient,
  getAuthenticatedClient,
  checkAuthStatus,
  authenticate,
};
