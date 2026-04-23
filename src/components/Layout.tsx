import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Building2,
  BarChart3,
  BrainCircuit,
  BookOpen,
  Box,
  ClipboardList,
  CircleHelp,
  ChevronDown,
  Database,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PlusCircle,
  Search,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Radiation,
  ScanEye,
  Siren,
  Sparkles,
  Star,
  Terminal,
  Trello,
  Users,
  Wallet,
  Workflow,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useCapability } from "../context/CapabilityContext";
import { useToast } from "../context/ToastContext";
import {
  claimCapabilityExecution,
  fetchRuntimeStatus,
  type RuntimeStatus,
} from "../lib/api";
import { hasPermission } from "../lib/accessControl";
import {
  getVisibleAdvancedToolDescriptors,
  type AdvancedToolId,
} from "../lib/capabilityExperience";
import {
  readViewPreference,
  writeViewPreference,
} from "../lib/viewPreferences";
import { StatusBadge } from "./EnterpriseUI";
import { SingularityHelpMenu } from "./SingularityHelpMenu";
import { AssistantDock } from "./AssistantDock";

const primaryNavItems = [
  { name: "Work", shortName: "Work", icon: Trello, path: "/" },
  { name: "Home", shortName: "Home", icon: LayoutDashboard, path: "/home" },
] as const;

const companionNavItems = [
  { name: "Chat", shortName: "Chat", icon: MessageSquare, path: "/chat" },
  { name: "Planning", shortName: "Plan", icon: ClipboardList, path: "/planning" },
  { name: "Agents", shortName: "Agents", icon: Users, path: "/team" },
  { name: "Evidence", shortName: "Evidence", icon: Wallet, path: "/ledger" },
  { name: "Designer", shortName: "Design", icon: Workflow, path: "/designer" },
] as const;

const advancedToolIcons: Record<AdvancedToolId, typeof BrainCircuit> = {
  architecture: Building2,
  identity: KeyRound,
  operations: Activity,
  "desktop-connectors": KeyRound,
  incidents: Siren,
  mrm: BarChart3,
  access: ShieldCheck,
  databases: Database,
  memory: BrainCircuit,
  "tool-access": ShieldCheck,
  "run-console": Activity,
  evals: BarChart3,
  skills: BookOpen,
  tools: Wrench,
  policies: Scale,
  "artifact-designer": FileText,
  tasks: Terminal,
  studio: Sparkles,
  "governance-controls": Scale,
  "governance-exceptions": ShieldOff,
  "governance-provenance": Search,
  "governance-posture": Gauge,
  "work-item-report": BarChart3,
  sentinel: Radiation,
  "blast-radius": ScanEye,
};

// ─── Sidebar group definitions ───────────────────────────────────────────────

const TOOL_GROUP_DEFS = [
  {
    id: "governance" as const,
    label: "Governance",
    icon: Scale,
    color: "text-violet-600",
  },
  {
    id: "security" as const,
    label: "Security",
    icon: ShieldAlert,
    color: "text-rose-600",
  },
  {
    id: "operations" as const,
    label: "Operations",
    icon: Activity,
    color: "text-sky-600",
  },
  {
    id: "platform" as const,
    label: "Platform",
    icon: Building2,
    color: "text-slate-500",
  },
];

type ToolGroup = (typeof TOOL_GROUP_DEFS)[number]["id"];

const PATH_TO_GROUP: Record<string, ToolGroup> = {
  "/governance/controls": "governance",
  "/governance/exceptions": "governance",
  "/governance/provenance": "governance",
  "/governance/posture": "governance",
  "/reports/work-items": "governance",
  "/sentinel": "security",
  "/blast-radius": "security",
  "/operations": "operations",
  "/desktop/connectors": "operations",
  "/incidents": "operations",
  "/mrm": "operations",
  "/run-console": "operations",
  "/memory": "operations",
  "/evals": "operations",
  "/architecture": "platform",
  "/access": "platform",
  "/skills": "platform",
  "/tools": "platform",
  "/tool-access": "platform",
  "/policies": "platform",
  "/artifact-designer": "platform",
  "/studio": "platform",
  "/tasks": "platform",
  "/workspace/databases": "platform",
};

const routeTitles: Record<string, string> = {
  "/": "Work",
  "/home": "Home",
  "/planning": "Planning",
  "/capabilities/new": "On Board Capability",
  "/capabilities/metadata": "Capability Metadata",
  "/architecture": "Architecture",
  "/operations": "Operations",
  "/desktop/connectors": "Local Connectors",
  "/incidents": "Incidents",
  "/mrm": "Model Risk Monitoring",
  "/access": "Users & Access",
  "/capabilities/databases": "Workspace Databases",
  "/workspace/databases": "Workspace Databases",
  "/tool-access": "Rule Engine",
  "/rule-engine": "Rule Engine",
  "/tools": "Tools",
  "/policies": "Policies",
  "/governance/controls": "Governance Controls",
  "/governance/exceptions": "Governance Exceptions",
  "/governance/provenance": "Prove the Negative",
  "/governance/posture": "Posture Dashboard",
  "/reports/work-items": "Work Item Report",
  "/sentinel": "Sentinel Mode",
  "/blast-radius": "Blast Radius",
};

const SIDEBAR_STORAGE_KEY = "singularity.sidebar.collapsed";
const ADVANCED_NAV_STORAGE_KEY = "singularity.navigation.advanced.open";

const matchesNavPath = (currentPath: string, itemPath: string) =>
  itemPath === "/"
    ? currentPath === itemPath
    : currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);

const Sidebar = ({
  isCollapsed,
  isAdvancedNavOpen,
  advancedNavItems,
  onToggleCollapsed,
  onToggleAdvancedNav,
}: {
  isCollapsed: boolean;
  isAdvancedNavOpen: boolean;
  advancedNavItems: Array<{
    name: string;
    shortName: string;
    path: string;
    description: string;
    icon: typeof BrainCircuit;
  }>;
  onToggleCollapsed: () => void;
  onToggleAdvancedNav: () => void;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeCapability,
    bootStatus,
    preferredCapabilityId,
    setActiveCapability,
    setPreferredCapabilityId,
    capabilities,
    setCurrentWorkspaceUserId,
    updateCapabilityMetadata,
  } = useCapability();
  const { success } = useToast();
  const [isCapabilityMenuOpen, setIsCapabilityMenuOpen] = useState(false);
  const [capabilitySearchQuery, setCapabilitySearchQuery] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const capabilitySearchRef = useRef<HTMLInputElement | null>(null);

  const activeCapabilities = useMemo(
    () => capabilities.filter((capability) => capability.status !== "ARCHIVED"),
    [capabilities],
  );
  const inactiveCapabilities = useMemo(
    () => capabilities.filter((capability) => capability.status === "ARCHIVED"),
    [capabilities],
  );

  const filteredActiveCapabilities = useMemo(() => {
    const q = capabilitySearchQuery.trim().toLowerCase();
    if (!q) return activeCapabilities;
    return activeCapabilities.filter((c) =>
      [c.name, c.domain, c.businessUnit, c.description]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [activeCapabilities, capabilitySearchQuery]);

  const filteredInactiveCapabilities = useMemo(() => {
    const q = capabilitySearchQuery.trim().toLowerCase();
    if (!q) return inactiveCapabilities;
    return inactiveCapabilities.filter((c) =>
      [c.name, c.domain, c.description].join(" ").toLowerCase().includes(q),
    );
  }, [inactiveCapabilities, capabilitySearchQuery]);
  const isPreferredCapability = preferredCapabilityId === activeCapability.id;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsCapabilityMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    setIsCapabilityMenuOpen(false);
  }, [isCollapsed]);

  // Reset typeahead search when the capability menu closes.
  useEffect(() => {
    if (!isCapabilityMenuOpen) {
      setCapabilitySearchQuery("");
    }
  }, [isCapabilityMenuOpen]);

  useEffect(() => {
    let isMounted = true;

    const loadRuntimeStatus = () => {
      void fetchRuntimeStatus()
        .then((status) => {
          if (isMounted) {
            setRuntimeStatus(status);
          }
        })
        .catch(() => {
          if (isMounted) {
            setRuntimeStatus((current) => current);
          }
        });
    };

    loadRuntimeStatus();
    const refreshInterval = window.setInterval(loadRuntimeStatus, 15000);
    const handleFocus = () => loadRuntimeStatus();

    window.addEventListener("focus", handleFocus);
    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [location.pathname]);

  const runtimeDatabaseTone = runtimeStatus?.databaseRuntime
    ?.lastConnectionError
    ? "danger"
    : runtimeStatus?.activeDatabaseProfileId
      ? "success"
      : "warning";
  const runtimeDatabaseName =
    runtimeStatus?.databaseRuntime?.databaseName || "Unknown DB";
  const runtimeDatabaseLabel =
    runtimeStatus?.activeDatabaseProfileLabel ||
    runtimeStatus?.activeDatabaseProfileId ||
    "Unsaved runtime target";

  const handleCapabilityStatusToggle = () => {
    void (async () => {
      const nextArchivedState = activeCapability.status !== "ARCHIVED";
      const actionLabel = nextArchivedState ? "make inactive" : "reactivate";
      const confirmed = window.confirm(
        `Do you want to ${actionLabel} ${activeCapability.name}?`,
      );

      if (!confirmed) {
        return;
      }

      try {
        await updateCapabilityMetadata(activeCapability.id, {
          status: nextArchivedState ? "ARCHIVED" : "STABLE",
        });
        success(
          nextArchivedState
            ? "Capability made inactive"
            : "Capability reactivated",
          `${activeCapability.name} is now ${nextArchivedState ? "inactive" : "active"} in the workspace.`,
        );
        setIsCapabilityMenuOpen(false);
      } catch {
        // Toast comes from the context mutation path.
      }
    })();
  };

  const openActiveCapability = () => {
    setIsCapabilityMenuOpen(false);
    navigate("/capabilities/metadata");
  };

  const handleSetDefaultCapability = () => {
    setPreferredCapabilityId(activeCapability.id);
    success(
      "Default capability updated",
      `${activeCapability.name} will open as the default workspace capability.`,
    );
    setIsCapabilityMenuOpen(false);
  };

  const handleLogout = () => {
    setIsCapabilityMenuOpen(false);
    setCurrentWorkspaceUserId("");
    navigate("/login");
  };

  return (
    <aside
      className={cn(
        "shell-sidebar hidden lg:flex overflow-hidden",
        isCollapsed ? "w-[5.5rem] px-3" : "w-[17rem] px-4",
      )}
    >
      <div
        className={cn(
          "px-2",
          isCollapsed
            ? "flex flex-col items-center gap-3"
            : "flex items-center justify-between gap-3",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
            <Box size={22} />
          </div>
          {!isCollapsed ? (
            <div>
              <h2 className="text-base font-bold tracking-tight text-on-surface">
                Singularity
              </h2>
              <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary">
                Engineering Cockpit
              </p>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded-xl border border-outline-variant/50 bg-surface-container-low p-2 text-secondary transition hover:border-primary/20 hover:bg-white hover:text-on-surface"
          title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {isCollapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
        {!isCollapsed ? (
          <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-4">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
              Workspace
            </p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              Work-first engineering operations
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              Daily execution lives in Work. Home summarizes health, and
              specialist views stay one click away when you need them.
            </p>
            <button
              type="button"
              onClick={() => navigate("/workspace/databases")}
              className="mt-3 flex w-full items-start justify-between gap-3 rounded-xl border border-primary/10 bg-white/80 px-3 py-2.5 text-left transition hover:border-primary/20 hover:bg-white"
              title={`Runtime database: ${runtimeDatabaseName}`}
            >
              <div className="min-w-0">
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-outline">
                  Active DB
                </p>
                <p className="truncate text-sm font-semibold text-on-surface">
                  {runtimeDatabaseName}
                </p>
                <p className="truncate text-[0.72rem] text-secondary">
                  {runtimeDatabaseLabel}
                </p>
              </div>
              <StatusBadge tone={runtimeDatabaseTone} className="shrink-0">
                {runtimeStatus?.databaseRuntime?.lastConnectionError
                  ? "Error"
                  : runtimeStatus?.activeDatabaseProfileId
                    ? "Live"
                    : "Ad hoc"}
              </StatusBadge>
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="flex flex-col items-center gap-2">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary"
                title="Capability-scoped enterprise workspace"
              >
                <Sparkles size={18} />
              </div>
              <button
                type="button"
                onClick={() => navigate("/workspace/databases")}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-outline-variant/45 bg-white text-secondary transition hover:border-primary/20 hover:bg-primary/5 hover:text-primary"
                title={`Active DB: ${runtimeDatabaseName}`}
                aria-label={`Active DB: ${runtimeDatabaseName}`}
              >
                <Database size={16} />
              </button>
            </div>
          </div>
        )}

        <div
          className={cn("mt-4 space-y-3", isCollapsed && "relative")}
          ref={menuRef}
        >
          <div
            className={cn(
              "rounded-2xl border border-outline-variant/60 bg-white shadow-[0_8px_20px_rgba(12,23,39,0.04)]",
              isCollapsed ? "p-2" : "p-3",
            )}
          >
            {!isCollapsed ? (
              <p className="form-kicker">Active Capability</p>
            ) : null}
            {isCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={openActiveCapability}
                  className="flex w-full items-center justify-center rounded-xl border border-outline-variant/35 bg-surface-container-low px-2 py-3 transition-all hover:border-primary/20 hover:bg-white"
                  title={`Open ${activeCapability.name}`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-sm font-bold text-primary">
                      {activeCapability.name.slice(0, 1).toUpperCase()}
                    </div>
                    <StatusBadge
                      tone={
                        activeCapability.status === "ARCHIVED"
                          ? "warning"
                          : "success"
                      }
                      className="px-2 py-0.5 text-[0.55rem]"
                    >
                      {activeCapability.status === "ARCHIVED" ? "Off" : "On"}
                    </StatusBadge>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setIsCapabilityMenuOpen((current) => !current)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/35 bg-white text-secondary transition-all hover:border-primary/20 hover:text-on-surface"
                  title="Switch capability"
                  aria-label="Switch capability"
                >
                  <ChevronDown
                    size={16}
                    className={cn(
                      "transition-transform",
                      isCapabilityMenuOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={openActiveCapability}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 py-3 text-left transition-all hover:border-primary/20 hover:bg-white"
                  title={`Open ${activeCapability.name}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">
                      {activeCapability.name}
                    </p>
                    <p className="truncate text-xs text-secondary">
                      {[activeCapability.domain, activeCapability.businessUnit]
                        .filter(Boolean)
                        .join(" • ") || activeCapability.description}
                    </p>
                    {isPreferredCapability ? (
                      <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                        Default workspace capability
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge
                    tone={
                      activeCapability.status === "ARCHIVED"
                        ? "warning"
                        : "success"
                    }
                  >
                    {activeCapability.status === "ARCHIVED"
                      ? "Inactive"
                      : "Active"}
                  </StatusBadge>
                </button>
                <button
                  type="button"
                  onClick={() => setIsCapabilityMenuOpen((current) => !current)}
                  className="flex shrink-0 items-center justify-center rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 text-secondary transition-all hover:border-primary/20 hover:bg-white hover:text-on-surface"
                  title="Switch capability"
                  aria-label="Switch capability"
                >
                  <ChevronDown
                    size={16}
                    className={cn(
                      "transition-transform",
                      isCapabilityMenuOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>
            )}

            {isCapabilityMenuOpen ? (
              <div
                className={cn(
                  "rounded-xl border border-outline-variant/50 bg-white p-2 shadow-[0_12px_28px_rgba(12,23,39,0.08)]",
                  isCollapsed
                    ? "absolute left-full top-0 z-40 ml-3 w-[21rem]"
                    : "mt-2",
                )}
              >
                {/* Typeahead search — only shown when there are multiple capabilities */}
                {capabilities.length > 3 ? (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-2">
                    <Search size={13} className="shrink-0 text-outline" />
                    <input
                      ref={capabilitySearchRef}
                      value={capabilitySearchQuery}
                      onChange={(event) =>
                        setCapabilitySearchQuery(event.target.value)
                      }
                      placeholder="Search capabilities…"
                      className="w-full bg-transparent text-xs outline-none placeholder:text-outline"
                      autoFocus
                    />
                    {capabilitySearchQuery ? (
                      <button
                        type="button"
                        onClick={() => setCapabilitySearchQuery("")}
                        className="shrink-0 text-outline hover:text-on-surface"
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="space-y-3">
                  <div>
                    <p className="px-2 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                      Active capabilities
                    </p>
                    <div className="space-y-1">
                      {filteredActiveCapabilities.map((capability) => (
                        <button
                          key={capability.id}
                          type="button"
                          onClick={() => {
                            setActiveCapability(capability);
                            setIsCapabilityMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-all",
                            activeCapability.id === capability.id
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-surface-container-low",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              {capability.name}
                            </span>
                            <StatusBadge tone="success">Active</StatusBadge>
                          </div>
                          <span className="text-xs text-secondary">
                            {capability.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredInactiveCapabilities.length > 0 ? (
                    <div>
                      <p className="px-2 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                        Inactive capabilities
                      </p>
                      <div className="space-y-1">
                        {filteredInactiveCapabilities.map((capability) => (
                          <button
                            key={capability.id}
                            type="button"
                            onClick={() => {
                              setActiveCapability(capability);
                              setIsCapabilityMenuOpen(false);
                            }}
                            className={cn(
                              "flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-all",
                              activeCapability.id === capability.id
                                ? "bg-amber-50 text-amber-800"
                                : "hover:bg-surface-container-low",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold">
                                {capability.name}
                              </span>
                              <StatusBadge tone="warning">Inactive</StatusBadge>
                            </div>
                            <span className="text-xs text-secondary">
                              {capability.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="border-t border-outline-variant/40 pt-2">
                    <button
                      type="button"
                      onClick={handleSetDefaultCapability}
                      disabled={bootStatus !== "ready" || isPreferredCapability}
                      className="enterprise-button enterprise-button-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Star size={16} />
                      {isPreferredCapability
                        ? "Default capability selected"
                        : "Set as default"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCapabilityMenuOpen(false);
                        navigate("/capabilities/metadata");
                      }}
                      className="enterprise-button enterprise-button-secondary mt-2 w-full"
                    >
                      Edit capability
                    </button>
                    <button
                      type="button"
                      onClick={handleCapabilityStatusToggle}
                      disabled={bootStatus !== "ready"}
                      className={cn(
                        "enterprise-button mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50",
                        activeCapability.status === "ARCHIVED"
                          ? "enterprise-button-brand-muted"
                          : "enterprise-button-secondary",
                      )}
                    >
                      {activeCapability.status === "ARCHIVED"
                        ? "Reactivate capability"
                        : "Make inactive"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => navigate("/capabilities/new")}
            disabled={bootStatus !== "ready"}
            className={cn(
              "enterprise-button enterprise-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50",
              isCollapsed && "px-0",
            )}
            title="On Board Capability"
          >
            <PlusCircle size={16} />
            {!isCollapsed ? <span>On Board Capability</span> : null}
          </button>
        </div>

        <nav className="mt-5 flex flex-col gap-1.5">
          {!isCollapsed ? (
            <p className="px-4 pb-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              Main
            </p>
          ) : null}
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={item.name}
              className={({ isActive }) =>
                cn(
                  "group flex items-center rounded-xl text-sm font-semibold transition-all",
                  isCollapsed
                    ? "justify-center gap-0 px-2 py-3"
                    : "gap-3 px-4 py-3",
                  isActive
                    ? "border border-primary/15 bg-primary/10 text-primary shadow-[0_8px_20px_rgba(0,132,61,0.08)]"
                    : "text-secondary hover:bg-surface-container-low hover:text-on-surface",
                )
              }
            >
              <item.icon
                size={18}
                className="shrink-0 transition-transform group-hover:scale-105"
              />
              {!isCollapsed ? <span>{item.name}</span> : null}
            </NavLink>
          ))}
        </nav>

        <nav className="mt-4 flex flex-col gap-1.5">
          {!isCollapsed ? (
            <p className="px-4 pb-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              Workspace
            </p>
          ) : null}
          {companionNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={item.name}
              className={({ isActive }) =>
                cn(
                  "group flex items-center rounded-xl text-sm font-semibold transition-all",
                  isCollapsed
                    ? "justify-center gap-0 px-2 py-3"
                    : "gap-3 px-4 py-3",
                  isActive
                    ? "border border-primary/15 bg-primary/10 text-primary shadow-[0_8px_20px_rgba(0,132,61,0.08)]"
                    : "text-secondary hover:bg-surface-container-low hover:text-on-surface",
                )
              }
            >
              <item.icon
                size={18}
                className="shrink-0 transition-transform group-hover:scale-105"
              />
              {!isCollapsed ? <span>{item.name}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="mt-5 border-t border-outline-variant/50 pt-4">
          <button
            type="button"
            onClick={onToggleAdvancedNav}
            className={cn(
              "group flex w-full items-center rounded-xl text-sm font-semibold text-secondary transition-all hover:bg-surface-container-low hover:text-on-surface",
              isCollapsed
                ? "justify-center gap-0 px-2 py-3"
                : "gap-3 px-4 py-2.5",
              isAdvancedNavOpen && "bg-surface-container-low text-primary",
            )}
            title="Advanced tools"
            aria-expanded={isAdvancedNavOpen}
          >
            <Sparkles
              size={18}
              className="shrink-0 transition-transform group-hover:scale-105"
            />
            {!isCollapsed ? (
              <>
                <span>Specialist tools</span>
                <ChevronDown
                  size={15}
                  className={cn(
                    "ml-auto text-outline transition-transform",
                    isAdvancedNavOpen && "rotate-180 text-primary",
                  )}
                />
              </>
            ) : null}
          </button>

          {isAdvancedNavOpen ? (
            <nav className="mt-2 flex flex-col gap-0.5">
              {advancedNavItems.length === 0 && !isCollapsed ? (
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-xs leading-relaxed text-secondary">
                  Specialist tools will appear here when the current role or
                  capability context needs them.
                </div>
              ) : (
                TOOL_GROUP_DEFS.map((group) => {
                  const items = advancedNavItems.filter(
                    (item) => PATH_TO_GROUP[item.path] === group.id,
                  );
                  if (!items.length) return null;
                  return (
                    <div key={group.id} className="mb-1">
                      {!isCollapsed ? (
                        <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-2.5">
                          <group.icon
                            size={11}
                            className={cn("shrink-0", group.color)}
                          />
                          <p
                            className={cn(
                              "text-[0.58rem] font-bold uppercase tracking-[0.16em]",
                              group.color,
                            )}
                          >
                            {group.label}
                          </p>
                        </div>
                      ) : (
                        <div className="mx-auto my-1.5 h-px w-6 bg-outline-variant/40" />
                      )}
                      {items.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          title={item.name}
                          className={({ isActive }) =>
                            cn(
                              "group flex items-center rounded-xl text-sm font-semibold transition-all",
                              isCollapsed
                                ? "justify-center gap-0 px-2 py-3"
                                : "gap-3 px-4 py-3",
                              isActive
                                ? "border border-primary/15 bg-primary/10 text-primary shadow-[0_8px_20px_rgba(0,132,61,0.08)]"
                                : "text-secondary hover:bg-surface-container-low hover:text-on-surface",
                            )
                          }
                        >
                          <item.icon
                            size={18}
                            className="shrink-0 transition-transform group-hover:scale-105"
                          />
                          {!isCollapsed ? <span>{item.name}</span> : null}
                        </NavLink>
                      ))}
                    </div>
                  );
                })
              )}
            </nav>
          ) : null}

          <div className={cn("mt-3", isCollapsed && "flex justify-center")}>
            <button
              type="button"
              onClick={handleLogout}
              className={cn(
                "group flex items-center rounded-xl text-sm font-semibold text-secondary transition-all hover:bg-surface-container-low hover:text-on-surface",
                isCollapsed
                  ? "justify-center gap-0 px-2 py-3"
                  : "gap-3 px-4 py-2.5",
              )}
              title="Logout"
              aria-label="Logout"
            >
              <LogOut
                size={18}
                className="shrink-0 transition-transform group-hover:scale-105"
              />
              {!isCollapsed ? <span>Logout</span> : null}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

const TopBar = ({
  isSidebarCollapsed,
  navItems,
  onOpenCommandPalette,
  onOpenHelp,
  onOpenMobileNav,
  onToggleSidebar,
  currentActorName,
  currentActorTeamLabel,
  currentWorkspaceUserId,
  workspaceUsers,
  onChangeWorkspaceUser,
  onClaimExecution,
  isClaiming,
  isClaimedByThisDesktop,
  onOpenDesktopWorkspaces,
}: {
  isSidebarCollapsed: boolean;
  navItems: Array<{ name: string; path: string }>;
  onOpenCommandPalette: () => void;
  onOpenHelp: () => void;
  onOpenMobileNav: () => void;
  onToggleSidebar: () => void;
  currentActorName: string;
  currentActorTeamLabel?: string;
  currentWorkspaceUserId?: string;
  workspaceUsers: Array<{ id: string; name: string; title?: string }>;
  onChangeWorkspaceUser: (userId: string) => void;
  onClaimExecution?: () => void;
  isClaiming?: boolean;
  isClaimedByThisDesktop?: boolean;
  onOpenDesktopWorkspaces?: () => void;
}) => {
  const location = useLocation();

  const activeNavItem = useMemo(
    () => navItems.find((item) => matchesNavPath(location.pathname, item.path)) || null,
    [location.pathname, navItems],
  );
  const pageTitle =
    activeNavItem?.name ||
    (location.pathname.startsWith("/work/approvals/")
      ? "Approval Workspace"
      : undefined) ||
    routeTitles[location.pathname] ||
    "Console";

  return (
    <header className="shell-topbar">
      <div className="mx-auto w-full max-w-[1680px] px-6 py-3 lg:px-8">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenMobileNav}
              className="inline-flex rounded-xl border border-outline-variant/50 bg-white p-2 text-secondary transition hover:border-primary/20 hover:bg-surface-container-low hover:text-on-surface lg:hidden"
              title="Open navigation"
              aria-label="Open navigation"
            >
              <PanelLeftOpen size={17} />
            </button>
            <button
              type="button"
              onClick={onToggleSidebar}
              className="hidden rounded-xl border border-outline-variant/50 bg-white p-2 text-secondary transition hover:border-primary/20 hover:bg-surface-container-low hover:text-on-surface lg:inline-flex"
              title={
                isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"
              }
              aria-label={
                isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"
              }
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
            <StatusBadge tone="brand">Enterprise Workspace</StatusBadge>
            <span className="page-context">{pageTitle}</span>
          </div>

          <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="relative flex w-full items-center rounded-xl border border-outline-variant/60 bg-white px-4 py-3 text-left text-sm text-secondary shadow-[0_8px_24px_rgba(12,23,39,0.04)] transition hover:border-primary/20 hover:text-on-surface xl:w-[26rem]"
            >
              <Search size={16} className="mr-3 shrink-0 text-outline" />
              <span className="truncate">
                Search work items, runs, artifacts, agents
              </span>
              <span className="ml-auto hidden rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline sm:inline-flex">
                {navigator.platform.toLowerCase().includes("mac")
                  ? "Cmd K"
                  : "Ctrl K"}
              </span>
            </button>

            {/* Claim execution — shown when capability is not yet claimed by this desktop */}
            {isClaimedByThisDesktop ? (
              <StatusBadge
                tone="success"
                className="w-full justify-center xl:w-auto"
              >
                <Zap size={12} className="shrink-0" />
                Claimed
              </StatusBadge>
            ) : onClaimExecution ? (
              <button
                type="button"
                onClick={onClaimExecution}
                disabled={isClaiming}
                className="enterprise-button enterprise-button-primary w-full xl:w-auto"
                title="Claim execution of this capability on the current desktop executor"
              >
                {isClaiming ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Zap size={16} />
                )}
                <span>{isClaiming ? "Claiming…" : "Claim"}</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={onOpenHelp}
              className="enterprise-button enterprise-button-secondary w-full xl:w-auto"
            >
              <CircleHelp size={16} />
              <span>Help</span>
            </button>

            <div className="toolbar-shell min-w-[18rem] justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="form-kicker">Current Operator</p>
                <select
                  value={currentWorkspaceUserId || ""}
                  onChange={(event) =>
                    onChangeWorkspaceUser(event.target.value)
                  }
                  className="mt-1 w-full rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-1.5 text-sm font-semibold text-on-surface outline-none transition focus:border-primary/40"
                >
                  {workspaceUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 truncate text-xs font-medium text-secondary">
                  {currentActorTeamLabel || currentActorName}
                </p>
                {onOpenDesktopWorkspaces ? (
                  <button
                    type="button"
                    onClick={onOpenDesktopWorkspaces}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition hover:text-primary/80"
                  >
                    <Wrench size={12} />
                    Desktop workspaces
                  </button>
                ) : null}
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-outline-variant/60 bg-surface-container-low text-sm font-bold text-primary">
                {currentActorName.slice(0, 1).toUpperCase()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activeCapability,
    bootStatus,
    capabilities,
    currentActorContext,
    currentWorkspaceUserId,
    getCapabilityWorkspace,
    lastSyncError,
    preferredCapabilityId,
    refreshCapabilityBundle,
    retryInitialSync,
    setActiveCapability,
    setActiveChatAgent,
    setCurrentWorkspaceUserId,
    setPreferredCapabilityId,
    updateCapabilityMetadata,
    workspaceOrganization,
  } = useCapability();
  const { success, error: showError } = useToast();
  const [topbarRuntimeStatus, setTopbarRuntimeStatus] =
    useState<RuntimeStatus | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  });
  const [isAdvancedNavOpen, setIsAdvancedNavOpen] = useState<boolean>(
    () =>
      readViewPreference<"open" | "closed">(
        ADVANCED_NAV_STORAGE_KEY,
        "closed",
        {
          allowed: ["open", "closed"] as const,
        },
      ) === "open",
  );
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandFocusedIndex, setCommandFocusedIndex] = useState(-1);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const commandResultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentWorkspaceUser =
    workspaceOrganization.users.find(
      (user) => user.id === currentWorkspaceUserId,
    ) || workspaceOrganization.users[0];
  const currentWorkspaceRoles = currentWorkspaceUser?.workspaceRoles || [];
  const currentActorTeamLabel =
    workspaceOrganization.teams.find((team) =>
      currentActorContext.teamIds.includes(team.id),
    )?.name ||
    (currentWorkspaceRoles.length > 0
      ? currentWorkspaceRoles.join(", ")
      : currentWorkspaceUser?.title);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      isSidebarCollapsed ? "true" : "false",
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    writeViewPreference(
      ADVANCED_NAV_STORAGE_KEY,
      isAdvancedNavOpen ? "open" : "closed",
    );
  }, [isAdvancedNavOpen]);

  // Poll runtime status for claim button state in TopBar
  useEffect(() => {
    let isMounted = true;
    const load = () => {
      void fetchRuntimeStatus()
        .then((s) => {
          if (isMounted) setTopbarRuntimeStatus(s);
        })
        .catch(() => {});
    };
    load();
    const interval = window.setInterval(load, 20_000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [activeCapability.id]);

  const isImmersiveRoute =
    location.pathname === "/workflow-designer-neo" ||
    location.pathname === "/designer";
  const isPreferredCapability = preferredCapabilityId === activeCapability.id;
  const activeWorkspace = activeCapability.id
    ? getCapabilityWorkspace(activeCapability.id)
    : null;

  // Claim execution state (depends on activeWorkspace declared above)
  const executionOwnership = activeWorkspace?.executionOwnership ?? null;
  const isClaimedByThisDesktop =
    !!executionOwnership?.executorId &&
    !!topbarRuntimeStatus?.executorId &&
    executionOwnership.executorId === topbarRuntimeStatus.executorId;
  const canClaimExecution = hasPermission(
    activeCapability.effectivePermissions,
    "capability.execution.claim",
  );

  const handleClaimExecution = async () => {
    setIsClaiming(true);
    try {
      await claimCapabilityExecution({ capabilityId: activeCapability.id });
      await Promise.all([
        refreshCapabilityBundle(activeCapability.id),
        fetchRuntimeStatus()
          .then((s) => setTopbarRuntimeStatus(s))
          .catch(() => {}),
      ]);
      success(
        "Execution claimed",
        `${activeCapability.name} is now owned by this desktop executor.`,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to claim execution.";
      showError("Claim failed", message);
      if (/desktop workspace mapping/i.test(message)) {
        navigate("/operations#desktop-workspaces");
      }
    } finally {
      setIsClaiming(false);
    }
  };
  const handleOpenDesktopWorkspaces = () => {
    navigate("/operations#desktop-workspaces");
  };
  const visibleAdvancedNavItems = useMemo(
    () =>
      activeWorkspace
        ? getVisibleAdvancedToolDescriptors({
            capability: activeCapability,
            workspace: activeWorkspace,
            workspaceRoles: currentWorkspaceRoles,
            includeOnDemand: false,
          }).map((tool) => ({
            name: tool.label,
            shortName: tool.shortName,
            path: tool.path,
            description: tool.description,
            icon: advancedToolIcons[tool.id],
          }))
        : [],
    [activeCapability, activeWorkspace, currentWorkspaceRoles],
  );
  const fullAdvancedCommandItems = useMemo(
    () =>
      activeWorkspace
        ? getVisibleAdvancedToolDescriptors({
            capability: activeCapability,
            workspace: activeWorkspace,
            workspaceRoles: currentWorkspaceRoles,
            includeOnDemand: true,
          }).map((tool) => ({
            name: tool.label,
            shortName: tool.shortName,
            path: tool.path,
            description: tool.description,
            icon: advancedToolIcons[tool.id],
          }))
        : [],
    [activeCapability, activeWorkspace, currentWorkspaceRoles],
  );
  const workspaceNavItems = useMemo(
    () => [
      ...primaryNavItems,
      ...companionNavItems,
      ...visibleAdvancedNavItems,
    ],
    [visibleAdvancedNavItems],
  );
  const commandResults = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLowerCase();
    const matches = (value: string) =>
      !normalizedQuery || value.toLowerCase().includes(normalizedQuery);

    const primaryRouteResults = primaryNavItems
      .filter((item) => matches(item.name))
      .map((item) => ({
        key: `route:${item.path}`,
        label: item.name,
        description: `Cockpit route • ${item.path}`,
        section: "Main",
        type: "route" as const,
        onSelect: () => navigate(item.path),
      }));

    const companionRouteResults = companionNavItems
      .filter((item) => matches(item.name))
      .map((item) => ({
        key: `companion-route:${item.path}`,
        label: item.name,
        description: `Companion view • ${item.path}`,
        section: "Companion views",
        type: "route" as const,
        onSelect: () => navigate(item.path),
      }));

    const advancedRouteResults = fullAdvancedCommandItems
      .filter((item) => matches(item.name))
      .map((item) => ({
        key: `advanced-route:${item.path}`,
        label: item.name,
        description: `Specialist tool • ${item.description}`,
        section: "Specialist tools",
        type: "route" as const,
        onSelect: () => navigate(item.path),
      }));

    const capabilityResults = capabilities
      .filter((capability) =>
        matches(
          [capability.name, capability.domain, capability.businessUnit].join(
            " ",
          ),
        ),
      )
      .map((capability) => ({
        key: `capability:${capability.id}`,
        label: capability.name,
        description:
          [capability.domain, capability.businessUnit]
            .filter(Boolean)
            .join(" • ") || capability.description,
        section: "Capabilities",
        type: "capability" as const,
        onSelect: () => {
          setActiveCapability(capability);
          navigate("/capabilities/metadata");
        },
      }));

    const agentResults =
      activeWorkspace?.agents
        .filter((agent) =>
          matches([agent.name, agent.role, agent.objective].join(" ")),
        )
        .map((agent) => ({
          key: `agent:${agent.id}`,
          label: agent.name,
          description: `${agent.role} • ${activeCapability.name}`,
          section: "Agents",
          type: "agent" as const,
          onSelect: () => {
            void setActiveChatAgent(activeCapability.id, agent.id);
            navigate("/chat");
          },
        })) || [];

    const workItemResults =
      activeWorkspace?.workItems
        .filter((item) =>
          matches([item.title, item.id, item.status, item.phase].join(" ")),
        )
        .map((item) => {
          const attentionBadge =
            item.status === "BLOCKED"
              ? { label: "⚠ Blocked", className: "bg-red-100 text-red-700" }
              : item.status === "PENDING_APPROVAL"
                ? {
                    label: "⌛ Approval",
                    className: "bg-amber-100 text-amber-800",
                  }
                : item.status === "PAUSED"
                  ? {
                      label: "⏸ Paused",
                      className: "bg-slate-100 text-slate-600",
                    }
                  : null;
          return {
            key: `work-item:${item.id}`,
            label: item.title,
            description: `${item.id} • ${item.phase || "No phase"}`,
            section: "Work items",
            type: "work-item" as const,
            attentionBadge,
            onSelect: () =>
              navigate(`/?selected=${encodeURIComponent(item.id)}`),
          };
        }) || [];

    const helpResults = [
      {
        key: "help:singularity-overview",
        label: "Help menu",
        description:
          "Understand how Singularity works, what each workspace does, and where to go next.",
        section: "Guides",
        type: "guide" as const,
        onSelect: () => setIsHelpMenuOpen(true),
      },
    ];

    return [
      ...primaryRouteResults,
      ...companionRouteResults,
      ...advancedRouteResults,
      ...helpResults,
      ...capabilityResults,
      ...agentResults,
      ...workItemResults,
    ].slice(0, 30);
  }, [
    activeCapability.id,
    activeCapability.name,
    activeWorkspace?.agents,
    activeWorkspace?.workItems,
    capabilities,
    commandQuery,
    fullAdvancedCommandItems,
    navigate,
    setActiveCapability,
    setActiveChatAgent,
    setIsHelpMenuOpen,
  ]);
  const commandResultGroups = useMemo(
    () =>
      commandResults.reduce<
        Array<{ section: string; results: typeof commandResults }>
      >((groups, result) => {
        const currentGroup = groups.find(
          (group) => group.section === result.section,
        );
        if (currentGroup) {
          currentGroup.results.push(result);
        } else {
          groups.push({ section: result.section, results: [result] });
        }
        return groups;
      }, []),
    [commandResults],
  );
  const isDatabaseSetupRoute =
    location.pathname === "/workspace/databases" ||
    location.pathname === "/capabilities/databases";
  const isAdvancedToolRoute =
    fullAdvancedCommandItems.some((item) => item.path === location.pathname) ||
    location.pathname === "/rule-engine";
  const isLoginRoute = location.pathname === "/login";
  const showBlockingSyncState =
    !isDatabaseSetupRoute &&
    (bootStatus === "loading" ||
      (bootStatus === "degraded" && capabilities.length === 0));
  const showNoCapabilityState =
    !showBlockingSyncState &&
    bootStatus === "ready" &&
    capabilities.length === 0 &&
    !isDatabaseSetupRoute &&
    !isAdvancedToolRoute &&
    !isLoginRoute &&
    location.pathname !== "/capabilities/new";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      if (event.key === "Escape") {
        setIsHelpMenuOpen(false);
        setIsCommandPaletteOpen(false);
        setIsMobileNavOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }
    setCommandFocusedIndex(-1);
    commandInputRef.current?.focus();
  }, [isCommandPaletteOpen]);

  // Reset focus index whenever the query changes so stale indices don't fire.
  useEffect(() => {
    setCommandFocusedIndex(-1);
  }, [commandQuery]);

  return (
    <div
      className="app-shell"
      style={
        {
          "--shell-sidebar-width":
            !isImmersiveRoute && typeof window !== "undefined"
              ? isSidebarCollapsed
                ? "5.5rem"
                : "17rem"
              : "0px",
        } as React.CSSProperties
      }
    >
      {!isImmersiveRoute ? (
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          isAdvancedNavOpen={isAdvancedNavOpen}
          advancedNavItems={visibleAdvancedNavItems}
          onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
          onToggleAdvancedNav={() =>
            setIsAdvancedNavOpen((current) => !current)
          }
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isImmersiveRoute ? (
          <TopBar
            isSidebarCollapsed={isSidebarCollapsed}
            navItems={workspaceNavItems}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenHelp={() => setIsHelpMenuOpen(true)}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
            onToggleSidebar={() => setIsSidebarCollapsed((current) => !current)}
            currentActorName={currentActorContext.displayName}
            currentActorTeamLabel={currentActorTeamLabel}
            currentWorkspaceUserId={currentWorkspaceUserId}
            workspaceUsers={workspaceOrganization.users}
            onChangeWorkspaceUser={setCurrentWorkspaceUserId}
            onClaimExecution={
              canClaimExecution && !isClaimedByThisDesktop
                ? handleClaimExecution
                : undefined
            }
            isClaiming={isClaiming}
            isClaimedByThisDesktop={isClaimedByThisDesktop}
            onOpenDesktopWorkspaces={handleOpenDesktopWorkspaces}
          />
        ) : null}
        <main
          className={cn(
            "shell-main",
            isImmersiveRoute && "shell-main-immersive",
          )}
        >
          {showBlockingSyncState ? (
            <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
              <div className="section-card max-w-xl space-y-4 text-center">
                <p className="form-kicker">
                  {bootStatus === "loading"
                    ? "Connecting workspace"
                    : "Workspace unavailable"}
                </p>
                <h2 className="text-2xl font-bold text-on-surface">
                  {bootStatus === "loading"
                    ? "Loading capability state from the backend"
                    : "The workspace cannot reach the backend right now"}
                </h2>
                <p className="text-sm leading-relaxed text-secondary">
                  {bootStatus === "loading"
                    ? "Waiting for the authoritative capability workspace before rendering the application."
                    : lastSyncError ||
                      "Retry after restoring the backend connection."}
                </p>
                {bootStatus !== "loading" ? (
                  <div className="flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => void retryInitialSync()}
                      className="enterprise-button enterprise-button-primary"
                    >
                      Retry sync
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/workspace/databases")}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Database setup
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : showNoCapabilityState ? (
            <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
              <div className="section-card max-w-xl space-y-4 text-center">
                <p className="form-kicker">No capabilities</p>
                <h2 className="text-2xl font-bold text-on-surface">
                  Create the first capability workspace
                </h2>
                <p className="text-sm leading-relaxed text-secondary">
                  The backend is connected, but no capabilities have been
                  created yet. If you just initialized a new database, the
                  shared standards are already loaded into the hidden system
                  foundation capability even though this workspace stays empty
                  until you create the first business capability.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/capabilities/new")}
                    className="enterprise-button enterprise-button-primary"
                  >
                    On Board Capability
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/workspace/databases")}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Open Database Setup
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {bootStatus === "degraded" ? (
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="flex items-start justify-between gap-4">
                    <p>
                      Viewing the last synchronized capability state. Durable
                      edits are disabled until backend sync is restored.{" "}
                      {lastSyncError}
                    </p>
                    <button
                      type="button"
                      onClick={() => void retryInitialSync()}
                      className="enterprise-button enterprise-button-secondary shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}
              {children}
            </>
          )}
        </main>
      </div>

      {isImmersiveRoute ? (
        <button
          type="button"
          onClick={() => setIsHelpMenuOpen(true)}
          className="fixed right-4 top-4 z-40 inline-flex items-center gap-2 rounded-full border border-outline-variant/60 bg-white/95 px-4 py-2 text-sm font-semibold text-secondary shadow-[0_12px_28px_rgba(12,23,39,0.12)] backdrop-blur transition hover:border-primary/20 hover:text-on-surface"
        >
          <CircleHelp size={16} />
          Help
        </button>
      ) : null}

      {!isImmersiveRoute && isMobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close navigation"
          />
          <div className="relative h-full w-[22rem] max-w-[90vw] overflow-y-auto border-r border-outline-variant/60 bg-white px-5 py-5 shadow-[0_20px_60px_rgba(12,23,39,0.2)]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-on-surface">
                  Singularity
                </h2>
                <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary">
                  Delivery Console
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(false)}
                className="rounded-xl border border-outline-variant/50 bg-surface-container-low p-2 text-secondary"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-outline-variant/60 bg-white p-4 shadow-[0_8px_20px_rgba(12,23,39,0.04)]">
              <p className="form-kicker">Active Capability</p>
              <button
                type="button"
                onClick={() => {
                  setIsMobileNavOpen(false);
                  navigate("/capabilities/metadata");
                }}
                className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 py-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-on-surface">
                    {activeCapability.name}
                  </p>
                  <p className="truncate text-xs text-secondary">
                    {[activeCapability.domain, activeCapability.businessUnit]
                      .filter(Boolean)
                      .join(" • ") || activeCapability.description}
                  </p>
                  {isPreferredCapability ? (
                    <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                      Default workspace capability
                    </p>
                  ) : null}
                </div>
              </button>
              <div className="mt-3 space-y-2">
                {capabilities.map((capability) => (
                  <button
                    key={capability.id}
                    type="button"
                    onClick={() => {
                      setActiveCapability(capability);
                      setIsMobileNavOpen(false);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-all",
                      activeCapability.id === capability.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-surface-container-low",
                    )}
                  >
                    <span className="text-sm font-semibold">
                      {capability.name}
                    </span>
                    <span className="text-xs text-secondary">
                      {capability.description}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  disabled={bootStatus !== "ready" || isPreferredCapability}
                  onClick={() => {
                    setPreferredCapabilityId(activeCapability.id);
                    success(
                      "Default capability updated",
                      `${activeCapability.name} will open as the default workspace capability.`,
                    );
                    setIsMobileNavOpen(false);
                  }}
                  className="enterprise-button enterprise-button-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Star size={16} />
                  {isPreferredCapability
                    ? "Default capability selected"
                    : "Set as default"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    navigate("/capabilities/metadata");
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  Edit capability
                </button>
                <button
                  type="button"
                  disabled={bootStatus !== "ready"}
                  onClick={() => {
                    void (async () => {
                      try {
                        await updateCapabilityMetadata(activeCapability.id, {
                          status:
                            activeCapability.status === "ARCHIVED"
                              ? "STABLE"
                              : "ARCHIVED",
                        });
                        success(
                          activeCapability.status === "ARCHIVED"
                            ? "Capability reactivated"
                            : "Capability made inactive",
                          `${activeCapability.name} lifecycle state was updated.`,
                        );
                        setIsMobileNavOpen(false);
                      } catch {
                        // Context toast handles failures.
                      }
                    })();
                  }}
                  className="enterprise-button enterprise-button-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeCapability.status === "ARCHIVED"
                    ? "Reactivate capability"
                    : "Make inactive"}
                </button>
                <button
                  type="button"
                  disabled={bootStatus !== "ready"}
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    navigate("/capabilities/new");
                  }}
                  className="enterprise-button enterprise-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  On Board Capability
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    navigate("/capabilities/metadata");
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  Existing Capability
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    navigate("/workspace/databases");
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  Database Setup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    navigate("/rule-engine");
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  Rule Engine
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    setIsHelpMenuOpen(true);
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  <CircleHelp size={16} />
                  Help
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    setCurrentWorkspaceUserId("");
                    navigate("/login");
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            </div>

            <nav className="mt-5 flex flex-col gap-1.5">
              <p className="px-4 pb-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                Business workspace
              </p>
              {primaryNavItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileNavOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                      isActive
                        ? "border border-primary/15 bg-primary/10 text-primary"
                        : "text-secondary hover:bg-surface-container-low hover:text-on-surface",
                    )
                  }
                >
                  <item.icon size={18} />
                  <span>{item.name}</span>
                </NavLink>
              ))}
            </nav>

            <nav className="mt-5 flex flex-col gap-1.5">
              <p className="px-4 pb-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                Workspace
              </p>
              {companionNavItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileNavOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                      isActive
                        ? "border border-primary/15 bg-primary/10 text-primary"
                        : "text-secondary hover:bg-surface-container-low hover:text-on-surface",
                    )
                  }
                >
                  <item.icon size={18} />
                  <span>{item.name}</span>
                </NavLink>
              ))}
            </nav>

            <div className="mt-5 border-t border-outline-variant/50 pt-4">
              <button
                type="button"
                onClick={() => setIsAdvancedNavOpen((current) => !current)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  isAdvancedNavOpen
                    ? "bg-surface-container-low text-primary"
                    : "text-secondary hover:bg-surface-container-low hover:text-on-surface",
                )}
                aria-expanded={isAdvancedNavOpen}
              >
                <Sparkles size={18} />
                <span>Specialist tools</span>
                <ChevronDown
                  size={16}
                  className={cn(
                    "ml-auto text-outline transition-transform",
                    isAdvancedNavOpen && "rotate-180 text-primary",
                  )}
                />
              </button>
              {isAdvancedNavOpen ? (
                <nav className="mt-2 flex flex-col gap-1.5">
                  {visibleAdvancedNavItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileNavOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                          isActive
                            ? "border border-primary/15 bg-primary/10 text-primary"
                            : "text-secondary hover:bg-surface-container-low hover:text-on-surface",
                        )
                      }
                    >
                      <item.icon size={18} />
                      <span>{item.name}</span>
                    </NavLink>
                  ))}
                  {!visibleAdvancedNavItems.length ? (
                    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-xs leading-relaxed text-secondary">
                      Specialist tools appear when the current capability or
                      role needs them.
                    </div>
                  ) : null}
                </nav>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isCommandPaletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-4 pt-[10vh]">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setIsCommandPaletteOpen(false)}
            aria-label="Close command palette"
          />
          <div className="relative w-full max-w-3xl rounded-[1.75rem] border border-outline-variant/60 bg-white p-4 shadow-[0_24px_80px_rgba(12,23,39,0.18)]">
            <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/60 bg-surface-container-low px-4 py-3">
              <Search size={16} className="text-outline" />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Search routes, capabilities, agents, and work items"
                className="w-full bg-transparent text-sm outline-none"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    const next = Math.min(
                      commandFocusedIndex + 1,
                      commandResults.length - 1,
                    );
                    setCommandFocusedIndex(next);
                    commandResultRefs.current[next]?.scrollIntoView({
                      block: "nearest",
                    });
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    const prev = commandFocusedIndex - 1;
                    if (prev < 0) {
                      setCommandFocusedIndex(-1);
                    } else {
                      setCommandFocusedIndex(prev);
                      commandResultRefs.current[prev]?.scrollIntoView({
                        block: "nearest",
                      });
                    }
                  } else if (
                    event.key === "Enter" &&
                    commandFocusedIndex >= 0
                  ) {
                    event.preventDefault();
                    const result = commandResults[commandFocusedIndex];
                    if (result) {
                      result.onSelect();
                      setIsCommandPaletteOpen(false);
                      setCommandQuery("");
                    }
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setIsCommandPaletteOpen(false)}
                className="rounded-lg border border-outline-variant/50 bg-white px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline"
              >
                Esc
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] overflow-y-auto">
              {commandResults.length > 0 ? (
                (() => {
                  let flatIndex = -1;
                  return (
                    <div className="space-y-2">
                      {commandResultGroups.map((group) => (
                        <div key={group.section} className="space-y-2">
                          <p className="px-2 pt-2 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                            {group.section}
                          </p>
                          <div className="space-y-1">
                            {group.results.map((result) => {
                              flatIndex += 1;
                              const idx = flatIndex;
                              const isFocused = idx === commandFocusedIndex;
                              const badge = (result as any).attentionBadge as
                                | { label: string; className: string }
                                | null
                                | undefined;
                              return (
                                <button
                                  key={result.key}
                                  ref={(el) => {
                                    commandResultRefs.current[idx] = el;
                                  }}
                                  type="button"
                                  onClick={() => {
                                    result.onSelect();
                                    setIsCommandPaletteOpen(false);
                                    setCommandQuery("");
                                  }}
                                  onMouseEnter={() =>
                                    setCommandFocusedIndex(idx)
                                  }
                                  className={cn(
                                    "flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition",
                                    isFocused
                                      ? "border-primary/30 bg-primary/5 ring-1 ring-primary/20"
                                      : "border-outline-variant/40 hover:bg-surface-container-low",
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-semibold text-on-surface">
                                        {result.label}
                                      </p>
                                      {badge ? (
                                        <span
                                          className={cn(
                                            "rounded-full px-2 py-px text-[0.6rem] font-bold",
                                            badge.className,
                                          )}
                                        >
                                          {badge.label}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-0.5 text-xs text-secondary">
                                      {result.description}
                                    </p>
                                  </div>
                                  <span className="shrink-0 rounded-full bg-surface-container-low px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                                    {result.type}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <div className="flex min-h-[12rem] items-center justify-center text-center">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-on-surface">
                      No matching results
                    </p>
                    <p className="text-sm text-secondary">
                      Try a capability name, route, agent, or work item id.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isHelpMenuOpen ? (
        <SingularityHelpMenu
          activeCapabilityName={activeCapability.name}
          onClose={() => setIsHelpMenuOpen(false)}
          onNavigate={(path) => {
            setIsHelpMenuOpen(false);
            navigate(path);
          }}
        />
      ) : null}

      {/* Always-on assistant. Hides itself on /chat, /login, immersive
          viewers, and onboarding — see AssistantDock's HIDDEN_PATH_PREFIXES. */}
      {!isImmersiveRoute ? <AssistantDock /> : null}
    </div>
  );
};
