import { test, expect } from "@playwright/test";
import { taskGroup } from "../src/features/tasks/grouping";
import { matterStatusClass } from "../src/features/cases/status";
import { displayClientStatus } from "../src/features/clients/status";

test("tasks partition into exclusive workspace-timezone groups including undated open work", () => {
  const now = new Date("2026-10-27T09:00:00Z"); // 14:30 in Asia/Kolkata
  const group = (status: string, due_at?: string | null) =>
    taskGroup({ status, due_at }, now);
  expect(group("open", "2026-10-26T23:00:00+05:30")).toBe("Overdue");
  expect(group("open", "2026-10-27T18:00:00+05:30")).toBe("Today");
  expect(group("open", "2026-10-30T10:00:00+05:30")).toBe("This week");
  expect(group("open", "2026-11-02T10:00:00+05:30")).toBe("Later");
  expect(group("open", null)).toBe("No due date");
  expect(group("done", null)).toBe("Done");
});

test("case status classes use semantic colors only for known statuses", () => {
  expect(matterStatusClass("active")).toBe("active");
  expect(matterStatusClass("pending")).toBe("pending");
  expect(matterStatusClass("closed")).toBe("closed");
  expect(matterStatusClass("review")).toBe("unknown");
  expect(matterStatusClass(undefined)).toBe("unknown");
});

test("missing client status remains unavailable instead of being inferred", () => {
  expect(displayClientStatus(undefined)).toBe("—");
  expect(displayClientStatus("inactive")).toBe("inactive");
});
