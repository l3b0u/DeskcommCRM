import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveZernioCreds } from "./credentials";
import { ZERNIO_CAPABILITIES, type ZernioPlatform } from "./platform-capabilities";

interface CommentReplyInput {
  organizationId: string;
  accountId: string;
  platform: ZernioPlatform;
  postId: string;
  commentId: string;
  message: string;
  idempotencyKey?: string;
}

async function postCommentAction(admin: SupabaseClient, input: CommentReplyInput, privateReply: boolean) {
  const capability = ZERNIO_CAPABILITIES[input.platform].comments;
  if (!(privateReply ? capability.privateReply : capability.reply)) throw new Error("zernio_comment_action_not_supported");
  const creds = await resolveZernioCreds(admin, { organizationId: input.organizationId, accountId: input.accountId });
  if (!creds) throw new Error("zernio_not_configured");
  const suffix = privateReply ? `/${encodeURIComponent(input.commentId)}/private-reply` : "";
  const response = await fetch(`${creds.baseUrl}/v1/inbox/comments/${encodeURIComponent(input.postId)}${suffix}`, {
    method: "POST", headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
    body: JSON.stringify({ accountId: input.accountId, message: input.message, ...(privateReply ? {} : { commentId: input.commentId }) }),
  });
  const body = await response.json().catch(() => null) as { error?: string; code?: string } | null;
  if (!response.ok) throw new Error(`zernio_comment_failed: ${body?.code ?? response.status} ${body?.error ?? ""}`.trim());
  return body;
}

export const replyToZernioComment = (admin: SupabaseClient, input: CommentReplyInput) => postCommentAction(admin, input, false);
export const privateReplyToZernioComment = (admin: SupabaseClient, input: CommentReplyInput) => postCommentAction(admin, input, true);
