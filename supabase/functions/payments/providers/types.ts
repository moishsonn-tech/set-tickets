// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript); kept annotation-free so any JS engine can syntax-check it.
/* The payment gateway contract. Every processor (Stripe, Square, PayPal, Authorize.net, a small local processor…) is ONE file in this
   folder exporting an object with these members. Checkout, orders, tickets and refunds never know which processor ran.

   name                      display name
   createPayment(ctx)        → { clientSecret?, redirectUrl?, publishableKey?, account?, ref }   start paying for one order (idempotent per order)
   parseWebhook(req, raw)    → { type: 'succeeded' | 'failed' | 'account', orderId?, ref?, charge?, amount?, fee?, appFee?, method?, brand?, last4?, error?, account?, ready?, test? }
                             | { type: 'dispute', id, payment, amount, reason, status: open|won|lost }       (Stage 9: chargebacks)
                             | { type: 'payout', id, amount, status, created, arrival, failure, tx: [payment ids carried] }   (Stage 9: payouts)
                             | null — verifies the processor's signature; null = ignore
   refund(ctx)               → { id } the processor's refund id (recorded in processor_tx for reconciliation)
                             refund a payment: ctx.ref = the processor's payment id, ctx.amount = cents (all when left out), ctx.idem = idempotency key
                             (late payments whose seats are gone, and staff refunds from the order screen — full or partial)
   connect(ctx)              → { url }   send the box office to the processor to connect THEIR account (payouts go to them)

   ctx = { order, account, platformFee, returnUrl, env }  — env holds this processor's secrets from Supabase secrets, never from the client. */
export const REQUIRED = ['name', 'createPayment', 'parseWebhook', 'refund', 'connect'];
export function checkProvider(p) { for (const k of REQUIRED) if (!(k in p)) throw new Error('payment provider is missing ' + k); return p; }
