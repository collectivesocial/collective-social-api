export interface Config {
  port: number;
  collectiveApiUrl: string;
  collectiveApiToken: string;
  allowedOrigins: string;
}

export function loadConfig(): Config {
  const collectiveApiUrl = process.env.COLLECTIVE_API_URL;
  if (!collectiveApiUrl) {
    throw new Error('COLLECTIVE_API_URL is required');
  }

  const collectiveApiToken = process.env.COLLECTIVE_API_TOKEN;
  if (!collectiveApiToken) {
    throw new Error(
      'COLLECTIVE_API_TOKEN is required — this is the Bearer token for authenticating with the Collective API'
    );
  }

  return {
    port: parseInt(process.env.MCP_PORT || '3100', 10),
    collectiveApiUrl,
    collectiveApiToken,
    allowedOrigins: process.env.MCP_ALLOWED_ORIGINS || '*',
  };
}
