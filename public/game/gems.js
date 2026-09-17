export function getGemFrameForValue(value, gemValueToFrame) {
  const v = Math.max(1, Math.floor(Number(value) || 1));
  if (v >= 100) return gemValueToFrame[100];
  if (v >= 50) return gemValueToFrame[50];
  if (v >= 10) return gemValueToFrame[10];
  if (v >= 5) return gemValueToFrame[5];
  return gemValueToFrame[1];
}

export function getGemDrawSizeForValue(value, zoom, tileSize = 32) {
  const v = Math.max(1, Math.floor(Number(value) || 1));
  // ratios preserve the original look tuned for a 32px tile
  let ratio = 0.375;
  if (v >= 100) {
    ratio = 0.5;
  } else if (v >= 50) {
    ratio = 0.46875;
  } else if (v >= 10) {
    ratio = 0.4375;
  } else if (v >= 5) {
    ratio = 0.40625;
  }

  return Math.max(8, ratio * tileSize * zoom);
}
