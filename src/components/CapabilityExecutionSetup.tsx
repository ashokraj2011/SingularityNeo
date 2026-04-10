import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  CapabilityDeploymentTarget,
  CapabilityExecutionCommandTemplate,
  CommandTemplateValidationResult,
  DeploymentTargetValidationResult,
} from '../types';
import { StatusBadge } from './EnterpriseUI';

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
