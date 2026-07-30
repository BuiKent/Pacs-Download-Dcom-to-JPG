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
    const pixels = new Uint8Array(width * height);
    for (let source = 0, target = 0; target < pixels.length; source += 4, target += 1) {
      pixels[target] = Math.round(
        rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114,
      );
    }
    self.postMessage({ id, width, height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({
      id,
      error: error?.message || String(error),
    });
  }
};
