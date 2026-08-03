import { Link } from 'react-router-dom';
import { LEGAL_ENTITY } from '../data/legalEntity';
import { LegalPageShell, Fill } from '../components/LegalPageShell';
import styles from '../styles/LegalPage.module.css';

// Privacy policy. The content here is written to match what the code actually
// does — every claim below was checked against the schema and the routes, not
// copied from a template:
//
//   * no child can self-register (server/routes/auth.js, docs/COPPA.md)
//   * kids have no free-text messaging of any kind
//   * the data list mirrors server/db/schema.js
//   * deletion is real: DELETE /api/auth/account and
//     DELETE /api/parent/children/:childId, plus the 30-day orphan sweep in
//     server/lib/orphanCleanup.js
//
// Operator identity and contact details come from src/data/legalEntity.js — one
// file, so an LLC or an address change is a single edit. Anything still unset
// renders a loud [NEEDS: …] marker and keeps the draft banner up (see
// LegalPageShell). GAPS.md 5b tracks the remainder.

export function PrivacyPolicyPage() {
  return (
    <LegalPageShell title="Privacy Policy">
        <p>
          My Dragon Math is a math practice game for children, used by families and by
          schools. This policy explains what we collect, why, who we share it with, and how
          to get it deleted. We have tried to write it in plain language rather than legal
          boilerplate.
        </p>

        <h2>The short version</h2>
        <ul>
          <li>Children cannot create their own accounts. An adult always does it.</li>
          <li>We do not show advertising, and we do not sell or rent personal information.</li>
          <li>We do not use third-party advertising or analytics trackers.</li>
          <li>Children cannot send free-text messages to each other anywhere in the app.</li>
          <li>You can delete your account, or any individual child, at any time.</li>
        </ul>

        <h2>Who we are</h2>
        <p>
          My Dragon Math is operated by <strong>{LEGAL_ENTITY.name}</strong>,{' '}
          {LEGAL_ENTITY.address}. For any privacy question, or to exercise any right
          described here, contact us at{' '}
          <strong><Fill value={LEGAL_ENTITY.privacyEmail} needs="privacy contact email" /></strong>
          {' '}or by telephone at{' '}
          <Fill value={LEGAL_ENTITY.phone} needs="telephone number" />.
        </p>

        <h2>Information we collect</h2>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr><th>Who</th><th>What</th><th>Why</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Parent or teacher</td>
                <td>Email address, password (stored only as a secure hash), or a Google
                    sign-in identifier if you use Google to log in</td>
                <td>To create and secure your account and send account email</td>
              </tr>
              <tr>
                <td>Parent or teacher</td>
                <td>Billing identifiers from our payment processor (a customer and
                    subscription id, plan, and renewal date)</td>
                <td>To run subscriptions. We never see or store your card number.</td>
              </tr>
              <tr>
                <td>Child</td>
                <td>A display handle, an avatar, a font preference, and optionally a real
                    name entered by the adult who set up the account</td>
                <td>So the child can sign in and be identified on their grown-up&rsquo;s roster</td>
              </tr>
              <tr>
                <td>Child</td>
                <td>Learning activity: which problems were answered, whether each was
                    correct, how long answers took, map progress, placement-test results,
                    game scores, medals, collected dragons, and minutes played</td>
                <td>To run the game and to show progress to the child&rsquo;s parent or teacher</td>
              </tr>
              <tr>
                <td>Child</td>
                <td>A permanent sign-in link token, for children whose adult created their
                    account</td>
                <td>So a child can sign in from a link or QR code without a password</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          Guests can try the app with no account at all. A guest session exists only in the
          browser&rsquo;s memory: nothing is written to our servers, and refreshing the page
          ends it.
        </p>

        <h2>Children&rsquo;s privacy (COPPA)</h2>
        <p>
          We designed the account model around the fact that our users are children. No
          child can register themselves — every child account is created by an authenticated
          adult, either a parent (who is automatically linked to that child) or a teacher or
          school administrator acting under the school&rsquo;s authority.
        </p>
        <p>
          We collect from children only what the game needs to work and to report progress
          to their own adult. We do not ask children for an email address, a phone number, a
          photo, a birthdate, or a location. There is no free-text messaging between
          children anywhere in the app. Handles that a child chooses for themselves are
          screened for inappropriate content.
        </p>
        <p>
          <strong>Schools:</strong> where a teacher or school creates student accounts, we
          rely on the school to provide the notice to parents and the consent that COPPA
          permits a school to give for school-directed educational use. Schools that need a
          data protection agreement should contact us at{' '}
          <Fill value={LEGAL_ENTITY.privacyEmail} needs="privacy contact email" />.
        </p>

        <h2>Who we share information with</h2>
        <p>
          We do not sell personal information, and we do not share it for advertising. We use
          a small number of service providers to run the product:
        </p>
        <ul>
          <li><strong>Stripe</strong> — payment processing. Card details go directly to
              Stripe and are never stored on our servers.</li>
          <li><strong>Supabase</strong> — hosts the database that holds the information
              described above.</li>
          <li><strong>Resend</strong> — delivers account email, such as password resets,
              billing notices, and the optional weekly progress digest.</li>
          <li><strong>Google Fonts</strong> — serves the fonts the app uses. Loading a font
              discloses your IP address to Google.</li>
          <li><strong>Google</strong> — only if a parent or teacher chooses to sign in with
              a Google account.</li>
          <li><strong>Anthropic</strong> — when handle screening is enabled, a handle a child
              types is checked by an automated content classifier. Only the handle text is
              sent; it is not used to train models.</li>
        </ul>
        <p>
          We may also disclose information if we are legally required to, or to protect
          someone&rsquo;s safety.
        </p>

        <h2>How long we keep it</h2>
        <p>
          We keep account and learning data for as long as the account exists. If a child is
          left with no linked guardian — for example their only parent deletes their own
          account — that child&rsquo;s account keeps working for 30 days and is then
          permanently deleted automatically.
        </p>

        <h2>Your choices and rights</h2>
        <ul>
          <li><strong>See it.</strong> A parent or teacher can view everything recorded about
              a child from their dashboard.</li>
          <li><strong>Delete a child.</strong> Removing a child from your dashboard deletes
              that child&rsquo;s account and their learning history.</li>
          <li><strong>Delete everything.</strong> Deleting your own account removes your
              account and the children only you were linked to.</li>
          <li><strong>Turn off email.</strong> The weekly progress digest can be switched off
              in your dashboard settings. Account and billing email cannot be turned off
              while you hold an account.</li>
          <li><strong>Ask us.</strong> Write to{' '}
              <Fill value={LEGAL_ENTITY.privacyEmail} needs="privacy contact email" /> for a copy of
              your data, a correction, or a deletion we can&rsquo;t action from the
              dashboard.</li>
        </ul>

        <h2>Security</h2>
        <p>
          Traffic is encrypted in transit. Passwords are stored only as salted hashes, never
          in a readable form. Access to the production database is limited to the operator of
          the service. No system is perfectly secure, but we do not collect data we do not
          need, which is the most reliable protection available.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          If we make a material change we will update the date at the top of this page, and
          for significant changes affecting children&rsquo;s data we will email account
          holders.
        </p>

        <p style={{ marginTop: 28 }}>
          See also our <Link to="/terms">Terms of Service</Link>.
        </p>
    </LegalPageShell>
  );
}
