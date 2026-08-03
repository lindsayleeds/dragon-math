import { Link } from 'react-router-dom';
import { LEGAL_ENTITY } from '../data/legalEntity';
import { LegalPageShell, Fill } from '../components/LegalPageShell';

// Terms of service. Like the privacy policy, the substantive clauses describe
// real behaviour rather than template text — in particular the billing section,
// which states the actual trial mechanics implemented in
// server/routes/billing.js: a card is collected at checkout and charged
// automatically when the trial ends unless it is cancelled first.
//
// That disclosure is the point of this page as much as the liability language is.
// Operator details come from src/data/legalEntity.js; unset values render a loud
// [NEEDS: …] marker and hold the draft banner up (GAPS.md 5b).

export function TermsPage() {
  return (
    <LegalPageShell title="Terms of Service">
        <p>
          These terms are an agreement between you and <strong>{LEGAL_ENTITY.name}</strong>{' '}
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;) covering your use of My Dragon Math. By
          creating an account you agree to them. If you do not agree, please do not use the
          service.
        </p>

        <h2>Who may use My Dragon Math</h2>
        <p>
          You must be at least 18 to hold an account. Children use the service only through
          an account created for them by a parent, guardian, teacher, or school
          administrator. If you create an account for a child, you confirm you have the
          authority to do so and to agree to these terms on their behalf.
        </p>

        <h2>Your account</h2>
        <p>
          Keep your password confidential; you are responsible for what happens under your
          account. Children created by an adult sign in through a permanent private link —
          treat that link like a password and do not share it publicly. Tell us promptly at{' '}
          <Fill value={LEGAL_ENTITY.supportEmail} needs="support contact email" /> if you
          believe an account has been accessed without
          permission.
        </p>

        <h2>Plans, trials, and billing</h2>
        <h3>What the free plan includes</h3>
        <p>
          The free plan is genuinely free and has no time limit. It covers one child and the
          core math games. Some games and features require a paid plan; the current limits
          are always shown in the upgrade panel on your dashboard.
        </p>

        <h3>How the free trial works</h3>
        <p>
          Paid plans start with a free trial. <strong>Please read this part carefully:</strong>
        </p>
        <ul>
          <li>We collect a payment card when you start the trial.</li>
          <li>You are not charged during the trial.</li>
          <li>
            <strong>When the trial ends, the card is charged automatically</strong> and the
            subscription continues at the price shown when you signed up, renewing each month
            or year until cancelled.
          </li>
          <li>
            You can cancel at any time before the trial ends and you will not be charged. We
            also email you before the trial ends to remind you.
          </li>
        </ul>

        <h3>Renewals, cancellation, and refunds</h3>
        <p>
          Subscriptions renew automatically. Cancel any time from &ldquo;Manage billing&rdquo;
          on your dashboard; cancelling stops future charges and keeps your access until the
          end of the period you have already paid for, after which the account returns to the
          free plan. Cancelling never deletes your children&rsquo;s progress.
        </p>
        <p>
          If a payment fails we will email you and keep trying for a short period without
          immediately cutting off access. If it keeps failing, the subscription ends and the
          account returns to the free plan.
        </p>
        <p>
          Prices may change. We will give you notice before a change affects a renewal, and
          you can cancel before it takes effect.{' '}
          <Fill value={LEGAL_ENTITY.refundPolicy} needs="refund policy" />
        </p>

        <h2>Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>choose handles or other visible names that are offensive, harassing, or
              impersonate someone else;</li>
          <li>attempt to access accounts, classrooms, or data that are not yours;</li>
          <li>disrupt, overload, probe, or reverse engineer the service;</li>
          <li>scrape or bulk-extract content or other users&rsquo; information;</li>
          <li>resell or redistribute access to the service.</li>
        </ul>
        <p>
          We may suspend or close an account that breaks these rules, and we will tell you
          why where we can.
        </p>

        <h2>Schools and classrooms</h2>
        <p>
          A teacher or school administrator who creates student accounts confirms that they
          are authorised to do so and that the school has provided any notice to parents that
          the law requires. Schools needing a data protection agreement should contact{' '}
          <Fill value={LEGAL_ENTITY.supportEmail} needs="support contact email" />.
        </p>

        <h2>Our content and yours</h2>
        <p>
          The game, its artwork, and its content belong to us and are licensed to you for
          personal or classroom use while your account is active. Names, handles, and other
          text you enter remain yours; you give us permission to store and display them
          within the service as needed to run it.
        </p>

        <h2>Availability</h2>
        <p>
          We work to keep the service running but we do not promise it will be uninterrupted
          or error-free. We may change or discontinue features. If we discontinue the service
          entirely, we will give account holders reasonable notice and a chance to export or
          delete their data.
        </p>

        <h2>Disclaimers and liability</h2>
        <p>
          My Dragon Math is an educational practice tool. It is provided &ldquo;as is&rdquo;,
          without warranties of any kind to the fullest extent the law allows, and we do not
          guarantee any particular learning outcome.
        </p>
        <p>
          To the fullest extent permitted by law, our total liability for any claim relating
          to the service is limited to the amount you paid us in the twelve months before the
          claim. Nothing here limits liability that cannot lawfully be limited.
        </p>

        <h2>Ending your account</h2>
        <p>
          You may delete your account at any time from your dashboard. We may close an
          account that breaches these terms. On closure, data is deleted as described in the{' '}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          We may update these terms. For material changes we will update the date above and
          notify account holders by email. Continuing to use the service after a change means
          you accept it.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of {LEGAL_ENTITY.governingLaw}, and the
          courts of {LEGAL_ENTITY.governingLaw} have exclusive jurisdiction, except
          where your local consumer law gives you a right to bring a claim elsewhere.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms:{' '}
          <strong><Fill value={LEGAL_ENTITY.supportEmail} needs="support contact email" /></strong>.
        </p>

        <p style={{ marginTop: 28 }}>
          See also our <Link to="/privacy">Privacy Policy</Link>.
        </p>
    </LegalPageShell>
  );
}
