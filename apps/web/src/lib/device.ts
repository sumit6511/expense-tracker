/** "Chrome on Android", "Safari on iPhone": enough to tell someone's devices apart. */
export function deviceLabel(ua = navigator.userAgent, fallback = 'Unknown device'): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  // iPhone and iPad user agents also say "like Mac OS X", so they're checked first.
  const os = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return os ?? browser ?? fallback;
}

/** Phones and tablets, for picking an icon. */
export const isMobileDevice = (ua: string) => /Android|iPhone|iPad|Mobile/.test(ua);
