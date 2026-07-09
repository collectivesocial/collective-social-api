import { AtpAgent } from '@atproto/api';
import { config } from '../config';
import { Generated } from 'kysely';

export interface User {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  firstLoginAt: Date;
  lastActivityAt: Date;
  isAdmin: Generated<boolean>;
  popfeedMigratedAt: Date | null;
  popfeedMigrationStatus: 'pending' | 'in_progress' | 'complete' | 'failed';
  popfeedMigrationError: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export async function getUserByHandle(handle: string) {
  const agent = new AtpAgent({ service: config.pdsUrl });
  const response = await agent.getProfile({ actor: handle });
  return response.data;
}
