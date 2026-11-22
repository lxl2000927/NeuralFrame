export function coverTint(image: HTMLImageElement): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 12;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, 12, 12);
    const { data } = context.getImageData(0, 0, 12, 12);
    const bins = new Map<number, { weight: number; r: number; g: number; b: number }>();
    let dominant: ReturnType<typeof bins.get>;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, alpha] = data.subarray(i, i + 4);
      if (alpha < 96) continue;
      const x = (i / 4) % 12, y = Math.floor(i / 48);
      const weight = alpha * (x < 2 || x > 9 || y < 2 || y > 9 ? 2 : 1);
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      const bin = bins.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
      bin.weight += weight;
      bin.r += r * weight;
      bin.g += g * weight;
      bin.b += b * weight;
      bins.set(key, bin);
      if (!dominant || bin.weight > dominant.weight) dominant = bin;
    }
    if (!dominant) return;
    const { r, g, b, weight } = dominant;
    return `rgb(${Math.round(r / weight)} ${Math.round(g / weight)} ${Math.round(b / weight)})`;
  } catch {
    return undefined;
  }
}
