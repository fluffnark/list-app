import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { DateTime } from "luxon";
import {
  Sun,
  Inbox,
  ShoppingCart,
  Layers,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Check,
  CheckCheck,
  MoreHorizontal,
  X,
  Trash2,
  Settings,
  Repeat,
  FileText,
  ArrowUpRight,
  Cloud,
  CloudOff,
  Menu,
  CornerDownLeft,
  RotateCcw,
  Link as LinkIcon,
  Download,
  Pin,
  Hash,
  Calendar,
  Flag,
  Command,
  LogIn,
  ExternalLink,
  Copy,
  Mic,
  Pause,
  Play,
  SkipForward,
  FolderPlus,
  House,
  CalendarDays,
} from "lucide-react";
import {
  db,
  initDB,
  mutate,
  create,
  api,
  syncNow,
  resolveConflict,
  download,
  markdown,
  apiRoot,
  refreshSnapshot,
  collectAttachments,
  type Conflict,
} from "./db";
import {
  INBOX,
  SHOPPING,
  WORKSPACE,
  uuid,
  newItem,
  capture,
  calendarDate,
  isActive,
  ready,
  descendants,
  markdownExcerpt,
  type Item,
  type Entity,
  type List,
  type Category,
} from "../shared/model";
import { native } from "./native";
// Markdown editor and calendar load on first use to keep startup small.
const NoteEditor = React.lazy(() =>
  import("./notes").then((m) => ({ default: m.NoteEditor })),
);
const CalendarView = React.lazy(() =>
  import("./calendar").then((m) => ({ default: m.CalendarView })),
);
const CalendarSettings = React.lazy(() =>
  import("./calendar").then((m) => ({ default: m.CalendarSettings })),
);
import { VERSION } from "../shared/version";
import "./style.css";
import { ThemePicker } from "./themes";
import { CategoryIcon, CategoryIconPicker } from "./assets";
const client = new QueryClient();
let initialData: Entity[] = [];
let initialPending = 0;
let initialConflicts: Conflict[] = [];
const iconProps = { size: 18, strokeWidth: 1.7 };
function App() {
  const entities: Entity[] = useLiveQuery(
    () => db.entities.toArray(),
    [],
    initialData,
  );
  const pending = useLiveQuery(() => db.outbox.count(), [], initialPending)!;
  const conflicts = useLiveQuery(
    () => db.conflicts.toArray(),
    [],
    initialConflicts,
  )!;
  const items = entities.filter((x): x is Item => x.kind === "item");
  const lists = entities
    .filter((x): x is List => x.kind === "list" && !x.archived_at)
    .sort((a, b) => a.sort_key - b.sort_key);
  const categories = entities.filter(
    (x): x is Category => x.kind === "category" && !x.archived_at,
  );
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const [view, setView] = useState(() =>
    window.matchMedia("(max-width: 760px)").matches
      ? "home"
      : localStorage.getItem("listflow-view") || "today",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureParent, setCaptureParent] = useState<string | null>(null);
  const [draft, setDraft] = useState(
    localStorage.getItem("listflow-draft") || "",
  );
  const [noteTitle, setNoteTitle] = useState(
    localStorage.getItem("listflow-note-title-draft") || "",
  );
  const [noteBody, setNoteBody] = useState(
    localStorage.getItem("listflow-note-body-draft") || "",
  );
  const saveNoteDraft = (title: string, body: string) => {
    setNoteTitle(title);
    setNoteBody(body);
    localStorage.setItem("listflow-note-title-draft", title);
    localStorage.setItem("listflow-note-body-draft", body);
  };
  const [captureType, setCaptureType] = useState<Item["type"]>("task");
  const [captureList, setCaptureList] = useState(INBOX);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Saved on device");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<null | (() => Promise<unknown>)>(null);
  const [confirmAll, setConfirmAll] = useState<Item | null>(null);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api("/api/session"),
    retry: false,
    refetchInterval: 60000,
  });
  useQuery({
    queryKey: ["sync"],
    queryFn: async () => {
      await syncNow();
      return Date.now();
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const write = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => void syncNow(), 800);
    };
    const online = () => void syncNow(true);
    const visibility = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const status = (e: Event) => setSyncStatus((e as CustomEvent).detail);
    window.addEventListener("listflow-write", write);
    window.addEventListener("listflow-sync", status);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("listflow-write", write);
      window.removeEventListener("listflow-sync", status);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (!isMobile && view !== "home")
      localStorage.setItem("listflow-view", view);
  }, [view, isMobile]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const change = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
      setView(
        event.matches
          ? "home"
          : localStorage.getItem("listflow-view") || "today",
      );
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!navOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [navOpen]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => {
      setNotice("");
      setUndo(null);
    }, 7000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setNavOpen(false);
        setCaptureOpen(false);
        setSearchOpen(false);
        setSelected(null);
        setSettingsOpen(false);
      }
      if (
        e.key === "q" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        openCapture();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("item");
    if (id) setSelected(id);
    const launch = async () => {
      if (!native) return;
      const data = await native.getLaunch();
      if (data.text) {
        setCaptureType("task");
        setDraft(data.text);
        localStorage.setItem("listflow-draft", data.text);
        setCaptureOpen(true);
      }
      if (data.route === "shopping") {
        setView(SHOPPING);
        setCaptureOpen(false);
        setSelected(null);
      }
      if (data.route === "today") {
        setView("today");
        setCaptureOpen(false);
        setSelected(null);
      }
      if (data.route === "capture") setCaptureOpen(true);
      if (data.item) setSelected(data.item);
    };
    void launch();
    window.addEventListener("listflow-native-launch", launch);
    return () => window.removeEventListener("listflow-native-launch", launch);
  }, []);
  const notify = (message: string, action?: () => Promise<unknown>) => {
    setNotice(message);
    setUndo(action ? () => action : null);
  };
  async function act(fn: () => Promise<unknown>) {
    try {
      return await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save");
    }
  }
  function navigate(id: string) {
    setView(id);
    setSearch("");
    setNavOpen(false);
    setShowDone(false);
  }
  function openCapture(parent: string | null = null, type?: Item["type"]) {
    setCaptureParent(parent);
    const list = parent
      ? items.find((x) => x.id === parent)?.list_id
      : lists.some((x) => x.id === view)
        ? view
        : INBOX;
    setCaptureList(list || INBOX);
    setCaptureType(
      type ||
        (!parent && view === "notes"
          ? "note"
          : list === SHOPPING
            ? "shopping"
            : "task"),
    );
    setCaptureOpen(true);
  }
  async function submitCapture(e: React.FormEvent) {
    e.preventDefault();
    if (
      captureType === "note"
        ? !noteTitle.trim() && !noteBody.trim()
        : !draft.trim()
    )
      return;
    const parsed =
      captureType === "note"
        ? newItem(noteTitle.trim() || "Untitled note", {
            type: "note",
            body_md: noteBody,
            list_id: captureList,
          })
        : capture(draft, captureList);
    if (captureParent) {
      parsed.parent_item_id = captureParent;
      parsed.list_id =
        items.find((x) => x.id === captureParent)?.list_id || captureList;
    }
    await act(async () => {
      await create(parsed);
      if (captureType === "note") {
        saveNoteDraft("", "");
        localStorage.removeItem("listflow-note-title-draft");
        localStorage.removeItem("listflow-note-body-draft");
      } else {
        setDraft("");
        localStorage.removeItem("listflow-draft");
      }
      setCaptureOpen(false);
      notify(
        `Added to ${lists.find((x) => x.id === parsed.list_id)?.name || "Inbox"}`,
        () => mutate(parsed.id, "delete"),
      );
    });
  }
  async function toggle(item: Item) {
    if (item.status === "done") {
      await act(() => mutate(item.id, "reopen"));
      return;
    }
    if (descendants(entities, item.id).some(isActive)) {
      setConfirmAll(item);
      return;
    }
    await act(async () => {
      await mutate(item.id, "complete");
      notify(
        item.recurrence?.active ? "Done. Next repeat scheduled" : "Completed",
        () => mutate(item.id, "reopen"),
      );
    });
  }
  async function remove(item: Item) {
    await act(async () => {
      await mutate(item.id, "delete");
      setSelected(null);
      notify("Moved to trash", () => mutate(item.id, "restore"));
    });
  }
  const today = DateTime.local().toISODate()!;
  const active = items.filter(
    (x) => isActive(x) && ready(x) && !x.parent_item_id,
  );
  const list = lists.find((x) => x.id === view);
  let visible: Item[] = [];
  if (search)
    visible = items.filter(
      (x) =>
        !x.deleted_at &&
        `${x.title} ${x.body_md}`.toLowerCase().includes(search.toLowerCase()),
    );
  else if (view === "today")
    visible = active.filter(
      (x) =>
        x.type !== "note" &&
        (!x.scheduled_for || calendarDate(x.scheduled_for)! <= today),
    );
  else if (view === "notes")
    visible = items.filter(
      (x) => x.type === "note" && !x.deleted_at && !x.parent_item_id,
    );
  else if (view === "routines")
    visible = items.filter(
      (x) => x.recurrence && !x.deleted_at && !x.parent_item_id,
    );
  else if (view === "trash")
    visible = items.filter(
      (x) =>
        x.deleted_at &&
        !items.find((p) => p.id === x.parent_item_id)?.deleted_at,
    );
  else if (list)
    visible = items.filter(
      (x) =>
        x.list_id === list.id &&
        !x.deleted_at &&
        !x.parent_item_id &&
        (showDone || x.status !== "done"),
    );
  visible.sort((a, b) => a.sort_key - b.sort_key);
  const scheduled =
    view === "today" && !search
      ? visible.filter((x) => calendarDate(x.scheduled_for) === today)
      : [];
  let next =
    view === "today" && !search
      ? visible
          .filter((x) => !scheduled.includes(x))
          .sort(
            (a, b) =>
              ["urgent", "high", "medium", "low", "none"].indexOf(a.priority) -
                ["urgent", "high", "medium", "low", "none"].indexOf(
                  b.priority,
                ) || a.sort_key - b.sort_key,
          )
          .slice(0, 5)
      : visible;
  const todayCount = active.filter(
    (x) => x.type === "task" && calendarDate(x.scheduled_for) === today,
  ).length;
  const heading = search
    ? "Search results"
    : view === "home"
      ? "Home"
      : view === "today"
        ? "Today"
        : view === "calendar"
          ? "Calendar"
          : view === "lists"
            ? "Lists"
            : view === "notes"
              ? "Notes"
              : view === "routines"
                ? "Routines"
                : view === "trash"
                  ? "Trash"
                  : list?.name || "Inbox";
  const chosen = items.find((x) => x.id === selected);
  function count(id: string) {
    return active.filter((x) => x.list_id === id).length;
  }
  function navButton(
    id: string,
    label: string,
    Icon: typeof Sun,
    badge?: number,
  ) {
    return (
      <button
        key={id}
        className={`nav-item ${view === id ? "selected" : ""}`}
        onClick={() => navigate(id)}
      >
        <Icon {...iconProps} />
        <span className="nav-label">{label}</span>
        {!!badge && <span className="nav-count">{badge}</span>}
      </button>
    );
  }
  function row(item: Item, depth = 0): React.ReactNode {
    const children = items
      .filter((x) => x.parent_item_id === item.id && !x.deleted_at)
      .sort((a, b) => a.sort_key - b.sort_key);
    const finished = children.filter((x) => x.status === "done").length;
    const dest = lists.find((x) => x.id === item.list_id);
    return (
      <div key={item.id} className={`item-tree depth-${Math.min(depth, 2)}`}>
        <div className={`task-row ${item.status === "done" ? "done" : ""}`}>
          {view === "trash" ? (
            <button
              className="check-circle"
              title="Restore item"
              onClick={() => act(() => mutate(item.id, "restore"))}
            >
              <RotateCcw size={14} />
            </button>
          ) : item.type === "note" ? (
            <FileText size={19} className="note-icon" />
          ) : (
            <button
              className={`check-circle ${item.status === "done" ? "checked" : ""} ${item.type === "shopping" ? "shopping-check" : ""}`}
              aria-label={`${item.status === "done" ? "Reopen" : "Complete"} ${item.title}`}
              onClick={() => toggle(item)}
            >
              {item.status === "done" && <Check size={13} />}
            </button>
          )}
          <button className="task-main" onClick={() => setSelected(item.id)}>
            <span className="task-title">{item.title}</span>
            {item.type === "note" && item.body_md && (
              <span className="note-excerpt">
                {markdownExcerpt(item.body_md, 100)}
              </span>
            )}
          </button>
          <div className="task-meta">
            {item.priority !== "none" && (
              <Flag
                size={13}
                className={`priority-${item.priority}`}
                aria-label={`${item.priority} priority`}
              />
            )}{" "}
            {children.length > 0 && (
              <span className="subtask-count">
                <Layers size={12} />
                {finished}/{children.length}
              </span>
            )}
            {item.recurrence && (
              <span
                title={
                  item.recurrence.active
                    ? "Repeats " + item.recurrence.frequency
                    : "Repeat paused"
                }
              >
                <Repeat size={13} />
              </span>
            )}
            {(view === "today" || search) && dest && (
              <span className="list-tag">
                <span
                  className={`tiny-dot ${dest.id === SHOPPING ? "green" : "purple"}`}
                />
                {dest.name}
              </span>
            )}
            {item.due_at && (
              <span
                className={`date-tag ${calendarDate(item.due_at)! < today ? "overdue" : ""}`}
              >
                {DateTime.fromISO(item.due_at).toFormat("MMM d")}
              </span>
            )}
            <button
              className="row-more icon-button"
              aria-label={`Edit ${item.title}`}
              onClick={() => setSelected(item.id)}
            >
              <MoreHorizontal size={17} />
            </button>
          </div>
        </div>
        {depth < 2
          ? children.map((c) => row(c, depth + 1))
          : children.length > 0 && (
              <button className="deeper" onClick={() => setSelected(item.id)}>
                View {children.length} deeper subtasks{" "}
                <ChevronRight size={12} />
              </button>
            )}
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${navOpen ? "mobile-open" : ""}`}>
        <div className="workspace-brand">
          <div className="brand-mark">
            <CheckCheck size={20} />
          </div>
          <strong>ListFlow</strong>
          <span className="personal-label">Personal</span>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          <span>Search anything</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className="main-nav">
          {navButton("today", "Today", Sun, todayCount)}
          {navButton("calendar", "Calendar", CalendarDays)}
          {navButton(INBOX, "Inbox", Inbox, count(INBOX))}
          {navButton("notes", "Notes", FileText)}
          {navButton("routines", "Routines", Repeat)}
        </nav>
        <div className="nav-section-label">
          <span>PINNED</span>
          <button
            className="icon-button"
            title="Browse lists"
            onClick={() => navigate("lists")}
          >
            <Plus size={14} />
          </button>
        </div>
        <nav>
          {lists
            .filter((x) => x.pinned)
            .map((x) =>
              navButton(
                x.id,
                x.name,
                x.id === SHOPPING ? ShoppingCart : Hash,
                count(x.id),
              ),
            )}
        </nav>
        <div className="nav-section-label lists-label">
          <span>WORKSPACE</span>
        </div>
        <nav>
          {navButton("lists", "All lists", Layers)}
          {categories.map((c) => (
            <div key={c.id}>
              <div className="category-label">
                <CategoryIcon category={c} />
                {c.name}
              </div>
              {lists
                .filter((x) => x.category_id === c.id)
                .map((x) => navButton(x.id, x.name, Hash, count(x.id)))}
            </div>
          ))}
          {lists
            .filter((x) => !x.pinned && x.id !== INBOX && !x.category_id)
            .map((x) => navButton(x.id, x.name, Hash, count(x.id)))}
        </nav>
        <div className="sidebar-bottom">
          {navButton("trash", "Trash", Trash2)}
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>
            <Settings {...iconProps} />
            <span className="nav-label">Settings & connections</span>
          </button>
          <button
            className="sync-indicator"
            onClick={() =>
              session.data ? void syncNow(true) : setSettingsOpen(true)
            }
          >
            {syncStatus === "Synced" ? (
              <Cloud size={14} />
            ) : (
              <CloudOff size={14} />
            )}
            <span>
              {!navigator.onLine ? "Offline · saved on device" : syncStatus}
              {pending > 0 ? ` · ${pending} pending` : ""}
            </span>
            <span
              className={`status-dot ${syncStatus === "Synced" ? "online" : ""}`}
            />
          </button>
        </div>
      </aside>
      {navOpen && (
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={19} />
            </button>
            <span className="root-crumb">My workspace</span>
            <ChevronRight size={13} className="crumb-separator" />
            <span className="current-crumb">{heading}</span>
          </div>
          <div className="topbar-actions">
            <span className="local-badge">
              <span className="status-dot online" />
              {session.data ? "Personal workspace" : "Local first"}
            </span>
            <button
              className="icon-button"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
            </button>
            <button
              className="avatar"
              aria-label="Open account settings"
              onClick={() => setSettingsOpen(true)}
            >
              D
            </button>
          </div>
        </header>
        <main>
          <div
            className={`page-header ${view === "home" ? "home-page-header" : ""}`}
          >
            <div>
              {view === "today" && (
                <div className="eyebrow">
                  {DateTime.local().toFormat("EEEE, LLLL d")}
                </div>
              )}
              <h1>
                {heading}
                <span className="heading-dot">.</span>
              </h1>
            </div>
            <button
              className="primary-button header-add"
              aria-label="Add item"
              onClick={() => openCapture()}
            >
              <Plus size={16} />
              Add item<kbd>Q</kbd>
            </button>
          </div>
          {conflicts.length > 0 && (
            <button
              className="conflict-banner"
              onClick={() => setSettingsOpen(true)}
            >
              Some edits need your attention · Review {conflicts.length}{" "}
              conflict{conflicts.length > 1 ? "s" : ""}{" "}
              <ArrowUpRight size={15} />
            </button>
          )}
          {view === "home" && !search ? (
            <section className="mobile-home" aria-label="Notes and navigation">
              <button
                className="home-write-note"
                aria-label="Write a note"
                onClick={() => openCapture(null, "note")}
              >
                <span className="home-write-icon">
                  <Plus size={24} />
                </span>
                <span>Write a note</span>
                <FileText size={23} />
              </button>
              <nav
                className="home-navigation"
                aria-label="Workspace destinations"
              >
                <button onClick={() => navigate("today")}>
                  <Sun size={25} />
                  <strong>Today</strong>
                  <small>{todayCount} planned</small>
                </button>
                <button onClick={() => navigate(INBOX)}>
                  <Inbox size={25} />
                  <strong>Inbox</strong>
                  <small>
                    {count(INBOX)} {count(INBOX) === 1 ? "item" : "items"}
                  </small>
                </button>
                <button
                  className="shopping-destination"
                  onClick={() => navigate(SHOPPING)}
                >
                  <ShoppingCart size={25} />
                  <strong>Shopping</strong>
                  <small>{count(SHOPPING)} to pick up</small>
                </button>
                <button onClick={() => navigate("lists")}>
                  <Layers size={25} />
                  <strong>All lists</strong>
                  <small>
                    {lists.length} lists · {categories.length} categories
                  </small>
                </button>
              </nav>
              {lists.some(
                (l) => l.pinned && l.id !== SHOPPING && l.id !== INBOX,
              ) && (
                <nav className="home-pins" aria-label="Pinned lists">
                  {lists
                    .filter(
                      (l) => l.pinned && l.id !== SHOPPING && l.id !== INBOX,
                    )
                    .map((l) => (
                      <button key={l.id} onClick={() => navigate(l.id)}>
                        <Hash size={17} />
                        {l.name}
                        <ChevronRight size={16} />
                      </button>
                    ))}
                </nav>
              )}
              <div className="home-notes-heading">
                <h2>Recent notes</h2>
                <button
                  className="text-button"
                  onClick={() => navigate("notes")}
                >
                  All notes <ArrowUpRight size={17} />
                </button>
              </div>
              <div className="home-notes">
                {items
                  .filter(
                    (x) =>
                      x.type === "note" && !x.deleted_at && !x.parent_item_id,
                  )
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .slice(0, 3)
                  .map((note) => (
                    <button
                      className="home-note"
                      key={note.id}
                      onClick={() => setSelected(note.id)}
                    >
                      <span className="home-note-title">
                        <FileText size={20} />
                        <strong>{note.title}</strong>
                        <ChevronRight size={18} />
                      </span>
                      {note.body_md && (
                        <p>{markdownExcerpt(note.body_md, 180)}</p>
                      )}
                      <small>
                        {DateTime.fromISO(note.updated_at).toRelative()}
                      </small>
                    </button>
                  ))}
                {!items.some(
                  (x) =>
                    x.type === "note" && !x.deleted_at && !x.parent_item_id,
                ) && (
                  <button
                    className="home-notes-empty"
                    onClick={() => openCapture(null, "note")}
                  >
                    <FileText size={23} />
                    <span>
                      <strong>
                        Start your first note <Plus size={17} />
                      </strong>
                    </span>
                  </button>
                )}
              </div>
            </section>
          ) : view === "calendar" && !search ? (
            <React.Suspense fallback={null}>
              <CalendarView
                items={items}
                signedIn={!!session.data}
                onOpen={setSelected}
              />
            </React.Suspense>
          ) : view === "lists" && !search ? (
            <ListGallery
              lists={lists}
              categories={categories}
              items={items}
              onNavigate={navigate}
              onError={notify}
            />
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <span
                    className={`section-dot ${view === SHOPPING ? "green" : "purple"}`}
                  />
                  <h2>
                    {search
                      ? `${visible.length} results`
                      : view === "today"
                        ? "Next up"
                        : view === "trash"
                          ? "Recently deleted"
                          : view === "notes"
                            ? "All notes"
                            : view === "routines"
                              ? "Your rhythms"
                              : "Items"}
                  </h2>
                  <span className="section-count">{next.length}</span>
                </div>
                <div className="section-tools">
                  {list && (
                    <button
                      onClick={() => setShowDone(!showDone)}
                      className="text-button"
                    >
                      {showDone ? "Hide completed" : "Show completed"}
                    </button>
                  )}
                  <MoreHorizontal size={17} />
                </div>
              </div>
              <div className="task-list">
                {next.length ? (
                  next.map((x) => row(x))
                ) : (
                  <div className="empty-state">
                    <div className="empty-symbol">
                      {view === SHOPPING ? (
                        <ShoppingCart size={28} />
                      ) : view === "notes" ? (
                        <FileText size={28} />
                      ) : (
                        <CheckCheck size={28} />
                      )}
                    </div>
                    <h3>
                      {search
                        ? "No matching items"
                        : view === "trash"
                          ? "Nothing in trash"
                          : view === SHOPPING
                            ? "Shopping list is empty"
                            : view === "today"
                              ? "Nothing planned"
                              : "Nothing here yet"}
                    </h3>
                  </div>
                )}
                {view !== "trash" && (
                  <button className="inline-add" onClick={() => openCapture()}>
                    <Plus size={16} />
                    <span>
                      {view === SHOPPING
                        ? "Add a shopping item…"
                        : "Add an item…"}
                    </span>
                    <kbd>Q</kbd>
                  </button>
                )}
              </div>
              {view === "today" && !search && scheduled.length > 0 && (
                <>
                  <div className="section-heading scheduled-heading">
                    <div>
                      <Calendar size={15} />
                      <h2>Scheduled</h2>
                      <span className="section-count">{scheduled.length}</span>
                    </div>
                  </div>
                  <div className="task-list">
                    {scheduled.map((x) => row(x))}
                  </div>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span className="keyboard-hint">
              <kbd>⌘ K</kbd> to find anything
            </span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        <button
          className={view === "home" ? "active" : ""}
          onClick={() => navigate("home")}
        >
          <House size={24} />
          <span>Home</span>
        </button>
        <button
          className={view === "notes" ? "active" : ""}
          onClick={() => navigate("notes")}
        >
          <FileText size={24} />
          <span>Notes</span>
        </button>
        <button
          className="mobile-quick"
          aria-label="Quick capture"
          onClick={() => openCapture()}
        >
          <Plus size={24} />
        </button>
        <button
          className={view === SHOPPING ? "active" : ""}
          onClick={() => navigate(SHOPPING)}
        >
          <ShoppingCart size={20} />
          <span>Shopping</span>
        </button>
        <button
          className={view === "lists" ? "active" : ""}
          onClick={() => navigate("lists")}
        >
          <Layers size={20} />
          <span>Lists</span>
        </button>
      </nav>
      {captureOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCaptureOpen(false);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Quick capture"
            className="capture-modal"
            onSubmit={submitCapture}
          >
            <div className="modal-heading">
              <span>
                <Plus size={18} />
                {captureParent ? "New subtask" : "Capture a thought"}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Close capture"
                onClick={() => setCaptureOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            {captureParent && (
              <p className="muted tiny">
                Inside {items.find((x) => x.id === captureParent)?.title}
              </p>
            )}
            {captureType === "note" ? (
              <div className="capture-note-fields">
                <label htmlFor="capture-note-title">Title</label>
                <input
                  id="capture-note-title"
                  aria-label="Note title"
                  placeholder="Title (optional)"
                  maxLength={500}
                  autoFocus
                  value={noteTitle}
                  onChange={(e) => saveNoteDraft(e.target.value, noteBody)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text/plain");
                    if (!text.includes("\n") && !text.includes("\r")) return;
                    e.preventDefault();
                    const input = e.currentTarget;
                    const combined =
                      noteTitle.slice(
                        0,
                        input.selectionStart ?? noteTitle.length,
                      ) +
                      text +
                      noteTitle.slice(input.selectionEnd ?? noteTitle.length);
                    const parsed = capture("note: " + combined);
                    saveNoteDraft(
                      parsed.title,
                      parsed.body_md + (noteBody ? "\n\n" + noteBody : ""),
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.ctrlKey || e.metaKey) void submitCapture(e);
                      else
                        document
                          .getElementById("capture-note-content")
                          ?.focus();
                    }
                  }}
                />
                <label htmlFor="capture-note-content">Content</label>
                <textarea
                  id="capture-note-content"
                  aria-label="Note content"
                  placeholder="Write your note… Markdown supported"
                  value={noteBody}
                  onChange={(e) => saveNoteDraft(noteTitle, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void submitCapture(e);
                    }
                  }}
                />
              </div>
            ) : (
              <textarea
                aria-label="What’s on your mind?"
                placeholder="What’s on your mind?"
                autoFocus
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  localStorage.setItem("listflow-draft", e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submitCapture(e);
                  }
                }}
              />
            )}
            <div className="capture-options">
              <select
                aria-label="Item type"
                value={captureType}
                onChange={(e) => {
                  const next = e.target.value as Item["type"];
                  if (
                    next === "note" &&
                    !noteTitle &&
                    !noteBody &&
                    draft.trim()
                  ) {
                    const parsed = capture(
                      /^\s*note:/i.test(draft) ? draft : "note: " + draft,
                    );
                    saveNoteDraft(parsed.title, parsed.body_md);
                    setDraft("");
                    localStorage.removeItem("listflow-draft");
                  }
                  setCaptureType(next);
                }}
              >
                <option value="task">Task</option>
                <option value="shopping">Shopping</option>
                <option value="note">Note</option>
              </select>
              <select
                aria-label="Destination list"
                disabled={!!captureParent}
                value={captureList}
                onChange={(e) => setCaptureList(e.target.value)}
              >
                {lists.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <span className="capture-hint">
                {captureType === "note"
                  ? "Ctrl/⌘ + Enter to save"
                  : "Try “review PR tomorrow”"}
              </span>
              {native && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Voice capture"
                  onClick={() =>
                    native!
                      .dictate()
                      .then((d) => {
                        if (captureType === "note")
                          saveNoteDraft(
                            noteTitle,
                            noteBody + (noteBody ? "\n" : "") + d.text,
                          );
                        else {
                          setDraft(d.text);
                          localStorage.setItem("listflow-draft", d.text);
                        }
                      })
                      .catch(() =>
                        notify("Voice capture is unavailable on this device"),
                      )
                  }
                >
                  <Mic size={17} />
                </button>
              )}
            </div>
            <div className="capture-footer">
              <span>
                <CloudOff size={13} />
                Saved locally, even offline
              </span>
              <button
                className="primary-button"
                type="submit"
                disabled={
                  captureType === "note"
                    ? !noteTitle.trim() && !noteBody.trim()
                    : !draft.trim()
                }
              >
                Add item
                <CornerDownLeft size={14} />
              </button>
            </div>
          </form>
        </div>
      )}
      {searchOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSearchOpen(false);
          }}
        >
          <div
            className="search-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Search workspace"
          >
            <Search size={20} />
            <input
              autoFocus
              placeholder="Search tasks, notes, lists…"
              aria-label="Search workspace"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearchOpen(false);
              }}
            />
            <button
              className="icon-button"
              onClick={() => setSearchOpen(false)}
            >
              <X size={18} />
            </button>
            <div className="search-preview">
              {items
                .filter(
                  (x) =>
                    !x.deleted_at &&
                    search &&
                    `${x.title} ${x.body_md}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .slice(0, 8)
                .map((x) => (
                  <button
                    key={x.id}
                    onClick={() => {
                      setSelected(x.id);
                      setSearchOpen(false);
                    }}
                  >
                    <FileText size={16} />
                    {x.title}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              <span>Type to search. Press Enter to see all results.</span>
            </div>
          </div>
        </div>
      )}
      {chosen && (
        <ItemDetail
          key={chosen.id}
          item={chosen}
          entities={entities}
          lists={lists}
          onClose={() => setSelected(null)}
          onDelete={() => remove(chosen)}
          onToggle={() => toggle(chosen)}
          onSubtask={() => openCapture(chosen.id)}
          onSelect={setSelected}
          onError={notify}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          conflicts={conflicts}
          session={session.data}
          onClose={() => setSettingsOpen(false)}
          onError={notify}
          onSession={() => {
            void session.refetch();
            void syncNow(true);
          }}
        />
      )}
      {confirmAll && (
        <div className="modal-backdrop">
          <div
            className="small-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Complete subtasks"
          >
            <h2>Complete the whole task?</h2>
            <p>
              “{confirmAll.title}” has unfinished subtasks. Complete them all
              together, or finish each one first.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setConfirmAll(null)}
              >
                Keep working
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void act(() => mutate(confirmAll.id, "complete", {}, true));
                  setConfirmAll(null);
                }}
              >
                Complete all
              </button>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          {undo && (
            <button
              onClick={() => {
                void act(undo);
                setNotice("");
              }}
            >
              Undo
            </button>
          )}
          <button aria-label="Dismiss" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
function ListGallery({
  lists,
  categories,
  items,
  onNavigate,
  onError,
}: {
  lists: List[];
  categories: Category[];
  items: Item[];
  onNavigate: (id: string) => void;
  onError: (s: string) => void;
}) {
  const [manageOpen, setManageOpen] = useState(() => {
    try {
      return !!localStorage.getItem("listflow-manage-lists");
    } catch {
      return false;
    }
  });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryIcon, setCategoryIcon] = useState("");
  async function addList(e: React.FormEvent) {
    e.preventDefault();
    try {
      const list: List = {
        id: uuid(),
        workspace_id: WORKSPACE,
        kind: "list",
        name: name.trim(),
        category_id: category || null,
        sort_key: Date.now(),
        pinned: true,
        archived_at: null,
        version: 0,
        updated_at: new Date().toISOString(),
      };
      await create(list);
      setName("");
      onNavigate(list.id);
    } catch (e) {
      onError(String(e));
    }
  }
  return (
    <>
      <div className="list-gallery">
        {lists.map((l) => (
          <button
            className="list-card"
            key={l.id}
            onClick={() => onNavigate(l.id)}
          >
            <span
              className={`destination-icon ${l.id === SHOPPING ? "mint" : "lavender"}`}
            >
              {l.id === SHOPPING ? (
                <ShoppingCart size={23} />
              ) : (
                <Hash size={23} />
              )}
            </span>
            <h3>{l.name}</h3>
            <p>
              {plural(
                items.filter(
                  (x) => x.list_id === l.id && isActive(x) && !x.parent_item_id,
                ).length,
                "item",
              )}
              {l.category_id
                ? " · " + categories.find((x) => x.id === l.category_id)?.name
                : ""}
            </p>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <div className="settings-card">
        <h3>Create a list</h3>
        <form className="inline-form" onSubmit={addList}>
          <input
            aria-label="List name"
            placeholder="A new place for something…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="primary-button" type="submit">
            <Plus size={16} />
            Create
          </button>
        </form>
      </div>
      <details
        className="manage-lists"
        open={manageOpen}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          setManageOpen(open);
          try {
            localStorage.setItem("listflow-manage-lists", open ? "1" : "");
          } catch {}
        }}
      >
        <summary>Organize lists & categories</summary>
        <div className="settings-card">
          <h3>Organize lists</h3>
          {lists.map((l) => (
            <div className="list-management-row" key={l.id}>
              <input
                aria-label={`Rename ${l.name}`}
                defaultValue={l.name}
                maxLength={100}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== l.name)
                    void mutate(l.id, "patch", {
                      name: e.target.value.trim(),
                    }).catch((e) => onError(String(e)));
                }}
              />
              <select
                aria-label={`Category for ${l.name}`}
                value={l.category_id || ""}
                onChange={(e) =>
                  void mutate(l.id, "patch", {
                    category_id: e.target.value || null,
                  }).catch((e) => onError(String(e)))
                }
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                className={`icon-button ${l.pinned ? "pinned" : ""}`}
                aria-label={`${l.pinned ? "Unpin" : "Pin"} ${l.name}`}
                aria-pressed={l.pinned}
                onClick={() =>
                  void mutate(l.id, "patch", { pinned: !l.pinned }).catch((e) =>
                    onError(String(e)),
                  )
                }
              >
                <Pin size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="settings-card">
          <h3>Create a category</h3>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await create({
                  id: uuid(),
                  workspace_id: WORKSPACE,
                  kind: "category",
                  name: categoryName,
                  icon: categoryIcon.trim() || null,
                  sort_key: Date.now(),
                  archived_at: null,
                  version: 0,
                  updated_at: new Date().toISOString(),
                });
                setCategoryName("");
                setCategoryIcon("");
              } catch (e) {
                onError(String(e));
              }
            }}
          >
            <input
              aria-label="Category name"
              placeholder="Work, Home, Personal…"
              required
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
            />
            <input
              aria-label="New category icon"
              placeholder="Emoji icon"
              maxLength={16}
              value={categoryIcon}
              onChange={(e) => setCategoryIcon(e.target.value)}
            />
            <button className="secondary-button" type="submit">
              <FolderPlus size={15} />
              Create category
            </button>
          </form>
          {categories.map((c) => (
            <div className="category-management" key={c.id}>
              <strong>{c.name}</strong>
              <CategoryIconPicker category={c} onError={onError} />
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
function ItemDetail({
  item,
  entities,
  lists,
  onClose,
  onDelete,
  onToggle,
  onSubtask,
  onSelect,
  onError,
}: {
  item: Item;
  entities: Entity[];
  lists: List[];
  onClose: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onSubtask: () => void;
  onSelect: (id: string) => void;
  onError: (s: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body_md);
  const [link, setLink] = useState(
    String(item.metadata_json.obsidian_uri || ""),
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setTitle(item.title);
  }, [item.title]);
  useEffect(() => setBody(item.body_md), [item.body_md]);
  async function patch(p: Record<string, unknown>) {
    try {
      await mutate(item.id, "patch", p);
      setDirty(false);
    } catch (e) {
      onError(String(e));
    }
  }
  // Persist text drafts before blur so a tab close or route change cannot discard them.
  useEffect(() => {
    const saved = localStorage.getItem("listflow-detail:" + item.id);
    if (saved) {
      try {
        const d = JSON.parse(saved);
        setTitle(d.title ?? item.title);
        setBody(d.body ?? item.body_md);
        setDirty(true);
      } catch {}
    }
  }, [item.id]);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(async () => {
      if (title.trim()) {
        await patch({ title: title.trim(), body_md: body });
        localStorage.removeItem("listflow-detail:" + item.id);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [title, body, dirty]);
  function draft(t: string, b: string) {
    setTitle(t);
    setBody(b);
    setDirty(true);
    localStorage.setItem(
      "listflow-detail:" + item.id,
      JSON.stringify({ title: t, body: b }),
    );
  }
  const children = entities
    .filter(
      (x): x is Item =>
        x.kind === "item" && x.parent_item_id === item.id && !x.deleted_at,
    )
    .sort((a, b) => a.sort_key - b.sort_key);
  const parent = entities.find((x) => x.id === item.parent_item_id);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="detail-drawer">
        <div className="drawer-top">
          <span>
            <FileText size={16} />
            {item.type === "shopping"
              ? "Shopping item"
              : item.type === "note"
                ? "Note"
                : "Task details"}
          </span>
          <button
            className="icon-button"
            aria-label="Close details"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="drawer-content">
          {parent && parent.kind === "item" && (
            <button
              className="parent-link text-button"
              onClick={() => onSelect(parent.id)}
            >
              <CornerDownLeft size={13} />
              {parent.title}
            </button>
          )}
          <textarea
            className="detail-title"
            aria-label="Item title"
            value={title}
            onChange={(e) => draft(e.target.value, body)}
            rows={item.type === "note" ? 1 : 2}
          />
          {item.type === "note" && (
            <React.Suspense fallback={null}>
              <NoteEditor
                key={item.id}
                noteId={item.id}
                value={body}
                onChange={(value) => draft(title, value)}
                onError={onError}
              />
            </React.Suspense>
          )}
          <div className="detail-status">
            <button
              className={`secondary-button ${item.status === "done" ? "completed" : ""}`}
              onClick={onToggle}
            >
              <Check size={15} />
              {item.status === "done" ? "Completed" : "Mark complete"}
            </button>
            <span>{dirty ? "Saving…" : "Saved on device"}</span>
          </div>
          <div className="properties">
            <label>
              <Layers size={15} />
              List
              <select
                value={item.list_id}
                disabled={!!item.parent_item_id}
                onChange={(e) => patch({ list_id: e.target.value })}
              >
                {lists.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <Flag size={15} />
              Priority
              <select
                value={item.priority}
                onChange={(e) => patch({ priority: e.target.value })}
              >
                {["none", "low", "medium", "high", "urgent"].map((x) => (
                  <option key={x} value={x}>
                    {x[0].toUpperCase() + x.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <Sun size={15} />
              Plan for
              <input
                aria-label="Scheduled date"
                type="date"
                value={calendarDate(item.scheduled_for) || ""}
                onChange={(e) =>
                  patch({ scheduled_for: e.target.value || null })
                }
              />
            </label>
            <label>
              <Calendar size={15} />
              Due date
              <input
                aria-label="Due date"
                type="date"
                value={calendarDate(item.due_at) || ""}
                onChange={(e) => patch({ due_at: e.target.value || null })}
              />
            </label>
            {item.type === "shopping" && (
              <label>
                <ShoppingCart size={15} />
                Quantity
                <input
                  aria-label="Shopping quantity"
                  placeholder="e.g. 2 bags"
                  defaultValue={String(item.metadata_json.quantity || "")}
                  onBlur={(e) =>
                    patch({
                      metadata_json: {
                        ...item.metadata_json,
                        quantity: e.target.value,
                      },
                    })
                  }
                />
              </label>
            )}
            <label>
              <Repeat size={15} />
              Repeat
              <select
                aria-label="Repeat frequency"
                value={item.recurrence?.frequency || ""}
                onChange={(e) =>
                  patch({
                    recurrence: e.target.value
                      ? {
                          frequency: e.target.value,
                          interval: 1,
                          timezone: DateTime.local().zoneName,
                          active: true,
                          next_at: item.scheduled_for
                            ? DateTime.fromISO(item.scheduled_for)
                                .toUTC()
                                .toISO()
                            : null,
                          last_completed_at: null,
                        }
                      : null,
                  })
                }
              >
                <option value="">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {item.recurrence && (
              <>
                <label>
                  <Calendar size={15} />
                  Every
                  <input
                    aria-label="Recurrence interval"
                    type="number"
                    min={1}
                    max={365}
                    value={item.recurrence.interval}
                    onChange={(e) => {
                      if (Number(e.target.value) > 0)
                        void patch({
                          recurrence: {
                            ...item.recurrence,
                            interval: Number(e.target.value),
                          },
                        });
                    }}
                  />
                </label>
                <label>
                  <Cloud size={15} />
                  Time zone
                  <input
                    aria-label="Recurrence time zone"
                    defaultValue={item.recurrence.timezone}
                    onBlur={(e) =>
                      patch({
                        recurrence: {
                          ...item.recurrence,
                          timezone: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <div className="repeat-controls">
                  <button
                    className="text-button"
                    onClick={() =>
                      patch({
                        recurrence: {
                          ...item.recurrence,
                          active: !item.recurrence!.active,
                        },
                      })
                    }
                  >
                    {item.recurrence.active ? (
                      <Pause size={13} />
                    ) : (
                      <Play size={13} />
                    )}{" "}
                    {item.recurrence.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      mutate(item.id, "skip").catch((e) => onError(String(e)))
                    }
                  >
                    <SkipForward size={13} />
                    Skip once
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => patch({ recurrence: null })}
                  >
                    Cancel repeat
                  </button>
                </div>
                {item.recurrence.next_at && (
                  <p className="tiny muted">
                    Next:{" "}
                    {DateTime.fromISO(item.recurrence.next_at).toLocaleString(
                      DateTime.DATETIME_MED,
                    )}
                  </p>
                )}
              </>
            )}
          </div>
          {native && (
            <button
              className="text-button"
              onClick={() => {
                if (!item.due_at) {
                  onError("Set a due date first");
                  return;
                }
                const at = DateTime.fromISO(item.due_at)
                  .set({ hour: 9 })
                  .toMillis();
                void native!
                  .remind({ id: item.id, title: item.title, at })
                  .then(() =>
                    onError("Reminder scheduled. Android may delay delivery."),
                  )
                  .catch((e) => onError(String(e)));
              }}
            >
              Remind me at 9am on the due date
            </button>
          )}
          {item.type !== "note" && (
            <div className="detail-section">
              <h3>
                Description <span>Markdown supported</span>
              </h3>
              <textarea
                className="description-editor"
                aria-label="Description"
                placeholder="Description"
                value={body}
                onChange={(e) => draft(title, e.target.value)}
              />
            </div>
          )}
          <div className="detail-section">
            <h3>
              Subtasks{" "}
              <span>
                {children.filter((x) => x.status === "done").length}/
                {children.length}
              </span>
            </h3>
            <label className="container-toggle">
              <input
                type="checkbox"
                checked={item.container}
                onChange={(e) => patch({ container: e.target.checked })}
              />
              Complete parent automatically when all subtasks are done
            </label>
            {children.map((child, i) => (
              <div className="detail-child" key={child.id}>
                <button
                  className={`check-circle ${child.status === "done" ? "checked" : ""}`}
                  aria-label={`Complete ${child.title}`}
                  onClick={() =>
                    mutate(
                      child.id,
                      child.status === "done" ? "reopen" : "complete",
                    ).catch((e) => onError(String(e)))
                  }
                >
                  {child.status === "done" && <Check size={12} />}
                </button>
                <button onClick={() => onSelect(child.id)}>
                  {child.title}
                </button>
                <button
                  className="icon-button"
                  aria-label="Move subtask up"
                  disabled={i === 0}
                  onClick={() => patchChildOrder(child, children[i - 1], true)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Move subtask down"
                  disabled={i === children.length - 1}
                  onClick={() => patchChildOrder(child, children[i + 1], false)}
                >
                  <ArrowDown size={13} />
                </button>
              </div>
            ))}
            <button className="inline-add" onClick={onSubtask}>
              <Plus size={15} />
              Add subtask
            </button>
          </div>
          <div className="detail-section">
            <h3>Obsidian & links</h3>
            <input
              aria-label="Obsidian link"
              placeholder="obsidian://open?vault=…&file=…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onBlur={() =>
                patch({
                  metadata_json: { ...item.metadata_json, obsidian_uri: link },
                })
              }
            />
            {/^(obsidian:|https?:)/.test(link) && (
              <a
                href={link}
                className="text-button"
                target="_blank"
                rel="noreferrer"
              >
                <LinkIcon size={13} />
                Open linked note
              </a>
            )}
            <div className="export-actions">
              <button
                className="text-button"
                onClick={() =>
                  download(
                    item.title.replace(/[^a-z0-9]/gi, "-") + ".md",
                    markdown(item),
                    "text/markdown",
                  )
                }
              >
                <Download size={14} />
                Export Markdown
              </button>
              <button
                className="text-button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(markdown(item))
                    .catch(() =>
                      onError("Clipboard unavailable. Use Export Markdown."),
                    );
                }}
              >
                <Copy size={14} />
                Copy
              </button>
              {!!navigator.share && (
                <button
                  className="text-button"
                  onClick={() =>
                    navigator
                      .share({ title: item.title, text: markdown(item) })
                      .catch(() => {})
                  }
                >
                  Share
                </button>
              )}
            </div>
          </div>
          <div className="detail-section">
            <h3>Order</h3>
            <div className="export-actions">
              <button
                className="text-button"
                onClick={() =>
                  patch({
                    sort_key:
                      Math.min(
                        ...entities
                          .filter(
                            (x): x is Item =>
                              x.kind === "item" && x.list_id === item.list_id,
                          )
                          .map((x) => x.sort_key),
                      ) - 1024,
                  })
                }
              >
                <ArrowUp size={13} />
                Move to top
              </button>
              <button
                className="text-button"
                onClick={() =>
                  patch({
                    sort_key:
                      Math.max(
                        ...entities
                          .filter(
                            (x): x is Item =>
                              x.kind === "item" && x.list_id === item.list_id,
                          )
                          .map((x) => x.sort_key),
                      ) + 1024,
                  })
                }
              >
                <ArrowDown size={13} />
                Move to bottom
              </button>
            </div>
          </div>
          <button
            className="text-button danger delete-button"
            onClick={onDelete}
          >
            <Trash2 size={15} />
            Move to trash{children.length > 0 ? " with subtasks" : ""}
          </button>
          <p className="item-id">
            {item.id}
            <br />
            Updated {DateTime.fromISO(item.updated_at).toRelative()} · v
            {item.version}
          </p>
        </div>
      </aside>
    </>
  );
  async function patchChildOrder(child: Item, adjacent: Item, up: boolean) {
    if (!adjacent) return;
    const sorted = children.filter((x) => x.id !== child.id);
    const index = sorted.findIndex((x) => x.id === adjacent.id);
    const before = up ? sorted[index - 1]?.sort_key : adjacent.sort_key;
    const after = up ? adjacent.sort_key : sorted[index + 1]?.sort_key;
    const key =
      before === undefined
        ? after! - 1024
        : after === undefined
          ? before + 1024
          : (before + after) / 2;
    await mutate(child.id, "patch", { sort_key: key }).catch((e) =>
      onError(String(e)),
    );
  }
}
function SettingsPanel({
  conflicts,
  session,
  onClose,
  onError,
  onSession,
}: {
  conflicts: Conflict[];
  session: any;
  onClose: () => void;
  onError: (s: string) => void;
  onSession: () => void;
}) {
  const pendingEdits = useLiveQuery(
    () => db.outbox.orderBy("client_created_at").toArray(),
    [],
    [],
  );
  const syncError = useLiveQuery(() => db.meta.get("sync_error"), []);
  const [password, setPassword] = useState("");
  const [google, setGoogle] = useState(false);
  const [token, setToken] = useState("");
  const [tokenLabel, setTokenLabel] = useState("My assistant");
  const [write, setWrite] = useState(false);
  const [device, setDevice] = useState(false);
  const [server, setServer] = useState(
    localStorage.getItem("listflow-server") || "",
  );
  const [proposals, setProposals] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState("");
  const [nativeToken, setNativeToken] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const load = () => {
    if (session) {
      void api("/api/proposals")
        .then(setProposals)
        .catch(() => {});
      void api("/api/tokens")
        .then(setTokens)
        .catch(() => {});
    }
  };
  useEffect(() => {
    void api("/api/config")
      .then((d) => setGoogle(d.google))
      .catch(() => {});
    load();
  }, [session]);
  return (
    <div className="modal-backdrop settings-backdrop">
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="modal-heading">
          <span>
            <Settings size={18} />
            Settings & connections
          </span>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="settings-content">
          <ThemePicker />
          <div className="settings-card">
            <h3>Android app</h3>
            <a
              className="primary-button android-download"
              href={apiRoot() + `/downloads/listflow-v${VERSION}.apk`}
              download={`listflow-v${VERSION}.apk`}
            >
              <Download size={18} />
              Download Android APK
            </a>
          </div>
          <div className="settings-card">
            <h3>Your workspace</h3>
            {!session && (
              <p>Saved on this device. Sign in to sync across devices.</p>
            )}
            {!session ? (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api("/auth/login", {
                      method: "POST",
                      body: JSON.stringify({ password }),
                    });
                    setPassword("");
                    onSession();
                  });
                }}
              >
                <input
                  aria-label="Workspace password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Workspace password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button className="primary-button" disabled={busy}>
                  Sign in
                </button>
              </form>
            ) : (
              <div className="export-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    void run(async () => {
                      await syncNow(true);
                      onSession();
                      const failed = await db.meta.get("sync_error");
                      if (failed) throw new Error(failed.value);
                    })
                  }
                >
                  <Cloud size={15} />
                  Sync now
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void run(async () => {
                      await api("/api/logout", { method: "POST" });
                      onSession();
                    })
                  }
                >
                  Sign out
                </button>
              </div>
            )}
            {google && (
              <a
                className="secondary-button google-button"
                href={apiRoot() + "/auth/google"}
              >
                <LogIn size={15} />
                {session?.googleConnected
                  ? "Reconnect Google"
                  : "Connect Google"}
              </a>
            )}
            {!google && (
              <p className="tiny muted">
                Google isn&apos;t set up on this server yet (no OAuth client
                ID/secret). Password sign-in and sync work without it.
              </p>
            )}
          </div>
          {session && (
            <React.Suspense fallback={null}>
              <CalendarSettings googleConfigured={google} onError={onError} />
            </React.Suspense>
          )}
          <div className="settings-card">
            <h3>Google Sheets</h3>
            <p>
              A human-readable copy of your workspace. The durable operation
              ledger coordinates edits.
            </p>
            {session?.spreadsheetId && (
              <a
                className="text-button"
                href={`https://docs.google.com/spreadsheets/d/${session.spreadsheetId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open spreadsheet <ExternalLink size={13} />
              </a>
            )}
            {session?.sheetsError && (
              <p className="warning-text">{session.sheetsError}</p>
            )}
            <div className="export-actions">
              <button
                className="secondary-button"
                disabled={!session?.googleConnected || busy}
                onClick={() =>
                  void run(async () => {
                    await api("/api/sheets/create", { method: "POST" });
                    onSession();
                  })
                }
              >
                Create / sync spreadsheet
              </button>
              {session?.sheetsError && (
                <button
                  className="text-button"
                  onClick={() => {
                    if (
                      confirm(
                        "Rebuild all projection tabs from the ledger? Save any manual spreadsheet edits first.",
                      )
                    )
                      void run(async () => {
                        await api("/api/sheets/rebuild", { method: "POST" });
                        onSession();
                      });
                  }}
                >
                  Rebuild projection
                </button>
              )}
            </div>
          </div>
          {conflicts.length > 0 && (
            <div className="settings-card">
              <h3>Resolve conflicts</h3>
              <p>
                Your text is preserved here. Compare both versions before
                choosing.
              </p>
              {conflicts.map((c) => (
                <div key={c.id} className="conflict-card">
                  <strong>{c.result.message}</strong>
                  <div className="conflict-comparison">
                    <div>
                      <small>Your edit</small>
                      <pre>{JSON.stringify(c.operation.patch, null, 2)}</pre>
                    </div>
                    <div>
                      <small>Current version</small>
                      <pre>
                        {JSON.stringify(c.result.changes[0] || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                  <div className="export-actions">
                    <button
                      className="primary-button"
                      onClick={() => run(() => resolveConflict(c, true))}
                    >
                      Keep my edit
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => run(() => resolveConflict(c, false))}
                    >
                      Use current version
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        download(
                          "listflow-conflict.json",
                          JSON.stringify(c, null, 2),
                        )
                      }
                    >
                      Export both
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="settings-card">
            <h3>Export & Obsidian</h3>
            <p>
              Take your data with you. Nothing is sent to Obsidian
              automatically.
            </p>
            <div className="export-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  run(async () => {
                    const entities = await db.entities.toArray();
                    const attachments = await collectAttachments(entities);
                    download(
                      "listflow-export.json",
                      JSON.stringify(
                        {
                          schema: 2,
                          exported_at: new Date().toISOString(),
                          entities,
                          attachments,
                          pending: await db.outbox.toArray(),
                          conflicts: await db.conflicts.toArray(),
                        },
                        null,
                        2,
                      ),
                    );
                  })
                }
              >
                <Download size={14} />
                Full JSON backup
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  run(async () => {
                    const items = (await db.entities.toArray()).filter(
                      (x): x is Item => x.kind === "item" && !x.deleted_at,
                    );
                    download(
                      "ListFlow.md",
                      items.map(markdown).join("\n---\n\n"),
                      "text/markdown",
                    );
                  })
                }
              >
                Markdown export
              </button>
            </div>
            <label className="field-label">
              Import a Markdown note
              <textarea
                aria-label="Markdown import"
                rows={3}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="# A note from your vault…"
              />
            </label>
            <button
              className="text-button"
              disabled={!importText.trim()}
              onClick={() =>
                run(async () => {
                  const first =
                    importText.split("\n").find((x) => x.trim()) ||
                    "Imported note";
                  await create(
                    newItem(first.replace(/^#+\s*/, ""), {
                      type: "note",
                      body_md: importText,
                    }),
                  );
                  setImportText("");
                })
              }
            >
              Import as a new note
            </button>
          </div>
          <div className="settings-card">
            <h3>Assistant access</h3>
            <p>
              Create a scoped token for Codex or an assistant client. Tokens
              expire after 90 days; bulk and destructive edits need your review.
            </p>
            {session && (
              <>
                <form
                  className="token-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await api("/api/tokens", {
                        method: "POST",
                        body: JSON.stringify({
                          label: tokenLabel,
                          write,
                          device,
                        }),
                      });
                      setToken(result.token);
                      load();
                    });
                  }}
                >
                  <input
                    aria-label="Assistant token label"
                    value={tokenLabel}
                    onChange={(e) => setTokenLabel(e.target.value)}
                  />
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={write}
                      onChange={(e) => setWrite(e.target.checked)}
                    />
                    Allow item edits
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={device}
                      onChange={(e) => setDevice(e.target.checked)}
                    />
                    Personal Android device (full owner access)
                  </label>
                  <button className="secondary-button" disabled={busy}>
                    Create token
                  </button>
                </form>
                {token && (
                  <div className="token-result">
                    <p>Copy now; this token will not be shown again.</p>
                    <code>{token}</code>
                    <button
                      className="text-button"
                      onClick={() => navigator.clipboard.writeText(token)}
                    >
                      Copy token
                    </button>
                  </div>
                )}
                {tokens.map((t) => (
                  <div className="token-row" key={t.hash}>
                    <span>
                      {t.label} <small>{t.scopes}</small>
                    </span>
                    <button
                      className="text-button danger"
                      onClick={() =>
                        run(async () => {
                          await api("/api/tokens/" + t.hash, {
                            method: "DELETE",
                          });
                          load();
                        })
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </>
            )}
            <div className="endpoint-box">
              <small>MCP endpoint (bearer token)</small>
              <code>
                {(server ||
                  location.origin +
                    import.meta.env.BASE_URL.replace(/\/$/, "")) + "/mcp"}
              </code>
              <small>OpenAPI schema</small>
              <code>
                {(server ||
                  location.origin +
                    import.meta.env.BASE_URL.replace(/\/$/, "")) +
                  "/openapi.json"}
              </code>
            </div>
            <p className="tiny muted">
              ChatGPT access depends on your account’s available connector
              options. A deployed endpoint alone does not connect it to this
              chat.
            </p>
            <div className="detail-actions">
              <a
                className="secondary-button"
                href={apiRoot() + "/downloads/listflow-notes-plugin.zip"}
                download
              >
                Download notes skill
              </a>
              <a
                className="secondary-button"
                href={apiRoot() + "/downloads/listflow-chatgpt-context.txt"}
                download
              >
                Download ChatGPT context
              </a>
            </div>
          </div>
          {proposals.length > 0 && (
            <div className="settings-card">
              <h3>Assistant proposals</h3>
              {proposals.map((p) => (
                <div key={p.id} className="proposal">
                  <strong>
                    {p.actor} · {p.status}
                  </strong>
                  <pre>{JSON.stringify(p.operations, null, 2)}</pre>
                  {p.status === "pending" && (
                    <div className="export-actions">
                      <button
                        className="primary-button"
                        onClick={() =>
                          run(async () => {
                            await api("/api/proposals/" + p.id, {
                              method: "POST",
                              body: JSON.stringify({ approve: true }),
                            });
                            load();
                            void syncNow(true);
                          })
                        }
                      >
                        Approve changes
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          run(async () => {
                            await api("/api/proposals/" + p.id, {
                              method: "POST",
                              body: JSON.stringify({ approve: false }),
                            });
                            load();
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="settings-card">
            <h3>Device & connection</h3>
            {syncError?.value && (
              <p className="warning-text">{syncError.value}</p>
            )}
            <details>
              <summary>Pending edits ({pendingEdits.length})</summary>
              <pre className="audit-log">
                {JSON.stringify(pendingEdits, null, 2)}
              </pre>
            </details>
            <label className="field-label">
              Sync server URL
              <input
                aria-label="Sync server URL"
                placeholder="https://harmony.great-kettle.ts.net:4443/listflow"
                value={server}
                onChange={(e) => setServer(e.target.value)}
              />
            </label>
            <label className="field-label">
              Personal device token (for Android)
              <input
                type="password"
                aria-label="Device token"
                placeholder="Paste a personal Android device token from the web app"
                value={nativeToken}
                onChange={(e) => setNativeToken(e.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              onClick={() => {
                try {
                  if (
                    server &&
                    new URL(server).protocol !== "https:" &&
                    !(
                      new URL(server).protocol === "http:" &&
                      ["localhost", "127.0.0.1"].includes(
                        new URL(server).hostname,
                      )
                    )
                  )
                    throw new Error("Use an HTTPS sync server");
                  const previous =
                    localStorage.getItem("listflow-server") || "";
                  if (previous !== server.replace(/\/$/, "")) {
                    if (
                      !confirm(
                        "Changing servers requires exporting your data and clearing this device first to prevent mixing workspaces. Continue only for the same personal workspace.",
                      )
                    )
                      return;
                  }
                  localStorage.setItem(
                    "listflow-server",
                    server.replace(/\/$/, ""),
                  );
                  if (nativeToken)
                    localStorage.setItem("listflow-token", nativeToken);
                  setNativeToken("");
                  onSession();
                } catch (e) {
                  onError(String(e));
                }
              }}
            >
              Save connection
            </button>
            <div className="export-actions">
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    if (
                      confirm(
                        "Refresh the server snapshot? Pending edits are preserved and conflicts remain available for review. Export a backup first if this is recovery from a server snapshot.",
                      )
                    )
                      await refreshSnapshot();
                  })
                }
              >
                Refresh server snapshot
              </button>
            </div>
            <p className="tiny muted">
              Trash and audit records are retained indefinitely in this release.
              Manual JSON exports are available above; the server keeps nightly
              recovery snapshots.
            </p>
            <button
              className="text-button"
              onClick={() => run(async () => setAudit(await api("/api/audit")))}
            >
              Show recent audit history
            </button>
            {audit.length > 0 && (
              <pre className="audit-log">
                {audit
                  .slice(-30)
                  .reverse()
                  .map(
                    (x) =>
                      `${x.committed_at} · ${x.actor} · ${x.result.status}\n`,
                  )
                  .join("")}
              </pre>
            )}
          </div>
          <p className="settings-footnote">ListFlow {VERSION}</p>
        </div>
      </div>
    </div>
  );
}
await initDB();
[initialData, initialPending, initialConflicts] = await Promise.all([
  db.entities.toArray(),
  db.outbox.count(),
  db.conflicts.toArray(),
]);
if (!native && "serviceWorker" in navigator && import.meta.env.PROD) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        if (
          confirm(
            "A ListFlow update is ready. Reload now? Your saved items and pending edits are preserved.",
          )
        )
          void update(true);
      },
    });
  });
}
// Warm the lazy chunks once the first screen is up.
const warm = () => {
  void import("./notes");
  void import("./calendar");
};
if ("requestIdleCallback" in window)
  requestIdleCallback(warm, { timeout: 4000 });
else setTimeout(warm, 2000);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
