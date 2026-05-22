require('dotenv').config();

/** @type {import('drizzle-kit').Config} */
module.exports = {
  dialect: 'postgresql',
  schema: './server/db/schema.js',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Drizzle Kit treats `citext` as an unknown type during diff because it's
  // an extension type. Telling it `citext` exists prevents spurious
  // "type does not exist" warnings on subsequent `push`/`generate`.
  schemaFilter: ['public'],
  verbose: true,
  strict: false,
};
