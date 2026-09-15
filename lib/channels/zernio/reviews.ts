import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveZernioCreds } from "./credentials";
import { ZERNIO_CAPABILITIES, type ZernioPlatform } from "./platform-capabilities";

export async function replyToZernioReview(admin: SupabaseClient, input: {
  organizationId: string; accountId: string; platform: ZernioPlatform; reviewId: string; message: string; idempotencyKey?: string;
}) {
  if (!ZERNIO_CAPABILITIES[input.platform].reviews.reply) throw new Error("zernio_review_reply_not_supported");
  const creds = await resolveZernioCreds(admin, { organizationId: input.organizationId, accountId: input.accountId });
  if (!creds) throw new Error("zernio_not_configured");
  const response = await fetch(`${creds.baseUrl}/v1/inbox/reviews/${encodeURIComponent(input.reviewId)}/reply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
    body: JSON.stringify({ accountId: input.accountId, message: input.message }),
  });
  const body = await response.json().catch(() => null) as { error?: string; code?: string } | null;
  if (!response.ok) throw new Error(`zernio_review_reply_failed: ${body?.code ?? response.status} ${body?.error ?? ""}`.trim());
  return body;
}
