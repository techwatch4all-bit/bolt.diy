import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('cookies');

export function parseCookies(cookieHeader: string | null) {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  // Split the cookie string by semicolons and spaces
  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest.length > 0) {
      // Decode the name and value, and join value parts in case it contains '='
      let decodedName: string;
      let decodedValue: string;

      try {
        decodedName = decodeURIComponent(name.trim());
      } catch {
        decodedName = name.trim();
      }

      try {
        decodedValue = decodeURIComponent(rest.join('=').trim());
      } catch {
        decodedValue = rest.join('=').trim();
      }

      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

export function getApiKeysFromCookie(cookieHeader: string | null): Record<string, string> {
  const cookies = parseCookies(cookieHeader);

  if (!cookies.apiKeys) {
    return {};
  }

  try {
    return JSON.parse(cookies.apiKeys);
  } catch (error) {
    logger.warn('Failed to parse apiKeys cookie:', error);
    return {};
  }
}

export function getProviderSettingsFromCookie(cookieHeader: string | null): Record<string, any> {
  const cookies = parseCookies(cookieHeader);

  if (!cookies.providers) {
    return {};
  }

  try {
    return JSON.parse(cookies.providers);
  } catch (error) {
    logger.warn('Failed to parse providers cookie:', error);
    return {};
  }
}
