"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import type { Message } from "@/lib/types/messaging";

type Interaction = {
  kind: "comment" | "review";
  postId?: string;
  commentId?: string;
  reviewId?: string;
  publicReply: boolean;
  privateReply: boolean;
};

export function SocialInteractionActions({ message }: { message: Message }) {
  const t = useT();
  const interaction = message.metadata.channel_interaction as Interaction | undefined;
  const [open, setOpen] = useState<"public" | "private" | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  if (!interaction || message.direction !== "inbound") return null;

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      if (interaction.kind === "comment") {
        await apiClient.post("/api/v1/channels/partner/comments/reply", {
          channel_session_id: message.channel_session_id,
          post_id: interaction.postId,
          comment_id: interaction.commentId,
          message: body.trim(),
          private_reply: open === "private",
        });
      } else {
        await apiClient.post("/api/v1/channels/partner/reviews/reply", {
          channel_session_id: message.channel_session_id,
          review_id: interaction.reviewId,
          message: body.trim(),
        });
      }
      toast.success(t("Resposta enviada."));
      setBody("");
      setOpen(null);
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Não foi possível responder."));
    } finally { setSending(false); }
  };

  return <div className="mt-2 flex flex-col gap-2 border-t border-current/15 pt-2">
    <div className="flex flex-wrap gap-1">
      {interaction.publicReply && <Button type="button" size="sm" variant="outline" onClick={() => setOpen("public")}>{interaction.kind === "review" ? t("Responder avaliação") : t("Responder publicamente")}</Button>}
      {interaction.privateReply && <Button type="button" size="sm" variant="outline" onClick={() => setOpen("private")}>{t("Responder em privado")}</Button>}
    </div>
    {open && <div className="flex flex-col gap-1">
      <textarea aria-label={t("Texto da resposta social")} value={body} onChange={(e) => setBody(e.target.value.slice(0, 4096))} className="min-h-16 rounded-md border border-input bg-background p-2 text-foreground" />
      <div className="flex justify-end gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>{t("Cancelar")}</Button><Button type="button" size="sm" disabled={sending || !body.trim()} onClick={() => void send()}>{sending ? t("Enviando…") : t("Enviar")}</Button></div>
    </div>}
  </div>;
}
