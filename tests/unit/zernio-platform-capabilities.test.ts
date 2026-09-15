import { describe, expect, it } from "vitest";
import { ZERNIO_CAPABILITIES, ZERNIO_PLATFORMS, zernioCapabilitiesForAccount } from "@/lib/channels/zernio/platform-capabilities";

describe("matriz omnichannel Zernio", () => {
  it("tem entrada tipada para toda plataforma contratada", () => {
    expect(Object.keys(ZERNIO_CAPABILITIES).sort()).toEqual([...ZERNIO_PLATFORMS].sort());
  });
  it("não anuncia Discord, ausente do Inbox oficial", () => {
    expect(ZERNIO_PLATFORMS).not.toContain("discord");
  });
  it("reduz a capacidade ao escopo efetivo da conta", () => {
    const capability = zernioCapabilitiesForAccount("instagram", { scopes: ["inbox:read", "comments:read"] });
    expect(capability.dms.send).toBe(false);
    expect(capability.comments).toEqual({ list: true, reply: false, privateReply: false });
  });
  it("libera o slice IG/FB e não promete inbox onde a API não oferece", () => {
    for (const platform of ["instagram", "facebook"] as const) {
      expect(ZERNIO_CAPABILITIES[platform].dms.send).toBe(true);
      expect(ZERNIO_CAPABILITIES[platform].comments.reply).toBe(true);
      expect(ZERNIO_CAPABILITIES[platform].comments.privateReply).toBe(true);
    }
    for (const platform of ["tiktok", "pinterest", "snapchat"] as const) {
      expect(ZERNIO_CAPABILITIES[platform].inbox).toBe(false);
    }
    expect(ZERNIO_CAPABILITIES.bluesky.dms.attachments).toBe(false);
    expect(ZERNIO_CAPABILITIES.reddit.dms.attachments).toBe(false);
  });
});
