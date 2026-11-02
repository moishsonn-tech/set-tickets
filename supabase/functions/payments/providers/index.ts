// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript).
// Registered processors. Adding one = a new file + one line here; the app's GATEWAYS list (frontend/data.js) shows it to box offices.
import { checkProvider } from './types.ts';
import stripe from './stripe.ts';
export const PROVIDERS = { stripe: checkProvider(stripe) };
