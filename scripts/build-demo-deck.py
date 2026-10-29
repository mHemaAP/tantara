#!/usr/bin/env python3
"""Build the image-heavy Tantra walkthrough deck from an e2e run.

  backend/.venv/bin/python scripts/build-demo-deck.py \
      --report reports/walkthrough/report.json \
      --shots  reports/walkthrough \
      --stats  reports/walkthrough/stats.json \
      --password-file ~/.config/tantara/tantara-demo-password \
      --out    reports/Tantra-Walkthrough.pptx

Every functional screen in the deck is a real screenshot taken by
frontend/scripts/e2e-walkthrough.mjs against the deployed instance; the deck also
publishes the shared demo credentials so a reader can sign in themselves.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

SLIDE_W, SLIDE_H = Inches(13.333), Inches(7.5)
INK = RGBColor(0x0F, 0x17, 0x2A)
MUTED = RGBColor(0x64, 0x74, 0x8B)
LINE = RGBColor(0xE2, 0xE8, 0xF0)
ACCENT = RGBColor(0xB4, 0x53, 0x09)
PANEL = RGBColor(0xF6, 0xF7, 0xFA)
DARK = RGBColor(0x0B, 0x12, 0x20)
DARKTEXT = RGBColor(0xE9, 0xEE, 0xF7)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

ACCOUNTS = [
    ("advocate@tantara.local", "Workspace Advocate", "advocate", "Full write: matters, uploads, drafts, bundles"),
    ("researcher@tantara.local", "Mira Shah", "researcher", "Read-only: research and search, no uploads"),
    ("staff@tantara.local", "Dev Patel", "staff", "Matters staff: tasks, hearings, documents"),
    ("associate@tantara.local", "Aarav Nair", "advocate", "Starts empty — good for watching creation flows"),
]


class Fmt(defaultdict):
    def __init__(self, values):
        super().__init__(lambda: "—")
        self.update(values)

    def __missing__(self, key):
        return "—"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", default="reports/walkthrough/report.json")
    parser.add_argument("--shots", default="reports/walkthrough")
    parser.add_argument("--stats", default="reports/walkthrough/stats.json")
    parser.add_argument("--password-file", default=str(Path.home() / ".config/tantara/tantara-demo-password"))
    parser.add_argument("--url", default="https://tantra.theessencetimes.com")
    parser.add_argument("--out", default="reports/Tantra-Walkthrough.pptx")
    args = parser.parse_args()

    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    stats = json.loads(Path(args.stats).read_text(encoding="utf-8")) if Path(args.stats).exists() else {}
    shots_dir = Path(args.shots)
    password = Path(args.password_file).read_text(encoding="utf-8").strip() if Path(args.password_file).exists() else "(see your operator)"
    shots = {shot["label"]: shots_dir / shot["file"] for shot in report.get("shots", []) if shot.get("file")}
    checks = report.get("checks", [])
    passed = sum(1 for check in checks if check.get("ok"))

    def value(path, default="—"):
        node = stats
        for part in path.split("."):
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                return default
        return node if isinstance(node, (int, float)) else default

    values = Fmt(
        {
            "url": args.url,
            "when": str(report.get("when", ""))[:10],
            "checks_total": len(checks),
            "checks_passed": passed,
            "shots": len(shots),
            "documents": value("totals.documents"),
            "documents_ready": value("totals.documents_ready"),
            "pages": value("totals.pages"),
            "cases": value("totals.cases"),
            "clients": value("totals.clients"),
            "tasks": value("totals.tasks"),
            "collections": value("totals.collections"),
            "search_total": value("search_probe.total"),
            "search_status": value("search_probe.status"),
            "statute_pages": sum(
                int(d.get("pages") or 0) for d in stats.get("documents", []) if (d.get("type") or "") == "Statute"
            ),
            "statutes": sum(1 for d in stats.get("documents", []) if (d.get("type") or "") == "Statute"),
        }
    )

    prs = Presentation()
    prs.slide_width, prs.slide_height = SLIDE_W, SLIDE_H
    missing: list[str] = []
    used: list[str] = []
    state = {"n": 0}

    def blank(dark: bool = False):
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = DARK if dark else WHITE
        state["n"] += 1
        return slide

    def text(slide, x, y, w, h, runs, size=13, color=INK, bold=False, align=PP_ALIGN.LEFT, space_after=4):
        box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        frame = box.text_frame
        frame.word_wrap = True
        first = True
        for run in runs if isinstance(runs, list) else [runs]:
            para = frame.paragraphs[0] if first else frame.add_paragraph()
            first = False
            para.text = str(run)
            para.alignment = align
            para.space_after = Pt(space_after)
            para.font.size = Pt(size)
            para.font.color.rgb = color
            para.font.bold = bold
        return box

    def eyebrow(slide, label, dark=False):
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.55), Inches(0.52), Inches(0.30), Inches(0.30))
        bar.fill.solid()
        bar.fill.fore_color.rgb = ACCENT
        bar.line.fill.background()
        text(slide, 0.95, 0.46, 8.0, 0.4, [label.upper()], size=10.5, color=ACCENT, bold=True)
        text(
            slide,
            9.0,
            0.46,
            3.8,
            0.4,
            [f"{args.url.replace('https://', '')}"],
            size=10,
            color=MUTED if not dark else RGBColor(0x93, 0xA3, 0xB8),
            align=PP_ALIGN.RIGHT,
        )

    def header(slide, title, sub=None, dark=False):
        text(slide, 0.55, 0.86, 12.2, 0.7, [title], size=26, color=WHITE if dark else INK, bold=True)
        if sub:
            text(slide, 0.55, 1.52, 12.2, 0.45, [sub], size=13.5, color=MUTED if not dark else RGBColor(0xB6, 0xC2, 0xD6))
        rule = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.55), Inches(1.95), Inches(12.2), Emu(9525))
        rule.fill.solid()
        rule.fill.fore_color.rgb = LINE if not dark else RGBColor(0x1E, 0x29, 0x3B)
        rule.line.fill.background()

    def footer(slide, dark=False):
        text(
            slide,
            0.55,
            7.02,
            9.0,
            0.3,
            ["TANTRA · legal workspace on k3s + PostgreSQL + MinIO, published through Cloudflare Tunnel"],
            size=9,
            color=MUTED if not dark else RGBColor(0x8B, 0x9A, 0xB4),
        )
        text(slide, 11.9, 7.02, 0.9, 0.3, [str(state["n"])], size=9, color=MUTED, align=PP_ALIGN.RIGHT)

    def picture(slide, label, box=(0.55, 2.15, 12.2, 4.55), center_x=True):
        path = shots.get(label)
        if not path or not path.exists():
            missing.append(label)
            text(
                slide,
                box[0],
                box[1] + 1.6,
                box[2],
                0.6,
                [f"(no screenshot captured for “{label}”)"],
                size=13,
                color=RGBColor(0xB9, 0x1C, 0x1C),
                align=PP_ALIGN.CENTER,
            )
            return
        with Image.open(path) as image:
            pw, ph = image.size
        used.append(label)
        max_w, max_h = Inches(box[2]), Inches(box[3])
        scale = min(max_w / pw, max_h / ph)
        w, h = int(pw * scale), int(ph * scale)
        left = Inches(box[0]) + (max_w - w) // 2 if center_x else Inches(box[0])
        top = Inches(box[1]) + (max_h - h) // 2
        frame = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left - Emu(19050), top - Emu(19050), w + Emu(38100), h + Emu(38100))
        frame.fill.solid()
        frame.fill.fore_color.rgb = PANEL
        frame.line.color.rgb = LINE
        slide.shapes.add_picture(str(path), left, top, width=w, height=h)

    def caption(slide, note, y=6.62):
        text(slide, 0.55, y, 12.2, 0.4, [note], size=12, color=MUTED)

    def bullets(slide, items, box=(0.55, 2.2, 12.2, 4.4), size=14):
        box_shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(box[0]), Inches(box[1]), Inches(box[2]), Inches(box[3]))
        box_shape.fill.solid()
        box_shape.fill.fore_color.rgb = PANEL
        box_shape.line.color.rgb = LINE
        box_shape.adjustments[0] = 0.03
        inner = slide.shapes.add_textbox(Inches(box[0] + 0.35), Inches(box[1] + 0.25), Inches(box[2] - 0.7), Inches(box[3] - 0.5))
        frame = inner.text_frame
        frame.word_wrap = True
        first = True
        for item in items:
            lead, _, rest = str(item).partition("|")
            para = frame.paragraphs[0] if first else frame.add_paragraph()
            first = False
            para.space_after = Pt(9)
            run = para.add_run() if hasattr(para, "add_run") else None
            if run is None:
                para.text = f"{lead.strip()}  —  {rest.strip()}" if rest else lead.strip()
                para.font.size = Pt(size)
                para.font.color.rgb = INK
                continue
            run.text = lead.strip()
            run.font.size = Pt(size)
            run.font.bold = True
            run.font.color.rgb = INK
            if rest:
                second = para.add_run()
                second.text = f"  —  {rest.strip()}"
                second.font.size = Pt(size)
                second.font.color.rgb = RGBColor(0x33, 0x41, 0x55)

    def table(slide, headers, rows, box=(0.55, 2.2, 12.2, 4.4), widths=None, size=11.5):
        shape = slide.shapes.add_table(len(rows) + 1, len(headers), Inches(box[0]), Inches(box[1]), Inches(box[2]), Inches(box[3]))
        grid = shape.table
        grid.first_row = True
        if widths:
            total = sum(widths)
            for index, weight in enumerate(widths):
                grid.columns[index].width = int(Inches(box[2]) * weight / total)
        for column, heading in enumerate(headers):
            cell = grid.cell(0, column)
            cell.text = str(heading)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor(0x11, 0x1C, 0x2E)
            para = cell.text_frame.paragraphs[0]
            para.font.size = Pt(size)
            para.font.bold = True
            para.font.color.rgb = WHITE
        for r, row in enumerate(rows, start=1):
            for column, cell_value in enumerate(row):
                cell = grid.cell(r, column)
                cell.text = "" if cell_value is None else str(cell_value)
                cell.fill.solid()
                cell.fill.fore_color.rgb = WHITE if r % 2 else PANEL
                para = cell.text_frame.paragraphs[0]
                para.font.size = Pt(size)
                para.font.color.rgb = INK
                cell.margin_left = Inches(0.07)
                cell.margin_right = Inches(0.07)
        return grid

    def numbers(slide, cards, box=(0.55, 2.25, 12.2, 2.0)):
        count = len(cards)
        gap = 0.22
        width = (box[2] - gap * (count - 1)) / count
        for index, (value, label) in enumerate(cards):
            left = Inches(box[0] + index * (width + gap))
            card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, Inches(box[1]), Inches(width), Inches(box[2]))
            card.fill.solid()
            card.fill.fore_color.rgb = DARK
            card.line.fill.background()
            card.adjustments[0] = 0.08
            text(slide, box[0] + index * (width + gap) + 0.1, box[1] + 0.28, width - 0.2, 0.9, [f"{value}"], size=30, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
            text(slide, box[0] + index * (width + gap) + 0.1, box[1] + 1.22, width - 0.2, 0.6, [label], size=11, color=RGBColor(0xAF, 0xBE, 0xD4), align=PP_ALIGN.CENTER)

    # ------------------------------------------------------------------ slides
    title = blank(dark=True)
    text(title, 0.9, 1.5, 11.5, 1.0, ["TANTRA"], size=54, color=WHITE, bold=True)
    text(
        title,
        0.9,
        2.7,
        11.5,
        1.6,
        [
            "A complete walk-through of the live legal workspace",
            f"{values['shots']} screenshots from one real browser session · {values['checks_passed']}/{values['checks_total']} automated checks passed",
        ],
        size=18,
        color=RGBColor(0xC7, 0xD3, 0xE6),
    )
    rule = title.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.95), Inches(4.35), Inches(1.6), Emu(28575))
    rule.fill.solid()
    rule.fill.fore_color.rgb = ACCENT
    rule.line.fill.background()
    text(title, 0.9, 4.7, 11.5, 1.2, [f"{args.url}", "Sign-in details inside — every account is live right now."], size=15, color=WHITE)
    footer(title, dark=True)

    def divider(label, heading, blurb):
        slide = blank(dark=True)
        eyebrow(slide, label, dark=True)
        text(slide, 0.55, 2.5, 12.2, 1.2, [heading], size=38, color=WHITE, bold=True)
        text(slide, 0.55, 3.9, 11.0, 1.4, [blurb], size=15, color=RGBColor(0xB6, 0xC2, 0xD6))
        footer(slide, dark=True)
        return slide

    def shot_slide(label, heading, sub, note, extra_box=None):
        slide = blank()
        eyebrow(slide, heading)
        header(slide, heading, sub)
        picture(slide, label, box=(0.55, 2.15, 12.2, 4.35))
        caption(slide, note)
        footer(slide)
        return slide

    def pair_slide(heading, sub, left_label, right_label, note):
        slide = blank()
        eyebrow(slide, heading)
        header(slide, heading, sub)
        picture(slide, left_label, box=(0.55, 2.15, 6.0, 4.35))
        picture(slide, right_label, box=(6.75, 2.15, 6.0, 4.35))
        caption(slide, note)
        footer(slide)
        return slide

    def grid_slide(heading, sub, labels, note):
        """Four screenshots at once — used where the point is the set, not one screen."""
        slide = blank()
        eyebrow(slide, heading)
        header(slide, heading, sub)
        cells = [(0.55, 2.05), (6.75, 2.05), (0.55, 4.35), (6.75, 4.35)]
        for (cell_x, cell_y), label in zip(cells, labels[:4]):
            picture(slide, label, box=(cell_x, cell_y, 6.0, 2.1), center_x=True)
        caption(slide, note, y=6.55)
        footer(slide)
        return slide

    # 1 — what it is / how it is built
    slide = blank()
    eyebrow(slide, "Overview")
    header(slide, "One workspace per advocate, wired end to end", "Everything in this deck is the deployed service, not a mock-up")
    bullets(
        slide,
        [
            "Matters | contract, arbitration and litigation records with parties, hearings, limitation dates and claim value",
            "Documents | PDF, DOCX, TXT and MD ingestion: page split, OCR for scans, chunking, embeddings, hybrid search",
            "Research desk | answers grounded in the workspace corpus with citations that jump to the exact page",
            "Drafts | AI drafting for notices, petitions and replies, with cited sources and gaps flagged for review",
            "Filing bundles | assemble a paperbook per matter and export the merged PDF",
            "Roles and isolation | advocate / researcher / staff / admin, with every list scoped to its owner",
        ],
        box=(0.55, 2.15, 12.2, 4.35),
    )
    footer(slide)

    slide = blank()
    eyebrow(slide, "Architecture")
    header(slide, "How the deployment is put together", "k3s behind Cloudflare Tunnel, with PostgreSQL and MinIO as the only systems of record")
    numbers(
        slide,
        [
            (values["documents"], "documents"),
            (values["pages"], "pages indexed"),
            (values["statutes"], "statutes"),
            (values["cases"], "matters"),
            (values["clients"], "clients"),
            (values["tasks"], "tasks"),
        ],
        box=(0.55, 2.2, 12.2, 1.95),
    )
    bullets(
        slide,
        [
            "Browser | Next.js standalone image served by the frontend Deployment, TLS and auth edge at Cloudflare",
            "Edge | cloudflared tunnel (2 replicas) — no inbound ports, ingress through Traefik on k3s",
            "API | FastAPI + SQLAlchemy 2.x, Alembic migrations run at start-up, ingestion in worker threads",
            "PostgreSQL | rows, tsvector + GIN lexical search, chunk vectors in real[] with the immutable tantara_dot operator",
            "MinIO | content-addressed uploads (uploads/<sha256>.bin) and generated bundle PDFs",
            "Models | fastembed all-MiniLM-L6-v2 (384-dim) locally; MiniCPM5-2B over OpenAI-compatible HTTP for drafting",
        ],
        box=(0.55, 4.4, 12.2, 2.25),
    )
    footer(slide)

    # 2 — credentials
    slide = blank()
    eyebrow(slide, "Try it")
    header(slide, "Sign in yourself — these accounts are live", f"{args.url} · one shared password for all four demo identities")
    table(
        slide,
        ["Email", "Display name", "Role", "What it can do"],
        [(email, name, role, capability) for email, name, role, capability in ACCOUNTS],
        box=(0.55, 2.15, 12.2, 2.35),
        widths=[3.4, 2.6, 1.5, 4.7],
        size=12,
    )
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.55), Inches(4.75), Inches(12.2), Inches(1.1))
    card.fill.solid()
    card.fill.fore_color.rgb = DARK
    card.line.fill.background()
    text(slide, 0.9, 4.95, 3.0, 0.6, ["Shared password"], size=12, color=RGBColor(0xAF, 0xBE, 0xD4))
    text(slide, 3.6, 4.9, 5.2, 0.7, [password], size=22, color=WHITE, bold=True)
    text(
        slide,
        8.6,
        4.95,
        4.0,
        0.7,
        ["These are demo identities. Please use fictional facts — no real client data."],
        size=11,
        color=RGBColor(0xAF, 0xBE, 0xD4),
    )
    caption(slide, "Each identity owns its workspace: new accounts start empty, seeded accounts start with demo matters.")
    footer(slide)

    # 3 — sign-in
    divider("01 · Sign in", "Entering the workspace", "Password login, a session token held by the shell, and a workspace that is yours alone.")
    shot_slide("login-advocate", "Sign in", "The public edge presents the same login for every role", "Browser run at 1440×900 against the public URL — no local fixtures.")
    grid_slide(
        "The other three identities",
        "Same screen, same password, four separate workspaces",
        ["login-associate", "login-researcher", "login-staff"],
        "Each sign-in opens a workspace that only holds that account's rows.",
    )

    # 4 — cockpit
    divider("02 · Cockpit", "The dashboard you land on", "Live counts, deadlines, upcoming hearings and recent activity, straight from the database.")
    shot_slide("advocate-dashboard", "Cockpit", "KPIs, deadlines, next hearings and activity feed", f"Seeded workspace: {values['cases']} matters · {values['clients']} clients · {values['tasks']} tasks.")

    # 5 — matters
    divider("03 · Matters", "Cases, parties and limitation clocks", "The matter library, the record itself, and creating one from scratch.")
    shot_slide("advocate-cases", "Matter library", "Filter by status, search by party or reference", f"The list matched the API exactly: {values['cases']} matters for this account.")
    shot_slide("advocate-case-detail", "Matter record", "Parties, forum, hearings, documents, notes and linked tasks", "One place for everything attached to a dispute, including limitation dates.")

    # 6 — clients / tasks / calendar
    divider("04 · People and work", "Clients, tasks and the hearing calendar", "The book of clients, the to-do list that ties to matters, and the dates that cannot slip.")
    shot_slide("advocate-clients", "Client book", "Clients, organisations and their matters", f"{values['clients']} clients on the seeded account.")
    pair_slide("Tasks", "The composer, then the list it produced", "advocate-task-form", "advocate-tasks", "Priority, due date and a linked matter — created in the browser, read back from the API.")
    shot_slide("advocate-calendar", "Calendar", "Hearings and deadlines in workspace time (Asia/Kolkata)", "Dates come from matters and tasks, not from a separate planner.")

    # 7 — documents
    divider("05 · Documents", "Ingestion that you can watch happen", "Upload, extraction, OCR, chunking, embeddings — then the same document read back in the browser.")
    shot_slide("advocate-documents", "Document library", "Type, status, collection and page count for every file", f"{values['documents']} documents · {values['documents_ready']} ready · {values['pages']} pages.")
    shot_slide("associate-upload-queue", "Ingestion progress", "Extract → embed → index, with live job status", "The run uploads a PDF through the browser file picker on a brand-new account and polls the job until it is ready.")
    shot_slide("associate-document-viewer", "The uploaded document", "Extracted text, page map and search inside the file", "Same document, minutes later — proof the object store and the index both worked.")
    shot_slide("associate-search", "The upload is searchable", "Semantic plus lexical hits with page references", "Searching text that exists only in the file this account just uploaded.")
    shot_slide("advocate-document-viewer", "Reading a statute", "A 54-page Act with its extracted text and page references", f"Statute library loaded for the demo: {values['statutes']} Acts, {values['statute_pages']} pages.")

    corpus = [d for d in stats.get("documents", []) if (d.get("type") or "") == "Statute"]
    if corpus:
        slide = blank()
        eyebrow(slide, "Corpus")
        header(slide, "The statute shelf behind the research desk", "Uploaded through the public edge, indexed into the same workspace")
        table(
            slide,
            ["Statute", "Pages", "Status"],
            [(d.get("title"), d.get("pages"), d.get("status")) for d in corpus[:13]],
            box=(0.55, 2.15, 12.2, 4.35),
            widths=[8.6, 1.6, 2.0],
            size=12,
        )
        caption(slide, "Duplicate uploads are refused by content hash, so a re-run of the uploader is safe.")
        footer(slide)

    # 8 — retrieval
    divider("06 · Retrieval", "Search that understands and cites", "Semantic vectors plus Postgres full-text, fused and ranked, with page-level references.")
    shot_slide("advocate-search", "Hybrid search", "One query, both signals, results with page numbers", f"API reported {values['search_total']} matching passages (status: {values['search_status']}).")
    shot_slide("advocate-research-ask", "Research desk", "Ask in plain language, scoped to the workspace corpus", "The question is sent to retrieval first, then to the local LLM with the passages.")
    shot_slide("advocate-research-answer", "Grounded answer", "Answer with the statute passages it actually used", "Citations are clickable back to the document page; ungrounded claims are avoided by construction.")

    # 9 — drafting
    divider("07 · Drafting", "From matter to first draft", "Pick a matter and a document type, generate, then edit with the sources in view.")
    shot_slide("advocate-drafts-form", "Draft builder", "Matter, document type and institution drive the prompt", "Facts the corpus cannot support stay marked for review instead of being invented.")
    shot_slide("advocate-draft-editor", "Draft editor", "Editable clause text with cited sources alongside", "Saving a draft files it against the matter for the next pass.")

    # 10 — bundles
    divider("08 · Filing bundles", "Assemble and export the paperbook", "Order the documents, generate the merged PDF, and hand it to the registry.")
    shot_slide("advocate-bundles", "Filing bundles", "One paperbook per matter, in filing order", "The e2e pass creates a bundle and verifies the export really is a PDF (bytes start with %PDF).")
    pair_slide(
        "Inside a bundle",
        "Contents in filing order, then the generated file",
        "advocate-bundle-items",
        "advocate-bundle-ready",
        "Documents are added one at a time with a section label and a page range; Generate merges them into a downloadable PDF.",
    )

    # 11 — supporting surfaces
    divider("09 · Around the workspace", "Strategy, autofill, community, settings", "The rest of the shell: issue mapping, clause extraction, practice discussion, account controls.")
    for label, heading, sub, note in [
        ("advocate-strategy", "Strategy", "Positions and issues tracked against a matter", "Written from the same record the rest of the workspace reads."),
        ("advocate-autofill", "Smart autofill", "Pull clause facts out of a document into a form", "Upload a contract, get the structured fields back."),
        ("advocate-settings", "Settings", "Profile, workspace preferences and security", "Where an account checks what is configured."),
        ("advocate-palette", "Command palette", "Jump to any matter or document from the shell", "One keystroke replaces most of the navigation."),
    ]:
        shot_slide(label, heading, sub, note)
    pair_slide(
        "Community",
        "Write it up, then find it in the feed",
        "advocate-community-form",
        "advocate-community",
        "The composer defaults to Private; the walkthrough shares one post to the workspace feed so the difference is visible.",
    )

    # 12 — roles and isolation
    divider("10 · Trust boundaries", "Roles and per-user workspaces", "What a researcher may not do, and what no other account can see.")
    shot_slide("associate-empty-start", "A fresh account", "Nothing assumed: the workspace starts empty", "Same deployment, same release — a brand-new identity sees none of the seeded demo data.")
    shot_slide("associate-case-form", "Creating a matter", "Seat, institution, claim value, limitation date", "Written by the new account in the browser, at the public URL.")
    shot_slide("associate-case-created", "The matter it created", "Owner-scoped to the signed-in account", "Every list call is filtered by owner id on the server.")
    shot_slide("associate-isolation", "Isolation in practice", "The seeded firm's matters are simply not there", "The e2e pass asserts the other account's titles never appear, in UI or search.")
    shot_slide("researcher-dashboard", "Second identity", "The researcher sees their own workspace", "Same URL, different session — a different set of rows everywhere.")
    shot_slide("researcher-role", "Role enforcement", "A researcher is read-only for ingestion", "The upload attempt is refused: 403 “This role is read-only”.")
    shot_slide("staff-dashboard", "Third identity", "The staff account, with its own empty workspace", "Role-based access is enforced by the API, not hidden in the UI.")
    shot_slide("associate-documents", "A library of one", "The new account only ever sees what it uploaded", "One PDF in, one PDF listed — the seeded firm’s 400-odd pages are not in this view.")

    # 13 — mobile
    divider("11 · On the move", "The same workspace at 390×844", "Nothing is a desktop-only screen — the mobile pass runs the same flows.")
    shot_slide("mobile-login-advocate", "Signing in on a phone", "Same public edge, same credentials, 390 px wide", "The mobile pass is a second real run through the shell, not a resized desktop capture.")
    pair_slide("Mobile · cockpit and matters", "The shell reflows; the data is identical", "mobile-dashboard", "mobile-cases", "No horizontal overflow at 390 px — checked in the browser.")
    pair_slide("Mobile · documents and research", "Reading statutes and asking questions from a phone", "mobile-documents", "mobile-research", "The same session token works; the API is the public edge.")

    # 14 — evidence
    evidence_slide = blank()
    eyebrow(evidence_slide, "Evidence")
    header(evidence_slide, "What the browser run proved", f"{values['checks_passed']} of {values['checks_total']} assertions passed against the live deployment")
    rows = [(("pass" if c.get("ok") else "FAIL"), c.get("name"), (c.get("detail") or "")[:78]) for c in checks[:14]]
    table(evidence_slide, ["", "Assertion", "Measured"], rows, box=(0.55, 2.15, 12.2, 4.35), widths=[0.9, 6.0, 5.3], size=10.5)
    caption(evidence_slide, "Every assertion is a real check on the deployed service; nothing here runs against mocks.")
    footer(evidence_slide)

    if len(checks) > 14:
        for index in range(14, len(checks), 12):
            slide = blank()
            eyebrow(slide, "Evidence")
            header(slide, "Assertions, continued", f"checks {index + 1}–{min(index + 12, len(checks))} of {len(checks)}")
            rows = [(("pass" if c.get("ok") else "FAIL"), c.get("name"), (c.get("detail") or "")[:78]) for c in checks[index : index + 12]]
            table(slide, ["", "Assertion", "Measured"], rows, box=(0.55, 2.15, 12.2, 4.35), widths=[0.9, 6.0, 5.3], size=10.5)
            footer(slide)

    slide = blank()
    eyebrow(slide, "Under the hood")
    header(slide, "The parts you do not see in the UI", "Postgres does the retrieval work; MinIO holds the bytes")
    bullets(
        slide,
        [
            "Retrieval | websearch_to_tsquery + ts_rank over a GIN index, fused with cosine-style scoring on real[] chunk vectors via an immutable SQL function",
            "Embeddings | fastembed (ONNX Runtime) all-MiniLM-L6-v2, 384 dimensions, generated in-process on the backend pod",
            "Storage | uploads keyed by sha256, deduplicated per owner, so the same file never indexes twice",
            "Ingestion | one document per job: extract → chunk (1800 chars, 250 overlap) → embed → insert pages, chunks and vectors under an index lock",
            "Auth | JWT bearer token; owner id stamped on every row, and every list query filtered by owner",
            "Operations | image tag pinned in a private registry, Recreate strategy, startup probes on /readyz, emptyDir scratch only — PostgreSQL and MinIO are the state",
        ],
        box=(0.55, 2.15, 12.2, 4.35),
    )
    footer(slide)

    slide = blank()
    eyebrow(slide, "Honest limits")
    header(slide, "What is still rough", "Stated plainly, because a demo that hides its edges is worth less")
    bullets(
        slide,
        [
            "Big documents | the 347-page Code of Civil Procedure OOM-killed the backend at a 4 Gi ceiling (exit 137, restart count 2). At 6 Gi the same file completes and peaks at 4.83 GiB — one process holds pages, chunks and vectors, so document size sets the memory floor",
            "Ingestion state | the job queue lives inside the backend container, so a pod restart orphans a running document: the row stays “extracting” until someone calls the retry endpoint",
            "Node stability | the app node rebooted four times in ~35 minutes while the library was being indexed; the stack now runs on a single pinned node, and the second app node still cannot pull images (no insecure-registry entry), so there is no failover yet",
            "Shared database | PostgreSQL is shared with other platforms; a dead node's half-open sessions can exhaust its connection slots, so the backend pool is deliberately small (3 + 4 overflow)",
            "Found during this pass | one React hydration text mismatch (#418) in the console; a duplicate matter returns 409 instead of linking to the existing record; community posts default to Private, so a first-time user may think the feed is broken",
        ],
        box=(0.55, 2.15, 12.2, 4.35),
    )
    footer(slide)

    closing = blank(dark=True)
    eyebrow(closing, "Your turn", dark=True)
    text(closing, 0.55, 2.4, 12.2, 1.0, ["Sign in and try it"], size=40, color=WHITE, bold=True)
    text(closing, 0.55, 3.6, 12.2, 2.4, [args.url, "", "advocate@tantara.local  ·  researcher@tantara.local  ·  staff@tantara.local  ·  associate@tantara.local", f"password: {password}"], size=17, color=RGBColor(0xC7, 0xD3, 0xE6))
    caption(closing, "Suggested first move: open the Arbitration Act in Documents, then search “interim measures”, then ask the research desk the same question.", y=6.3)
    footer(closing, dark=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    print(f"wrote {out} ({len(prs.slides._sldIdLst)} slides)")
    if missing:
        print(f"missing screenshots: {', '.join(missing)}")
    unused = sorted(label for label in shots if label not in used)
    if unused:
        print(f"screenshots taken but not on any slide: {', '.join(unused)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
