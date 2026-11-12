'use strict';
/**
 * Shared Overpass API client for the data scripts: POSTs a query, rotates between public mirrors, retries with
 * back-off, and rejects "server busy" HTML pages / partial results. Data (c) OpenStreetMap contributors, ODbL.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = 'pubta-data-builder/1.0 (open-source commuter planner)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(4 * 60 * 1000),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (text.trimStart().startsWith('<')) throw new Error('non-JSON response (server busy)');
        const json = JSON.parse(text);
        if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error('overpass remark: ' + json.remark.slice(0, 100));
        return json;
      } catch (e) {
        lastErr = e;
        console.warn(`  [${label}] ${new URL(ep).host}: ${e.message}`);
      }
    }
    const wait = Math.min(60000, 8000 * (attempt + 1));
    console.warn(`  [${label}] all mirrors failed, waiting ${wait / 1000}s`);
    await sleep(wait);
  }
  throw lastErr;
}

module.exports = { overpass, sleep, ENDPOINTS, UA };
