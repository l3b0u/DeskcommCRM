import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseZernioCommentAsMessage, parseZernioInbound, parseZernioReviewAsMessage } from "@/lib/channels/zernio/webhook";
import { privateReplyToZernioComment, replyToZernioComment } from "@/lib/channels/zernio/comments";
import { replyToZernioReview } from "@/lib/channels/zernio/reviews";

afterEach(() => vi.restoreAllMocks());

describe("webhooks sociais Zernio", () => {
  it("DM Instagram usa id externo social e não wa_identity", () => {
    const parsed = parseZernioInbound({ event: "message.received", account: { id: "acc" }, message: { id: "m1", conversationId: "c1", platform: "instagram", direction: "incoming", text: "oi", sender: { id: "ig1", username: "ana" } } });
    expect(parsed).toMatchObject({ platform: "instagram", identity: { externalId: "ig1", anchor: null } });
  });
  it("comentário vira thread por post+autor e preserva o id nativo", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/zernio/comment.received.instagram.json", "utf8"));
    expect(parseZernioCommentAsMessage(fixture)).toMatchObject({
      conversationId: "comment:post_99:ig_user_42",
      externalId: "comment_77",
      platform: "instagram",
      interaction: { kind: "comment", postId: "post_99", commentId: "comment_77", authorId: "ig_user_42", publicReply: true, privateReply: true },
    });
  });

  it("dois comentários do mesmo autor no mesmo post permanecem na mesma conversa", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/zernio/comment.received.instagram.json", "utf8"));
    const outro = structuredClone(fixture);
    outro.comment.platformCommentId = "comment_78";
    expect(parseZernioCommentAsMessage(outro)?.conversationId).toBe(parseZernioCommentAsMessage(fixture)?.conversationId);
  });

  it.each([
    [false, "/v1/inbox/comments/post%2F99", { accountId: "acc", message: "oi", commentId: "comment/77" }],
    [true, "/v1/inbox/comments/post%2F99/comment%2F77/private-reply", { accountId: "acc", message: "oi" }],
  ] as const)("resposta pública/privada usa o endpoint oficial (private=%s)", async (privada, suffix, expectedBody) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "success", messageId: "m1" }), { status: 200 }));
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { zernio_account_id: "acc", zernio_token_encrypted: "cipher" }, error: null }) }) }) }) }) }), rpc: async () => ({ data: "secret", error: null }) } as never;
    const input = { organizationId: "org", accountId: "acc", platform: "instagram" as const, postId: "post/99", commentId: "comment/77", message: "oi" };
    if (privada) await privateReplyToZernioComment(admin, input);
    else await replyToZernioComment(admin, input);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(suffix), expect.objectContaining({ body: JSON.stringify(expectedBody) }));
  });

  it("review suportada preserva review_id estruturado", () => {
    expect(parseZernioReviewAsMessage({ event: "review.new", account: { id: "acc", platform: "googlebusiness" }, review: { id: "locations/x/reviews/y", platform: "googlebusiness", comment: "Ótimo", reviewer: { id: "u1" } } })).toMatchObject({
      conversationId: "review:locations/x/reviews/y",
      interaction: { kind: "review", reviewId: "locations/x/reviews/y", publicReply: true, privateReply: false },
    });
  });

  it("responde review pelo endpoint oficial com id codificado", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "success" }), { status: 200 }));
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { zernio_account_id: "acc", zernio_token_encrypted: "cipher" }, error: null }) }) }) }) }) }), rpc: async () => ({ data: "secret", error: null }) } as never;
    await replyToZernioReview(admin, { organizationId: "org", accountId: "acc", platform: "googlebusiness", reviewId: "locations/x/reviews/y", message: "Obrigado" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/v1/inbox/reviews/locations%2Fx%2Freviews%2Fy/reply"), expect.objectContaining({ body: JSON.stringify({ accountId: "acc", message: "Obrigado" }) }));
  });
});
