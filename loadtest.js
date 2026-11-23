// loadtest.js
// Simple load test: 20 users at once for 10 seconds
const autocannon = require('autocannon');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PAGES = ['/', '/events', '/about', '/health'];

async function run(path) {
  const result = await autocannon({
    url: BASE + path,
    connections: 20,
    duration: 10,
  });

  const failed = result.errors + result.timeouts + result.non2xx;
  console.log(`\n${path}`);
  console.log('  requests:', result.requests.total);
  console.log('  requests/sec (avg):', result.requests.average);
  console.log('  latency avg (ms):', result.latency.average);
  console.log('  latency p99 (ms):', result.latency.p99);
  console.log('  failed (errors + timeouts + non-2xx):', failed);
}

(async () => {
  console.log('Testing', BASE);
  for (const page of PAGES) {
    await run(page);
  }
})();