#!/usr/bin/env node
/**
 * Script to mark a user as admin by their handle
 * Usage: node scripts/makeAdmin.js <handle>
 * Example: node scripts/makeAdmin.js brittanyellich.com
 */

import { createDb, migrateToLatest } from '../src/db';
import { config } from '../src/config';
import { AtpAgent } from '@atproto/api';

async function makeAdmin(handle: string) {
  console.log(`Looking up user with handle: ${handle}`);

  try {
    // Initialize database
    const db = createDb(config.databaseUrl);
    await migrateToLatest(db);

    // Resolve handle to DID using ATP agent
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    const response = await agent.resolveHandle({ handle });
    const did = response.data.did;

    console.log(`Found DID: ${did}`);

    // Check if user exists in database
    const existingUser = await db
      .selectFrom('users')
      .select(['did', 'isAdmin'])
      .where('did', '=', did)
      .executeTakeFirst();

    if (!existingUser) {
      // Create user record if doesn't exist
      const now = new Date();
      await db
        .insertInto('users')
        .values({
          did: did,
          firstLoginAt: now,
          lastActivityAt: now,
          isAdmin: true,
          createdAt: now,
          updatedAt: now,
        } as any)
        .execute();
      console.log(`✓ Created new user and marked as admin`);
    } else if (existingUser.isAdmin) {
      console.log(`User is already an admin`);
    } else {
      // Update existing user to admin
      await db
        .updateTable('users')
        .set({
          isAdmin: true,
          updatedAt: new Date(),
        })
        .where('did', '=', did)
        .execute();
      console.log(`✓ User marked as admin`);
    }

    await db.destroy();
    process.exit(0);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Get handle from command line arguments
const handle = process.argv[2];

if (!handle) {
  console.error('Usage: node scripts/makeAdmin.js <handle>');
  console.error('Example: node scripts/makeAdmin.js brittanyellich.com');
  process.exit(1);
}

makeAdmin(handle);
