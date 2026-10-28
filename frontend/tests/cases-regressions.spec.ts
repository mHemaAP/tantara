import { test, expect } from "@playwright/test";
import { taskGroup } from "../src/features/tasks/grouping";
import { matterStatusClass } from "../src/features/cases/status";
import { displayClientStatus } from "../src/features/clients/status";
import { test as browserTest, expect as browserExpect } from "@playwright/test";
const base = `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8112"}/api/v1`;
async function apiReady() {
  try {
    return (await fetch(`${base}/health`)).ok;
  } catch {
    return false;
  }
}

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

browserTest(
  "shell has no activity signal when the real activity feed is empty",
  async ({ page, request }) => {
    const login = await request.post(`${base}/auth/login`, {
      data: {
        email: process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
        password: process.env.TANTARA_E2E_PASSWORD || "tantara-local",
      },
    });
    browserExpect(login.ok()).toBeTruthy();
    const token = (await login.json()).access_token;
    await page.addInitScript((value) => {
      localStorage.setItem("tantara_token", value as string);
      document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
    }, token);
    await page.route(`${base}/dashboard/activity`, (route) =>
      route.fulfill({ json: [] }),
    );
    await page.goto("/cases");
    await page.getByRole("button", { name: "Recent activity" }).click();
    browserExpect(await page.locator(".activity-dot").count()).toBe(0);
    await browserExpect(page.getByText("No recent activity.")).toBeVisible();
  },
);

browserTest(
  "shell never displays a fabricated identity while auth is loading",
  async ({ page, request }) => {
    const login = await request.post(`${base}/auth/login`, {
      data: {
        email: process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
        password: process.env.TANTARA_E2E_PASSWORD || "tantara-local",
      },
    });
    browserExpect(login.ok()).toBeTruthy();
    const token = (await login.json()).access_token;
    await page.addInitScript((value) => {
      localStorage.setItem("tantara_token", value as string);
      document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
    }, token);
    await page.route(`${base}/auth/me`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto("/cases");
    await browserExpect(page.getByText("Signing in…")).toBeVisible();
    await browserExpect(page.getByText("Aarav Mehta")).toHaveCount(0);
  },
);

browserTest(
  "case API projects the earliest future hearing and the list renders it",
  async ({ page, request }) => {
    const login = await request.post(`${base}/auth/login`, {
      data: {
        email: process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
        password: process.env.TANTARA_E2E_PASSWORD || "tantara-local",
      },
    });
    browserExpect(login.ok()).toBeTruthy();
    const token = (await login.json()).access_token;
    const headers = { Authorization: `Bearer ${token}` };
    const casesResponse = await request.get(
      `${base}/cases?page=1&page_size=100`,
      { headers },
    );
    const hearingsResponse = await request.get(
      `${base}/hearings?page=1&page_size=100&sort=at`,
      { headers },
    );
    browserExpect(casesResponse.ok()).toBeTruthy();
    browserExpect(hearingsResponse.ok()).toBeTruthy();
    const caseRows = (await casesResponse.json()).items as Array<{
      id: string;
      title: string;
      next_hearing_at?: string;
    }>;
    const hearings = (await hearingsResponse.json()).items as Array<{
      case_id?: string;
      at: string;
      title?: string;
    }>;
    browserExpect(hearings.length).toBeGreaterThan(0);
    const linkedCase = caseRows.find(
      (row) =>
        row.next_hearing_at &&
        new Date(row.next_hearing_at).getTime() > Date.now() + 3 * 86400000,
    );
    browserExpect(
      linkedCase,
      "seeded API should have a future hearing far enough ahead to appear in the next calendar month",
    ).toBeTruthy();
    const futureHearings = hearings
      .filter(
        (item) =>
          item.case_id === linkedCase!.id && new Date(item.at) >= new Date(),
      )
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const hearing = futureHearings[0];
    browserExpect(futureHearings.length).toBeGreaterThan(0);
    browserExpect(linkedCase!.next_hearing_at).toBe(hearing.at);
    for (const item of caseRows) {
      if (item.next_hearing_at)
        browserExpect(
          new Date(item.next_hearing_at).getTime(),
        ).toBeGreaterThanOrEqual(Date.now() - 60_000);
    }
    await page.addInitScript((value) => {
      localStorage.setItem("tantara_token", value as string);
      document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
    }, token);
    await page.goto("/cases");
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: linkedCase!.title }) });
    await browserExpect(row).toContainText(
      new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(hearing.at)),
    );
    await page.goto(`/cases/${linkedCase!.id}`);
    await browserExpect(page.locator(".data-list")).toContainText(
      new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(linkedCase!.next_hearing_at!)),
    );
    await page.goto("/calendar");
    await page.getByRole("button", { name: "Next period" }).click();
    const selectedLabel = hearing.title || "Future case conference";
    const eventButton = page
      .getByRole("button", {
        name: new RegExp(`View ${selectedLabel}`, "i"),
      })
      .first();
    await browserExpect(eventButton).toBeVisible();
    await eventButton.click();
    const eventDetails = page.getByRole("dialog", { name: "Event details" });
    await browserExpect(eventDetails).toContainText(linkedCase!.title);
    await browserExpect(eventDetails).toContainText(
      new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(linkedCase!.next_hearing_at!)),
    );
  },
);

browserTest(
  "client case count zero is displayed as a real zero",
  async ({ page, request }) => {
    const login = await request.post(`${base}/auth/login`, {
      data: {
        email: process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
        password: process.env.TANTARA_E2E_PASSWORD || "tantara-local",
      },
    });
    browserExpect(login.ok()).toBeTruthy();
    const token = (await login.json()).access_token;
    const response = await request.get(`${base}/clients?page_size=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    browserExpect(response.ok()).toBeTruthy();
    const clients = (await response.json()).items as Array<{
      id: string;
      name: string;
      case_count?: number;
    }>;
    const zero = clients.find((client) => client.case_count === 0);
    browserExpect(
      zero,
      "seed includes a client whose real case_count is zero",
    ).toBeTruthy();
    await page.addInitScript((value) => {
      localStorage.setItem("tantara_token", value as string);
      document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
    }, token);
    await page.goto("/clients");
    const row = page.getByRole("row").filter({ hasText: zero!.name });
    await browserExpect(row.locator("td").nth(2)).toHaveText("0");
  },
);

browserTest(
  "calendar labels all-day events without a time or raw event enums",
  async ({ page, request }) => {
    browserTest.skip(!(await apiReady()), "TANTARA API is not running");
    const login = await request.post(`${base}/auth/login`, {
      data: {
        email: process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
        password: process.env.TANTARA_E2E_PASSWORD || "tantara-local",
      },
    });
    const token = (await login.json()).access_token;
    await page.addInitScript((value) => {
      localStorage.setItem("tantara_token", value as string);
      document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
    }, token);
    await page.goto("/calendar");
    const allDayEvent = page
      .getByRole("button", { name: /View All-day event/ })
      .first();
    await browserExpect(allDayEvent.locator("time")).toHaveCount(0);
    await allDayEvent.click();
    const details = page.getByRole("dialog", { name: "Event details" });
    await browserExpect(details).toContainText("All-day");
    await browserExpect(details).not.toContainText(
      /\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i,
    );
    await browserExpect(page.locator("body")).not.toContainText(
      /all_day_event|first_hearing|hearing_completed/i,
    );
  },
);
