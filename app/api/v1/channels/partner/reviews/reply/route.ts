import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  responderAvaliacaoParceira,
  sessaoParceiraParaAcaoSocial,
} from "@/lib/channels/connect";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ channel_session_id: z.string().uuid(), review_id: z.string().trim().min(1).max(500), message: z.string().trim().min(1).max(4096) });

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  if (!z.string().uuid().safeParse(req.headers.get("Idempotency-Key")).success) return fail("invalid_request", "Idempotency-Key deve ser UUID.", 422, { requestId });
  const authz = await requireRole("agent", { requestId, resource: "channel_reviews" });
  if (!authz.ok) return authz.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request", "Resposta inválida.", 422, { requestId });
  const admin = createAdminClient();
  const sessao = await sessaoParceiraParaAcaoSocial(admin, authz.org.orgId, parsed.data.channel_session_id);
  if (!sessao?.accountId) return fail("not_found", "Conexão não encontrada.", 404, { requestId });
  if (!sessao.capabilities.reviews.reply) return fail("invalid_state", "A conta não autorizou resposta de avaliação.", 409, { requestId });
  try {
    const receipt = await responderAvaliacaoParceira(admin, { organizationId: authz.org.orgId, accountId: sessao.accountId, platform: sessao.platform, reviewId: parsed.data.review_id, message: parsed.data.message, idempotencyKey: req.headers.get("Idempotency-Key") ?? undefined });
    await audit({ action: "channel.review_replied", actorUserId: authz.user.id, organizationId: authz.org.orgId, resourceType: "channel_session", resourceId: sessao.id, requestId, metadata: { review_id: parsed.data.review_id } });
    return ok({ sent: true, receipt }, { requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel_review_failed";
    return fail(message.includes("not_supported") ? "invalid_state" : "upstream_unavailable", message, message.includes("not_supported") ? 409 : 502, { requestId });
  }
}
