function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.size) resolve(blob);
      else reject(new Error("画像を圧縮できませんでした。"));
    }, type, quality);
  });
}

export async function fitPortfolioCanvas(source: HTMLCanvasElement, maximum: number, type: string, { losslessFirst = false, opaque = false } = {}) {
  const resized = document.createElement("canvas");
  const context = resized.getContext("2d")!;
  let canvas = source;
  try {
    if (losslessFirst) {
      const png = await encode(source, "image/png", 1);
      if (png.size <= maximum) return { blob: png, width: source.width, height: source.height };
    }
    for (;;) {
      let fullQuality = await encode(canvas, type, 1);
      if (opaque && fullQuality.type === "image/png" && fullQuality.size > maximum) {
        type = "image/jpeg";
        fullQuality = await encode(canvas, type, 1);
      }
      if (fullQuality.size <= maximum) return { blob: fullQuality, width: canvas.width, height: canvas.height };

      // Unsupported encoders return PNG, which only responds to a change in dimensions.
      let smallest = fullQuality;
      if (fullQuality.type !== "image/png") {
        smallest = await encode(canvas, fullQuality.type, .82);
        if (smallest.size <= maximum) {
          let best = smallest;
          let low = 83, high = 99;
          while (low <= high) {
            const quality = Math.floor((low + high) / 2);
            const candidate = await encode(canvas, fullQuality.type, quality / 100);
            if (candidate.size <= maximum) {
              best = candidate;
              low = quality + 1;
            } else high = quality - 1;
          }
          return { blob: best, width: canvas.width, height: canvas.height };
        }
      }

      if (canvas.width === 1 && canvas.height === 1) throw new Error("指定の容量まで圧縮できませんでした。");
      const scale = Math.max(.1, Math.min(.96, Math.sqrt(maximum / smallest.size) * .98));
      resized.width = Math.max(1, Math.floor(canvas.width * scale));
      resized.height = Math.max(1, Math.floor(canvas.height * scale));
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, resized.width, resized.height);
      canvas = resized;
    }
  } finally {
    resized.width = resized.height = 0;
  }
}
