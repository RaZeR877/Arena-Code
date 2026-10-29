'use strict';
const { retry } = require('./retry');
async function fetchJson(fetcher, url, options = {}) {
  const response = await fetcher(url, options.fetchOptions);
  if (!response || !response.ok) throw new Error(`Request failed${response ? ` with HTTP ${response.status}` : ''}`);
  return response.json();
}
module.exports = { fetchJson };
