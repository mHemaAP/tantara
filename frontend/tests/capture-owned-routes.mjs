import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const frontend = "http://localhost:3011";
const api =
  (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8112").replace(
    /\/$/,
    "",
  ) + "/api/v1";
const login = await fetch(`${api}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: process.env.TANTARA_E2E_EMAIL || "advocate@tantara.local",
    password: process.env.TANTARA_E2E_PASSWORD || "tantara-local",
  }),
});
if (!login.ok) throw new Error(`API login failed: ${login.status}`);
const token = (await login.json()).access_token;
const auth = { Authorization: `Bearer ${token}` };
const casesResponse = await fetch(`${api}/cases?page_size=1`, {
  headers: auth,
});
if (!casesResponse.ok)
  throw new Error(`Case lookup failed: ${casesResponse.status}`);
const firstCase = (await casesResponse.json()).items?.[0];
if (!firstCase)
  throw new Error("Seeded API returned no case for detail capture");

await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
const views = [
  {
    route: "/cases",
    name: "cases-desktop",
    viewport: { width: 1440, height: 1000 },
    settled: "table",
  },
  {
    route: "/cases",
    name: "cases-mobile",
    viewport: { width: 390, height: 844 },
    settled: "table",
  },
  {
    route: `/cases/${firstCase.id}`,
    name: "case-detail-desktop",
    viewport: { width: 1440, height: 1000 },
    settled: "detail",
  },
  {
    route: `/cases/${firstCase.id}`,
    name: "case-detail-failure",
    viewport: { width: 1440, height: 1000 },
    settled: "detail",
    failure: true,
  },
  {
    route: "/clients",
    name: "clients-desktop",
    viewport: { width: 1440, height: 1000 },
    settled: "table",
  },
  {
    route: "/tasks",
    name: "tasks-desktop",
    viewport: { width: 1440, height: 1000 },
    settled: "settled",
  },
  {
    route: "/calendar",
    name: "calendar-desktop",
    viewport: { width: 1440, height: 1000 },
    settled: "calendar",
  },
  {
    route: "/calendar",
    name: "calendar-mobile",
    viewport: { width: 390, height: 844 },
    settled: "calendar",
  },
  {
    route: "/dashboard",
    name: "dashboard-desktop",
    viewport: { width: 1440, height: 1000 },
    settled: "table",
  },
];

async function makePage(view, failure = false) {
  const context = await browser.newContext({ viewport: view.viewport });
  await context.addInitScript(
    ({ value }) => {
      localStorage.removeItem("tantara_preview");
      localStorage.setItem("tantara_token", value);
      document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
    },
    { value: token },
  );
  const page = await context.newPage();
  if (failure)
    await page.route(`${api}/**`, (route) => {
      if (
        new URL(route.request().url()).pathname.endsWith("/auth/me") ||
        route.request().method() === "OPTIONS"
      )
        return route.continue();
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":{"message":"Capture failure state"}}',
      });
    });
  await page.goto(`${frontend}${view.route}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForFunction(
    () => !document.body.innerText.includes("Opening your workspace…"),
  );
  if (view.settled === "table")
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".matter-table tbody tr").length > 0 ||
        document.querySelector(".matter-empty, .matter-error"),
    );
  if (
    (view.name.startsWith("cases-") || view.route === "/dashboard") &&
    !failure
  )
    await page.waitForFunction(
      () => !document.querySelector(".matter-tabs")?.innerText.includes("—"),
    );
  if (view.settled === "calendar")
    await page.waitForFunction(
      () =>
        (document.querySelectorAll("[data-calendar-day]").length >= 7 &&
          document.querySelector('[data-calendar-settled="true"]')) ||
        document.querySelector(".matter-error"),
    );
  if (view.settled === "detail")
    await page.waitForFunction(
      () =>
        document.querySelector(".case-detail-header") ||
        document.querySelector(".matter-error, .matter-not-found"),
    );
  if (failure)
    await page.waitForFunction(() =>
      document.querySelector(".matter-error, .matter-not-found"),
    );
  if (view.settled === "settled" && !failure)
    await page.waitForFunction(
      () =>
        document.querySelector(".task-groups") ||
        document.querySelector(".matter-error, .matter-empty"),
    );
  return { context, page };
}

try {
  for (const view of views) {
    const { context, page } = await makePage(view, view.failure || false);
    if (await page.locator(".matter-skeleton").count())
      throw new Error(`${view.name} still contains skeletons`);
    if (
      !view.failure &&
      (view.route.startsWith("/cases") || view.route === "/dashboard") &&
      /All Cases\s*\(—\)|Active\s*\(—\)/.test(
        await page.locator(".matter-tabs").innerText(),
      )
    )
      throw new Error(
        `${view.name} has unavailable counts presented as loaded`,
      );
    await page.screenshot({
      path: `docs/screenshots/${view.name}.png`,
      fullPage: true,
    });
    await context.close();
  }

  for (const [name, route] of [
    ["cases-empty", "/cases?q=tantara-no-such-case-20261027"],
    ["clients-empty", "/clients?q=tantara-no-such-client-20261027"],
  ]) {
    const view = {
      route,
      name,
      viewport: { width: 1440, height: 1000 },
      settled: "table",
    };
    const { context, page } = await makePage(view);
    await page
      .getByRole("textbox", {
        name: name.startsWith("cases") ? "Search cases" : "Search clients",
      })
      .fill(`tantara-no-such-${name}-${Date.now()}`);
    await page
      .getByText(
        name.startsWith("cases") ? "No matters yet" : "No matching clients",
      )
      .waitFor();
    await page.screenshot({
      path: `docs/screenshots/${name}.png`,
      fullPage: true,
    });
    await context.close();
  }

  {
    const view = {
      route: "/calendar",
      name: "calendar-empty",
      viewport: { width: 1440, height: 1000 },
      settled: "calendar",
    };
    const { context, page } = await makePage(view);
    let foundEmpty = false;
    for (let month = 0; month < 18 && !foundEmpty; month += 1) {
      const response = page.waitForResponse((r) =>
        r.url().includes("/api/v1/calendar?from="),
      );
      await page.getByRole("button", { name: "Next period" }).click();
      await response;
      await page.waitForFunction(() =>
        document.querySelector('[data-calendar-settled="true"]'),
      );
      await page.getByRole("button", { name: "Agenda" }).click();
      await page.locator("[data-calendar-agenda-settled='true']").waitFor();
      foundEmpty = await page
        .getByText("No events in this period")
        .isVisible()
        .catch(() => false);
      if (!foundEmpty)
        await page.getByRole("button", { name: "Month" }).click();
    }
    if (!foundEmpty)
      throw new Error(
        "Seeded API has no event-free calendar month in the next 18 months",
      );
    await page.screenshot({
      path: "docs/screenshots/calendar-empty.png",
      fullPage: true,
    });
    await context.close();
  }

  for (const [name, route] of [
    ["cases-failure", "/cases"],
    ["clients-failure", "/clients"],
    ["tasks-failure", "/tasks"],
    ["calendar-failure", "/calendar"],
  ]) {
    const view = {
      route,
      name,
      viewport: { width: 1440, height: 1000 },
      settled: "settled",
    };
    const { context, page } = await makePage(view, true);
    await page.locator(".matter-error").waitFor();
    await page.screenshot({
      path: `docs/screenshots/${name}.png`,
      fullPage: true,
    });
    await context.close();
  }
  console.log(
    "Saved 8 loaded real-data captures, 3 genuine empty states, and 5 API failure states.",
  );
} finally {
  await browser.close();
}
