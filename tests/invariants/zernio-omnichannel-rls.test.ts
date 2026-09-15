import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres` });
const ids = {
  orgA: "71100000-0000-4000-8000-000000000001", orgB: "71100000-0000-4000-8000-000000000002",
  userA: "71100000-0000-4000-8000-000000000011", userB: "71100000-0000-4000-8000-000000000012",
  contactA: "71100000-0000-4000-8000-000000000021", contactB: "71100000-0000-4000-8000-000000000022",
  sessionA: "71100000-0000-4000-8000-000000000031", sessionB: "71100000-0000-4000-8000-000000000032",
};
async function asUser(user: string, sql: string, args: unknown[] = []) {
  const client = await pool.connect();
  try { await client.query("begin"); await client.query("set local role authenticated"); await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user })]); const result = await client.query(sql, args); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
beforeAll(async () => {
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1,'zernio-rls-a','A','A'),($2,'zernio-rls-b','B','B')", [ids.orgA, ids.orgB]);
  await pool.query("insert into auth.users(id,email) values($1,'za@test.invalid'),($2,'zb@test.invalid')", [ids.userA, ids.userB]);
  await pool.query("insert into user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'admin',now()),($3,$4,'admin',now())", [ids.orgA, ids.userA, ids.orgB, ids.userB]);
  await pool.query("insert into contacts(id,organization_id,name) values($1,$2,'Contato A'),($3,$4,'Contato B')", [ids.contactA, ids.orgA, ids.contactB, ids.orgB]);
  await pool.query("insert into channel_sessions(id,organization_id,provider,zernio_platform,zernio_account_id,webhook_secret_encrypted) values($1,$2,'zernio','instagram','acc-a','\\x00'),($3,$4,'zernio','facebook','acc-b','\\x00')", [ids.sessionA, ids.orgA, ids.sessionB, ids.orgB]);
  await pool.query("insert into contact_channel_identities(organization_id,contact_id,channel_session_id,provider,platform,external_user_id) values($1,$2,$3,'zernio','instagram','social-a'),($4,$5,$6,'zernio','facebook','social-b')", [ids.orgA, ids.contactA, ids.sessionA, ids.orgB, ids.contactB, ids.sessionB]);
  await pool.query("insert into zernio_webhook_event_receipts(organization_id,channel_session_id,event_id,event_type) values($1,$2,'event-a','message.received'),($3,$4,'event-b','comment.received')", [ids.orgA, ids.sessionA, ids.orgB, ids.sessionB]);
});
afterAll(() => pool.end());

describe("Zernio omnichannel: isolamento de dois tenants", () => {
  for (const table of ["contact_channel_identities", "zernio_webhook_event_receipts"] as const) {
    it(`${table}: cada usuário vê somente sua organização`, async () => {
      expect((await asUser(ids.userA, `select organization_id from ${table}`)).rows).toEqual([{ organization_id: ids.orgA }]);
      expect((await asUser(ids.userB, `select organization_id from ${table}`)).rows).toEqual([{ organization_id: ids.orgB }]);
    });
  }

  it("rejeita FK composta que mistura organização e contato", async () => {
    await expect(pool.query("insert into contact_channel_identities(organization_id,contact_id,channel_session_id,provider,platform,external_user_id) values($1,$2,$3,'zernio','instagram','cross')", [ids.orgA, ids.contactB, ids.sessionA])).rejects.toMatchObject({ code: "23503" });
  });

  it("a mesma conta externa ativa não pode pertencer a dois tenants", async () => {
    await expect(pool.query("insert into channel_sessions(organization_id,provider,zernio_platform,zernio_account_id,webhook_secret_encrypted) values($1,'zernio','instagram','acc-a','\\x00')", [ids.orgB])).rejects.toMatchObject({ code: "23505" });
  });
});
