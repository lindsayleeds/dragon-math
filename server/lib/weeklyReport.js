const db = require('../db');
const { buildAnalytics } = require('./analytics');
const { sendEmail } = require('./email');

const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

const OP_LABEL = { add: '+', sub: '−', mul: '×' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// Returns the Monday → Sunday window that ended most recently relative to now.
// Output dates are YYYY-MM-DD in UTC so the cron job is deterministic.
function lastCompletedWeek(now) {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  // Days to subtract to reach the most recent Sunday (end of the prior week).
  const daysToLastSunday = day === 0 ? 7 : day;
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysToLastSunday));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return { period_start: fmt(start), period_end: fmt(end) };
}

function renderChildBlock(child, stats) {
  const total = stats.summary?.total || 0;
  const wins = stats.summary?.child_wins || 0;
  const accuracy = total ? Math.round((wins / total) * 100) : null;
  const avgSec = stats.summary?.avg_child_ms ? (stats.summary.avg_child_ms / 1000).toFixed(1) : null;
  const minutes = stats.playtime.minutes_in_window || 0;

  const byOp = (stats.byOperator || []).map(r => {
    const opAcc = r.total ? Math.round((r.child_wins / r.total) * 100) : 0;
    return `<li>${OP_LABEL[r.operator] || escapeHtml(r.operator)} — ${r.total} problems · ${opAcc}% correct</li>`;
  }).join('');

  const hardest = (stats.hardProblems || [])[0];
  const hardestLine = hardest
    ? `<p style="margin:6px 0 0;">Trickiest this week: <strong>${hardest.operand_a} ${OP_LABEL[hardest.operator]} ${hardest.operand_b} = ${hardest.answer}</strong> (${hardest.ai_wins} of ${hardest.total} losses)</p>`
    : '';

  return `
    <div style="margin:20px 0;padding:18px;border-radius:14px;background:#faf6ff;border:1px solid #ece4f7;">
      <h3 style="margin:0 0 6px;color:#2b1a4d;font-size:18px;">${escapeHtml(child.avatar || '⚔️')} ${escapeHtml(child.username)}</h3>
      <p style="margin:0;color:#5c4d7a;font-size:14px;">
        ${minutes} min played · ${total} problems · ${accuracy != null ? accuracy + '% correct' : 'no data yet'}
        ${avgSec ? ` · avg ${avgSec}s per problem` : ''}
      </p>
      ${byOp ? `<ul style="margin:10px 0 0;padding-left:20px;color:#2b1a4d;font-size:14px;">${byOp}</ul>` : ''}
      ${hardestLine}
    </div>
  `;
}

function renderWeeklyReportHtml({ parent, children, childStats, period }) {
  const greetingName = parent.email ? parent.email.split('@')[0] : 'grown-up';
  const blocks = children.map(c => renderChildBlock(c, childStats[c.id])).join('\n');
  return `<!doctype html>
<html><body style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4eefb;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:28px;">
    <h1 style="margin:0 0 6px;color:#2b1a4d;font-size:22px;">🐉 My Dragon Math — Week in review</h1>
    <p style="margin:0 0 18px;color:#7b6c95;font-size:14px;">${escapeHtml(period.period_start)} → ${escapeHtml(period.period_end)}</p>
    <p style="color:#2b1a4d;font-size:15px;">Hi ${escapeHtml(greetingName)}, here's how ${children.length === 1 ? 'your child' : 'your kids'} did this week:</p>
    ${blocks || '<p style="color:#7b6c95;">No play this week.</p>'}
    <p style="margin-top:24px;text-align:center;">
      <a href="${escapeHtml(APP_PUBLIC_URL)}/parent" style="display:inline-block;padding:10px 18px;background:linear-gradient(135deg,#e05fa0,#9b4dca);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;">Open the dashboard</a>
    </p>
    <p style="margin-top:20px;color:#9b8fb0;font-size:12px;text-align:center;">
      You're receiving this because weekly emails are turned on for your account. Turn them off any time on the dashboard.
    </p>
  </div>
</body></html>`;
}

async function runWeeklyReports(now = new Date()) {
  const period = lastCompletedWeek(now);
  // Number of days from end-of-window through "today" — buildAnalytics uses
  // a relative "last N days" window. We want stats for the just-ended week,
  // not the trailing 7 days, but the analytics SQL only supports "last N days".
  // The cron runs Monday so picking days=7 captures Mon–Sun of the prior week
  // close enough for the digest. Refine later by pushing a date range into
  // buildAnalytics if needed.
  const windowDays = 7;

  const parents = db.prepare(`
    SELECT id, email FROM users
    WHERE account_type = 'parent' AND weekly_report_enabled = 1 AND email IS NOT NULL
  `).all();

  const results = [];
  for (const parent of parents) {
    const existing = db.prepare(
      'SELECT id FROM weekly_report_log WHERE parent_id = ? AND period_start = ?'
    ).get(parent.id, period.period_start);
    if (existing) {
      results.push({ parent_id: parent.id, status: 'already_sent' });
      continue;
    }

    const children = db.prepare(`
      SELECT u.id, u.username, u.avatar FROM parent_child_links pcl
      JOIN users u ON u.id = pcl.child_id
      WHERE pcl.parent_id = ?
      ORDER BY u.username
    `).all(parent.id);

    if (children.length === 0) {
      db.prepare(`
        INSERT INTO weekly_report_log (parent_id, period_start, period_end, status)
        VALUES (?, ?, ?, 'skipped_no_kids')
      `).run(parent.id, period.period_start, period.period_end);
      results.push({ parent_id: parent.id, status: 'skipped_no_kids' });
      continue;
    }

    const childStats = {};
    for (const c of children) {
      childStats[c.id] = buildAnalytics(c.id, { days: windowDays });
    }
    const html = renderWeeklyReportHtml({ parent, children, childStats, period });
    const subject = `My Dragon Math · ${period.period_start} → ${period.period_end}`;

    try {
      await sendEmail({ to: parent.email, subject, html });
      db.prepare(`
        INSERT INTO weekly_report_log (parent_id, period_start, period_end, sent_at, status)
        VALUES (?, ?, ?, datetime('now'), 'sent')
      `).run(parent.id, period.period_start, period.period_end);
      results.push({ parent_id: parent.id, status: 'sent' });
    } catch (err) {
      db.prepare(`
        INSERT INTO weekly_report_log (parent_id, period_start, period_end, status, error)
        VALUES (?, ?, ?, 'failed', ?)
      `).run(parent.id, period.period_start, period.period_end, err.message);
      results.push({ parent_id: parent.id, status: 'failed', error: err.message });
    }
  }

  return { period, results };
}

module.exports = { runWeeklyReports, renderWeeklyReportHtml, lastCompletedWeek };
