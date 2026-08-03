// Billing lifecycle emails: the trial-ending warning and failed-payment
// (dunning) notice. Both are sent from the Stripe webhook
// (server/routes/billing.js).
//
// The trial-ending one is not a courtesy. Checkout collects a card up front and
// auto-charges when the 14-day trial ends, so without this email the first time a
// parent learns they are being billed is the charge itself — which for a kids'
// product is how you earn chargebacks. Stripe fires
// `customer.subscription.trial_will_end` three days out; that is the window this
// email exists to use.

const { sendEmail } = require('./email');
const { renderShell, escapeHtml } = require('./emailShell');

const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

const PLAN_LABEL = { premium: 'Premium', classroom: 'Classroom' };

// Render a date for a parent to read. Deliberately date-only and in the server's
// timezone: an exact timestamp would imply a precision we don't have (Stripe
// charges within a window) and a wrong-by-hours time reads worse than a plain
// date. `null` when we have no date from Stripe, so callers can drop the clause
// rather than print "Invalid Date".
function formatChargeDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// "Your trial ends soon, here's exactly what happens." `amount` is a
// pre-formatted display string (e.g. "$7.99") or null if we couldn't resolve the
// Price; `endsAt` is a Date or null. The copy degrades gracefully in both cases
// because a vaguer warning still beats no warning.
async function sendTrialEndingEmail({ to, plan, amount, interval, endsAt }) {
  const label = PLAN_LABEL[plan] || 'paid';
  const when = formatChargeDate(endsAt);
  const per = interval === 'year' ? 'year' : 'month';

  const priceClause = amount
    ? `your card will be charged <strong>${escapeHtml(amount)}</strong> for ${escapeHtml(label)} (per ${per})`
    : `your card will be charged for ${escapeHtml(label)}`;
  const whenClause = when ? ` on <strong>${escapeHtml(when)}</strong>` : ' when the trial ends';

  const html = renderShell({
    heading: 'Your free trial ends soon',
    body:
      `Your My Dragon Math free trial is nearly over. Unless you cancel first, ${priceClause}${whenClause}, ` +
      'and your subscription will continue from there. No action is needed if you want to keep going — ' +
      'everything your children have earned stays exactly where it is.',
    buttonLabel: 'Review or cancel',
    url: `${APP_PUBLIC_URL}/parent`,
    footnote:
      'You can cancel any time before that date and you will not be charged — open the dashboard and choose ' +
      '“Manage billing”. Cancelling keeps your account on the Free plan; your children keep their progress.',
  });
  return sendEmail({ to, subject: 'Your My Dragon Math trial ends soon', html });
}

// Dunning. Access is deliberately NOT cut here — Stripe retries for a couple of
// weeks and a family whose card simply expired should not lose the app mid-week.
// That is exactly why this email matters: it is the only signal the parent gets
// that anything is wrong.
async function sendPaymentFailedEmail({ to, amount, nextAttemptAt }) {
  const when = formatChargeDate(nextAttemptAt);
  const amountClause = amount ? ` of <strong>${escapeHtml(amount)}</strong>` : '';
  const retryClause = when
    ? `We'll try again on <strong>${escapeHtml(when)}</strong>.`
    : "We'll try again over the next few days.";

  const html = renderShell({
    heading: "We couldn't process your payment",
    body:
      `Your most recent My Dragon Math payment${amountClause} didn't go through — usually that just means an ` +
      `expired or replaced card. ${retryClause} Your children still have full access in the meantime, so there's ` +
      'nothing for them to notice.',
    buttonLabel: 'Update payment method',
    url: `${APP_PUBLIC_URL}/parent`,
    footnote:
      'Open the dashboard and choose “Manage billing” to update your card. If the payment keeps failing, the ' +
      'subscription will eventually end and the account will return to the Free plan — progress is never deleted.',
  });
  return sendEmail({ to, subject: 'Payment problem on your My Dragon Math account', html });
}

module.exports = { sendTrialEndingEmail, sendPaymentFailedEmail, formatChargeDate };
