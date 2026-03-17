const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = 420;

export function getCanvasRenderMetrics({
  clientWidth,
  clientHeight,
  devicePixelRatio = 1
}) {
  const safeWidth = Math.max(1, Number(clientWidth) || LOGICAL_WIDTH);
  const safeHeight = Math.max(1, Number(clientHeight) || LOGICAL_HEIGHT);
  const safeRatio = Math.max(1, Number(devicePixelRatio) || 1);

  return {
    logicalWidth: LOGICAL_WIDTH,
    logicalHeight: LOGICAL_HEIGHT,
    pixelWidth: Math.max(1, Math.round(safeWidth * safeRatio)),
    pixelHeight: Math.max(1, Math.round(safeHeight * safeRatio)),
    scaleX: safeWidth / LOGICAL_WIDTH,
    scaleY: safeHeight / LOGICAL_HEIGHT
  };
}
