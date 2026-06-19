import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { apiFetch, apiJson, authAvailable, contractEnabled } from "./_client";

/**
 * Full CRUD round-trip against the real skills API for the test-auth user.
 * Self-cleaning (deletes the fixture skill before and after), so it is safe to
 * run repeatedly. Exercises the create/list/update/delete contract plus the
 * duplicate-name (409) and invalid-name (400) guards.
 */
const SKILL_NAME = "contract-smoke-skill";

type SkillRow = { id: string; name: string; enabled: boolean };

async function findSkillId(name: string): Promise<string | null> {
  const { data } = await apiJson<{ skills: SkillRow[] }>(
    "/api/settings/skills",
  );
  return data.skills.find((s) => s.name === name)?.id ?? null;
}

async function deleteSkillByName(name: string): Promise<void> {
  const id = await findSkillId(name);
  if (id) {
    await apiFetch("/api/settings/skills", { method: "DELETE", body: { id } });
  }
}

describe.skipIf(!(contractEnabled && authAvailable))(
  "contract / skills CRUD",
  () => {
    let createdId: string | null = null;

    beforeAll(async () => {
      await deleteSkillByName(SKILL_NAME);
    });

    afterAll(async () => {
      await deleteSkillByName(SKILL_NAME);
    });

    test("POST creates a skill (201) with the expected shape", async () => {
      const { status, data } = await apiJson<{ skill: SkillRow }>(
        "/api/settings/skills",
        {
          method: "POST",
          body: {
            name: SKILL_NAME,
            description: "Contract smoke skill",
            body: "# Contract smoke\n\nDo the thing.",
          },
        },
      );
      expect(status).toBe(201);
      expect(data.skill.name).toBe(SKILL_NAME);
      expect(data.skill.enabled).toBe(true);
      expect(typeof data.skill.id).toBe("string");
      createdId = data.skill.id;
    });

    test("GET list contains the created skill", async () => {
      const id = await findSkillId(SKILL_NAME);
      expect(id).toBe(createdId);
    });

    test("POST a duplicate name returns 409", async () => {
      const res = await apiFetch("/api/settings/skills", {
        method: "POST",
        body: {
          name: SKILL_NAME,
          description: "dup",
          body: "dup",
        },
      });
      expect(res.status).toBe(409);
    });

    test("POST a reserved/invalid name returns 400", async () => {
      const res = await apiFetch("/api/settings/skills", {
        method: "POST",
        body: { name: "new", description: "x", body: "y" },
      });
      expect(res.status).toBe(400);
    });

    test("PATCH toggles enabled to false", async () => {
      const { status, data } = await apiJson<{ skill: SkillRow }>(
        "/api/settings/skills",
        { method: "PATCH", body: { id: createdId, enabled: false } },
      );
      expect(status).toBe(200);
      expect(data.skill.enabled).toBe(false);
    });

    test("DELETE removes the skill and it leaves the list", async () => {
      const res = await apiFetch("/api/settings/skills", {
        method: "DELETE",
        body: { id: createdId },
      });
      expect(res.status).toBe(200);
      expect(await findSkillId(SKILL_NAME)).toBeNull();
    });
  },
);
