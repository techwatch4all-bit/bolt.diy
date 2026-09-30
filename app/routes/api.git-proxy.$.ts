import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

/*
 * Domain allowlist for the git proxy: only these hosts may be proxied.
 * Exact matches are checked, plus suffix matches for *.github.com and
 * *.githubusercontent.com so that raw.githubusercontent.com and
 * gist.githubusercontent.com are covered without listing every subdomain.
 */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'gist.githubusercontent.com',
  'raw.githubusercontent.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
  'git.sr.ht',
]);

function isHostAllowed(hostname: string, extraAllowedHosts: string[]): boolean {
  if (ALLOWED_HOSTS.has(hostname) || extraAllowedHosts.includes(hostname)) {
    return true;
  }

  // Subdomain-safe handling for GitHub hosts
  if (hostname.endsWith('.github.com') || hostname.endsWith('.githubusercontent.com')) {
    return true;
  }

  return false;
}

// Allowed headers to forward to the target server
const ALLOW_HEADERS = [
  'accept-encoding',
  'accept-language',
  'accept',
  'access-control-allow-origin',
  'authorization',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'dnt',
  'pragma',
  'range',
  'referer',
  'user-agent',
  'x-authorization',
  'x-http-method-override',
  'x-requested-with',
];

// Headers to expose from the target server's response
const EXPOSE_HEADERS = [
  'accept-ranges',
  'age',
  'cache-control',
  'content-length',
  'content-language',
  'content-type',
  'date',
  'etag',
  'expires',
  'last-modified',
  'pragma',
  'server',
  'transfer-encoding',
  'vary',
  'x-github-request-id',
  'x-redirected-url',
];

// Handle all HTTP methods
export async function action({ request, context, params }: ActionFunctionArgs) {
  return handleProxyRequest(request, params['*'], context.cloudflare?.env);
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  return handleProxyRequest(request, params['*'], context.cloudflare?.env);
}

async function handleProxyRequest(request: Request, path: string | undefined, env?: Record<string, any>) {
  try {
    if (!path) {
      return json({ error: 'Invalid proxy URL format' }, { status: 400 });
    }

    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': ALLOW_HEADERS.join(', '),
          'Access-Control-Expose-Headers': EXPOSE_HEADERS.join(', '),
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Extract domain and remaining path
    const parts = path.match(/([^\/]+)\/?(.*)/);

    if (!parts) {
      return json({ error: 'Invalid path format' }, { status: 400 });
    }

    const domain = parts[1].toLowerCase();
    const remainingPath = parts[2] || '';

    // Parse extra allowed hosts from environment (comma-separated)
    const envAllowedHosts = (env?.GIT_PROXY_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h: string) => h.trim())
      .filter(Boolean);

    // Enforce domain allowlist
    if (!isHostAllowed(domain, envAllowedHosts)) {
      return json({ error: 'Host not allowed' }, { status: 403 });
    }

    // Reconstruct the target URL with query parameters
    const url = new URL(request.url);

    console.log('Target URL:', `https://${domain}/${remainingPath}${url.search}`);

    // Filter and prepare headers
    const headers = new Headers();

    // Only forward allowed headers
    for (const header of ALLOW_HEADERS) {
      if (request.headers.has(header)) {
        headers.set(header, request.headers.get(header)!);
      }
    }

    // Set the host header
    headers.set('Host', domain);

    // Set Git user agent if not already present
    if (!headers.has('user-agent') || !headers.get('user-agent')?.startsWith('git/')) {
      headers.set('User-Agent', 'git/@isomorphic-git/cors-proxy');
    }

    console.log('Request headers:', Object.fromEntries(headers.entries()));

    // Manual redirect loop (max 5 hops)
    let targetURL = `https://${domain}/${remainingPath}${url.search}`;
    let method = request.method;
    let body = request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined;
    let duplex: RequestInit['duplex'] = undefined;

    if (body) {
      duplex = 'half';
    }

    const MAX_REDIRECTS = 5;
    let redirectCount = 0;
    let finalResponse: Response | null = null;

    while (redirectCount <= MAX_REDIRECTS) {
      const fetchOptions: RequestInit = {
        method,
        headers,
        redirect: 'manual',
      };

      if (body) {
        fetchOptions.body = body;
        fetchOptions.duplex = duplex;
      }

      const response = await fetch(targetURL, fetchOptions);

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        finalResponse = response;
        break;
      }

      const location = response.headers.get('Location');

      if (!location) {
        finalResponse = response;
        break;
      }

      redirectCount++;

      if (redirectCount > MAX_REDIRECTS) {
        return json({ error: 'Too many redirects' }, { status: 508 });
      }

      const newUrl = new URL(location, targetURL);
      const newHostname = newUrl.hostname.toLowerCase();

      if (!isHostAllowed(newHostname, envAllowedHosts)) {
        return json({ error: 'Redirect target not allowed' }, { status: 403 });
      }

      targetURL = newUrl.toString();

      if ([301, 302, 303].includes(response.status)) {
        method = 'GET';
        body = undefined;
        duplex = undefined;
        headers.delete('Content-Length');
      }

      // For 307/308: keep method + body

      // Re-set Host and user-agent for the redirected fetch
      headers.set('Host', newUrl.hostname);

      if (!headers.has('user-agent') || !headers.get('user-agent')?.startsWith('git/')) {
        headers.set('User-Agent', 'git/@isomorphic-git/cors-proxy');
      }
    }

    if (!finalResponse) {
      return json({ error: 'Proxy error' }, { status: 500 });
    }

    console.log('Response status:', finalResponse.status);

    // Create response headers
    const responseHeaders = new Headers();

    // Add CORS headers
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', ALLOW_HEADERS.join(', '));
    responseHeaders.set('Access-Control-Expose-Headers', EXPOSE_HEADERS.join(', '));

    // Copy exposed headers from the target response
    for (const header of EXPOSE_HEADERS) {
      // Skip content-length as we'll use the original response's content-length
      if (header === 'content-length') {
        continue;
      }

      if (finalResponse.headers.has(header)) {
        responseHeaders.set(header, finalResponse.headers.get(header)!);
      }
    }

    // If the response was redirected, add the x-redirected-url header
    if (finalResponse.redirected) {
      responseHeaders.set('x-redirected-url', finalResponse.url);
    }

    console.log('Response headers:', Object.fromEntries(responseHeaders.entries()));

    // Return the response with the target's body stream piped directly
    return new Response(finalResponse.body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
        url: path ? `https://${path}` : 'Invalid URL',
      },
      { status: 500 },
    );
  }
}
