self.onmessage = async (event) => {
  const { id, blob } = event.data || {};
  try {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Không tạo được bộ giải mã ảnh nền.");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rgba = context.getImageData(0, 0, width, height).data;
    const len = rgba.length;
    let isColor = false;
    for (let source = 0; source < len; source += 4) {
      const r = rgba[source];
      const g = rgba[source + 1];
      const b = rgba[source + 2];
      if (Math.abs(r - g) > 2 || Math.abs(g - b) > 2) {
        isColor = true;
        break;
      }
    }

    if (isColor) {
      const rgb = new Uint8Array(width * height * 3);
      for (let source = 0, target = 0; source < len; source += 4, target += 3) {
        rgb[target] = rgba[source];
        rgb[target + 1] = rgba[source + 1];
        rgb[target + 2] = rgba[source + 2];
      }
      self.postMessage({ id, width, height, isColor: true, pixels: rgb.buffer }, [rgb.buffer]);
    } else {
      const pixels = new Uint8Array(width * height);
      for (let source = 0, target = 0; target < pixels.length; source += 4, target += 1) {
        pixels[target] = rgba[source];
      }
      self.postMessage({ id, width, height, isColor: false, pixels: pixels.buffer }, [pixels.buffer]);
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error?.message || String(error),
    });
  }
};
