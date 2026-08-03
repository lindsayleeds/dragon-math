// The shared one-action transactional email card: dragon crest, heading, a line
// of body copy, a big button, and the raw link as a fallback (some mail clients
// strip buttons).
//
// Extracted from authEmails.js when billing emails became a second consumer —
// three copies of this palette was one too many. The weekly digest
// (server/lib/weeklyReport.js) deliberately does NOT use this: it is a
// multi-section per-child layout, not a single action, so it keeps its own
// rendering and its own copy of the palette.

const C = {
  parchment: '#FBF6E9',
  page: '#F1E8CF',
  pine: '#123D2A',
  coral: '#EE6C4D',
  coralEdge: '#C9553C',
  bark: '#4A4038',
  barkSoft: '#7C7266',
  cardEdge: '#EBDFC2',
};
const DISPLAY = "'Trebuchet MS','Segoe UI',Tahoma,Geneva,sans-serif";
const BODY = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// `body` and `footnote` are interpolated as HTML so callers can bold a date or
// an amount — callers are responsible for escaping anything user-supplied.
// `heading` and `buttonLabel` are escaped here.
function renderShell({ heading, body, buttonLabel, url, footnote }) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:${C.parchment};border:1px solid ${C.cardEdge};border-radius:18px;overflow:hidden;">
        <tr><td style="background:${C.pine};padding:22px 28px;text-align:center;">
          <span style="font-family:${DISPLAY};font-size:22px;font-weight:700;color:#ffffff;">🐉 My Dragon Math</span>
        </td></tr>
        <tr><td style="padding:30px 30px 8px;">
          <h1 style="margin:0 0 12px;font-family:${DISPLAY};font-size:22px;color:${C.pine};">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 22px;font-family:${BODY};font-size:15px;line-height:1.5;color:${C.bark};">${body}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px;">
            <tr><td style="border-radius:12px;background:${C.coral};border-bottom:3px solid ${C.coralEdge};">
              <a href="${safeUrl}" style="display:inline-block;padding:13px 30px;font-family:${DISPLAY};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(buttonLabel)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-family:${BODY};font-size:12px;color:${C.barkSoft};">Or paste this link into your browser:</p>
          <p style="margin:0 0 22px;font-family:${BODY};font-size:12px;word-break:break-all;"><a href="${safeUrl}" style="color:${C.coralEdge};">${safeUrl}</a></p>
          <p style="margin:0;font-family:${BODY};font-size:12px;line-height:1.5;color:${C.barkSoft};">${footnote}</p>
        </td></tr>
        <tr><td style="padding:18px 30px 26px;text-align:center;">
          <span style="font-family:${BODY};font-size:11px;color:${C.barkSoft};">My Dragon Math · a cozy place to grow math confidence</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

module.exports = { renderShell, escapeHtml, C, DISPLAY, BODY };
