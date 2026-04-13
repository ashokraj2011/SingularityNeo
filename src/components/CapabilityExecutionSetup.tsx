import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  CapabilityDeploymentTarget,
  CapabilityExecutionCommandTemplate,
  CommandTemplateValidationResult,
  DeploymentTargetValidationResult,
  WorkspaceDetectionResult,
} from '../types';
import { StatusBadge } from './EnterpriseUI';
import {
  formatWorkspaceBuildToolLabel,
  formatWorkspaceConfidenceLabel,
  formatWorkspaceStackLabel,
  hasAppliedWorkspaceRecommendations,
  joinWorkspaceCommand,
} from '../lib/workspaceProfile';

const splitCommand = (value: string) =>
  value
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);

const joinCommand = (command: string[]) => command.join(' ');

const createCommandTemplate = (
  index: number,
): CapabilityExecutionCommandTemplate => ({
  id: `command-${index + 1}`,
  label: `Command ${index + 1}`,
  description: '',
  command: [],
  requiresApproval: false,
});

const createDeploymentTarget = (index: number): CapabilityDeploymentTarget => ({
  id: `target-${index + 1}`,
  label: `Deployment Target ${index + 1}`,
  description: '',
  commandTemplateId: '',
  workspacePath: '',
});

export const WorkspaceProfileRecommendationCard = ({
  detection,
  currentTemplates,
  currentTargets,
  dismissed = false,
  onUseRecommendedSetup,
  onKeepCurrentSetup,
  onRefresh,
}: {
  detection: WorkspaceDetectionResult | null;
  currentTemplates: CapabilityExecutionCommandTemplate[];
  currentTargets: CapabilityDeploymentTarget[];
  dismissed?: boolean;
  onUseRecommendedSetup?: (
    templates: CapabilityExecutionCommandTemplate[],
    targets: CapabilityDeploymentTarget[],
  ) => void;
  onKeepCurrentSetup?: () => void;
  onRefresh?: () => void;
}) => {
  if (!detection || dismissed) {
    return null;
  }

  const hasRecommendations =
    detection.recommendedCommandTemplates.length > 0 ||
    detection.recommendedDeploymentTargets.length > 0;
  const applied = hasAppliedWorkspaceRecommendations({
    currentTemplates,
    currentTargets,
    recommendedTemplates: detection.recommendedCommandTemplates,
    recommendedTargets: detection.recommendedDeploymentTargets,
  });

  return (
    <div className="rounded-3xl border border-primary/15 bg-primary/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="form-kicker">Detected workspace profile</p>
          <h3 className="mt-2 text-lg font-bold text-on-surface">
            {formatWorkspaceStackLabel(detection.profile.stack)}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-secondary">
            {detection.profile.summary}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            tone={
              detection.profile.confidence === 'HIGH'
                ? 'success'
                : detection.profile.confidence === 'MEDIUM'
                ? 'brand'
                : 'warning'
            }
          >
            {formatWorkspaceConfidenceLabel(detection.profile.confidence)}
          </StatusBadge>
          <StatusBadge tone={detection.profile.buildTool === 'UNKNOWN' ? 'neutral' : 'brand'}>
            {formatWorkspaceBuildToolLabel(detection.profile.buildTool)}
          </StatusBadge>
          {applied && <StatusBadge tone="success">Applied</StatusBadge>}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3">
            <p className="form-kicker">Workspace path</p>
            <p className="mt-2 break-all text-sm font-semibold text-on-surface">
              {detection.normalizedPath || 'No local workspace detected yet'}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3">
            <p className="form-kicker">Evidence files</p>
            {detection.evidenceFiles.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {detection.evidenceFiles.map(file => (
                  <span
                    key={file}
                    className="rounded-full border border-primary/10 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary"
                  >
                    {file}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-secondary">
                No supporting manifest files were found yet.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3">
            <p className="form-kicker">Recommended command templates</p>
            {detection.recommendedCommandTemplates.length > 0 ? (
              <div className="mt-3 space-y-3">
                {detection.recommendedCommandTemplates.map(template => (
                  <div key={template.id} className="rounded-2xl bg-surface-container-low px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-on-surface">
                        {template.label}
                      </p>
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-outline">
                        {template.id}
                      </span>
                    </div>
                    <p className="mt-2 rounded-xl bg-slate-950 px-3 py-2 font-mono text-xs text-white">
                      {joinWorkspaceCommand(template.command)}
                    </p>
                    {template.rationale && (
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {template.rationale}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-secondary">
                No build, test, docs, or deploy command could be inferred with enough confidence.
              </p>
            )}
          </div>

          {detection.recommendedDeploymentTargets.length > 0 && (
            <div className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3">
              <p className="form-kicker">Recommended deployment targets</p>
              <div className="mt-3 space-y-2">
                {detection.recommendedDeploymentTargets.map(target => (
                  <div key={target.id} className="rounded-2xl bg-surface-container-low px-3 py-3">
                    <p className="text-sm font-bold text-on-surface">{target.label}</p>
                    <p className="mt-1 text-xs text-secondary">
                      Uses command template <span className="font-semibold">{target.commandTemplateId}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {hasRecommendations && onUseRecommendedSetup && (
          <button
            type="button"
            onClick={() =>
              onUseRecommendedSetup(
                detection.recommendedCommandTemplates,
                detection.recommendedDeploymentTargets,
              )
            }
            className="enterprise-button enterprise-button-brand"
          >
            Use recommended setup
          </button>
        )}
        {onKeepCurrentSetup && (
          <button
            type="button"
            onClick={onKeepCurrentSetup}
            className="enterprise-button enterprise-button-secondary"
          >
            Keep current setup
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="enterprise-button enterprise-button-secondary"
          >
            Refresh detection
          </button>
        )}
      </div>
    </div>
  );
};

export const CommandTemplateEditor = ({
  templates,
  allowedWorkspacePaths,
  validationResults = {},
  onChange,
  onValidate,
}: {
  templates: CapabilityExecutionCommandTemplate[];
  allowedWorkspacePaths: string[];
  validationResults?: Record<string, CommandTemplateValidationResult>;
  onChange: (templates: CapabilityExecutionCommandTemplate[]) => void;
  onValidate?: (template: CapabilityExecutionCommandTemplate) => void;
}) => {
  const updateTemplate = (
    index: number,
    updates: Partial<CapabilityExecutionCommandTemplate>,
  ) => {
    onChange(
      templates.map((template, currentIndex) =>
        currentIndex === index ? { ...template, ...updates } : template,
      ),
    );
  };

  return (
    <div className="space-y-4">
      {templates.map((template, index) => {
        const validation = validationResults[template.id];

        return (
          <div
            key={`${template.id}-${index}`}
            className="rounded-3xl border border-outline-variant/25 bg-surface-container-low p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-on-surface">
                  {template.label || template.id || `Command ${index + 1}`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-secondary">
                  Named commands are the only actions agents can request for
                  build, test, docs, and deployment execution.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {validation && (
                  <StatusBadge tone={validation.valid ? 'success' : 'warning'}>
                    {validation.valid ? 'Valid' : 'Check'}
                  </StatusBadge>
                )}
                {onValidate && (
                  <button
                    type="button"
                    onClick={() => onValidate(template)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Validate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onChange(templates.filter((_, currentIndex) => currentIndex !== index))
                  }
                  className="enterprise-button enterprise-button-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {validation && validation.issues.length > 0 && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {validation.issues.join(' ')}
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="form-kicker">Template id</span>
                <input
                  value={template.id}
                  onChange={event =>
                    updateTemplate(index, { id: event.target.value.trim() })
                  }
                  className="field-input"
                  placeholder="build"
                />
              </label>
              <label className="space-y-2">
                <span className="form-kicker">Label</span>
                <input
                  value={template.label}
                  onChange={event =>
                    updateTemplate(index, { label: event.target.value })
                  }
                  className="field-input"
                  placeholder="Build"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="form-kicker">Description</span>
                <input
                  value={template.description || ''}
                  onChange={event =>
                    updateTemplate(index, { description: event.target.value })
                  }
                  className="field-input"
                  placeholder="Compile and package the workspace."
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="form-kicker">Command</span>
                <input
                  value={joinCommand(template.command)}
                  onChange={event =>
                    updateTemplate(index, {
                      command: splitCommand(event.target.value),
                    })
                  }
                  className="field-input font-mono text-xs"
                  placeholder="npm run build"
                />
              </label>
              <label className="space-y-2">
                <span className="form-kicker">Working directory</span>
                <select
                  value={template.workingDirectory || ''}
                  onChange={event =>
                    updateTemplate(index, {
                      workingDirectory: event.target.value || undefined,
                    })
                  }
                  className="field-select"
                >
                  <option value="">Default approved path</option>
                  {allowedWorkspacePaths.map(path => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-outline-variant/25 bg-white px-4 py-3 text-sm font-semibold text-on-surface">
                <input
                  type="checkbox"
                  checked={Boolean(template.requiresApproval)}
                  onChange={event =>
                    updateTemplate(index, {
                      requiresApproval: event.target.checked,
                    })
                  }
                />
                Requires approval before execution
              </label>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => onChange([...templates, createCommandTemplate(templates.length)])}
        className="enterprise-button enterprise-button-brand-muted"
      >
        <Plus size={16} />
        Add command template
      </button>
    </div>
  );
};

export const DeploymentTargetEditor = ({
  targets,
  commandTemplates,
  allowedWorkspacePaths,
  validationResults = {},
  onChange,
  onValidate,
}: {
  targets: CapabilityDeploymentTarget[];
  commandTemplates: CapabilityExecutionCommandTemplate[];
  allowedWorkspacePaths: string[];
  validationResults?: Record<string, DeploymentTargetValidationResult>;
  onChange: (targets: CapabilityDeploymentTarget[]) => void;
  onValidate?: (target: CapabilityDeploymentTarget) => void;
}) => {
  const updateTarget = (
    index: number,
    updates: Partial<CapabilityDeploymentTarget>,
  ) => {
    onChange(
      targets.map((target, currentIndex) =>
        currentIndex === index ? { ...target, ...updates } : target,
      ),
    );
  };

  return (
    <div className="space-y-4">
      {targets.map((target, index) => {
        const validation = validationResults[target.id];

        return (
          <div
            key={`${target.id}-${index}`}
            className="rounded-3xl border border-outline-variant/25 bg-surface-container-low p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-on-surface">
                  {target.label || target.id || `Target ${index + 1}`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-secondary">
                  Deployment targets stay approval-gated and must use approved
                  command templates.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {validation && (
                  <StatusBadge tone={validation.valid ? 'success' : 'warning'}>
                    {validation.valid ? 'Valid' : 'Check'}
                  </StatusBadge>
                )}
                {onValidate && (
                  <button
                    type="button"
                    onClick={() => onValidate(target)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Validate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onChange(targets.filter((_, currentIndex) => currentIndex !== index))
                  }
                  className="enterprise-button enterprise-button-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {validation && validation.issues.length > 0 && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {validation.issues.join(' ')}
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="form-kicker">Target id</span>
                <input
                  value={target.id}
                  onChange={event =>
                    updateTarget(index, { id: event.target.value.trim() })
                  }
                  className="field-input"
                  placeholder="staging"
                />
              </label>
              <label className="space-y-2">
                <span className="form-kicker">Label</span>
                <input
                  value={target.label}
                  onChange={event =>
                    updateTarget(index, { label: event.target.value })
                  }
                  className="field-input"
                  placeholder="Staging"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="form-kicker">Description</span>
                <input
                  value={target.description || ''}
                  onChange={event =>
                    updateTarget(index, { description: event.target.value })
                  }
                  className="field-input"
                  placeholder="Deploy to the controlled staging environment."
                />
              </label>
              <label className="space-y-2">
                <span className="form-kicker">Command template</span>
                <select
                  value={target.commandTemplateId}
                  onChange={event =>
                    updateTarget(index, { commandTemplateId: event.target.value })
                  }
                  className="field-select"
                >
                  <option value="">Select command</option>
                  {commandTemplates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.label || template.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="form-kicker">Workspace path</span>
                <select
                  value={target.workspacePath || ''}
                  onChange={event =>
                    updateTarget(index, {
                      workspacePath: event.target.value || undefined,
                    })
                  }
                  className="field-select"
                >
                  <option value="">Default approved path</option>
                  {allowedWorkspacePaths.map(path => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => onChange([...targets, createDeploymentTarget(targets.length)])}
        className="enterprise-button enterprise-button-brand-muted"
      >
        <Plus size={16} />
        Add deployment target
      </button>
    </div>
  );
};
