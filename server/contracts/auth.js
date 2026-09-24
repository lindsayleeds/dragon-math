// Contract for the kid sign-in and kid-profile routes in server/routes/auth.js —
// the ones the iOS app calls: login link / QR (child-login), the family picker
// (family, family-login, family-members, family-switch), the session check (me),
// the kid's own profile (avatars, child/handle, profile), and the parent's
// Sign in with Apple (apple).
//
// Input schemas here ARE the route's validation: the handler parses req.body with
// them via server/lib/parseInput.js, so an error message written here is what the
// client sees. The messages match what the routes returned before they had
// schemas; keep them kid-friendly.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');
const { AuthSession, UserResponse } = require('./schemas');

// Curated set of avatars the player may choose from. The server rejects anything
// outside the list — prevents arbitrary strings (or hostile payloads) from being
// stored as a user's avatar.
const ALLOWED_AVATARS = [
  '⚔️', '🗡️', '🏹', '/avatars/cleaned_up_dragon.png',
  '/avatars/avie_rain.png', '🧝‍♀️', '🧚', '👸',
  '🦄', '🐉', '🐲', '🐱',
  '🐰', '🦊', '🐺', '🦁',
  '🐯', '🐼', '🐨', '🦉',
];

// Font combos selectable from the Settings page; mirrors src/data/fontThemes.js.
// The DEFAULT is decided elsewhere — see DEFAULT_FONT in server/routes/auth.js.
const ALLOWED_FONTS = ['handwritten', 'bubbly', 'storybook', 'clean'];

const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
// Written without the `i` flag so the pattern survives into openapi.json intact.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const BROKEN_LINK = 'That link looks broken.';
const CHOOSE_CHILD = 'Choose an adventurer.';
const NO_FAMILY = "We couldn't find that family link. Ask your grown-up for a fresh one.";
const BAD_HANDLE = 'Handle must be 2–24 letters, numbers, _ or -';

// Accepts a number or a numeric string, exactly as the old Number(x) check did.
const ChildId = z.coerce
  .number({ error: CHOOSE_CHILD })
  .int({ error: CHOOSE_CHILD })
  .positive({ error: CHOOSE_CHILD })
  .meta({ description: 'Id of a child linked to the family.' });

const Avatar = z.enum(ALLOWED_AVATARS, { error: 'Invalid avatar' });
const Font = z.enum(ALLOWED_FONTS, { error: 'Invalid font' });

const ChildLoginRequest = z
  .object({
    token: z
      .string({ error: BROKEN_LINK })
      .trim()
      .regex(UUID_RE, { error: BROKEN_LINK })
      .meta({ description: 'The login token from a /k/<token> link or QR code.' }),
  })
  .meta({ id: 'ChildLoginRequest' });

const FamilyTokenParams = z.object({
  token: z.string().meta({ description: 'The family token from a family-device link.' }),
});

const FamilyLoginRequest = z
  .object({
    child_id: ChildId,
    token: z.string({ error: NO_FAMILY }).trim().meta({ description: 'The family token from a family-device link.' }),
  })
  .meta({ id: 'FamilyLoginRequest' });

const FamilySwitchRequest = z.object({ child_id: ChildId }).meta({ id: 'FamilySwitchRequest' });

const SetHandleRequest = z
  .object({
    username: z.string({ error: BAD_HANDLE }).trim().regex(USERNAME_RE, { error: BAD_HANDLE }),
    avatar: Avatar.nullish(),
  })
  .meta({ id: 'SetHandleRequest' });

const UpdateProfileRequest = z
  .object({ avatar: Avatar.optional(), font: Font.optional() })
  .refine(body => body.avatar !== undefined || body.font !== undefined, { error: 'Nothing to update' })
  .meta({ id: 'UpdateProfileRequest', description: 'At least one field is required.' });

const BAD_APPLE_TOKEN = 'Apple sign-in did not send an identity token.';

const AppleSignInRequest = z
  .object({
    identity_token: z
      .string({ error: BAD_APPLE_TOKEN })
      .trim()
      .min(1, { error: BAD_APPLE_TOKEN })
      .max(8192, { error: BAD_APPLE_TOKEN })
      .meta({ description: 'The identityToken from ASAuthorizationAppleIDCredential, as a string.' }),
    nonce: z
      .string({ error: 'Invalid nonce' })
      .min(1, { error: 'Invalid nonce' })
      .max(256, { error: 'Invalid nonce' })
      .optional()
      .meta({
        description: 'The RAW nonce. The authorization request must have carried its SHA-256 as lowercase hex; '
          + 'the server checks the token\'s nonce claim against that hash.',
      }),
  })
  .meta({ id: 'AppleSignInRequest' });

const FamilyMember = z
  .object({
    id: z.number().int(),
    username: z.string(),
    avatar: z.string(),
    needs_handle: z.boolean(),
  })
  .meta({ id: 'FamilyMember' });

const FamilyMembersResponse = z.object({ children: z.array(FamilyMember) }).meta({ id: 'FamilyMembersResponse' });
const AvatarsResponse = z.object({ avatars: z.array(z.string()) }).meta({ id: 'AvatarsResponse' });

const session = description => ({ 200: { description, schema: AuthSession } });

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/auth/me',
    operationId: 'getCurrentUser',
    summary: 'The signed-in user.',
    tags: ['auth'],
    auth: true,
    responses: { 200: { description: 'The signed-in user.', schema: UserResponse }, ...errors(401, 404) },
  }),
  defineRoute({
    method: 'post',
    path: '/api/auth/child-login',
    operationId: 'childLogin',
    summary: 'Exchange a permanent login link or QR token for a session.',
    tags: ['auth'],
    body: ChildLoginRequest,
    responses: { ...session('Signed in.'), ...errors(400, 403, 404, 429) },
  }),
  defineRoute({
    method: 'get',
    path: '/api/auth/family/{token}',
    operationId: 'getFamily',
    summary: 'The children a family-device link can sign in as. Kid-facing fields only.',
    tags: ['auth'],
    params: FamilyTokenParams,
    responses: {
      200: { description: 'Children in the family.', schema: FamilyMembersResponse },
      ...errors(404),
    },
  }),
  defineRoute({
    method: 'post',
    path: '/api/auth/family-login',
    operationId: 'familyLogin',
    summary: 'Sign in as one child of a family-device link.',
    tags: ['auth'],
    body: FamilyLoginRequest,
    responses: { ...session('Signed in, in family mode.'), ...errors(400, 404, 429) },
  }),
  defineRoute({
    method: 'get',
    path: '/api/auth/family-members',
    operationId: 'listFamilyMembers',
    summary: "The signed-in child's siblings, for the family picker. Family mode only.",
    tags: ['auth'],
    auth: true,
    responses: {
      200: { description: 'Children in the family.', schema: FamilyMembersResponse },
      ...errors(401, 403),
    },
  }),
  defineRoute({
    method: 'post',
    path: '/api/auth/family-switch',
    operationId: 'familySwitch',
    summary: 'Switch a family-mode session to a sibling.',
    tags: ['auth'],
    auth: true,
    body: FamilySwitchRequest,
    responses: { ...session('Signed in as the sibling, in family mode.'), ...errors(400, 401, 403, 404) },
  }),
  defineRoute({
    method: 'post',
    path: '/api/auth/apple',
    operationId: 'appleSignIn',
    summary: 'Sign a parent in with an Apple identity token, creating the account on first sign-in.',
    tags: ['auth'],
    body: AppleSignInRequest,
    responses: { ...session('Signed in as a parent.'), ...errors(400, 401, 409, 429, 502, 503) },
  }),
  defineRoute({
    method: 'get',
    path: '/api/auth/avatars',
    operationId: 'listAvatars',
    summary: 'Avatars a user may choose.',
    tags: ['profile'],
    auth: true,
    responses: { 200: { description: 'Allowed avatars.', schema: AvatarsResponse }, ...errors(401) },
  }),
  defineRoute({
    method: 'post',
    path: '/api/auth/child/handle',
    operationId: 'setChildHandle',
    summary: "A new child picks their own handle (only while needs_handle is true). Re-issues the token.",
    tags: ['profile'],
    auth: true,
    body: SetHandleRequest,
    responses: { ...session('Handle set.'), ...errors(400, 401, 403, 404, 409) },
  }),
  defineRoute({
    method: 'put',
    path: '/api/auth/profile',
    operationId: 'updateProfile',
    summary: "Change the signed-in user's avatar and/or font.",
    tags: ['profile'],
    auth: true,
    body: UpdateProfileRequest,
    responses: { 200: { description: 'The updated user.', schema: UserResponse }, ...errors(400, 401) },
  }),
];

module.exports = {
  routes,
  ALLOWED_AVATARS,
  ALLOWED_FONTS,
  USERNAME_RE,
  UUID_RE,
  AppleSignInRequest,
  ChildLoginRequest,
  FamilyLoginRequest,
  FamilySwitchRequest,
  SetHandleRequest,
  UpdateProfileRequest,
};
