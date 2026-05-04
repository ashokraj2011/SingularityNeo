import { useMemo } from "react";
import type {
  AssignmentMode,
  BusinessNode,
  TaskPriority,
} from "../../contracts/businessWorkflow";
import type { CapabilityAgent as Agent } from "../../types";

const ASSIGNMENT_MODES: AssignmentMode[] = [
  "DIRECT_USER",
  "TEAM_QUEUE",
  "ROLE_BASED",
  "SKILL_BASED",
  "AGENT",
];

const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

type Props = {
  node: BusinessNode;
  capabilityAgents: Agent[];
  onChange: (patch: Partial<BusinessNode>) => void;
  onDelete: () => void;
};

const TextField = ({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) => (
  <label className="block text-xs">
    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
      {label}
    </span>
    {multiline ? (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
      />
    ) : (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
      />
    )}
  </label>
);

const NumberField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) => (
  <label className="block text-xs">
    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
      {label}
    </span>
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? undefined : Number(e.target.value))
      }
      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
    />
  </label>
);

const SelectField = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (v: string) => void;
}) => (
  <label className="block text-xs">
    <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

export const NodeInspector = ({
  node,
  capabilityAgents,
  onChange,
  onDelete,
}: Props) => {
  const cfg = node.config;

  const formSchemaText = useMemo(() => {
    if (!cfg.formSchema) return "";
    try {
      return JSON.stringify(cfg.formSchema, null, 2);
    } catch {
      return "";
    }
  }, [cfg.formSchema]);

  const updateConfig = (patch: Record<string, unknown>) =>
    onChange({ config: { ...cfg, ...patch } as typeof cfg });

  const updateAssignment = (patch: Record<string, unknown>) =>
    updateConfig({
      assignment: { ...(cfg.assignment || { mode: "DIRECT_USER" }), ...patch },
    });

  const isHumanish =
    node.type === "HUMAN_TASK" ||
    node.type === "FORM_FILL" ||
    node.type === "APPROVAL";

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-outline-variant/30 bg-surface-container-low p-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Node Inspector
          </p>
          <p className="text-xs font-mono text-outline">{node.id}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-rose-300 px-2 py-1 text-[0.65rem] font-semibold text-rose-700 hover:bg-rose-50"
        >
          Delete
        </button>
      </div>

      <TextField
        label="Label"
        value={node.label}
        onChange={(v) => onChange({ label: v })}
      />

      <TextField
        label="Description"
        value={cfg.description || ""}
        onChange={(v) => updateConfig({ description: v })}
        multiline
      />

      {isHumanish && (
        <>
          <SelectField
            label="Assignment Mode"
            value={cfg.assignment?.mode || "DIRECT_USER"}
            options={ASSIGNMENT_MODES.map((m) => ({ label: m, value: m }))}
            onChange={(v) => updateAssignment({ mode: v })}
          />
          {cfg.assignment?.mode === "DIRECT_USER" && (
            <TextField
              label="User ID"
              value={cfg.assignment?.userId || ""}
              onChange={(v) => updateAssignment({ userId: v })}
            />
          )}
          {cfg.assignment?.mode === "TEAM_QUEUE" && (
            <TextField
              label="Team ID"
              value={cfg.assignment?.teamId || ""}
              onChange={(v) => updateAssignment({ teamId: v })}
            />
          )}
          {cfg.assignment?.mode === "ROLE_BASED" && (
            <TextField
              label="Role"
              value={cfg.assignment?.role || ""}
              onChange={(v) => updateAssignment({ role: v })}
            />
          )}
          {cfg.assignment?.mode === "SKILL_BASED" && (
            <TextField
              label="Skill"
              value={cfg.assignment?.skill || ""}
              onChange={(v) => updateAssignment({ skill: v })}
            />
          )}

          <SelectField
            label="Priority"
            value={cfg.priority || "NORMAL"}
            options={PRIORITIES.map((p) => ({ label: p, value: p }))}
            onChange={(v) => updateConfig({ priority: v })}
          />

          <NumberField
            label="SLA (minutes)"
            value={cfg.slaMinutes}
            onChange={(v) => updateConfig({ slaMinutes: v })}
          />
        </>
      )}

      {(node.type === "HUMAN_TASK" || node.type === "FORM_FILL") && (
        <label className="block text-xs">
          <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Form Schema (JSON)
          </span>
          <textarea
            value={formSchemaText}
            onChange={(e) => {
              const text = e.target.value;
              if (!text.trim()) {
                updateConfig({ formSchema: null });
                return;
              }
              try {
                updateConfig({ formSchema: JSON.parse(text) });
              } catch {
                // Leave invalid JSON in the textarea; parse on next valid edit.
              }
            }}
            rows={6}
            className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 font-mono text-[0.65rem]"
            placeholder='{"type":"object","properties":{...}}'
          />
        </label>
      )}

      {node.type === "AGENT_TASK" && (
        <>
          <SelectField
            label="Capability Agent"
            value={cfg.agentId || ""}
            options={[
              { label: "(select an agent)", value: "" },
              ...capabilityAgents.map((a) => ({ label: a.name, value: a.id })),
            ]}
            onChange={(v) => updateConfig({ agentId: v })}
          />
          <TextField
            label="Prompt Template"
            value={cfg.agentPromptTemplate || ""}
            onChange={(v) => updateConfig({ agentPromptTemplate: v })}
            multiline
            placeholder="Use {{context.path}} to interpolate runtime values"
          />
        </>
      )}

      {node.type === "TIMER" && (
        <NumberField
          label="Timer (minutes)"
          value={cfg.timerMinutes}
          onChange={(v) => updateConfig({ timerMinutes: v })}
        />
      )}

      {node.type === "NOTIFICATION" && (
        <>
          <SelectField
            label="Channel"
            value={cfg.notificationChannel || "IN_APP"}
            options={[
              { label: "In-app", value: "IN_APP" },
              { label: "Email", value: "EMAIL" },
              { label: "Webhook", value: "WEBHOOK" },
            ]}
            onChange={(v) => updateConfig({ notificationChannel: v })}
          />
          <TextField
            label="Recipients (comma-separated)"
            value={(cfg.notificationRecipients || []).join(", ")}
            onChange={(v) =>
              updateConfig({
                notificationRecipients: v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </>
      )}

      {node.type === "TOOL_REQUEST" && (
        <TextField
          label="Tool ID"
          value={cfg.toolId || ""}
          onChange={(v) => updateConfig({ toolId: v })}
        />
      )}

      {node.type === "CALL_WORKFLOW" && (
        <TextField
          label="Child Template ID"
          value={cfg.childTemplateId || ""}
          onChange={(v) => updateConfig({ childTemplateId: v })}
        />
      )}
    </aside>
  );
};
