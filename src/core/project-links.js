'use strict';

// Only these destinations may be opened by the renderer, never arbitrary URLs.
const links = Object.freeze({
  github: 'https://github.com/lxl2000927/NeuralFrame',
  releases: 'https://github.com/lxl2000927/NeuralFrame/releases/latest',
  coffee: 'https://github.com/lxl2000927/NeuralFrame'
});
function projectUrl(key) {
  return typeof key === 'string' && Object.hasOwn(links, key) ? links[key] : null;
}
module.exports = { links, projectUrl };
