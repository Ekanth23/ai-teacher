/**
 * Stage 2C-1 — Workflow store unit tests.
 *
 * Covers run creation, phase advancement, event recording, and the
 * PO Decision 3 routing (Alternative B).
 */

import { describe, expect, it } from "vitest";

import { InMemoryWorkflowStore, createWorkflowStore } from "../src/workflow-store.js";
import { WorkflowNotFoundError } from "../src/errors.js";
import { canTransition } from "../src/workflow.js";

describe("workflow store", () => {
  it("creates a run in REQUESTED phase", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    expect(run.id).toMatch(/^wf-/);
    expect(run.storyId).toBe("US-101");
    expect(run.phase).toBe("REQUESTED");
    expect(run.history).toHaveLength(0);
    expect(run.createdAt).toBeTruthy();
    expect(run.updatedAt).toBeTruthy();
  });

  it("generates unique IDs for each run", () => {
    const store = createWorkflowStore();
    const run1 = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });
    const run2 = store.create({ storyId: "US-102", requestedBy: "po", intent: "test" });

    expect(run1.id).not.toBe(run2.id);
  });

  it("retrieves a run by ID", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    const retrieved = store.get(run.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(run.id);
    expect(retrieved?.storyId).toBe("US-101");
  });

  it("returns null for a non-existent run", () => {
    const store = createWorkflowStore();
    expect(store.get("wf-nonexistent")).toBeNull();
  });

  it("advances a run through the state machine", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    const advanced = store.advance(run.id, {
      to: "PLANNING",
      trigger: "PLAN_REQUESTED",
      actor: "po",
    });

    expect(advanced.phase).toBe("PLANNING");
    expect(advanced.history).toHaveLength(1);
    expect(advanced.history[0]?.from).toBe("REQUESTED");
    expect(advanced.history[0]?.to).toBe("PLANNING");
    expect(advanced.history[0]?.trigger).toBe("PLAN_REQUESTED");
  });

  it("records events on a run", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    const updated = store.recordEvent(run.id, {
      from: "REQUESTED",
      to: "REQUESTED",
      trigger: "EXTERNAL_BLOCK",
      actor: "po",
      note: "test event",
    });

    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]?.note).toBe("test event");
  });

  it("records events without a note (note is optional)", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    const updated = store.recordEvent(run.id, {
      from: "REQUESTED",
      to: "REQUESTED",
      trigger: "EXTERNAL_BLOCK",
      actor: "po",
    });

    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]?.note).toBeNull();
  });

  it("throws WorkflowNotFoundError for non-existent run on advance", () => {
    const store = createWorkflowStore();
    expect(() =>
      store.advance("wf-nonexistent", {
        to: "PLANNING",
        trigger: "PLAN_REQUESTED",
        actor: "po",
      }),
    ).toThrow(WorkflowNotFoundError);
  });

  it("throws WorkflowNotFoundError for non-existent run on recordEvent", () => {
    const store = createWorkflowStore();
    expect(() =>
      store.recordEvent("wf-nonexistent", {
        from: "REQUESTED",
        to: "REQUESTED",
        trigger: "EXTERNAL_BLOCK",
        actor: "po",
      }),
    ).toThrow(WorkflowNotFoundError);
  });

  it("enforces illegal transitions", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    // PLAN_READY -> BUILDING is NOT a legal edge
    store.advance(run.id, { to: "PLANNING", trigger: "PLAN_REQUESTED", actor: "po" });
    store.advance(run.id, { to: "PLAN_READY", trigger: "PLAN_PRODUCED", actor: "po" });

    expect(() =>
      store.advance(run.id, { to: "BUILDING", trigger: "APPROVAL_GRANTED", actor: "po" }),
    ).toThrow();
  });

  it("lists all runs", () => {
    const store = createWorkflowStore();
    store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });
    store.create({ storyId: "US-102", requestedBy: "po", intent: "test" });

    expect(store.all()).toHaveLength(2);
  });
});

describe("PO Decision 3 routing (Alternative B)", () => {
  it("routes PO_DECISION_REQUIRED from PLANNING to PO_DECISION_REQUIRED", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    store.advance(run.id, { to: "PLANNING", trigger: "PLAN_REQUESTED", actor: "po" });

    const advanced = store.advance(run.id, {
      to: "PO_DECISION_REQUIRED",
      trigger: "PO_DECISION_REQUIRED",
      actor: "po",
    });

    expect(advanced.phase).toBe("PO_DECISION_REQUIRED");
    expect(advanced.history).toHaveLength(2);
    expect(advanced.history[1]?.to).toBe("PO_DECISION_REQUIRED");
  });

  it("confirms the state machine graph has the ambiguity", () => {
    // The underlying workflow.ts graph lists PO_DECISION_REQUIRED in both
    // the BLOCKED edge and the PO_DECISION_REQUIRED edge from PLANNING.
    // The store must route to PO_DECISION_REQUIRED (Alternative B).
    expect(canTransition("PLANNING", "PO_DECISION_REQUIRED", "PO_DECISION_REQUIRED")).toBe(true);
    expect(canTransition("PLANNING", "BLOCKED", "PO_DECISION_REQUIRED")).toBe(true);
  });

  it("store routes to PO_DECISION_REQUIRED even when BLOCKED is also legal", () => {
    const store = createWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "test" });

    store.advance(run.id, { to: "PLANNING", trigger: "PLAN_REQUESTED", actor: "po" });

    // Even though canTransition("PLANNING", "BLOCKED", "PO_DECISION_REQUIRED") is true,
    // the store must route to PO_DECISION_REQUIRED.
    const advanced = store.advance(run.id, {
      to: "PO_DECISION_REQUIRED",
      trigger: "PO_DECISION_REQUIRED",
      actor: "po",
    });

    expect(advanced.phase).toBe("PO_DECISION_REQUIRED");
    expect(advanced.phase).not.toBe("BLOCKED");
  });
});

describe("InMemoryWorkflowStore isolation", () => {
  it("maintains separate state for each store instance", () => {
    const store1 = new InMemoryWorkflowStore();
    const store2 = new InMemoryWorkflowStore();

    const run1 = store1.create({ storyId: "US-101", requestedBy: "po", intent: "test" });
    const run2 = store2.create({ storyId: "US-102", requestedBy: "po", intent: "test" });

    expect(store1.all()).toHaveLength(1);
    expect(store2.all()).toHaveLength(1);
    expect(store1.get(run2.id)).toBeNull();
    expect(store2.get(run1.id)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Rev 19 Decision 3 — auditable waiver grants and revocations                  */
/* -------------------------------------------------------------------------- */

describe("waiver audit events", () => {
  function verifyingRun(store: InMemoryWorkflowStore) {
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "waiver tests" });
    store.advance(run.id, { to: "PLANNING", trigger: "PLAN_REQUESTED", actor: "po" });
    store.advance(run.id, { to: "PLAN_READY", trigger: "PLAN_PRODUCED", actor: "orchestrator" });
    return store.get(run.id)!;
  }

  const validGrant = { checkId: "headed-e2e", phase: "VERIFYING", actor: "po", reason: "Browser unavailable" } as const;

  it("records an auditable waiver-grant event on a successful grant", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);

    const result = store.grantWaiver(run.id, validGrant);

    expect(result.ok).toBe(true);
    expect(result.waiver?.actor).toBe("po");
    expect(result.waiver?.grantedAt).toBeTruthy();
    expect(result.waiver?.revokedBy).toBeNull();

    const history = store.get(run.id)!.history;
    const grantEvents = history.filter((e) => e.kind === "waiver-grant");
    expect(grantEvents).toHaveLength(1);
    const event = grantEvents[0]!;
    expect(event.actor).toBe("po");
    expect(event.at).toBeTruthy();
    expect(event.trigger).toBeNull();
    expect(event.from).toBe("PLAN_READY");
    expect(event.to).toBe("PLAN_READY");
    expect(event.waiver).toEqual({ checkId: "headed-e2e", phase: "VERIFYING", reason: "Browser unavailable", grantedBy: null });
    expect(event.note).toContain("Browser unavailable");

    // The waiver is held on the run, associated with this run only.
    expect(store.get(run.id)!.waivers).toHaveLength(1);
    expect(store.get(run.id)!.waivers[0]?.checkId).toBe("headed-e2e");
  });

  it("records an auditable waiver-revocation event on a successful revocation", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);

    const result = store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });

    expect(result.ok).toBe(true);
    expect(result.waiver?.revokedBy).toBe("po");
    expect(result.waiver?.revokedAt).toBeTruthy();

    const revocation = store.get(run.id)!.history.filter((e) => e.kind === "waiver-revocation");
    expect(revocation).toHaveLength(1);
    expect(revocation[0]?.actor).toBe("po");
    expect(revocation[0]?.trigger).toBeNull();
    expect(revocation[0]?.from).toBe(revocation[0]?.to);
    expect(revocation[0]?.waiver).toEqual({ checkId: "headed-e2e", phase: "VERIFYING", reason: null, grantedBy: "po" });
  });

  it("waiver entries are distinguishable from transition events", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);
    store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });

    const history = store.get(run.id)!.history;
    // Pre-existing transitions keep their kind, trigger and phase movement.
    expect(history[0]).toMatchObject({ kind: "transition", trigger: "PLAN_REQUESTED", from: "REQUESTED", to: "PLANNING", waiver: null });
    expect(history[1]).toMatchObject({ kind: "transition", trigger: "PLAN_PRODUCED", from: "PLANNING", to: "PLAN_READY", waiver: null });
    // Waiver entries never move the run and never carry a transition trigger.
    for (const event of history.filter((e) => e.kind !== "transition")) {
      expect(event.trigger).toBeNull();
      expect(event.from).toBe(event.to);
      expect(event.waiver).not.toBeNull();
    }
    expect(store.get(run.id)!.phase).toBe("PLAN_READY");
    expect(store.get(run.id)!.history).toHaveLength(4);
  });

  it("rejects a grant by an unauthorized actor without recording a grant event", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    const before = store.get(run.id)!;

    const result = store.grantWaiver(run.id, { ...validGrant, actor: "orchestrator" });

    expect(result.ok).toBe(false);
    expect(result.waiver).toBeNull();
    expect(result.reason).toContain("not a human PO");
    expect(store.get(run.id)!.history.filter((e) => e.kind !== "transition")).toHaveLength(0);
    expect(store.get(run.id)!.waivers).toHaveLength(0);
    expect(store.get(run.id)).toEqual(before);
  });

  it("rejects a revocation by a non-grantor and leaves the waiver valid (PD-9)", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, { ...validGrant, actor: "human" });
    const before = store.get(run.id)!;

    const result = store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Only the granting actor");
    expect(store.get(run.id)!.history.filter((e) => e.kind === "waiver-revocation")).toHaveLength(0);
    expect(store.get(run.id)!.waivers[0]?.revokedBy).toBeNull();
    expect(store.get(run.id)).toEqual(before);
  });

  it("rejects a revocation by an unauthorized actor", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);
    const before = store.get(run.id)!;

    const result = store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "opencode" });

    expect(result.ok).toBe(false);
    expect(store.get(run.id)!.history.filter((e) => e.kind === "waiver-revocation")).toHaveLength(0);
    expect(store.get(run.id)).toEqual(before);
  });

  it("rejects a grant without a reason", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    const before = store.get(run.id)!;

    const result = store.grantWaiver(run.id, { ...validGrant, reason: "   " });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("non-empty reason");
    expect(store.get(run.id)).toEqual(before);
  });

  it("rejects a duplicate active grant for the same check and phase (PD-10)", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);
    const before = store.get(run.id)!;

    const result = store.grantWaiver(run.id, { ...validGrant, actor: "human" });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("PD-10");
    expect(store.get(run.id)!.waivers).toHaveLength(1);
    expect(store.get(run.id)!.history.filter((e) => e.kind === "waiver-grant")).toHaveLength(1);
    expect(store.get(run.id)).toEqual(before);
  });

  it("keeps one waiver per check and phase, so a grant for a different phase is allowed", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);

    const result = store.grantWaiver(run.id, { ...validGrant, phase: "TESTING" });

    expect(result.ok).toBe(true);
    expect(store.get(run.id)!.waivers).toHaveLength(2);
  });

  it("allows a re-grant after revocation, retaining the earlier audit trail", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);
    store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });

    const result = store.grantWaiver(run.id, { ...validGrant, reason: "Browser fixed" });

    expect(result.ok).toBe(true);
    const history = store.get(run.id)!.history;
    expect(history.filter((e) => e.kind === "waiver-grant")).toHaveLength(2);
    expect(history.filter((e) => e.kind === "waiver-revocation")).toHaveLength(1);
    expect(history.map((e) => e.kind)).toEqual([
      "transition",
      "transition",
      "waiver-grant",
      "waiver-revocation",
      "waiver-grant",
    ]);
    // The ledger holds exactly one record for the pair, and it is the live one.
    const waivers = store.get(run.id)!.waivers;
    expect(waivers).toHaveLength(1);
    expect(waivers[0]?.revokedBy).toBeNull();
    expect(waivers[0]?.reason).toBe("Browser fixed");
  });

  it("rejects a revocation for an unknown check or phase", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);
    const before = store.get(run.id)!;

    expect(store.revokeWaiver(run.id, { checkId: "other-check", phase: "VERIFYING", actor: "po" }).ok).toBe(false);
    expect(store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "TESTING", actor: "po" }).ok).toBe(false);
    expect(store.get(run.id)).toEqual(before);
  });

  it("rejects revoking an already-revoked waiver", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    store.grantWaiver(run.id, validGrant);
    store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });
    const before = store.get(run.id)!;

    const result = store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("already revoked");
    expect(store.get(run.id)!.history.filter((e) => e.kind === "waiver-revocation")).toHaveLength(1);
    expect(store.get(run.id)).toEqual(before);
  });

  it("rejects grants and revocations once the run is terminal", () => {
    const store = new InMemoryWorkflowStore();
    const run = store.create({ storyId: "US-101", requestedBy: "po", intent: "waiver tests" });
    store.advance(run.id, { to: "BLOCKED", trigger: "EXTERNAL_BLOCK", actor: "po" });
    const before = store.get(run.id)!;

    const grant = store.grantWaiver(run.id, validGrant);
    expect(grant.ok).toBe(false);
    expect(grant.reason).toContain("terminal");

    const revoke = store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });
    expect(revoke.ok).toBe(false);
    expect(revoke.reason).toContain("terminal");

    expect(store.get(run.id)!.history.filter((e) => e.kind !== "transition")).toHaveLength(0);
    expect(store.get(run.id)).toEqual(before);
  });

  it("throws for an unknown workflow id and leaves the store untouched", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);
    const sizeBefore = store.all().length;
    const snapshot = store.get(run.id)!;

    expect(() => store.grantWaiver("wf-missing", validGrant)).toThrow(WorkflowNotFoundError);
    expect(() => store.revokeWaiver("wf-missing", { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" })).toThrow(WorkflowNotFoundError);

    expect(store.all()).toHaveLength(sizeBefore);
    expect(store.get(run.id)).toEqual(snapshot);
  });

  it("writes the waiver and its event in one snapshot (no partial state)", () => {
    const store = new InMemoryWorkflowStore();
    const run = verifyingRun(store);

    // After the call, the returned run and the stored run both contain the
    // waiver record and its event. No intermediate state is observable.
    store.grantWaiver(run.id, validGrant);
    const afterGrant = store.get(run.id)!;
    expect(afterGrant.waivers).toHaveLength(1);
    expect(afterGrant.history.filter((e) => e.kind === "waiver-grant")).toHaveLength(1);

    store.revokeWaiver(run.id, { checkId: "headed-e2e", phase: "VERIFYING", actor: "po" });
    const afterRevoke = store.get(run.id)!;
    expect(afterRevoke.waivers[0]?.revokedBy).toBe("po");
    expect(afterRevoke.history.filter((e) => e.kind === "waiver-revocation")).toHaveLength(1);
    // Both operations live on the same run and only that run.
    expect(store.all()).toHaveLength(1);
  });
});
