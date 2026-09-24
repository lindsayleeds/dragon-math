// POST /api/diagnostics/metrickit — MetricKit crash and performance reports
// from the iOS app (issue #170). Contract: server/contracts/diagnostics.js;
// what is stored and for how long: server/lib/metricKit.js.
//
// No session, and the Authorization header is never read: a report must not be
// linkable to an account (the privacy label says diagnostics are not linked),
// and a crash report is most valuable exactly when sign-in is what broke.
// Being open, it holds its own abuse limits:
//   - its own JSON parser capped at MAX_METRICKIT_BYTES (the global parser
//     skips this path, see server/index.js), answering 413 in JSON so the app
//     knows to drop the report rather than retry it;
//   - a per-sender rate limit keyed on the IP, which is used for the count and
//     never stored with the report;
//   - a server-wide rate limit, so many senders together still can't fill the
//     table faster than a fixed rate;
//   - retention: old reports are swept by every insert.
const express = require('express');
const { db } = require('../db');
const { rateLimit } = require('../lib/rateLimit');
const { parseInput } = require('../lib/parseInput');
const { storeMetricKitPayload, PayloadTooDeepError } = require('../lib/metricKit');
const { MetricKitUploadRequest, MAX_METRICKIT_BYTES } = require('../contracts/diagnostics');

const router = express.Router();

router.post('/metrickit', express.json({ limit: MAX_METRICKIT_BYTES }), async (req, res) => {
  const ip = req.ip || 'unknown';
  // A device sends about one metric report a day plus one per crash, so this
  // is room for a household of devices catching up, not a real-use ceiling.
  const sender = await rateLimit({ key: `metrickit:${ip}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!sender.allowed) return res.status(429).json({ error: 'Too many reports. Try again later.' });
  const everyone = await rateLimit({ key: `metrickit-all:global`, limit: 5000, windowMs: 60 * 60 * 1000 });
  if (!everyone.allowed) return res.status(429).json({ error: 'Too many reports. Try again later.' });

  const input = parseInput(MetricKitUploadRequest, req.body);
  if (!input.ok) return res.status(400).json({ error: input.error });

  try {
    await storeMetricKitPayload(db, input.data);
  } catch (err) {
    if (err instanceof PayloadTooDeepError) return res.status(400).json({ error: err.message });
    throw err;
  }
  res.status(202).json({ accepted: true });
});

// The body parser's failures, as the contract's JSON errors instead of
// Express's HTML page.
router.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: `A report may be at most ${MAX_METRICKIT_BYTES / 1024} KB` });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The body is not valid JSON' });
  next(err);
});

module.exports = router;
