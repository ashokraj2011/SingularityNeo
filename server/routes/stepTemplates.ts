import type { Express } from 'express';
import { query } from '../db';
import type { StepTemplate } from '../../src/types';

function rowToTemplate(row: Record<string, unknown>): StepTemplate {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    capabilityId: row.capability_id as string | undefined,
    nodeType: row.node_type as 'HUMAN_TASK' | 'AGENT_TASK',
    label: row.label as string,
    description: row.description as string | undefined,
    icon: row.icon as string | undefined,
    defaultConfig: (row.default_config as unknown) as StepTemplate['defaultConfig'],
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function registerStepTemplateRoutes(app: Express) {
  // GET /api/step-templates?capabilityId=...&workspaceId=...
  app.get('/api/step-templates', async (req, res) => {
    try {
      const { capabilityId, workspaceId } = req.query as Record<string, string>;

      const result = await query<Record<string, unknown>>(
        `SELECT * FROM workspace_step_templates
         WHERE workspace_id = $1
           AND (capability_id IS NULL OR capability_id = $2)
         ORDER BY node_type, label`,
        [workspaceId || 'default', capabilityId || null],
      );

      res.json(result.rows.map(rowToTemplate));
    } catch (error) {
      console.error('Error fetching step templates:', error);
      res.status(500).json({ error: 'Failed to fetch step templates' });
    }
  });

  // POST /api/step-templates
  app.post('/api/step-templates', async (req, res) => {
    try {
      const { workspaceId, capabilityId, nodeType, label, description, icon, defaultConfig } =
        req.body as Partial<StepTemplate> & { workspaceId?: string };

      if (!nodeType || !label) {
        return res.status(400).json({ error: 'nodeType and label are required' });
      }

      const id = `stp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const result = await query<Record<string, unknown>>(
        `INSERT INTO workspace_step_templates
           (id, workspace_id, capability_id, node_type, label, description, icon, default_config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          id,
          workspaceId || 'default',
          capabilityId || null,
          nodeType,
          label,
          description || null,
          icon || null,
          JSON.stringify(defaultConfig || {}),
        ],
      );

      res.status(201).json(rowToTemplate(result.rows[0]));
    } catch (error) {
      console.error('Error creating step template:', error);
      res.status(500).json({ error: 'Failed to create step template' });
    }
  });

  // PUT /api/step-templates/:id
  app.put('/api/step-templates/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { label, description, icon, defaultConfig } = req.body as Partial<StepTemplate>;

      const result = await query<Record<string, unknown>>(
        `UPDATE workspace_step_templates
         SET label = COALESCE($1, label),
             description = $2,
             icon = $3,
             default_config = COALESCE($4::jsonb, default_config),
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [label || null, description || null, icon || null, JSON.stringify(defaultConfig) || null, id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json(rowToTemplate(result.rows[0]));
    } catch (error) {
      console.error('Error updating step template:', error);
      res.status(500).json({ error: 'Failed to update step template' });
    }
  });

  // DELETE /api/step-templates/:id
  app.delete('/api/step-templates/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const result = await query<{ id: string }>(
        'DELETE FROM workspace_step_templates WHERE id = $1 RETURNING id',
        [id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json({ deleted: true, id });
    } catch (error) {
      console.error('Error deleting step template:', error);
      res.status(500).json({ error: 'Failed to delete step template' });
    }
  });
}
