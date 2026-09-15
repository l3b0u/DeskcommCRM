import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  responderComentarioParceiro,
  sessaoParceiraParaAcaoSocial,
} from "@/lib/channels/connect";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({
  channel_session_id: z.string().uuid(),
  post_id: z.string().trim().min(1).max(500),
  comment_id: z.string().trim().min(1).max(500),
  message: z.string().trim().min(1).max(4096),
  private_reply: z.boolean().default(false),
});

/** Responde comentário pela conta conectada, sem aceitar organização do corpo. */
export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  if (!z.string().uuid().safeParse(req.headers.get("Idempotency-Key")).success) return fail("invalid_request", "Idempotency-Key deve ser UUID.", 422, { requestId });
  const authz = await requireRole("agent", { requestId, resource: "channel_comments" });
  if (!authz.ok) return authz.response;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request", "Resposta inválida.", 422, { requestId });

  const admin = createAdminClient();
  const sessao = await sessaoParceiraParaAcaoSocial(
    admin,
    authz.org.orgId,
    parsed.data.channel_session_id,
  );
  if (!sessao?.accountId) return fail("not_found", "Conexão não encontrada.", 404, { requestId });
  const permitido = parsed.data.private_reply ? sessao.capabilities.comments.privateReply : sessao.capabilities.comments.reply;
  if (!permitido) return fail("invalid_state", "A conta não autorizou esta resposta.", 409, { requestId });

  try {
    const receipt = await responderComentarioParceiro(admin, {
      organizationId: authz.org.orgId,
      accountId: sessao.accountId,
      platform: sessao.platform,
      postId: parsed.data.post_id,
      commentId: parsed.data.comment_id,
      message: parsed.data.message,
      privateReply: parsed.data.private_reply,
      idempotencyKey: req.headers.get("Idempotency-Key") ?? undefined,
    });
    await audit({
      action: parsed.data.private_reply ? "channel.comment_private_replied" : "channel.comment_replied",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "channel_session",
      resourceId: parsed.data.channel_session_id,
      requestId,
      metadata: { post_id: parsed.data.post_id, comment_id: parsed.data.comment_id },
    });
    return ok({ sent: true, receipt }, { requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel_comment_failed";
    const unsupported = message.includes("not_supported");
    return fail(unsupported ? "invalid_state" : "upstream_unavailable", message, unsupported ? 409 : 502, { requestId });
  }
}
