/**
 * Contrato central do Inbox/Publicação Zernio.
 *
 * Fonte: docs.zernio.com/platforms e rules/inbox.md do repositório oficial
 * zernio-dev/zernio-api, conferidos em 2026-09-10. `false` significa que a API
 * não expõe a operação; limitações graduais ficam em `limitations`.
 */
export const ZERNIO_PLATFORMS = [
  "instagram", "facebook", "twitter", "bluesky", "reddit", "telegram",
  "whatsapp", "slack", "threads", "youtube", "linkedin", "googlebusiness",
  "tiktok", "pinterest", "snapchat",
] as const;

export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number];

export interface ZernioPlatformCapabilities {
  inbox: boolean;
  dms: { list: boolean; fetch: boolean; send: boolean; attachments: boolean; replies: boolean };
  comments: { list: boolean; reply: boolean; privateReply: boolean };
  reviews: { list: boolean; reply: boolean };
  publishing: boolean;
  webhooks: readonly string[];
  limitations: readonly string[];
}

const DM_EVENTS = ["message.received", "message.sent", "conversation.started", "message.delivered", "message.read", "message.failed"] as const;
const TELEGRAM_DM_EVENTS = [...DM_EVENTS, "message.edited", "message.deleted"] as const;
const COMMENT_EVENTS = ["comment.received"] as const;
const REVIEW_EVENTS = ["review.new", "review.updated"] as const;
const noDm = { list: false, fetch: false, send: false, attachments: false, replies: false } as const;
const dm = { list: true, fetch: true, send: true, attachments: true, replies: true } as const;
const dmSemAnexos = { ...dm, attachments: false } as const;
const noComments = { list: false, reply: false, privateReply: false } as const;
const comments = { list: true, reply: true, privateReply: false } as const;
const noReviews = { list: false, reply: false } as const;

export const ZERNIO_CAPABILITIES = {
  instagram: { inbox: true, dms: dm, comments: { ...comments, privateReply: true }, reviews: noReviews, publishing: true, webhooks: [...DM_EVENTS, ...COMMENT_EVENTS], limitations: ["DM e resposta privada sujeitos à janela Meta; private reply: uma por comentário, em até 7 dias, somente texto", "Ocultar comentário está em liberação limitada"] },
  facebook: { inbox: true, dms: dm, comments: { ...comments, privateReply: true }, reviews: { list: true, reply: true }, publishing: true, webhooks: [...DM_EVENTS, ...COMMENT_EVENTS, ...REVIEW_EVENTS], limitations: ["DM sujeito à janela Meta; private reply: uma por comentário, em até 7 dias, somente texto"] },
  twitter: { inbox: true, dms: dm, comments, reviews: noReviews, publishing: true, webhooks: [...DM_EVENTS, ...COMMENT_EVENTS], limitations: ["X Chat criptografado não é exposto pela API; conversas podem ficar vazias ou mostrar apenas saídas"] },
  bluesky: { inbox: true, dms: dmSemAnexos, comments, reviews: noReviews, publishing: true, webhooks: [...DM_EVENTS, ...COMMENT_EVENTS], limitations: ["DM não aceita anexos; resposta a comentário requer parentCid, rootUri e rootCid"] },
  reddit: { inbox: true, dms: dmSemAnexos, comments, reviews: noReviews, publishing: true, webhooks: [...DM_EVENTS, ...COMMENT_EVENTS], limitations: ["DM não aceita anexos; operações de comentário podem exigir subreddit"] },
  telegram: { inbox: true, dms: dm, comments: noComments, reviews: noReviews, publishing: true, webhooks: TELEGRAM_DM_EVENTS, limitations: ["Edição de mensagem é exclusiva do Telegram"] },
  whatsapp: { inbox: true, dms: dm, comments: noComments, reviews: noReviews, publishing: false, webhooks: DM_EVENTS, limitations: ["Texto livre somente na janela de 24h; fora dela exige template"] },
  slack: { inbox: true, dms: dm, comments: noComments, reviews: noReviews, publishing: false, webhooks: DM_EVENTS, limitations: ["Reações usam nomes Slack como :thumbsup:"] },
  threads: { inbox: true, dms: noDm, comments, reviews: noReviews, publishing: true, webhooks: COMMENT_EVENTS, limitations: ["Sem DMs pelo Inbox Zernio"] },
  youtube: { inbox: true, dms: noDm, comments, reviews: noReviews, publishing: true, webhooks: COMMENT_EVENTS, limitations: ["Sem DMs pelo Inbox Zernio"] },
  linkedin: { inbox: true, dms: noDm, comments, reviews: noReviews, publishing: true, webhooks: COMMENT_EVENTS, limitations: ["Sem DMs pelo Inbox Zernio"] },
  googlebusiness: { inbox: true, dms: noDm, comments: noComments, reviews: { list: true, reply: true }, publishing: true, webhooks: REVIEW_EVENTS, limitations: ["Inbox limitado a reviews; reviewId deve ser URL-encoded"] },
  tiktok: { inbox: false, dms: noDm, comments: noComments, reviews: noReviews, publishing: true, webhooks: [], limitations: ["Zernio não expõe DMs nem comentários"] },
  pinterest: { inbox: false, dms: noDm, comments: noComments, reviews: noReviews, publishing: true, webhooks: [], limitations: ["Sem Inbox comprovado na API Zernio"] },
  snapchat: { inbox: false, dms: noDm, comments: noComments, reviews: noReviews, publishing: true, webhooks: [], limitations: ["Sem Inbox comprovado na API Zernio"] },
} as const satisfies Record<ZernioPlatform, ZernioPlatformCapabilities>;

type AccountCapabilityHints = {
  scopes?: readonly string[];
  capabilities?: Partial<{
    inbox: boolean;
    dms: boolean;
    comments: boolean;
    commentReplies: boolean;
    privateReplies: boolean;
    reviews: boolean;
    reviewReplies: boolean;
  }>;
};

/** Intersecta a matriz da plataforma com o que ESTA conta autorizou. */
export function zernioCapabilitiesForAccount(
  platform: ZernioPlatform,
  account: AccountCapabilityHints,
): ZernioPlatformCapabilities {
  const base = ZERNIO_CAPABILITIES[platform];
  const scopes = new Set(account.scopes ?? []);
  const hinted = account.capabilities ?? {};
  const scoped = (scope: string, hint: boolean | undefined, fallback: boolean) =>
    hint ?? (scopes.size === 0 ? fallback : scopes.has(scope));
  const inbox = scoped("inbox:read", hinted.inbox, base.inbox);
  const dmRead = inbox && scoped("messages:read", hinted.dms, base.dms.list);
  const dmWrite = dmRead && scoped("messages:write", hinted.dms, base.dms.send);
  const commentRead = inbox && scoped("comments:read", hinted.comments, base.comments.list);
  const commentWrite = commentRead && scoped("comments:write", hinted.commentReplies, base.comments.reply);
  const reviewRead = inbox && scoped("reviews:read", hinted.reviews, base.reviews.list);
  const reviewWrite = reviewRead && scoped("reviews:write", hinted.reviewReplies, base.reviews.reply);
  return {
    ...base,
    inbox,
    dms: { ...base.dms, list: dmRead, fetch: dmRead, send: dmWrite, replies: dmWrite },
    comments: {
      list: commentRead,
      reply: commentWrite,
      privateReply: commentWrite && scoped("messages:write", hinted.privateReplies, base.comments.privateReply),
    },
    reviews: { list: reviewRead, reply: reviewWrite },
    webhooks: inbox ? base.webhooks : [],
  };
}

export function isZernioPlatform(value: unknown): value is ZernioPlatform {
  return typeof value === "string" && (ZERNIO_PLATFORMS as readonly string[]).includes(value);
}
