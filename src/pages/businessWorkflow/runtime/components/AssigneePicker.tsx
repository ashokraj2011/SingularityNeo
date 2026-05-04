import { useMemo, useState } from "react";
import { Search, User, Users, Shield, Sparkles } from "lucide-react";
import { useCapability } from "../../../../context/CapabilityContext";
import { cn } from "../../../../lib/utils";
import type { AssignmentMode } from "../../../../contracts/businessWorkflow";

/**
 * Assignment shape the picker emits. Mirrors the four columns on
 * `capability_business_tasks` (mode + the corresponding identifier),
 * which is exactly what the reassign / ad-hoc / send-back endpoints
 * accept.
 */
export interface AssignmentValue {
  mode: AssignmentMode;
  userId?: string;
  teamId?: string;
  role?: string;
  skill?: string;
}

const ROLE_OPTIONS: string[] = [
  "WORKSPACE_ADMIN",
  "PORTFOLIO_OWNER",
  "TEAM_LEAD",
  "INCIDENT_COMMANDER",
  "OPERATOR",
  "AUDITOR",
  "VIEWER",
];

/**
 * Four-tab assignee picker:
 *   USER → searchable list of WorkspaceUsers from the org
 *   TEAM → searchable list of WorkspaceTeams from the org
 *   ROLE → preset list of WorkspaceRoles
 *   SKILL → free text (skills are capability-scoped & free-form here)
 *
 * The picker is fully controlled — the parent owns AssignmentValue.
 * Both the ReassignPopover and the AdHocTaskDialog feed it the same
 * shape, and the reassign / ad-hoc API endpoints accept the same
 * shape, so there's no impedance mismatch.
 */
export const AssigneePicker = ({
  value,
  onChange,
  /** Restrict to a subset of modes — e.g. an approval reassign only
   *  meaningfully supports USER / TEAM / ROLE (no SKILL). Defaults to
   *  all four. */
  allowedModes = ["DIRECT_USER", "TEAM_QUEUE", "ROLE_BASED", "SKILL_BASED"],
  className,
}: {
  value: AssignmentValue;
  onChange: (next: AssignmentValue) => void;
  allowedModes?: AssignmentMode[];
  className?: string;
}) => {
  const { workspaceOrganization } = useCapability();
  const users = workspaceOrganization?.users || [];
  const teams = workspaceOrganization?.teams || [];

  const [filter, setFilter] = useState("");

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users.slice(0, 50);
    return users
      .filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.title || "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [users, filter]);

  const filteredTeams = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [teams, filter]);

  const allTabs: {
    mode: AssignmentMode;
    label: string;
    Icon: typeof User;
  }[] = [
    { mode: "DIRECT_USER", label: "User", Icon: User },
    { mode: "TEAM_QUEUE", label: "Team", Icon: Users },
    { mode: "ROLE_BASED", label: "Role", Icon: Shield },
    { mode: "SKILL_BASED", label: "Skill", Icon: Sparkles },
  ];
  const tabs = allTabs.filter((t) => allowedModes.includes(t.mode));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Mode tabs */}
      <div className="flex gap-1">
        {tabs.map((t) => {
          const active = value.mode === t.mode;
          return (
            <button
              key={t.mode}
              type="button"
              onClick={() => {
                // When switching modes we clear the per-mode field so
                // we don't carry stale values across.
                onChange({ mode: t.mode });
                setFilter("");
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[0.65rem] font-semibold",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container",
              )}
            >
              <t.Icon size={11} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Per-mode body */}
      {value.mode === "DIRECT_USER" && (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Search
              size={11}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-outline"
            />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, email, title…"
              className="w-full rounded-lg border border-outline-variant/40 bg-white py-1.5 pl-7 pr-2 text-xs"
            />
          </div>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-outline-variant/30 bg-white">
            {filteredUsers.length === 0 ? (
              <p className="p-2 text-[0.65rem] text-outline">
                No matching users.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/20">
                {filteredUsers.map((u) => {
                  const selected = value.userId === u.id;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() =>
                          onChange({ mode: "DIRECT_USER", userId: u.id })
                        }
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[0.7rem]",
                          selected
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-surface-container",
                        )}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[0.55rem] font-bold text-primary">
                          {u.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            {u.name}
                          </span>
                          <span className="block truncate text-[0.6rem] text-outline">
                            {u.title || u.email}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {value.mode === "TEAM_QUEUE" && (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Search
              size={11}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-outline"
            />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter teams…"
              className="w-full rounded-lg border border-outline-variant/40 bg-white py-1.5 pl-7 pr-2 text-xs"
            />
          </div>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-outline-variant/30 bg-white">
            {filteredTeams.length === 0 ? (
              <p className="p-2 text-[0.65rem] text-outline">
                No matching teams.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/20">
                {filteredTeams.map((t) => {
                  const selected = value.teamId === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() =>
                          onChange({ mode: "TEAM_QUEUE", teamId: t.id })
                        }
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[0.7rem]",
                          selected
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-surface-container",
                        )}
                      >
                        <Users size={12} className="shrink-0 text-secondary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            {t.name}
                          </span>
                          <span className="block truncate text-[0.6rem] text-outline">
                            {t.memberUserIds.length} member
                            {t.memberUserIds.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {value.mode === "ROLE_BASED" && (
        <div className="grid grid-cols-2 gap-1">
          {ROLE_OPTIONS.map((role) => {
            const selected = value.role === role;
            return (
              <button
                key={role}
                type="button"
                onClick={() => onChange({ mode: "ROLE_BASED", role })}
                className={cn(
                  "rounded-lg border px-2 py-1 text-left text-[0.65rem] font-semibold",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container",
                )}
              >
                {role.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      )}

      {value.mode === "SKILL_BASED" && (
        <input
          type="text"
          value={value.skill || ""}
          onChange={(e) =>
            onChange({ mode: "SKILL_BASED", skill: e.target.value })
          }
          placeholder="Skill name (e.g. legal_review)"
          className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
        />
      )}

      {/* Selection summary so the parent dialog can show what'll be saved
          even when the body isn't visible (e.g. collapsed). */}
      <p className="text-[0.6rem] text-outline">
        {summarise(value, users, teams)}
      </p>
    </div>
  );
};

const summarise = (
  v: AssignmentValue,
  users: { id: string; name: string }[],
  teams: { id: string; name: string }[],
): string => {
  switch (v.mode) {
    case "DIRECT_USER":
      return v.userId
        ? `→ ${users.find((u) => u.id === v.userId)?.name || v.userId}`
        : "Pick a user.";
    case "TEAM_QUEUE":
      return v.teamId
        ? `→ Team ${teams.find((t) => t.id === v.teamId)?.name || v.teamId}`
        : "Pick a team.";
    case "ROLE_BASED":
      return v.role ? `→ Anyone with role ${v.role}` : "Pick a role.";
    case "SKILL_BASED":
      return v.skill ? `→ Anyone with skill ${v.skill}` : "Enter a skill name.";
    case "AGENT":
      return "→ Delegated to agent";
    default:
      return "";
  }
};
