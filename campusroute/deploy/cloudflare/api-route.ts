// The plan API — the same five endpoints the CampusRoute Node server exposes,
// backed by D1 instead of JSON files:
//
//   GET    /api/health
//   POST   /api/plans            { state }            -> { id, editKey, revision }
//   GET    /api/plans/:id                             -> { state, revision, canEdit }
//   PUT    /api/plans/:id        { state, revision }   -> { revision }   X-Edit-Key
//   DELETE /api/plans/:id                                                X-Edit-Key
//
// There are no accounts: publishing a plan returns an edit key, and only that
// key can change the plan afterwards. The key is stored as a SHA-256 hash, and
// it travels in a header (in the browser it lives in the URL fragment), so it
// never lands in a request line or an access log.

import { createFileRoute } from "@tanstack/react-router";
import { bindings } from "../../lib/bindings.server";
import { validateState } from "../../planner/engine.js";

const MAX_PLAN_BYTES = 2_000_000;
const MAX_PLANS = 5_000;
// No look-alike characters: a plan id gets read aloud and typed by hand.
const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

type PlanRow = {
  id: string;
  edit_key_hash: string;
  revision: number;
  state: string;
  updated_at: string;
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const db = () => {
  const database = bindings().DB;
  if (!database) throw new Error("This deployment has no plan database configured.");
  return database;
};

function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

function newEditKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compare without leaking where two hashes start to differ.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const isPlanId = (id: string) => /^[a-z2-9]{12}$/.test(id);

async function keyMatches(row: PlanRow | null, editKey: string): Promise<boolean> {
  if (!row || !editKey) return false;
  return constantTimeEquals(row.edit_key_hash, await sha256Hex(editKey));
}

// Read and size-cap the body before parsing it.
async function readState(request: Request): Promise<{ state: unknown; revision: unknown }> {
  const text = await request.text();
  if (text.length > MAX_PLAN_BYTES) {
    throw Object.assign(new Error("That plan is larger than this server accepts."), { status: 413 });
  }
  try {
    const body = JSON.parse(text || "{}") as { state?: unknown; revision?: unknown };
    return { state: body.state, revision: body.revision };
  } catch {
    throw Object.assign(new Error("The request body was not valid JSON."), { status: 400 });
  }
}

// The Worker validates every plan it stores with the same engine the browser
// uses, so a malformed plan never reaches another viewer.
function checkState(state: unknown) {
  const errors = validateState(state);
  if (errors.length) {
    throw Object.assign(new Error(errors[0]), { status: 422, payload: { errors } });
  }
}

const readPlan = async (id: string) =>
  (await db().prepare("SELECT id, edit_key_hash, revision, state, updated_at FROM plans WHERE id = ?").bind(id).first()) as PlanRow | null;

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const editKey = request.headers.get("x-edit-key") || "";

  if (segments[0] === "health") return json({ ok: true, service: "campusroute" });

  if (segments[0] === "plans" && segments.length === 1) {
    if (request.method !== "POST") return json({ error: "Use POST to create a plan." }, 405);
    const { state } = await readState(request);
    checkState(state);

    const count = (await db().prepare("SELECT COUNT(*) AS n FROM plans").first()) as { n: number } | null;
    if ((count?.n ?? 0) >= MAX_PLANS) {
      return json({ error: "This server is holding as many plans as it is configured to keep." }, 507);
    }

    const id = newId();
    const editKeyValue = newEditKey();
    const now = new Date().toISOString();
    await db()
      .prepare("INSERT INTO plans (id, edit_key_hash, revision, state, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)")
      .bind(id, await sha256Hex(editKeyValue), JSON.stringify(state), now, now)
      .run();
    return json({ id, editKey: editKeyValue, revision: 1, updatedAt: now }, 201);
  }

  if (segments[0] === "plans" && segments.length === 2) {
    const id = segments[1];
    if (!isPlanId(id)) return json({ error: "No plan with that id." }, 404);

    if (request.method === "GET") {
      const row = await readPlan(id);
      if (!row) return json({ error: "No plan with that id." }, 404);
      return json({
        state: JSON.parse(row.state),
        revision: row.revision,
        updatedAt: row.updated_at,
        canEdit: await keyMatches(row, editKey),
      });
    }

    if (request.method === "PUT") {
      // Authorise before looking at the body: a viewer without the edit key
      // should be told that, not handed a critique of what they sent.
      const row = await readPlan(id);
      if (!row) return json({ error: "No plan with that id." }, 404);
      if (!(await keyMatches(row, editKey))) {
        return json({ error: "This plan is read-only from here. Open it with its edit link to make changes." }, 403);
      }
      const { state, revision } = await readState(request);
      checkState(state);

      const now = new Date().toISOString();
      // The revision in the WHERE clause is the concurrency check: a save built
      // on a stale copy changes no rows and is reported as a conflict.
      const result = await db()
        .prepare("UPDATE plans SET state = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
        .bind(JSON.stringify(state), now, id, Number(revision))
        .run();
      if (!result.meta.changes) {
        const current = await readPlan(id);
        return json(
          { error: "The shared plan changed since you loaded it. Reload it before saving.", revision: current?.revision },
          409,
        );
      }
      return json({ revision: Number(revision) + 1, updatedAt: now });
    }

    if (request.method === "DELETE") {
      const row = await readPlan(id);
      if (!row) return json({ error: "No plan with that id." }, 404);
      if (!(await keyMatches(row, editKey))) return json({ error: "Only the edit link can delete a plan." }, 403);
      await db().prepare("DELETE FROM plans WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    return json({ error: "Method not allowed on a plan." }, 405);
  }

  return json({ error: "No such endpoint." }, 404);
}

async function run(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const payload = (error as { payload?: Record<string, unknown> }).payload ?? {};
    if (status >= 500) console.error("plan api error", error);
    return json(
      {
        error: status >= 500 ? "The server could not complete that request." : (error as Error).message,
        ...payload,
      },
      status,
    );
  }
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
      PUT: ({ request }) => run(request),
      DELETE: ({ request }) => run(request),
    },
  },
});
