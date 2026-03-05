export function getGemFrameForValue(value, gemValueToFrame) {
  const v = Math.max(1, Math.floor(Number(value) || 1));
  if (v >= 100) return gemValueToFrame[100];
  if (v >= 50) return gemValueToFrame[50];
  if (v >= 10) return gemValueToFrame[10];
  if (v >= 5) return gemValueToFrame[5];
  return gemValueToFrame[1];
}

export function getGemDrawSizeForValue(value, zoom) {
  const v = Math.max(1, Math.floor(Number(value) || 1));
  let baseSize = 12;
  if (v >= 100) {
    baseSize = 16;
  } else if (v >= 50) {
    baseSize = 15;
  } else if (v >= 10) {
    baseSize = 14;
  } else if (v >= 5) {
    baseSize = 13;
  }

  return Math.max(8, baseSize * zoom);
}
