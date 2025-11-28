import { AtpAgent } from '@atproto/api';
import { config } from '../config';

export async function getUserByHandle(handle: string) {
  const agent = new AtpAgent({ service: config.pdsUrl });
  const response = await agent.getProfile({ actor: handle });
  return response.data;
}
