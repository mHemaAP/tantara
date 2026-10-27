"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { casesApi } from "@/features/cases/api";
import { RefreshCw } from "lucide-react";
import { StrategyPanel } from "@/features/cases/components/strategy";
import "@/features/cases/styles.css";

const tabs = [
  "Overview",
  "Timeline",
  "Parties",
  "Documents",
  "Research",
  "Drafts",
  "Hearings",
  "Tasks",
  "Notes",
  "Strategy",
  "Activity log",
];
type RecordValue = Record<string, unknown>;
function listFrom(value: unknown): RecordValue[] {
  if (Array.isArray(value)) return value as RecordValue[];
  if (
    value &&
    typeof value === "object" &&
    "items" in value &&
    Array.isArray((value as { items: unknown }).items)
  )
    return (value as { items: RecordValue[] }).items;
  return [];
}
function Records({
  title,
  rows,
  fields,
}: {
  title: string;
  rows: RecordValue[];
  fields: Array<[string, string]>;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {rows.length ? (
        <div className="case-record-list">
          {rows.map((row, index) => (
            <article key={String(row.id || index)}>
              <strong>
                {String(
                  row.title ||
                    row.name ||
                    row.event_type ||
                    row.action ||
                    title,
                )}
              </strong>
              <dl>
                {fields.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {row[key] == null || row[key] === ""
                        ? "—"
                        : String(row[key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <p className="matter-empty case-inline-empty">
          No {title.toLowerCase()} recorded for this case.
        </p>
      )}
    </section>
  );
}
export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") || "Overview";
  const c = useQuery({
    queryKey: ["case", id],
    queryFn: () => casesApi.get(id),
  });
  const overview = useQuery({
    queryKey: ["case-overview", id],
    queryFn: () => casesApi.overview(id),
    enabled: !c.isLoading && !c.isError,
  });
  const keyed: Record<string, () => Promise<unknown>> = {
    Timeline: () => casesApi.events(id),
    Hearings: () => casesApi.hearings(id),
    Tasks: () => casesApi.tasks(id),
  };
  const payload = useQuery({
    queryKey: ["case-tab", id, tab],
    queryFn: keyed[tab] || (() => Promise.resolve(null)),
    enabled: !!keyed[tab] && !!c.data,
  });
  if (c.isLoading)
    return (
      <section className="matter-wrap">
        <div
          className="matter-card matter-skeleton"
          aria-label="Loading case"
        />
      </section>
    );
  if (c.isError) {
    const missing = c.error instanceof ApiError && c.error.status === 404;
    return (
      <section className="matter-wrap">
        <div className="matter-card matter-not-found">
          <h1>{missing ? "Case not found" : "Case is unavailable"}</h1>
          <p>
            {missing
              ? "This case may have been removed or you may not have access."
              : "The case could not be loaded. Check the workspace connection and retry."}
          </p>
          <button className="matter-action" onClick={() => void c.refetch()}>
            <RefreshCw size={14} /> Retry
          </button>
          <Link href="/cases">Back to cases</Link>
        </div>
      </section>
    );
  }
  const item = c.data!;
  const over = (overview.data || {}) as RecordValue;
  const people = listFrom(over.participants);
  const facts = [...Object.entries(item), ...Object.entries(over)].reduce<
    Record<string, unknown>
  >((a, [k, v]) => ((a[k] = v), a), {});
  const setTab = (name: string) =>
    router.replace(`/cases/${id}?tab=${encodeURIComponent(name)}`, {
      scroll: false,
    });
  const rows = listFrom(payload.data);
  return (
    <section className="matter-wrap case-detail">
      <p className="subheading">
        <Link href="/cases">Cases</Link> / Case workspace
      </p>
      <header className="matter-head case-detail-header">
        <div>
          <h1 className="matter-title">{item.title}</h1>
          <p className="subheading">
            {item.reference_number || "No reference"} ·{" "}
            {item.status || "Status unavailable"} ·{" "}
            {item.forum || item.institution || "Institution unavailable"}
          </p>
        </div>
        <Link className="matter-action" href={`/cases/${id}/edit`}>
          Edit case
        </Link>
      </header>
      <nav className="matter-tabs case-detail-tabs" aria-label="Case sections">
        {tabs.map((name) => (
          <button
            type="button"
            key={name}
            className={tab === name ? "active" : ""}
            aria-current={tab === name ? "page" : undefined}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <section className="matter-card case-detail-panel">
        {tab === "Overview" ? (
          <div className="grid dashboard-columns">
            <div>
              <h2>Case overview</h2>
              <dl className="data-list">
                {[
                  ["Case title", facts.title],
                  ["Reference number", facts.reference_number],
                  ["Claimant", facts.claimant],
                  ["Respondent", facts.respondent],
                  ["Institution", facts.forum || facts.institution],
                  ["Seat", facts.seat],
                  ["Governing law", facts.governing_law],
                  ["Status", facts.status],
                  [
                    "Claim amount",
                    facts.claim_amount !== undefined
                      ? new Intl.NumberFormat("en-IN", {
                          style: "currency",
                          currency: String(facts.claim_currency || "INR"),
                          maximumFractionDigits: 2,
                        }).format(Number(facts.claim_amount))
                      : undefined,
                  ],
                  [
                    "Arbitration agreement",
                    facts.arbitration_agreement_details,
                  ],
                  ["Description", facts.description],
                  ["Next hearing", facts.next_hearing_at],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt>{String(label)}</dt>
                    <dd>
                      {value == null || value === "" ? "—" : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              {people.length > 0 && (
                <Records
                  title="Parties"
                  rows={people}
                  fields={[
                    ["party_role", "Role"],
                    ["email", "Email"],
                  ]}
                />
              )}
            </div>
            <div>
              <h2>Quick actions</h2>
              <p>
                <Link href={`/calendar?case_id=${encodeURIComponent(id)}`}>
                  Open calendar for this case
                </Link>
              </p>
              <p>
                <Link href={`/tasks?case_id=${encodeURIComponent(id)}`}>
                  Open tasks for this case
                </Link>
              </p>
              <p>
                Documents: {String(over.documents_count ?? "—")} · Drafts:{" "}
                {String(over.drafts_count ?? "—")}
              </p>
            </div>
          </div>
        ) : tab === "Strategy" ? (
          <StrategyPanel id={id} />
        ) : tab === "Timeline" ? (
          <Records
            title="Timeline events"
            rows={rows}
            fields={[
              ["event_type", "Type"],
              ["description", "Details"],
              ["created_at", "Date"],
            ]}
          />
        ) : tab === "Hearings" ? (
          <Records
            title="Hearings"
            rows={rows}
            fields={[
              ["at", "Date and time"],
              ["type", "Type"],
              ["location", "Location"],
              ["status", "Status"],
            ]}
          />
        ) : tab === "Tasks" ? (
          <Records
            title="Tasks"
            rows={rows}
            fields={[
              ["due_at", "Due"],
              ["status", "Status"],
              ["priority", "Priority"],
            ]}
          />
        ) : tab === "Notes" || tab === "Activity log" ? (
          <div className="matter-unavailable">
            <h2>{tab}</h2>
            <p>The API does not provide a case {tab.toLowerCase()} endpoint.</p>
          </div>
        ) : tab === "Parties" ? (
          <Records
            title="Parties and participants"
            rows={people}
            fields={[
              ["party_role", "Role"],
              ["email", "Email"],
              ["organization", "Organization"],
            ]}
          />
        ) : (
          <div className="matter-unavailable">
            <h2>{tab}</h2>
            <p>
              {tab === "Documents"
                ? `This case has ${String(over.documents_count ?? "no available")} linked documents. The case document listing endpoint is not available.`
                : tab === "Drafts"
                  ? `This case has ${String(over.drafts_count ?? "no available")} linked drafts. The case draft listing endpoint is not available.`
                  : "The case research listing endpoint is not available."}
            </p>
          </div>
        )}
        {tab !== "Overview" &&
          tab !== "Strategy" &&
          tab !== "Notes" &&
          tab !== "Activity log" &&
          !["Documents", "Drafts", "Research"].includes(tab) &&
          payload.isError && (
            <div className="matter-error">
              {tab} could not be loaded.{" "}
              <button onClick={() => void payload.refetch()}>Retry</button>
            </div>
          )}
      </section>
    </section>
  );
}
