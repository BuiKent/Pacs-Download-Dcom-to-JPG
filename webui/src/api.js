let token = "";

/**
 * The viewer session every request is answered from.
 *
 * The backend keeps one catalog per session and falls back to a single shared
 * default when no session is named. Nothing used to send this, so every viewer
 * tab read whichever archive was opened last: switching back to an earlier
 * patient reported "Không tìm thấy series", and a write meant for one chart
 * could land in another's. Tab switches set this, so a request is always
 * answered from the archive the tab is actually showing.
 */
let sessionId = "";

export function configureApi(value) {
  token = value;
}

export function setApiSession(value) {
  sessionId = String(value || "");
  return sessionId;
}

export function getApiSession() {
  return sessionId;
}

/**
 * A URL a media element can load on its own.
 *
 * `<video>` and `<embed>` cannot set the auth header, and fetching them as a
 * blob first means a whole surgical clip sits in memory before the first frame
 * plays and cannot be seeked. The read-only media routes accept the token in
 * the query instead, so the element streams the file itself.
 */
export function mediaAuthUrl(path) {
  const params = new URLSearchParams({ token });
  if (sessionId) params.set("session", sessionId);
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
}

/** Auth and session headers every call shares. */
function baseHeaders() {
  const headers = { "X-DCom-Token": token };
  if (sessionId) headers["X-Viewer-Session"] = sessionId;
  return headers;
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...baseHeaders(),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(body?.error || body || `HTTP ${response.status}`);
  }
  return body;
}

export async function apiBlob(path) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: baseHeaders(),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = (await response.json()).error || message;
    } catch (_) {
      // Keep the HTTP status if the response is not JSON.
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function apiPixelData(path) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: baseHeaders(),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = (await response.json()).error || message;
    } catch (_) {
      // Keep the HTTP status if the response is not JSON.
    }
    throw new Error(message);
  }
  const number = (name, fallback) => {
    const value = Number(response.headers.get(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    buffer: await response.arrayBuffer(),
    pixelType: response.headers.get("X-DCom-Pixel-Type") || "uint16",
    rows: number("X-DCom-Rows", 0),
    columns: number("X-DCom-Columns", 0),
    // 1 for windowed grayscale, 3 for colour already normalised to RGB.
    samples: number("X-DCom-Samples", 1),
    min: number("X-DCom-Min", 0),
    max: number("X-DCom-Max", 0),
    slope: number("X-DCom-Slope", 1),
    intercept: number("X-DCom-Intercept", 0),
    windowCenter: number("X-DCom-Window-Center", 0),
    windowWidth: number("X-DCom-Window-Width", 1),
    photometric: response.headers.get("X-DCom-Photometric") || "MONOCHROME2",
  };
}

export function imagePath(seriesId, index) {
  return `/api/series/${seriesId}/image/${index}`;
}

export function thumbnailPath(seriesId) {
  return `/api/series/${seriesId}/thumbnail`;
}
