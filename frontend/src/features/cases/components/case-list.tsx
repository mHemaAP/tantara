"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, RefreshCw, Search } from "lucide-react";
import { casesApi, Matter } from "../api";
import { matterStatusClass, matterStatusLabel } from "../status";
import "../styles.css";
const tabs = [
  ["all", "All Cases"],
  ["active", "Active"],
  ["pending", "Pending"],
  ["closed", "Closed"],
] as const;
export function CaseList({
  initialStatus = "all",
  compact = false,
}: {
  initialStatus?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState(false);
  useEffect(
    () => setPreview(localStorage.getItem("tantara_preview") === "true"),
    [],
  );
  const [status, setStatus] = useState(initialStatus),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [sort, setSort] = useState("updated_at"),
    [direction, setDirection] = useState<"asc" | "desc">("desc"),
    [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("status");
    if (value && ["active", "pending", "closed", "archived"].includes(value))
      setStatus(value);
  }, []);
  const query = useMemo(
    () =>
      `?page=${page}&page_size=${compact ? 5 : 20}${q ? `&q=${encodeURIComponent(q)}` : ""}${status !== "all" ? `&status=${status}` : ""}&sort=${direction === "desc" ? `-${sort}` : sort}`,
    [page, q, status, compact, sort, direction],
  );
  const data = useQuery({
    queryKey: ["cases", query],
    queryFn: () => casesApi.list(query),
  });
  // The cases collection has no computed hearing projection. One bounded
  // hearings request supplies the visible rows without per-case N+1 calls.
  const hearingData = useQuery({
    queryKey: ["case-list-hearings"],
    queryFn: () => casesApi.hearingsForList(),
  });
  const nextHearingByCase = useMemo(() => {
    const result = new Map<string, string>();
    for (const hearing of hearingData.data?.items ?? []) {
      if (!hearing.case_id || !hearing.at) continue;
      const previous = result.get(hearing.case_id);
      if (
        !previous ||
        new Date(hearing.at).getTime() < new Date(previous).getTime()
      ) {
        result.set(hearing.case_id, hearing.at);
      }
    }
    return result;
  }, [hearingData.data]);
  const rows = data.data?.items ?? [];
  const countQuery = useQuery({
    queryKey: ["cases", "counts"],
    queryFn: async () => {
      const [all, active, pending, closed] = await Promise.all(
        ["", ...["active", "pending", "closed"]].map((status) =>
          casesApi.list(
            `?page=1&page_size=1${status ? `&status=${status}` : ""}`,
          ),
        ),
      );
      const archived = await casesApi.list(
        "?page=1&page_size=1&status=archived",
      );
      return {
        all: all.total,
        active: active.total,
        pending: pending.total,
        closed: closed.total,
        archived: archived.total,
      };
    },
  });
  const counts = countQuery.data;
  const choose = (s: string) => {
    setStatus(s);
    setPage(1);
    router.replace(
      s === "all"
        ? "/cases"
        : s === "closed"
          ? "/cases?status=closed"
          : `/cases/${s === "active" ? "active" : s === "pending" ? "pending" : "archived"}`,
    );
  };
  const action = async (kind: string, c: Matter) => {
    setMenu(null);
    if (
      (preview || localStorage.getItem("tantara_preview") === "true") &&
      ["Archive", "Delete"].includes(kind)
    )
      return;
    if (kind === "Open") {
      router.push(`/cases/${c.id}`);
      return;
    }
    if (kind === "Edit") {
      router.push(`/cases/${c.id}/edit`);
      return;
    }
    if (!window.confirm(`${kind} “${c.title}”?`)) return;
    try {
      if (kind === "Delete") await casesApi.remove(c.id);
      else await casesApi.update(c.id, { status: "archived" });
      await data.refetch();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to update case");
    }
  };
  return (
    <section className="matter-wrap">
      <div className="matter-head">
        <div>
          <h1 className="matter-title">
            {compact ? "Case Management" : "Cases"}
          </h1>
          {!compact && (
            <p className="subheading">Manage your arbitration matters</p>
          )}
        </div>
        <Link className="matter-action" href="/cases/new">
          <Plus size={16} /> New Case
        </Link>
      </div>
      <div className="matter-card">
        <nav className="matter-tabs" aria-label="Case status">
          {[
            ...tabs,
            ...(initialStatus === "archived"
              ? [["archived", "Archived"] as const]
              : []),
          ].map(([key, label]) => (
            <button
              key={key}
              className={status === key ? "active" : ""}
              aria-pressed={status === key}
              onClick={() => choose(key)}
            >
              {label} ({counts?.[key] ?? "—"})
            </button>
          ))}
        </nav>
        {!compact && (
          <div className="matter-tools">
            <label
              style={{ display: "flex", alignItems: "center", gap: 7, flex: 1 }}
            >
              <Search size={15} />
              <input
                aria-label="Search cases"
                placeholder="Search cases…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <select
              aria-label="Sort cases"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated_at">Recently updated</option>
              <option value="title">Case title</option>
              <option value="next_hearing_at">Next hearing</option>
            </select>
          </div>
        )}
        {data.isLoading ? (
          <div aria-label="Loading cases">
            <div
              className="matter-table-scroll"
              role="region"
              aria-label="Cases table"
              tabIndex={0}
            >
              <table className="matter-table">
                <thead>
                  <tr>
                    <th>Case Title</th>
                    <th>Tribunal / Institution</th>
                    <th>Next Hearing</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
              </table>
            </div>
            {[1, 2, 3, 4].map((x) => (
              <div className="matter-skeleton" key={x} />
            ))}
          </div>
        ) : data.isError ? (
          <div className="matter-error">
            <p>
              Cases could not be loaded. Check the workspace API connection.
            </p>
            <button
              className="matter-action"
              onClick={() => void data.refetch()}
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="matter-empty">No matters yet</div>
        ) : (
          <div
            className="matter-table-scroll"
            role="region"
            aria-label="Cases table; scroll horizontally to view all columns"
            tabIndex={0}
          >
            <table className="matter-table">
              <thead>
                <tr>
                  {(
                    ["title", "forum", "next_hearing_at", "status"] as const
                  ).map((key) => (
                    <th
                      key={key}
                      aria-sort={
                        sort === key
                          ? direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (sort === key)
                            setDirection(direction === "asc" ? "desc" : "asc");
                          else {
                            setSort(key);
                            setDirection("asc");
                          }
                        }}
                      >
                        {key === "title"
                          ? "Case Title"
                          : key === "forum"
                            ? "Tribunal / Institution"
                            : key === "next_hearing_at"
                              ? "Next Hearing"
                              : "Status"}
                        {sort === key
                          ? direction === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </button>
                    </th>
                  ))}
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/cases/${c.id}`}>{c.title}</Link>
                      {c.is_demo && (
                        <small style={{ display: "block", color: "#667085" }}>
                          Sample workspace data
                        </small>
                      )}
                    </td>
                    <td>{c.forum || c.institution || "—"}</td>
                    <td>
                      {nextHearingByCase.get(c.id) || c.next_hearing_at
                        ? new Date(
                            nextHearingByCase.get(c.id) || c.next_hearing_at!,
                          ).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={`status-pill ${matterStatusClass(c.status)}`}
                      >
                        {matterStatusLabel(c.status)}
                      </span>
                    </td>
                    <td style={{ position: "relative" }}>
                      <button
                        className="matter-more"
                        aria-label={`Actions for ${c.title}`}
                        aria-expanded={menu === c.id}
                        onClick={() => setMenu(menu === c.id ? null : c.id)}
                      >
                        ⋯
                      </button>
                      {menu === c.id && (
                        <div
                          style={{
                            position: "absolute",
                            right: 8,
                            zIndex: 3,
                            background: "#fff",
                            border: "1px solid #e5eaf2",
                            borderRadius: 8,
                            boxShadow: "0 8px 24px #0002",
                            minWidth: 120,
                          }}
                        >
                          {["Open", "Edit", "Archive", "Delete"].map((a) => (
                            <button
                              key={a}
                              onClick={() => void action(a, c)}
                              disabled={
                                preview && ["Archive", "Delete"].includes(a)
                              }
                              title={
                                preview && ["Archive", "Delete"].includes(a)
                                  ? "Changes are disabled in read-only preview"
                                  : undefined
                              }
                              style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                padding: "8px 12px",
                                border: 0,
                                background: "white",
                                cursor: "pointer",
                              }}
                            >
                              {a}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="matter-foot">
          <span>
            {data.data
              ? `${data.data.total === 0 ? 0 : (data.data.page - 1) * data.data.page_size + 1}–${Math.min(data.data.page * data.data.page_size, data.data.total)} of ${data.data.total}`
              : " "}
          </span>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!compact && (
              <>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button
                  disabled={!data.data || page >= data.data.pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </>
            )}
            {compact && (
              <Link href="/cases" className="matter-view-all">
                View all cases <ArrowRight size={13} />
              </Link>
            )}
          </div>
        </footer>
      </div>
      {data.data?.items.some((c) => c.is_demo) && (
        <small style={{ display: "block", marginTop: 8, color: "#667085" }}>
          Sample workspace data
        </small>
      )}
    </section>
  );
}
