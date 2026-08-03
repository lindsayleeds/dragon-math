// Who operates My Dragon Math, for the privacy policy and terms pages.
//
// ONE file on purpose. COPPA requires the operator's name, address, phone and
// email in the posted notice, and those details change as a business does —
// forming an LLC, moving, switching to a virtual mailbox. Keeping them here means
// that change is one edit, not a search through JSX for the third copy of an
// address.
//
// Anything still null renders as a visible [NEEDS: …] marker on the page and
// keeps the draft banner up, so an unfilled field cannot ship unnoticed. That is
// deliberate: a legal page is the one place where a quietly-missing value is
// worse than a loud one.

export const LEGAL_ENTITY = {
  // Currently a sole proprietor — no entity. If an LLC is formed, this becomes
  // the company name and the address becomes its registered/mailing address.
  name: 'Lindsay Leeds',
  address: '4375 University Drive, Ooltewah, TN 37363',

  // COPPA's notice rule lists a telephone number alongside name/address/email.
  phone: '(423) 225-4275',

  // Kept as two fields even though they currently hold the same mailbox, so a
  // dedicated privacy address can be split out later without touching the pages.
  privacyEmail: 'mydragonmath@gmail.com',
  supportEmail: 'mydragonmath@gmail.com',

  // One sentence on refunds, e.g. whether a mid-period cancellation is refunded.
  // Stated because auto-renewal rules expect the cancellation and refund terms to
  // be findable, not because the law dictates a particular policy.
  refundPolicy:
    'You may cancel at any time. Cancelling stops future charges and your access continues ' +
    'until the end of the period you have already paid for; we do not refund the remainder ' +
    'of a period already begun.',

  // Inferred from the business address above — change if you intend to be
  // governed elsewhere.
  governingLaw: 'the State of Tennessee',

  lastUpdated: 'August 3, 2026',

  // Flip to true only after a lawyer has read both pages. Independent of the
  // fields above: complete is not the same as reviewed, and a kids' product
  // taking payments is not a DIY-policy situation.
  legallyReviewed: false,
};

// Fields that must be non-null before these pages are publishable.
const REQUIRED = ['name', 'address', 'phone', 'privacyEmail', 'supportEmail', 'refundPolicy', 'governingLaw'];

export function missingLegalFields() {
  return REQUIRED.filter(k => !LEGAL_ENTITY[k]);
}

export function isLegalContentReady() {
  return missingLegalFields().length === 0 && LEGAL_ENTITY.legallyReviewed;
}
