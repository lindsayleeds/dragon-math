#!/usr/bin/env node

/**
 * Clear all Learning Lair progress (practice mode) for all users.
 * Learning Lair progress is stored in problemAttempts with nodeId = 0.
 */

require('dotenv').config();
const { eq } = require('drizzle-orm');
const { db, schema } = require('../server/db');

async function clearLearningLair() {
  try {
    const result = await db
      .delete(schema.problemAttempts)
      .where(eq(schema.problemAttempts.nodeId, 0))
      .returning({ id: schema.problemAttempts.id });

    console.log(`✓ Cleared ${result.length} Learning Lair problem attempts`);
    process.exit(0);
  } catch (error) {
    console.error('✗ Error clearing Learning Lair progress:', error.message);
    process.exit(1);
  }
}

clearLearningLair();
