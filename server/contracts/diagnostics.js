// Contract for POST /api/diagnostics/metrickit — the iOS app's crash and
// performance reports (issue #170, docs/IOS_PRIVACY_LABEL.md).
//
// The app subscribes to Apple's MetricKit, which hands it a JSON report about
// once a day (MXMetricPayload: launch times, hangs, memory, energy) and after a
// crash, hang or resource exception (MXDiagnosticPayload: call stacks). The app
// queues each report on the device and uploads it here, best effort. This is
// the whole of the app's crash reporting: no third-party SDK (ADR 0008).
//
// Not linked to anyone, on purpose — the privacy label declares diagnostics as
// "not linked to the user". The route takes no session (it ignores an
// Authorization header rather than reading it) and stores no account, IP
// address or device identifier: only the report, the app and OS versions the
// app states, and when it arrived. What bounds abuse instead is the body size
// limit, a per-sender and a server-wide rate limit, and retention — see
// server/routes/diagnostics.js and server/lib/metricKit.js.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');

// A diagnostic report with a deep call stack runs to tens of KB; a daily metric
// report is a few KB. The app skips (never retries) anything larger.
const MAX_METRICKIT_BYTES = 256 * 1024;

// Without the `i` flag so the pattern survives into openapi.json intact (as in
// ./sync.js); Swift's UUID().uuidString is upper case.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const Label = (name, max) => z
  .string({ error: `${name} must be a string` })
  .trim()
  .min(1, { error: `${name} must not be empty` })
  .max(max, { error: `${name} must be at most ${max} characters` });

const MetricKitUploadRequest = z
  .object({
    id: z.string({ error: 'id must be a UUID' }).regex(UUID_RE, { error: 'id must be a UUID' }).meta({
      description: 'Minted on the device for this report; a resend with the same id is stored once. '
        + 'Mint a fresh one per report — never reuse one as a device or install identifier.',
    }),
    kind: z.enum(['metric', 'diagnostic'], { error: 'kind must be metric or diagnostic' }).meta({
      description: 'metric: an MXMetricPayload. diagnostic: an MXDiagnosticPayload.',
    }),
    app_version: Label('app_version', 32).meta({ description: 'The app version and build, e.g. "1.0 (42)".' }),
    os_version: Label('os_version', 64).meta({ description: 'The OS version, e.g. "Version 18.6 (Build 22G86)".' }),
    payload: z
      .record(z.string(), z.unknown(), { error: 'payload must be an object' })
      .meta({ description: "The payload's jsonRepresentation(), as MetricKit produced it." }),
  })
  .meta({
    id: 'MetricKitUploadRequest',
    description: `One MetricKit report. The whole request body is at most ${MAX_METRICKIT_BYTES / 1024} KB.`,
  });

const MetricKitUploadResponse = z
  .object({
    accepted: z.boolean().meta({ description: 'Always true on 202: the device may delete its copy.' }),
  })
  .meta({ id: 'MetricKitUploadResponse' });

const routes = [
  defineRoute({
    method: 'post',
    path: '/api/diagnostics/metrickit',
    operationId: 'uploadMetricKitPayload',
    summary: 'Upload one MetricKit crash or performance report. No session needed; nothing links it to an account.',
    tags: ['diagnostics'],
    body: MetricKitUploadRequest,
    responses: {
      202: { description: 'Stored (or already stored under this id). Delete the report from the device.', schema: MetricKitUploadResponse },
      // 400 and 413 will never be accepted, so the app drops the report; 429
      // means try again later.
      ...errors(400, 413, 429),
    },
  }),
];

module.exports = { routes, MAX_METRICKIT_BYTES, MetricKitUploadRequest, MetricKitUploadResponse };
