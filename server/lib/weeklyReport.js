const { and, asc, eq, inArray, isNotNull, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { buildAnalytics } = require('./analytics');
const { sendEmail } = require('./email');
const { PAID_PLANS } = require('./entitlements');
const { toLocalIsoDay } = require('./localTime');

const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

// --- Brand tokens (the "dragon's keep" identity: parchment + emerald + gold) ---
const C = {
  parchment: '#FBF6E9',
  page: '#F1E8CF',      // slightly deeper edge behind the card
  pine: '#123D2A',      // header band + display ink
  meadow: '#2F8F5B',    // emerald accent / active bars
  meadowSoft: '#DCEBE0',// bar tracks, avatar backing
  gold: '#E6A32E',      // treasure / mastery fill
  coral: '#EE6C4D',     // the single action color
  coralEdge: '#C9553C', // button depth
  bark: '#4A4038',      // body text
  barkSoft: '#7C7266',  // secondary text
  cardEdge: '#EBDFC2',  // hairline on parchment
};
const DISPLAY = "'Trebuchet MS','Segoe UI',Tahoma,Geneva,sans-serif";
const BODY = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Full words for parents (recognizable) with the symbol kept as a small crest.
const OP_META = {
  add: { symbol: '+', label: 'Addition' },
  sub: { symbol: '−', label: 'Subtraction' },
  mul: { symbol: '×', label: 'Multiplication' },
  div: { symbol: '÷', label: 'Division' },
};
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

function titleCase(s) {
  return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
}

// An encouraging rank derived from real accuracy — the label carries information,
// it isn't decoration. Wholesome, on-theme (no dark/occult).
function riderRank(accuracy) {
  if (accuracy == null) return 'Just getting started';
  if (accuracy < 60) return 'Brave beginner';
  if (accuracy < 80) return 'Rising rider';
  if (accuracy < 95) return 'Dragon tamer';
  return 'Dragon master';
}

// child.avatar is a stored path like "/avatars/avie_rain.png" — render it as a
// real round token. Fall back to an emoji (or the dragon) when it isn't a path.
function renderAvatarCell(child) {
  const a = child.avatar || '';
  const isImg = /^https?:\/\//.test(a) || a.startsWith('/');
  const ring = `border:3px solid ${C.gold};border-radius:50%;background:${C.meadowSoft};`;
  if (isImg) {
    const src = /^https?:\/\//.test(a) ? a : `${APP_PUBLIC_URL}${a}`;
    return `<img src="${escapeHtml(src)}" width="56" height="56" alt=""
      style="display:block;width:56px;height:56px;object-fit:cover;${ring}" />`;
  }
  return `<div style="width:56px;height:56px;line-height:56px;text-align:center;font-size:30px;${ring}">${escapeHtml(a || '🐉')}</div>`;
}

// A small flat stat pill. inline-block so a row of them wraps on narrow screens.
function statChip(value, label) {
  return `<span style="display:inline-block;vertical-align:top;margin:0 6px 8px 0;padding:9px 13px;background:#ffffff;border:1px solid ${C.cardEdge};border-radius:12px;">
    <span style="display:block;font-family:${DISPLAY};font-size:19px;font-weight:700;line-height:1;color:${C.pine};">${escapeHtml(String(value))}</span>
    <span style="display:block;margin-top:4px;font-family:${BODY};font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:${C.barkSoft};">${escapeHtml(label)}</span>
  </span>`;
}

// One "Mastery" row: operation crest · gold fill bar on emerald track · % + count.
function masteryRow(op) {
  const meta = OP_META[op.operator] || { symbol: '•', label: op.operator };
  const acc = op.total ? Math.round((op.child_wins / op.total) * 100) : 0;
  const fill = acc > 0
    ? `<table role="presentation" width="${acc}%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:12px;line-height:12px;font-size:0;background:${C.gold};border-radius:7px;">&nbsp;</td></tr></table>`
    : '';
  return `<tr>
    <td valign="middle" style="padding:6px 0;font-family:${BODY};font-size:13px;color:${C.bark};white-space:nowrap;">
      <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:${C.pine};color:#ffffff;border-radius:6px;font-family:${DISPLAY};font-weight:700;font-size:14px;">${meta.symbol}</span>
      <span style="padding-left:9px;">${escapeHtml(meta.label)}</span>
    </td>
    <td valign="middle" style="padding:6px 0 6px 12px;width:100%;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.meadowSoft};border-radius:7px;"><tr><td style="height:12px;line-height:12px;font-size:0;">${fill}</td></tr></table>
    </td>
    <td valign="middle" style="padding:6px 0 6px 10px;text-align:right;white-space:nowrap;font-family:${DISPLAY};font-size:14px;font-weight:700;color:${C.pine};">${acc}%<span style="font-family:${BODY};font-weight:400;font-size:11px;color:${C.barkSoft};"> · ${op.total}</span></td>
  </tr>`;
}

// A quiet 7-day play strip built from the real by_day minutes — days with play
// stand up in emerald; quiet days are faint stubs.
function weekStrip(byDay) {
  const days = (byDay || []).slice(-7);
  if (!days.length) return '';
  const max = Math.max(1, ...days.map(d => d.minutes || 0));
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const cells = days.map((d) => {
    const m = d.minutes || 0;
    const h = m > 0 ? Math.max(6, Math.round((m / max) * 34)) : 3;
    const dow = new Date(`${d.day}T00:00:00Z`).getUTCDay();
    const color = m > 0 ? C.meadow : '#E6DBBF';
    return `<td valign="bottom" align="center" style="padding:0 3px;">
      <div style="width:16px;height:${h}px;background:${color};border-radius:4px 4px 0 0;"></div>
      <div style="margin-top:6px;font-family:${BODY};font-size:9px;color:${C.barkSoft};">${DOW[dow]}</div>
    </td>`;
  }).join('');
  return `<div style="margin-top:20px;">
    <div style="font-family:${BODY};font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${C.barkSoft};margin-bottom:8px;">This week</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>
  </div>`;
}

// The Monday–Sunday week before `now`, as inclusive local 'YYYY-MM-DD' strings.
//
// Computed on the LOCAL clock, because these strings are used two ways that have
// to agree: they are printed in the email, and they are handed to buildAnalytics
// as a calendar range that resolves against play_minutes (local-time text) and
// created_at. A UTC-derived week interpreted as local days is a week the data was
// never keyed on.
//
// The old UTC version happened to produce the same strings in production — the
// cron fires 13:00 Monday and America/New_York is UTC-4, so the UTC date is still
// Monday — but it was one schedule change away from being a day out, and the two
// environments don't share a timezone (prod America/New_York, test UTC).
function lastCompletedWeek(now) {
  const d = new Date(now);
  const day = d.getDay(); // 0=Sun..6=Sat, local
  // Days to subtract to reach the most recent Sunday (end of the prior week).
  const daysToLastSunday = day === 0 ? 7 : day;
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysToLastSunday);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { period_start: toLocalIsoDay(start), period_end: toLocalIsoDay(end) };
}

function renderChildBlock(child, stats) {
  const total = stats.summary?.total || 0;
  const wins = stats.summary?.child_wins || 0;
  const accuracy = total ? Math.round((wins / total) * 100) : null;
  const avgSec = stats.summary?.avg_child_ms ? (stats.summary.avg_child_ms / 1000).toFixed(1) : null;
  const minutes = stats.playtime?.minutes_in_window || 0;
  const name = titleCase(child.username);

  const cardOpen = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;background:#ffffff;border:1px solid ${C.cardEdge};border-radius:16px;">
    <tr><td style="padding:20px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="56" valign="top" style="width:56px;">${renderAvatarCell(child)}</td>
        <td valign="middle" style="padding-left:14px;">
          <div style="font-family:${DISPLAY};font-size:20px;font-weight:700;color:${C.pine};line-height:1.1;">${escapeHtml(name)}</div>
          <div style="font-family:${BODY};font-size:12px;color:${C.meadow};font-weight:600;margin-top:3px;">${escapeHtml(riderRank(accuracy))}</div>
        </td>
      </tr></table>`;

  // Quiet week: an invitation to play, not a dead end.
  if (total === 0 && minutes === 0) {
    return `${cardOpen}
      <div style="margin-top:16px;font-family:${BODY};font-size:14px;color:${C.barkSoft};line-height:1.5;">The keep was quiet this week — no quests yet. The dragons are waiting whenever ${escapeHtml(name)} is ready to ride back in.</div>
    </td></tr></table>`;
  }

  const chips = [
    statChip(minutes, 'Minutes'),
    statChip(total, 'Problems'),
    statChip(accuracy != null ? `${accuracy}%` : '—', 'Accuracy'),
    avgSec ? statChip(`${avgSec}s`, 'Pace') : '',
  ].join('');

  const ops = (stats.byOperator || []).filter(o => o.total > 0);
  const mastery = ops.length
    ? `<div style="margin-top:20px;">
        <div style="font-family:${BODY};font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${C.barkSoft};margin-bottom:4px;">Mastery</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${ops.map(masteryRow).join('')}</table>
      </div>`
    : '';

  const hardest = (stats.hardProblems || [])[0];
  const hardestMeta = hardest ? (OP_META[hardest.operator] || { symbol: '•' }) : null;
  const hardestBox = hardest
    ? `<div style="margin-top:18px;padding:12px 14px;background:${C.parchment};border:1px solid ${C.cardEdge};border-left:4px solid ${C.coral};border-radius:10px;">
        <span style="font-family:${BODY};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.coral};font-weight:700;">Toughest foe</span>
        <div style="font-family:${DISPLAY};font-size:16px;font-weight:700;color:${C.pine};margin-top:4px;">${hardest.operand_a} ${hardestMeta.symbol} ${hardest.operand_b} = ${hardest.answer}</div>
        <div style="font-family:${BODY};font-size:12px;color:${C.barkSoft};margin-top:2px;">tripped up ${hardest.ai_wins} of ${hardest.total} tries</div>
      </div>`
    : '';

  return `${cardOpen}
      <div style="margin-top:16px;">${chips}</div>
      ${weekStrip(stats.playtime?.by_day)}
      ${mastery}
      ${hardestBox}
    </td></tr></table>`;
}

function renderWeeklyReportHtml({ children, childStats, period }) {
  const blocks = children.map(c => renderChildBlock(c, childStats[c.id])).join('\n');
  const soloName = children.length === 1 ? titleCase(children[0].username) : null;
  const intro = soloName
    ? `Here's how <strong style="color:${C.pine};">${escapeHtml(soloName)}</strong> fared in the keep this week.`
    : `Here's how your dragon-riders fared in the keep this week.`;

  // Hidden preview line shown in the inbox list before the email is opened.
  const first = children[0] && childStats[children[0].id];
  const fTotal = first?.summary?.total || 0;
  const fAcc = fTotal ? Math.round((first.summary.child_wins / fTotal) * 100) : null;
  const preheader = soloName && fTotal
    ? `${soloName}: ${first.playtime?.minutes_in_window || 0} min · ${fTotal} problems · ${fAcc}% correct`
    : `Your weekly quest log from the dragon's keep.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>My Dragon Math — Week in review</title>
<style>
  @media only screen and (max-width:600px){
    .shell{width:100% !important;}
    .pad{padding-left:16px !important;padding-right:16px !important;}
    .band{padding-left:20px !important;padding-right:20px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${C.parchment};border-radius:22px;overflow:hidden;border:1px solid ${C.cardEdge};">

        <!-- Header band: the dragon's keep -->
        <tr><td class="band" style="background:${C.pine};padding:26px 34px 22px;">
          <div style="font-family:${DISPLAY};font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:${C.gold};font-weight:700;">🐉 My Dragon Math</div>
          <div style="font-family:${DISPLAY};font-size:27px;font-weight:700;color:#ffffff;margin-top:8px;line-height:1.05;">Week in review</div>
          <div style="font-family:${BODY};font-size:13px;color:#A9C7B4;margin-top:6px;">${escapeHtml(period.period_start)} &nbsp;→&nbsp; ${escapeHtml(period.period_end)}</div>
        </td></tr>
        <tr><td style="height:4px;background:${C.gold};font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td class="pad" style="padding:24px 34px 8px;">
          <p style="margin:0;font-family:${BODY};font-size:15px;line-height:1.5;color:${C.bark};">${intro}</p>
        </td></tr>
        <tr><td class="pad" style="padding:0 34px;">
          ${blocks || `<p style="font-family:${BODY};color:${C.barkSoft};">No play this week.</p>`}
        </td></tr>

        <!-- CTA -->
        <tr><td class="pad" style="padding:14px 34px 30px;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:12px;background:${C.coral};border-bottom:3px solid ${C.coralEdge};">
            <a href="${escapeHtml(APP_PUBLIC_URL)}/parent" style="display:inline-block;padding:13px 26px;font-family:${DISPLAY};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Open the dashboard →</a>
          </td></tr></table>
        </td></tr>

        <!-- Footer -->
        <tr><td class="band" style="background:${C.pine};padding:18px 34px;">
          <p style="margin:0;font-family:${BODY};font-size:11px;line-height:1.5;color:#8FB09C;text-align:center;">
            You're getting this because weekly reports are on for your account.<br />
            Turn them off any time on the <a href="${escapeHtml(APP_PUBLIC_URL)}/parent" style="color:${C.gold};text-decoration:underline;">dashboard</a>.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function runWeeklyReports(now = new Date()) {
  const period = lastCompletedWeek(now);
  // The window is the period this email NAMES — in the subject line, the header
  // and the log row — not "the last 7 days". Those are different spans: asking
  // for `days: 7` at the Monday 13:00 send time dropped the reported Monday
  // before 13:00 and counted the current Monday morning in its place, so the
  // dates a parent read and the numbers beside them described different weeks.
  const reportRange = { start_day: period.period_start, end_day: period.period_end };

  const parents = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(and(
      eq(schema.users.accountType, 'parent'),
      eq(schema.users.weeklyReportEnabled, true),
      isNotNull(schema.users.email),
      // Weekly digest is a paid feature — free accounts are never selected.
      inArray(schema.users.plan, PAID_PLANS),
    ));

  const results = [];
  for (const parent of parents) {
    const existing = await db
      .select({ id: schema.weeklyReportLog.id })
      .from(schema.weeklyReportLog)
      .where(and(
        eq(schema.weeklyReportLog.parentId, parent.id),
        eq(schema.weeklyReportLog.periodStart, period.period_start),
      ))
      .limit(1);
    if (existing.length > 0) {
      results.push({ parent_id: parent.id, status: 'already_sent' });
      continue;
    }

    const children = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        avatar: schema.users.avatar,
      })
      .from(schema.parentChildLinks)
      .innerJoin(schema.users, eq(schema.users.id, schema.parentChildLinks.childId))
      .where(eq(schema.parentChildLinks.parentId, parent.id))
      .orderBy(asc(schema.users.username));

    if (children.length === 0) {
      await db.insert(schema.weeklyReportLog).values({
        parentId: parent.id,
        periodStart: period.period_start,
        periodEnd: period.period_end,
        status: 'skipped_no_kids',
      });
      results.push({ parent_id: parent.id, status: 'skipped_no_kids' });
      continue;
    }

    const childStats = {};
    for (const c of children) {
      childStats[c.id] = await buildAnalytics(c.id, { range: reportRange });
    }
    const html = renderWeeklyReportHtml({ parent, children, childStats, period });
    const subject = `My Dragon Math · ${period.period_start} → ${period.period_end}`;

    try {
      const sendResult = await sendEmail({ to: parent.email, subject, html });
      // The dev stub prints to stdout without delivering; record it distinctly
      // so the log never overstates real delivery.
      const status = sendResult?.stubbed ? 'stubbed' : 'sent';
      await db.insert(schema.weeklyReportLog).values({
        parentId: parent.id,
        periodStart: period.period_start,
        periodEnd: period.period_end,
        sentAt: status === 'sent' ? sql`now()` : null,
        status,
      });
      results.push({ parent_id: parent.id, status });
    } catch (err) {
      await db.insert(schema.weeklyReportLog).values({
        parentId: parent.id,
        periodStart: period.period_start,
        periodEnd: period.period_end,
        status: 'failed',
        error: err.message,
      });
      results.push({ parent_id: parent.id, status: 'failed', error: err.message });
    }
  }

  return { period, results };
}

module.exports = { runWeeklyReports, renderWeeklyReportHtml, lastCompletedWeek };
