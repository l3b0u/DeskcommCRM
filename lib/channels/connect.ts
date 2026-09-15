/**
 * Conexão de um canal por CREDENCIAL — do lado de dentro do seam.
 *
 * A tela e a rota não podem saber qual provider é (invariante 1 da doutrina),
 * mas precisam de três coisas concretas: como se chama o canal para o usuário,
 * quais campos pedir, e se a credencial que ele colou presta. As três moram
 * aqui, onde nomear o provider é permitido.
 *
 * ─── Validar ANTES de gravar ────────────────────────────────────────────────
 *
 * Mesma decisão da conexão oficial, pelo mesmo motivo: gravar primeiro e
 * descobrir depois é o que faz o operador achar que conectou e só entender que
 * não na primeira mensagem que não sai — com o lead do outro lado esperando.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "./archived";
import { CHANNEL_PROVIDER_ZERNIO } from "./capabilities";
import { zernioBaseUrl } from "./zernio/credentials";
import { privateReplyToZernioComment, replyToZernioComment } from "./zernio/comments";
import { isZernioPlatform, zernioCapabilitiesForAccount, type ZernioPlatform, type ZernioPlatformCapabilities } from "./zernio/platform-capabilities";
import { replyToZernioReview } from "./zernio/reviews";
import type { ChannelProvider } from "./types";

/**
 * O canal conectável por credencial nesta instalação.
 *
 * Exportado como valor para que rota e tela não escrevam a string — é o que o
 * `lint:channels` cobra, e o que faz um canal seguinte trocar uma linha aqui
 * em vez de dez espalhadas.
 */
export const PARTNER_CHANNEL_PROVIDER: ChannelProvider = CHANNEL_PROVIDER_ZERNIO;

/**
 * Como o canal se chama PARA O USUÁRIO.
 *
 * O nome comercial mora aqui e não na tela por causa do lint — mas a razão é
 * anterior a ele: quem instala reconhece a marca do serviço que contratou, e a
 * tela que diz "provedor parceiro" obriga a adivinhar. O rótulo é dado, não
 * decisão de quem desenha a tela.
 */
export const PARTNER_CHANNEL_LABEL = "Zernio";

export interface PartnerCredentialsInput {
  accountId: string;
  apiKey: string;
}

export type PartnerValidation =
  | {
      ok: true;
      /** Número conectado, para a tela confirmar que é o esperado. */
      phoneNumber: string | null;
      displayName: string | null;
      /** Qualidade do número segundo a plataforma (GREEN/YELLOW/RED). */
      qualityRating: string | null;
      platform: ZernioPlatform;
      capabilities: ZernioPlatformCapabilities;
    }
  | { ok: false; reason: string };

/**
 * A credencial presta, e a conta é mesmo de WhatsApp?
 *
 * Confere as DUAS coisas de propósito. Uma chave válida apontando para uma
 * conta de outra rede autentica bem e falha em todo envio — e o operador veria
 * "conectado" numa tela de WhatsApp que nunca manda nada.
 */
export async function validatePartnerCredentials(
  input: PartnerCredentialsInput,
): Promise<PartnerValidation> {
  const accountId = input.accountId.trim();
  const apiKey = input.apiKey.trim();
  if (!accountId || !apiKey) return { ok: false, reason: "Informe a conta e a chave." };

  let res: Response;
  try {
    // LISTA e não `GET /accounts/{id}`: medido contra a API, o endpoint por id
    // aceita só `PUT` e responde 405 ao GET — e um 405 tratado como "credencial
    // inválida" mandaria o operador trocar uma chave que estava certa. Pior: a
    // primeira versão deste teste "passava" nos casos de recusa porque TODOS
    // recebiam 405, verde afirmando uma validação que não acontecia.
    res = await fetch(`${zernioBaseUrl()}/v1/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Rede caída não é credencial errada, e dizer "chave inválida" mandaria o
    // operador trocar uma chave que estava certa.
    return { ok: false, reason: "Não foi possível falar com o provedor. Tente de novo." };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "Chave recusada pelo provedor." };
  }
  if (!res.ok) {
    return { ok: false, reason: `Provedor respondeu ${res.status}.` };
  }

  const json = (await res.json().catch(() => null)) as {
    accounts?: Record<string, unknown>[];
  } | null;
  const contas = Array.isArray(json?.accounts) ? json.accounts : [];
  const conta = contas.find((c) => String(c._id ?? c.id) === accountId) ?? null;

  if (!conta) {
    // A chave presta, mas não alcança esta conta. É diferente de chave inválida,
    // e a mensagem precisa dizer QUAL das duas para o operador saber o que
    // corrigir.
    return { ok: false, reason: "Conta não encontrada para esta chave." };
  }

  if (!isZernioPlatform(conta.platform)) return { ok: false, reason: "Plataforma da conta não suportada." };

  const meta = (conta.metadata ?? {}) as Record<string, unknown>;
  const scopes = Array.isArray(conta.scopes) ? conta.scopes.filter((v): v is string => typeof v === "string") : Array.isArray(meta.scopes) ? meta.scopes.filter((v): v is string => typeof v === "string") : [];
  const capabilities = conta.capabilities && typeof conta.capabilities === "object" ? conta.capabilities as Record<string, boolean> : undefined;
  return {
    ok: true,
    phoneNumber: typeof meta.displayPhoneNumber === "string" ? meta.displayPhoneNumber : null,
    displayName: typeof conta.displayName === "string" ? conta.displayName : null,
    qualityRating: typeof meta.qualityRating === "string" ? meta.qualityRating : null,
    platform: conta.platform,
    capabilities: zernioCapabilitiesForAccount(conta.platform, { scopes, capabilities }),
  };
}

export interface PartnerAccount {
  accountId: string;
  platform: ZernioPlatform;
  displayName: string;
  username: string | null;
  capabilities: ZernioPlatformCapabilities;
}

export async function listPartnerAccounts(apiKey: string): Promise<{ ok: true; accounts: PartnerAccount[] } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetch(`${zernioBaseUrl()}/v1/accounts`, { headers: { Authorization: `Bearer ${apiKey.trim()}` } });
  } catch { return { ok: false, reason: "Não foi possível falar com o provedor. Tente de novo." }; }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "Chave recusada pelo provedor." };
  if (!response.ok) return { ok: false, reason: `Provedor respondeu ${response.status}.` };
  const body = await response.json().catch(() => null) as { accounts?: Record<string, unknown>[] } | null;
  const accounts = (Array.isArray(body?.accounts) ? body.accounts : []).flatMap((account): PartnerAccount[] => {
    const accountId = String(account._id ?? account.id ?? "");
    if (!accountId || !isZernioPlatform(account.platform)) return [];
    const metadata = account.metadata && typeof account.metadata === "object" ? account.metadata as Record<string, unknown> : {};
    const scopes = Array.isArray(account.scopes) ? account.scopes.filter((v): v is string => typeof v === "string") :
      Array.isArray(metadata.scopes) ? metadata.scopes.filter((v): v is string => typeof v === "string") : [];
    const capabilities = account.capabilities && typeof account.capabilities === "object"
      ? account.capabilities as Record<string, boolean>
      : undefined;
    return [{ accountId, platform: account.platform, displayName: String(account.displayName ?? account.username ?? accountId), username: typeof account.username === "string" ? account.username : null, capabilities: zernioCapabilitiesForAccount(account.platform, { scopes, capabilities }) }];
  });
  return { ok: true, accounts };
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/**
 * As colunas da sessão carregam o nome do provider — e é assim que a migration
 * 0117/0118 as criou, porque o CHECK precisa saber qual exigir. Escrevê-las da
 * rota faria a rota nomear o canal, que é o que o `lint:channels` reprovou na
 * primeira versão dela.
 *
 * Então a leitura e a escrita moram aqui, e a rota fala em conceitos: "a conta",
 * "a chave", "o token do webhook".
 */
export interface PartnerSession {
  id: string;
  accountId: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  status: string | null;
  webhookPathToken: string | null;
  hasApiKey: boolean;
  archivedAt: string | null;
  platform: ZernioPlatform;
  capabilities: ZernioPlatformCapabilities;
}

const COLUNAS =
  "id, zernio_account_id, zernio_platform, phone_number, display_name, status, webhook_path_token, zernio_token_encrypted, metadata";

function toPartnerSession(row: Record<string, unknown> | null): PartnerSession | null {
  if (!row) return null;
  const platform = isZernioPlatform(row.zernio_platform) ? row.zernio_platform : "whatsapp";
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  const savedCapabilities = metadata.zernio_capabilities && typeof metadata.zernio_capabilities === "object" ? metadata.zernio_capabilities as ZernioPlatformCapabilities : null;
  return {
    id: row.id as string,
    accountId: (row.zernio_account_id as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    status: (row.status as string) ?? null,
    webhookPathToken: (row.webhook_path_token as string) ?? null,
    hasApiKey: !!row.zernio_token_encrypted,
    archivedAt: (row.archived_at as string) ?? null,
    platform,
    capabilities: savedCapabilities ?? zernioCapabilitiesForAccount(platform, {}),
  };
}

export async function findPartnerSession(
  admin: SupabaseClient,
  organizationId: string,
): Promise<PartnerSession | null> {
  const buscar = (colunas: string) =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("provider", PARTNER_CHANNEL_PROVIDER)
      .maybeSingle();

  const { data } = await queryTolerantToMissingArchived(
    () => buscar(`${COLUNAS}, ${ARCHIVED_AT}`),
    () => buscar(COLUNAS),
  );
  return toPartnerSession(data as Record<string, unknown> | null);
}

export async function listPartnerSessions(admin: SupabaseClient, organizationId: string): Promise<PartnerSession[]> {
  const { data } = await admin.from("channel_sessions").select(`${COLUNAS}, ${ARCHIVED_AT}`).eq("organization_id", organizationId).eq("provider", PARTNER_CHANNEL_PROVIDER).is(ARCHIVED_AT, null).order("created_at");
  return (data ?? []).map((row) => toPartnerSession(row as Record<string, unknown>)).filter((row): row is PartnerSession => row !== null);
}

export async function sessaoParceiraParaAcaoSocial(
  admin: SupabaseClient,
  organizationId: string,
  sessionId: string,
): Promise<PartnerSession | null> {
  const { data } = await admin
    .from("channel_sessions")
    .select(`${COLUNAS}, ${ARCHIVED_AT}`)
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .eq("provider", PARTNER_CHANNEL_PROVIDER)
    .is(ARCHIVED_AT, null)
    .maybeSingle();
  return toPartnerSession(data as Record<string, unknown> | null);
}

export async function responderComentarioParceiro(
  admin: SupabaseClient,
  input: Parameters<typeof replyToZernioComment>[1] & { privateReply: boolean },
): Promise<unknown> {
  return input.privateReply
    ? privateReplyToZernioComment(admin, input)
    : replyToZernioComment(admin, input);
}

export async function responderAvaliacaoParceira(
  admin: SupabaseClient,
  input: Parameters<typeof replyToZernioReview>[1],
): Promise<unknown> {
  return replyToZernioReview(admin, input);
}

/**
 * Grava (ou ressuscita) a sessão.
 *
 * `archived_at: null` sempre: reconectar por cima de um canal excluído precisa
 * trazê-lo de volta. Sem isso o update deixaria a coluna no lugar e o canal
 * "conectado" ficaria invisível para o webhook, o envio e os seletores — todos
 * filtrados por ela.
 */
export async function savePartnerSession(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    existingId: string | null;
    accountId: string;
    apiKeyEncrypted: string;
    webhookPathToken: string;
    webhookSecretEncrypted: string;
    phoneNumber: string | null;
    displayName: string;
    platform: ZernioPlatform;
    capabilities: ZernioPlatformCapabilities;
  },
): Promise<{ id: string | null; error: string | null }> {
  let metadata = metadataInicialDoCanal();
  if (input.existingId) {
    const { data } = await admin.from("channel_sessions").select("metadata").eq("organization_id", input.organizationId).eq("id", input.existingId).maybeSingle();
    if (data?.metadata && typeof data.metadata === "object") metadata = data.metadata as typeof metadata;
  }
  const linha = {
    organization_id: input.organizationId,
    provider: PARTNER_CHANNEL_PROVIDER,
    zernio_account_id: input.accountId,
    zernio_platform: input.platform,
    zernio_token_encrypted: input.apiKeyEncrypted,
    webhook_path_token: input.webhookPathToken,
    webhook_secret_encrypted: input.webhookSecretEncrypted,
    phone_number: input.phoneNumber,
    display_name: input.displayName,
    status: "WORKING",
    archived_at: null,
    metadata: { ...metadata, zernio_capabilities: input.capabilities },
  };

  const { data, error } = input.existingId
    ? await admin.from("channel_sessions").update(linha).eq("organization_id", input.organizationId).eq("id", input.existingId).select("id").single()
    : await admin
        .from("channel_sessions")
        .insert(linha)
        .select("id")
        .single();

  return { id: (data?.id as string | undefined) ?? null, error: error?.message ?? null };
}
