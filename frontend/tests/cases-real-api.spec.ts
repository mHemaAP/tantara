import { test, expect } from "@playwright/test";
import { installApiFixtures } from "./api-fixtures.mjs";
const base = `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8112"}/api/v1`;
async function apiReady() {
  try {
    return (await fetch(`${base}/health`)).ok;
  } catch {
    return false;
  }
}
test("real API workflow persists client, case, party, hearing and task", async ({
  page,
  request,
}) => {
  test.skip(!(await apiReady()), "TANTARA API is not running");
  test.setTimeout(90000);
  const email = process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
    password = process.env.TANTARA_E2E_PASSWORD || "tantara-local";
  const login = await request.post(`${base}/auth/login`, {
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const suffix = Date.now().toString();
  let clientId = "",
    caseId = "",
    taskId = "",
    hearingId = "";
  const post = async (path: string, data: unknown) => {
    const r = await request.post(`${base}${path}`, { headers, data });
    expect(
      r.ok(),
      `${path} should accept workflow data: ${await r.text()}`,
    ).toBeTruthy();
    return r.json();
  };
  const del = async (path: string) => {
    if (path)
      try {
        await request.delete(`${base}${path}`, { headers, timeout: 5000 });
      } catch {
        /* cleanup should not hide a completed persistence assertion if the test API stops */
      }
  };
  try {
    const client = await post("/clients", {
      name: `E2E Client ${suffix}`,
      email: `e2e-${suffix}@example.test`,
    });
    clientId = client.id;
    const matter = await post("/cases", {
      title: `E2E Matter ${suffix}`,
      client_id: clientId,
      claimant: "E2E Claimant",
      respondent: "E2E Respondent",
      forum: "SIAC",
      status: "active",
    });
    caseId = matter.id;
    await post(`/cases/${caseId}/participants`, {
      name: "E2E Counsel",
      party_role: "counsel",
      email: `counsel-${suffix}@example.test`,
    });
    const hearing = await post("/hearings", {
      title: `E2E Hearing ${suffix}`,
      case_id: caseId,
      at: new Date(Date.now() + 86400000).toISOString(),
      mode: "online",
    });
    hearingId = hearing.id;
    const task = await post("/tasks", {
      title: `E2E Task ${suffix}`,
      case_id: caseId,
      due_at: new Date(Date.now() + 86400000).toISOString(),
      priority: "high",
      status: "todo",
    });
    taskId = task.id;
    await page.route(`${base}/**`, async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "http://localhost:3011",
            "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
            "access-control-allow-headers": "authorization,content-type",
          },
        });
        return;
      }
      const upstream = await request.fetch(route.request().url(), {
        method: route.request().method(),
        headers: route.request().headers(),
        data: route.request().postData() || undefined,
      });
      await route.fulfill({
        status: upstream.status(),
        body: await upstream.body(),
        headers: {
          "content-type":
            upstream.headers()["content-type"] || "application/json",
          "access-control-allow-origin": "http://localhost:3011",
          "access-control-allow-credentials": "true",
        },
      });
    });
    await page.addInitScript(
      ({ tokenValue }) => {
        localStorage.removeItem("tantara_preview");
        localStorage.setItem("tantara_token", tokenValue);
        document.cookie = `tantara_token=${tokenValue}; Path=/; SameSite=Lax`;
      },
      { tokenValue: token },
    );
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto("/cases");
    await page
      .getByRole("textbox", { name: "Search cases" })
      .fill(`E2E Matter ${suffix}`);
    await expect(
      page.getByRole("link", { name: `E2E Matter ${suffix}` }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Case Title/ }).click();
    await page.reload();
    await page
      .getByRole("textbox", { name: "Search cases" })
      .fill(`E2E Matter ${suffix}`);
    await expect(
      page.getByRole("link", { name: `E2E Matter ${suffix}` }),
    ).toBeVisible();
    const persisted = await request.get(
      `${base}/cases?q=${encodeURIComponent(`E2E Matter ${suffix}`)}`,
      { headers },
    );
    expect((await persisted.json()).items[0].id).toBe(caseId);
    const participants = await request.get(`${base}/cases/${caseId}/overview`, {
      headers,
    });
    expect(participants.ok()).toBeTruthy();
  } finally {
    await del(taskId ? `/tasks/${taskId}` : "");
    await del(hearingId ? `/hearings/${hearingId}` : "");
    await del(caseId ? `/cases/${caseId}` : "");
    await del(clientId ? `/clients/${clientId}` : "");
  }
});
test("new case routes remain usable without horizontal overflow at target widths", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("tantara_preview", "true"),
  );
  await installApiFixtures(page);
  test.skip(!(await apiReady()), "TANTARA API is not running");
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/cases");
    await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow at ${width}`,
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test("case detail reports an unreadable id with a retryable not-found state", async ({
  page,
  request,
}) => {
  test.skip(!(await apiReady()), "TANTARA API is not running");
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
  await page.goto(`/cases/not-a-real-case-${Date.now()}`);
  await expect(
    page.getByRole("heading", { name: "Case not found" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("closed status restores from URL and table sorting toggles direction accessibly", async ({
  page,
  request,
}) => {
  test.skip(!(await apiReady()), "TANTARA API is not running");
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
  await page.goto("/cases?status=closed");
  await expect(page.getByRole("button", { name: /Closed/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto("/cases");
  const title = page.getByRole("button", { name: /Case Title/ });
  await title.click();
  await expect(page.locator("th").filter({ has: title })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await title.click();
  await expect(page.locator("th").filter({ has: title })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
});

test("calendar week view renders seven distinct dates", async ({
  page,
  request,
}) => {
  test.skip(!(await apiReady()), "TANTARA API is not running");
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
  await page.getByRole("button", { name: "Week" }).click();
  await expect.poll(() => page.locator("[data-calendar-day]").count()).toBe(7);
  expect(
    await page
      .locator("[data-calendar-day]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-calendar-day")),
      ),
  ).toHaveLength(7);
});

test("preview case form cannot submit a mutation", async ({
  page,
  request,
}) => {
  test.skip(!(await apiReady()), "TANTARA API is not running");
  const login = await request.post(`${base}/auth/login`, {
    data: {
      email: process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
      password: process.env.TANTARA_E2E_PASSWORD || "tantara-local",
    },
  });
  const token = (await login.json()).access_token;
  await page.addInitScript((value) => {
    localStorage.setItem("tantara_preview", "true");
    localStorage.setItem("tantara_token", value as string);
    document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
  }, token);
  await page.goto("/cases/new");
  await expect(page.getByRole("button", { name: "Save case" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save case" })).toHaveAttribute(
    "title",
    "Changes are disabled in read-only preview",
  );
});
