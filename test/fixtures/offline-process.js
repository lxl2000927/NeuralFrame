'use strict';

// Legacy installer fixtures supply a full local payload. Keep this opt-out
// scoped to their VM; packaged/on-demand cache tests retain production defaults.
module.exports = () => Object.create(process, {
  env: { value: { ...process.env, DLSS5_LIGHTWEIGHT: '0' } }
});
