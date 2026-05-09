import { Jwk, jwkValidator } from '@atproto/oauth-client-node';
import { makeValidator } from 'envalid';
import { z } from 'zod';

export type JsonWebKey = Jwk & { kid: string };

const jsonWebKeySchema = z.intersection(
  jwkValidator as unknown as z.ZodTypeAny,
  z.object({ kid: z.string().nonempty() })
) as z.ZodType<JsonWebKey>;

const jsonWebKeysSchema = z.array(jsonWebKeySchema).nonempty();

export const envalidJsonWebKeys = makeValidator((input) => {
  const value = JSON.parse(input);
  return jsonWebKeysSchema.parse(value);
});
