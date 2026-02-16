// Express v5 types params as `string | string[]` to account for wildcard routes.
// This project only uses named params (e.g., /:id), which are always strings.
// We provide a helper type and recommend `as string` casts at usage sites.

