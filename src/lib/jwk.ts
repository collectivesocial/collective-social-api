import { Jwk, jwkValidator } from '@atproto/oauth-client-node';
import { makeValidator } from 'envalid';
import { z } from 'zod';

export type JsonWebKey = Jwk & { kid: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonWebKeySchema = z.intersection(
  jwkValidator as any,
  z.object({ kid: z.string().nonempty() })
) as unknown as z.ZodType<JsonWebKey>;

const jsonWebKeysSchema = z.array(jsonWebKeySchema).nonempty();

export const envalidJsonWebKeys = makeValidator((input) => {
  const value = JSON.parse(input);
  return jsonWebKeysSchema.parse(value);
});
