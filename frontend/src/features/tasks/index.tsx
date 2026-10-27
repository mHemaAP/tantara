"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@/lib/api/endpoints";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import "../cases/styles.css";
import { taskGroup } from "./grouping";

type Task = {
  id: string;
  title: string;
  status: string;
  priority?: string;
  due_at?: string | null;
  notes?: string;
  case_id?: string;
  case_title?: string;
};
const groups = [
  "Overdue",
  "Today",
  "This week",
  "Later",
  "No due date",
  "Done",
];
export default function TasksPage() {
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [now] = useState(() => new Date());
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["tasks"],
    queryFn: () => endpoints.tasks.list("?page_size=100"),
  });
  const [preview, setPreview] = useState(false);
  useEffect(
    () => setPreview(localStorage.getItem("tantara_preview") === "true"),
    [],
  );
  const complete = async (t: Task) => {
    if (preview || localStorage.getItem("tantara_preview") === "true") return;
    const old = q.data;
    if (!old) return;
    qc.setQueryData(["tasks"], {
      ...old,
      items: (old.items as Task[]).map((x: Task) =>
        x.id === t.id
          ? { ...x, status: x.status === "done" ? "open" : "done" }
          : x,
      ),
    });
    try {
      await endpoints.tasks.update(t.id, {
        status: t.status === "done" ? "todo" : "done",
      });
    } catch {
      qc.setQueryData(["tasks"], old);
      window.alert("Task update failed; previous status restored.");
    }
  };
  const items: Task[] = (q.data?.items || []) as Task[];
  return (
    <section className="matter-wrap">
      <div className="matter-head">
        <div>
          <h1 className="matter-title">Tasks</h1>
          <p className="subheading">Your casework, organized</p>
        </div>
        <button
          className="matter-action"
          disabled={preview}
          title={
            preview ? "Changes are disabled in read-only preview" : undefined
          }
          onClick={() => setShow(true)}
        >
          ＋ New task
        </button>
      </div>
      {q.isError ? (
        <div className="matter-error">
          Tasks are unavailable.{" "}
          <button onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : q.isLoading ? (
        <div className="matter-card matter-skeleton" />
      ) : (
        <div className="task-groups">
          {groups.map((name) => {
            const tasks = items.filter((task) => taskGroup(task, now) === name);
            return (
              <section className="matter-card task-group" key={name}>
                <h2>
                  {name} <small>{tasks.length}</small>
                </h2>
                {tasks.length ? (
                  tasks.map((task) => (
                    <div className="task-row" key={task.id}>
                      <input
                        type="checkbox"
                        aria-label={`Complete ${task.title}`}
                        checked={
                          task.status === "done" || task.status === "completed"
                        }
                        disabled={preview}
                        title={
                          preview
                            ? "Changes are disabled in read-only preview"
                            : undefined
                        }
                        onChange={() => void complete(task)}
                      />
                      <div className="task-row-copy">
                        <strong>{task.title}</strong>
                        <small>
                          {task.due_at
                            ? new Intl.DateTimeFormat("en-IN", {
                                dateStyle: "medium",
                                timeStyle: "short",
                                timeZone: "Asia/Kolkata",
                              }).format(new Date(task.due_at))
                            : "No due date"}
                          {name === "Overdue" ? " · Overdue" : ""} ·{" "}
                          {task.priority || "Normal"}
                          {task.case_id && (
                            <>
                              {" "}
                              ·{" "}
                              <Link href={`/cases/${task.case_id}`}>
                                {task.case_title || "Open linked case"}
                              </Link>
                            </>
                          )}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="task-group-empty">No tasks</p>
                )}
              </section>
            );
          })}
        </div>
      )}
      <Dialog.Root open={show} onOpenChange={setShow}>
        <Dialog.Portal>
          <Dialog.Overlay className="matter-dialog-overlay" />
          <Dialog.Content className="matter-dialog">
            <Dialog.Title>New task</Dialog.Title>
            <Dialog.Description>
              Create a task for your casework.
            </Dialog.Description>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  preview ||
                  localStorage.getItem("tantara_preview") === "true"
                )
                  return;
                try {
                  await endpoints.tasks.create({
                    title,
                    due_at: due || null,
                    status: "open",
                  });
                  setShow(false);
                  setTitle("");
                  setDue("");
                  await q.refetch();
                } catch (err) {
                  window.alert(
                    err instanceof Error
                      ? err.message
                      : "Unable to create task",
                  );
                }
              }}
            >
              <label>
                Title
                <input
                  aria-label="Task title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Due date and time
                <input
                  aria-label="Due date and time"
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <div className="matter-dialog-actions">
                <button type="button" onClick={() => setShow(false)}>
                  Cancel
                </button>
                <button
                  className="matter-action"
                  disabled={preview}
                  title={
                    preview
                      ? "Changes are disabled in read-only preview"
                      : undefined
                  }
                >
                  Save task
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
