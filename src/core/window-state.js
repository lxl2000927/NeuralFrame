'use strict';
function restoreBounds(saved, displays, primary) {
  if (!saved || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(saved[k]))) return null;
  const overlap = area => Math.max(0, Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x)) * Math.max(0, Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y));
  const areas = displays.map(d => d.workArea);
  const best = areas.reduce((a, b) => overlap(b) > overlap(a) ? b : a, primary.workArea);
  const area = overlap(best) > 2500 ? best : primary.workArea;
  const width = Math.min(area.width, Math.max(960, Math.round(saved.width)));
  const height = Math.min(area.height, Math.max(640, Math.round(saved.height)));
  return {
    width, height,
    x: Math.round(Math.max(area.x, Math.min(saved.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(saved.y, area.y + area.height - height))),
    maximized: saved.maximized === true
  };
}
module.exports = { restoreBounds };
