import { query } from '../../db';

const DEFAULT_POLICY_TEMPLATES = [
  {
    id: 'pt-two-approver',
    name: 'Two-Approver Sign-off',
    description: 'Requires any two members from the approval team to approve before proceeding.',
    category: 'Approval',
    policy_config: JSON.stringify({
      mode: 'QUORUM',
      minimumApprovals: 2,
      delegationAllowed: false,
      escalationAfterMinutes: 1440,
    }),
  },
  {
    id: 'pt-single-manager',
    name: 'Manager Sign-off',
    description: 'Single manager approval required. Escalates after 24 hours.',
    category: 'Approval',
    policy_config: JSON.stringify({
      mode: 'ANY_ONE',
      minimumApprovals: 1,
      delegationAllowed: true,
      escalationAfterMinutes: 1440,
    }),
  },
  {
    id: 'pt-all-required',
    name: 'All Stakeholders Required',
    description: 'Every assigned approver must approve. Use for high-risk or regulated changes.',
    category: 'Governance',
    policy_config: JSON.stringify({
      mode: 'ALL_REQUIRED',
      minimumApprovals: 0,
      delegationAllowed: false,
      escalationAfterMinutes: 2880,
    }),
  },
  {
    id: 'pt-ciso-critical',
    name: 'CISO Sign-off (Critical)',
    description: 'Required for CRITICAL severity changes. Routes to CISO role with 4-hour SLA.',
    category: 'Security',
    policy_config: JSON.stringify({
      mode: 'ANY_ONE',
      minimumApprovals: 1,
      delegationAllowed: false,
      escalationAfterMinutes: 240,
    }),
  },
  {
    id: 'pt-fast-track',
    name: 'Fast-Track Approval',
    description: 'Single approver, delegation allowed, escalates in 2 hours. For low-risk changes.',
    category: 'Approval',
    policy_config: JSON.stringify({
      mode: 'ANY_ONE',
      minimumApprovals: 1,
      delegationAllowed: true,
      escalationAfterMinutes: 120,
    }),
  },
];

export const seedPolicyTemplates = async (): Promise<void> => {
  const existing = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM workspace_policy_templates',
  );
  if (Number(existing.rows[0]?.count) > 0) return;

  for (const tpl of DEFAULT_POLICY_TEMPLATES) {
    await query(
      `INSERT INTO workspace_policy_templates (id, name, description, policy_config, category)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [tpl.id, tpl.name, tpl.description, tpl.policy_config, tpl.category],
    );
  }
  console.log('[model-policy] Seeded default policy templates');
};

export const getPolicyTemplates = async (): Promise<
  Array<{
    id: string;
    name: string;
    description?: string;
    policyConfig: Record<string, unknown>;
    category?: string;
    createdAt: string;
  }>
> => {
  await seedPolicyTemplates();
  const result = await query<Record<string, unknown>>(
    'SELECT * FROM workspace_policy_templates ORDER BY category, name',
  );
  return result.rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? undefined,
    policyConfig: row.policy_config as Record<string, unknown>,
    category: (row.category as string) ?? undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
};
