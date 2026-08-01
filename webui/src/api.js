let token = "";

export function configureApi(value) {
  token = value;
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-DCom-Token": token,
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
    headers: { "X-DCom-Token": token },
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
    headers: { "X-DCom-Token": token },
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
