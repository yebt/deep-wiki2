// Synthetic client chunk that the server env schema leaked into: the zod
// schema names every server-side variable, secrets included.
const envSchema = { DATABASE_URL: "string", AI_KEK_KEYRING: "string", AI_KEK_ACTIVE_ID: "string" };
export { envSchema };
