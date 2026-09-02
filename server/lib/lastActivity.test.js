const { sql } = require('drizzle-orm');
const { PgDialect } = require('drizzle-orm/pg-core');
const { lastActivityAt, SERVER_TIMEZONE } = require('./lastActivity');

describe('lastActivityAt', () => {
  it('uses the newest math attempt or playtime heartbeat', () => {
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(sql`
      SELECT ${lastActivityAt(sql.raw('u.id'))} AS last_attempt_at FROM users u
    `);

    expect(query.sql).toContain('GREATEST(');
    expect(query.sql).toContain('MAX(pa.created_at)');
    expect(query.sql).toContain('MAX(pm.minute)::timestamp AT TIME ZONE');
    expect(query.sql.match(/\.user_id = u\.id/g)).toHaveLength(2);
    expect(query.params).toEqual([SERVER_TIMEZONE]);
  });
});
