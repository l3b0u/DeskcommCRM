import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialInteractionActions } from "@/components/inbox/SocialInteractionActions";
import { apiClient } from "@/lib/api/client";
import type { Message } from "@/lib/types/messaging";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn(async () => ({ data: { sent: true } })) } }));

const base = { id: "m", organization_id: "o", conversation_id: "c", channel_session_id: "11111111-1111-4111-8111-111111111111", contact_id: "ct", external_id: "e", type: "text", direction: "inbound", status: "delivered", ack: null, error_code: null, error_message: null, body: "oi", media_url: null, media_mime: null, media_size_bytes: null, media_storage_path: null, sent_via: "system", sent_by_user_id: null, sent_at: new Date().toISOString(), delivered_at: null, read_at: null, edited_at: null, revoked_at: null, reply_to_message_id: null, created_at: new Date().toISOString() } as const;

afterEach(() => vi.clearAllMocks());

describe("ações sociais no cockpit", () => {
  it("oferece resposta pública e privada somente quando suportadas", () => {
    render(<SocialInteractionActions message={{ ...base, metadata: { channel_interaction: { kind: "comment", postId: "p", commentId: "x", publicReply: true, privateReply: true } } } as Message} />);
    expect(screen.getByRole("button", { name: "Responder publicamente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Responder em privado" })).toBeInTheDocument();
  });

  it("envia review pela rota ligada ao botão", async () => {
    render(<SocialInteractionActions message={{ ...base, metadata: { channel_interaction: { kind: "review", reviewId: "r/1", publicReply: true, privateReply: false } } } as Message} />);
    fireEvent.click(screen.getByRole("button", { name: "Responder avaliação" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Texto da resposta social" }), { target: { value: "Obrigado" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/v1/channels/partner/reviews/reply", expect.objectContaining({ review_id: "r/1", message: "Obrigado" })));
  });
});
