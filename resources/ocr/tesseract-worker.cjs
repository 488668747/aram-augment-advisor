'use strict';

const { getEnvironmentData } = require('node:worker_threads');

// The upstream Node adapter captures global fetch on import. Block its network
// branch as well as using an explicit local langPath; no CDN fallback is allowed.
globalThis.fetch = async () => { throw new Error('OCR network access is disabled'); };
require(getEnvironmentData('aram-advisor:ocr-worker'));
