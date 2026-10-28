import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const frontend = "http://localhost:3012";
const api = `${(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8112").replace(/\/$/, "")}/api/v1`;
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
const caseResponse = await fetch(
  `${api}/cases?page=1&page_size=20&sort=-updated_at`,
  {
    headers: auth,
  },
);
if (!caseResponse.ok)
  throw new Error(`GET cases failed: ${caseResponse.status}`);
const caseRows = (await caseResponse.json()).items;
const firstListCase = caseRows[0];
const nextMonthStart = new Date();
nextMonthStart.setDate(1);
nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
const firstCase = caseRows.find(
  (item) =>
    item.next_hearing_at &&
    new Date(item.next_hearing_at).getTime() >= nextMonthStart.getTime(),
);
if (!firstCase)
  throw new Error("Seeded API returned no future hearing projection");
const hearingResponse = await fetch(`${api}/hearings?page=1&page_size=100`, {
  headers: auth,
});
const hearings = (await hearingResponse.json()).items;
const selectedHearing = hearings
  .filter(
    (item) => item.case_id === firstCase.id && new Date(item.at) >= new Date(),
  )
  .sort((a, b) => new Date(a.at) - new Date(b.at))[0];
if (!selectedHearing || selectedHearing.at !== firstCase.next_hearing_at)
  throw new Error("Case hearing projection does not match GET hearings");
const hearingMonth = new Date(firstCase.next_hearing_at);
const calendarFrom = new Date(
  hearingMonth.getFullYear(),
  hearingMonth.getMonth(),
  1,
)
  .toISOString()
  .slice(0, 10);
const calendarTo = new Date(
  hearingMonth.getFullYear(),
  hearingMonth.getMonth() + 1,
  1,
)
  .toISOString()
  .slice(0, 10);
const apiCalendar = await fetch(
  `${api}/calendar?from=${calendarFrom}&to=${calendarTo}`,
  { headers: auth },
);
if (!apiCalendar.ok)
  throw new Error(`GET calendar failed: ${apiCalendar.status}`);
const calendarEvents = await apiCalendar.json();
if (
  !calendarEvents.some(
    (event) =>
      event.case_id === firstCase.id && event.at === selectedHearing.at,
  )
)
  throw new Error("Calendar API does not contain the projected hearing");

await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
const views = [
  {
    route: "/cases",
    name: "cases-desktop_1440x900_loaded",
    width: 1440,
    height: 900,
    settle: "cases",
  },
  {
    route: "/cases",
    name: "cases-mobile_390x844_loaded",
    width: 390,
    height: 844,
    settle: "cases",
  },
  {
    route: `/cases/${firstCase.id}`,
    name: "case-detail-desktop_1440x900_loaded",
    width: 1440,
    height: 900,
    settle: "detail",
  },
  {
    route: "/clients",
    name: "clients-desktop_1440x900_loaded",
    width: 1440,
    height: 900,
    settle: "table",
  },
  {
    route: "/tasks",
    name: "tasks-desktop_1440x900_loaded",
    width: 1440,
    height: 900,
    settle: "tasks",
  },
  {
    route: "/tasks",
    name: "tasks-mobile_390x844_action-menu",
    width: 390,
    height: 844,
    settle: "tasks",
    actionMenu: true,
  },
  {
    route: "/calendar",
    name: "calendar-desktop_1440x900_loaded",
    width: 1440,
    height: 900,
    settle: "calendar",
  },
  {
    route: "/calendar",
    name: "calendar-mobile_390x844_selected-event",
    width: 390,
    height: 844,
    settle: "calendar",
    selectedEvent: true,
  },
];

async function createPage(
  view,
  { failure = false, clientsTransient = false } = {},
) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
  });
  await context.addInitScript((value) => {
    localStorage.removeItem("tantara_preview");
    localStorage.setItem("tantara_token", value);
    document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
  }, token);
  if (clientsTransient)
    await context.addInitScript(() => {
      const original = window.fetch.bind(window);
      let failures = 2;
      window.fetch = (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (
          failures &&
          new URL(url, location.href).pathname.endsWith("/api/v1/clients")
        ) {
          failures -= 1;
          return Promise.resolve(
            new Response('{"error":{"message":"Temporary failure"}}', {
              status: 503,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return original(input, init);
      };
    });
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
        body: '{"error":{"message":"Request failed"}}',
      });
    });
  await page.goto(`${frontend}${view.route}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForFunction(
    () => !document.body.innerText.includes("Opening your workspace…"),
  );
  if (view.settle === "cases" || view.settle === "table")
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".matter-table tbody tr").length > 0 ||
        document.querySelector(".matter-empty,.matter-error"),
    );
  if (view.settle === "cases") {
    const titleLink =
      view.width <= 650
        ? page
            .locator(".matter-mobile-cards")
            .getByRole("link", { name: firstCase.title, exact: true })
        : page
            .locator(".matter-table")
            .getByRole("link", { name: firstCase.title, exact: true });
    await titleLink.waitFor({ state: "visible" });
  }
  if (view.settle === "detail")
    await page.waitForSelector(
      ".case-detail-header,.matter-error,.matter-not-found",
    );
  if (view.settle === "tasks")
    await page.waitForSelector(".task-groups,.matter-error,.matter-empty");
  if (view.settle === "calendar") {
    await page.waitForSelector('[data-calendar-settled="true"]');
    if (view.width <= 650) {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-calendar-agenda-settled="true"]') !==
          null,
      );
    } else {
      await page.waitForFunction(
        () => document.querySelector(".calendar-grid") !== null,
      );
    }
  }
  await page.waitForFunction(() => {
    if (document.querySelector("nextjs-dev-tools-indicator")) return false;
    return ![...document.querySelectorAll("nextjs-portal")].some((host) =>
      [
        ...(host.shadowRoot?.querySelectorAll(
          'button[aria-label="Open issues overlay"], button[aria-label="Collapse issues badge"]',
        ) || []),
      ].some(
        (badge) =>
          badge.getBoundingClientRect().width > 0 &&
          badge.getBoundingClientRect().height > 0,
      ),
    );
  });
  return { context, page };
}

async function assertCapture(page, name, mobile = false) {
  if (await page.locator(".matter-skeleton").count())
    throw new Error(`${name} contains a loading skeleton`);
  const devBadge = await page.evaluate(
    () =>
      !!document.querySelector("nextjs-dev-tools-indicator") ||
      [...document.querySelectorAll("nextjs-portal")].some(
        (host) =>
          !!host.shadowRoot
            ?.querySelector(
              'button[aria-label="Open issues overlay"], button[aria-label="Collapse issues badge"]',
            )
            ?.getBoundingClientRect().width,
      ),
  );
  if (devBadge) throw new Error(`${name} contains the Next.js dev indicator`);
  const badCopy = await page.locator("body").innerText();
  if (
    /localhost|127\.0\.0\.1|:8112|:3012|Sample workspace data|all_day_event|first_hearing|hearing_completed/i.test(
      badCopy,
    )
  )
    throw new Error(`${name} contains internal or raw enum copy`);
  if (
    !name.includes("failure") &&
    (await page.locator(".nav a[aria-current='page']").count()) !== 1
  )
    throw new Error(`${name} does not have one active workspace destination`);
  if (
    mobile &&
    (await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ))
  )
    throw new Error(`${name} overflows the mobile viewport`);
}

try {
  for (const view of views) {
    const { context, page } = await createPage(view);
    if (view.name.startsWith("cases-")) {
      const topRow =
        view.width <= 650
          ? page.locator(".matter-mobile-case").first().getByRole("link")
          : page.locator(".matter-table tbody tr").first().getByRole("link");
      const renderedTitle = (await topRow.innerText()).trim();
      if (renderedTitle !== firstListCase.title)
        throw new Error(
          "Rendered first case row does not match GET /cases sorted response",
        );
    }
    if (view.selectedEvent) {
      const periodsAhead =
        (hearingMonth.getFullYear() - new Date().getFullYear()) * 12 +
        hearingMonth.getMonth() -
        new Date().getMonth();
      for (let i = 0; i < Math.max(1, periodsAhead); i += 1) {
        await page.getByRole("button", { name: "Next period" }).click();
      }
      const targetEvent = page.getByRole("button", {
        name: new RegExp(`View ${selectedHearing.title}`, "i"),
      });
      for (
        let i = 0;
        i < 4 && !(await targetEvent.isVisible().catch(() => false));
        i += 1
      ) {
        await page.getByRole("button", { name: "Next days" }).click();
      }
      await targetEvent.click();
      await page.getByRole("dialog", { name: "Event details" }).waitFor();
      const detailBox = await page
        .getByRole("dialog", { name: "Event details" })
        .boundingBox();
      if (
        !detailBox ||
        detailBox.y < 0 ||
        detailBox.y + detailBox.height > view.height
      )
        throw new Error(
          "Selected event details are outside the mobile viewport",
        );
    }
    if (view.actionMenu) {
      await page
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole("button", { name: "Edit" }).last().waitFor();
    }
    await assertCapture(page, view.name, view.width <= 650);
    await page.screenshot({
      path: `docs/screenshots/${view.name}.png`,
      fullPage: false,
    });
    await context.close();
  }

  const clientsRetry = {
    route: "/clients",
    name: "clients-desktop_1440x900_retry-success",
    width: 1440,
    height: 900,
    settle: "table",
  };
  const retry = await createPage(clientsRetry, { clientsTransient: true });
  await retry.page.locator(".matter-error").waitFor();
  await retry.page.getByRole("button", { name: "Retry" }).click();
  await retry.page.locator(".matter-table tbody tr").first().waitFor();
  await assertCapture(retry.page, clientsRetry.name);
  await retry.page.screenshot({
    path: `docs/screenshots/${clientsRetry.name}.png`,
    fullPage: false,
  });
  await retry.context.close();

  for (const [name, route, settle] of [
    ["cases", "/cases?q=none-found-capture", "cases"],
    ["clients", "/clients?q=none-found-capture", "table"],
  ]) {
    const view = {
      route,
      name: `${name}-desktop_1440x900_empty`,
      width: 1440,
      height: 900,
      settle,
    };
    const { context, page } = await createPage(view);
    await page
      .getByRole("textbox", {
        name: name === "cases" ? "Search cases" : "Search clients",
      })
      .fill(`none-found-${Date.now()}`);
    await page
      .getByText(name === "cases" ? "No matching cases" : "No matching clients")
      .waitFor();
    await assertCapture(page, view.name);
    await page.screenshot({
      path: `docs/screenshots/${view.name}.png`,
      fullPage: false,
    });
    await context.close();
  }

  for (const [name, route] of [
    ["cases", "/cases"],
    ["clients", "/clients"],
    ["tasks", "/tasks"],
    ["calendar", "/calendar"],
  ]) {
    const view = {
      route,
      name: `${name}-desktop_1440x900_failure`,
      width: 1440,
      height: 900,
      settle: "failure",
    };
    const { context, page } = await createPage(view, { failure: true });
    await page.locator(".matter-error").waitFor();
    await assertCapture(page, view.name);
    await page.screenshot({
      path: `docs/screenshots/${view.name}.png`,
      fullPage: false,
    });
    await context.close();
  }
  console.log(
    "Saved 9 loaded real-data captures, 2 empty states, and 4 failure states.",
  );
} finally {
  await browser.close();
}
