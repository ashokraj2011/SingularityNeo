import { Blueprint, WorkPackage, AgentTask, Artifact, Capability, Skill, Workflow, ExecutionLog, LearningUpdate, WorkItem } from './types';

export const SKILL_LIBRARY: Skill[] = [
  { id: 'SKL-001', name: 'Log Analysis', description: 'Analyze system logs for patterns and anomalies.', category: 'Analysis', version: '1.2.0' },
  { id: 'SKL-002', name: 'Auto-Remediation', description: 'Automatically fix common infrastructure issues.', category: 'Automation', version: '0.9.5' },
  { id: 'SKL-003', name: 'Security Scanning', description: 'Scan artifacts for vulnerabilities.', category: 'Security', version: '2.1.0' },
  { id: 'SKL-004', name: 'Compliance Verification', description: 'Verify artifacts against regulatory frameworks.', category: 'Compliance', version: '1.5.0' },
  { id: 'SKL-005', name: 'Data Normalization', description: 'Transform raw data into canonical formats.', category: 'Data', version: '1.1.0' },
];

export const CAPABILITIES: Capability[] = [
  {
    id: 'CAP-001',
    name: 'Retail Banking Core',
    description: 'Primary retail banking systems including ledger and customer accounts.',
    applications: ['CoreLedger', 'CustomerPortal'],
    apis: ['AccountAPI', 'TransactionService'],
    databases: ['Retail_DB_01', 'User_Auth_DB'],
    status: 'STABLE',
    specialAgentId: 'AGENT-CORE-01',
    skillLibrary: [SKILL_LIBRARY[0], SKILL_LIBRARY[4]],
  },
  {
    id: 'CAP-002',
    name: 'Institutional Wealth',
    description: 'High-net-worth portfolio management and institutional trading.',
    applications: ['WealthManager', 'TradeDesk'],
    apis: ['PortfolioAPI', 'MarketDataFeed'],
    databases: ['Wealth_DB_Prod', 'Market_Cache'],
    status: 'STABLE',
    specialAgentId: 'AGENT-WEALTH-01',
    skillLibrary: [SKILL_LIBRARY[0], SKILL_LIBRARY[1], SKILL_LIBRARY[4]],
  },
  {
    id: 'CAP-003',
    name: 'Compliance & Risk',
    description: 'Enterprise-wide risk analysis and regulatory compliance monitoring.',
    applications: ['RiskAnalyzer', 'ComplianceMonitor'],
    apis: ['RegulatoryFeed', 'AuditAPI'],
    databases: ['Risk_Data_Lake', 'Audit_Logs'],
    status: 'ALERT',
    specialAgentId: 'AGENT-RISK-01',
    skillLibrary: [SKILL_LIBRARY[2], SKILL_LIBRARY[3]],
  },
];

export const BLUEPRINTS: Blueprint[] = [
  {
    id: 'BP-001',
    title: 'Cloud Migration',
    capabilityId: 'CAP-001',
    description: 'High-scale AWS target blueprints',
    version: 'v2.4.0',
    activeIds: 12,
    status: 'STABLE',
    type: 'Cloud',
  },
  {
    id: 'BP-002',
    title: 'Security Hardening',
    capabilityId: 'CAP-001',
    description: 'Zero-trust artifact governance',
    version: 'v1.1.2',
    activeIds: 8,
    status: 'STABLE',
    type: 'Security',
  },
  {
    id: 'BP-003',
    title: 'Data Pipeline',
    capabilityId: 'CAP-002',
    description: 'Real-time ETL and ingestion',
    version: 'v3.0.1',
    activeIds: 31,
    status: 'ALERT',
    type: 'Data',
  },
  {
    id: 'BP-004',
    title: 'Legacy Bridge',
    capabilityId: 'CAP-003',
    description: 'Mainframe connector patterns',
    version: 'v0.9.0',
    activeIds: 4,
    status: 'BETA',
    type: 'API',
  },
];

export const WORK_PACKAGES: WorkPackage[] = [
  {
    id: 'WRK-0442',
    blueprint: 'Cloud Migration',
    capabilityId: 'CAP-001',
    status: 'PENDING',
    owner: { name: 'A. Chen' },
  },
  {
    id: 'WRK-0445',
    blueprint: 'Security Hardening',
    capabilityId: 'CAP-001',
    status: 'VERIFIED',
    owner: { name: 'M. Roberts' },
  },
  {
    id: 'WRK-0449',
    blueprint: 'Data Pipeline',
    capabilityId: 'CAP-002',
    status: 'RUNNING',
    owner: { name: 'L. Petrov' },
  },
];

export const AGENT_TASKS: AgentTask[] = [
  {
    id: 'TASK-8821',
    title: 'Portfolio Risk Analysis Generation',
    agent: 'RiskAgent_Alpha',
    capabilityId: 'CAP-003',
    priority: 'High',
    status: 'PROCESSING',
    timestamp: '2m ago',
    prompt: 'Analyze the connected portfolio ledger artifacts for exposure to emerging market volatility. Cross-reference with the compliance governance model StandardRisk_v4. Ensure all outliers beyond 2% variance are flagged with specific rationale for the Institutional Review Board.',
    executionNotes: 'Agent is currently validating secondary data sources from the Global Market Ledger. No manual intervention required at this stage. Latency expected in API calls to Basel III verification endpoints.',
    linkedArtifacts: [
      { name: 'Ledger_Raw_Q3.csv', size: '2.4 MB', type: 'table' },
      { name: 'Gov_Framework_Final.pdf', size: '1.1 MB', type: 'scale' },
    ],
    producedOutputs: [
      { name: 'Draft_Risk_Analysis_v1.docx', status: 'completed' },
      { name: 'Risk_Summary_Report.pdf', status: 'pending' },
    ],
  },
  {
    id: 'TASK-8819',
    title: 'Quarterly Compliance Audit Script',
    agent: 'AuditBot_V2',
    capabilityId: 'CAP-003',
    priority: 'Med',
    status: 'QUEUED',
    timestamp: '14m ago',
    prompt: 'Generate a comprehensive audit script for the Q1 compliance review. Focus on transaction logging and access control violations.',
    executionNotes: 'Awaiting resource allocation for the AuditBot_V2 instance.',
    linkedArtifacts: [
      { name: 'Compliance_Checklist.xlsx', size: '450 KB', type: 'table' },
    ],
    producedOutputs: [],
  },
  {
    id: 'TASK-8815',
    title: 'Equity Data Normalization',
    agent: 'DataWrangler',
    capabilityId: 'CAP-002',
    priority: 'Low',
    status: 'QUEUED',
    timestamp: '45m ago',
    prompt: 'Normalize equity data feeds from multiple sources (Bloomberg, Reuters) into the internal canonical format.',
    executionNotes: 'Queued behind higher priority data ingestion tasks.',
    linkedArtifacts: [
      { name: 'Source_Mapping_v2.json', size: '12 KB', type: 'file' },
    ],
    producedOutputs: [],
  },
  {
    id: 'TASK-8812',
    title: 'Basel III Capital Adequacy Report',
    agent: 'ComplianceBot',
    capabilityId: 'CAP-003',
    priority: 'High',
    status: 'COMPLETED',
    timestamp: '1h ago',
    prompt: 'Generate the final Basel III Capital Adequacy report for the current fiscal period. Ensure all capital ratios are calculated according to the latest regulatory updates.',
    executionNotes: 'Report generated successfully. All ratios verified against the internal risk engine.',
    linkedArtifacts: [
      { name: 'Capital_Data_Set.csv', size: '15.2 MB', type: 'table' },
    ],
    producedOutputs: [
      { name: 'Basel_III_Final_Report.pdf', status: 'completed' },
    ],
  },
  {
    id: 'TASK-8810',
    title: 'Market Volatility Stress Test',
    agent: 'RiskAgent_Beta',
    capabilityId: 'CAP-003',
    priority: 'High',
    status: 'COMPLETED',
    timestamp: '3h ago',
    prompt: 'Execute a stress test on the current portfolio under a 20% market downturn scenario. Analyze the impact on liquidity and margin requirements.',
    executionNotes: 'Stress test completed. Liquidity buffers are sufficient for the simulated scenario.',
    linkedArtifacts: [
      { name: 'Stress_Test_Scenarios.json', size: '8 KB', type: 'file' },
    ],
    producedOutputs: [
      { name: 'Stress_Test_Results.pdf', status: 'completed' },
    ],
  },
];

export const WORKFLOWS: Workflow[] = [
  {
    id: 'WF-001',
    name: 'Risk Assessment Pipeline',
    capabilityId: 'CAP-003',
    status: 'STABLE',
    steps: [
      { id: 'STP-1', agentId: 'RiskAgent_Alpha', action: 'Data Ingestion', outputArtifactId: 'ART-0501' },
      { id: 'STP-2', agentId: 'RiskAgent_Beta', action: 'Stress Testing', inputArtifactId: 'ART-0501', outputArtifactId: 'ART-0502' },
      { id: 'STP-3', agentId: 'AuditBot_V2', action: 'Compliance Check', inputArtifactId: 'ART-0502', outputArtifactId: 'ART-0503' },
      { id: 'STP-4', agentId: 'AGENT-CORE-01', action: 'Master Consolidation', inputArtifactId: 'ART-0503', outputArtifactId: 'ART-MASTER-001' },
    ]
  }
];

export const EXECUTION_LOGS: ExecutionLog[] = [
  {
    id: 'LOG-001',
    taskId: 'TASK-8821',
    capabilityId: 'CAP-003',
    agentId: 'RiskAgent_Alpha',
    timestamp: '2023-10-25T10:00:00Z',
    level: 'INFO',
    message: 'Started data ingestion from Global Market Ledger.',
  },
  {
    id: 'LOG-002',
    taskId: 'TASK-8821',
    capabilityId: 'CAP-003',
    agentId: 'RiskAgent_Alpha',
    timestamp: '2023-10-25T10:05:00Z',
    level: 'WARN',
    message: 'Latency detected in API calls to Basel III verification endpoints.',
    metadata: { latency: '450ms', endpoint: 'basel-iii-v1' }
  },
  {
    id: 'LOG-003',
    taskId: 'TASK-8821',
    capabilityId: 'CAP-003',
    agentId: 'RiskAgent_Alpha',
    timestamp: '2023-10-25T10:10:00Z',
    level: 'ERROR',
    message: 'Failed to parse secondary data source: Ledger_Raw_Q3.csv at line 442.',
    metadata: { line: 442, error: 'Invalid date format' }
  }
];

export const LEARNING_UPDATES: LearningUpdate[] = [
  {
    id: 'LRN-001',
    capabilityId: 'CAP-003',
    agentId: 'RiskAgent_Alpha',
    sourceLogIds: ['LOG-003'],
    insight: 'Encountered legacy date formats in Q3 raw ledgers which caused parsing failures.',
    skillUpdate: 'Updated Log Analysis skill to handle ISO-8601 and MM/DD/YYYY variants.',
    timestamp: '2023-10-25T11:00:00Z'
  }
];

export const ARTIFACTS: Artifact[] = [
  {
    id: 'ART-0129',
    name: 'Stakeholder Alignment Map',
    capabilityId: 'CAP-001',
    type: 'Standard',
    inputs: ['Primary', 'Secondary'],
    version: 'v1.0.4',
    agent: 'Sys_Alpha',
    created: '12 Oct 2023',
    documentationStatus: 'SYNCED'
  },
  {
    id: 'ART-0133',
    name: 'Business Process Ledger',
    capabilityId: 'CAP-001',
    type: 'Data Model',
    inputs: ['Primary'],
    version: 'v2.1.0',
    agent: 'L. Hamilton',
    created: '14 Oct 2023',
    documentationStatus: 'PENDING'
  },
  {
    id: 'ART-0442',
    name: 'Cloud Infrastructure YAML',
    capabilityId: 'CAP-001',
    type: 'Technical',
    template: 'AWS_CORE_V3',
    version: 'v3.2.1',
    agent: 'Auto-Provisioner',
    created: '22 Oct 2023',
    documentationStatus: 'SYNCED'
  },
  {
    id: 'ART-0501',
    name: 'Raw Risk Data Ingest',
    capabilityId: 'CAP-003',
    type: 'Data',
    version: 'v1.0.0',
    agent: 'RiskAgent_Alpha',
    created: '25 Oct 2023',
    documentationStatus: 'SYNCED'
  },
  {
    id: 'ART-0502',
    name: 'Stress Test Results',
    capabilityId: 'CAP-003',
    type: 'Analysis',
    version: 'v1.0.0',
    agent: 'RiskAgent_Beta',
    created: '25 Oct 2023',
    documentationStatus: 'PENDING'
  },
  {
    id: 'ART-0503',
    name: 'Compliance Audit Report',
    capabilityId: 'CAP-003',
    type: 'Compliance',
    version: 'v1.0.0',
    agent: 'AuditBot_V2',
    created: '25 Oct 2023',
    documentationStatus: 'PENDING'
  },
  {
    id: 'ART-LRN-001',
    name: 'Agent Learning: Date Parsing Fix',
    capabilityId: 'CAP-003',
    type: 'Learning',
    version: 'v1.0.0',
    agent: 'RiskAgent_Alpha',
    created: '25 Oct 2023',
    isLearningArtifact: true,
    documentationStatus: 'SYNCED'
  },
  {
    id: 'ART-MASTER-001',
    name: 'Master Orchestration Record',
    capabilityId: 'CAP-003',
    type: 'Governance',
    version: 'v1.0.0',
    agent: 'AGENT-CORE-01',
    created: '25 Oct 2023',
    isMasterArtifact: true,
    documentationStatus: 'SYNCED',
    decisions: [
      'Approved 20% stress test scenario',
      'Flagged 3 compliance anomalies for review',
      'Validated Q3 ledger integrity'
    ],
    changes: [
      'Updated risk model thresholds',
      'Refined parsing logic for legacy dates'
    ],
    learningInsights: [
      'Agent Alpha improved date parsing efficiency by 40%',
      'New compliance rule identified for Basel III v4'
    ],
    governanceRules: [
      'Requires human approval for all high-risk decisions',
      'Must be synced to Confluence within 24 hours of creation',
      'All changes must be traceable to a specific agent task'
    ]
  }
];

export const WORK_ITEMS: WorkItem[] = [
  {
    id: 'WI-101',
    title: 'Q3 Compliance Audit',
    description: 'Full audit of retail banking transactions for Q3 2025.',
    phase: 'EXECUTION',
    capabilityId: 'CAP-001',
    workflowId: 'WF-001',
    currentStepId: 'STEP-02',
    assignedAgentId: 'AGENT-COMPLIANCE-01',
    status: 'PENDING_APPROVAL',
    priority: 'High',
    tags: ['Audit', 'Q3', 'Compliance'],
    pendingRequest: {
      type: 'APPROVAL',
      message: 'Anomalous transaction detected in ledger 402. Require human verification to proceed with artifact generation.',
      requestedBy: 'AGENT-COMPLIANCE-01',
      timestamp: '10m ago'
    }
  },
  {
    id: 'WI-102',
    title: 'Ledger Migration Strategy',
    description: 'Design the migration path for legacy ledger data to cloud-native storage.',
    phase: 'ANALYSIS',
    capabilityId: 'CAP-001',
    workflowId: 'WF-001',
    status: 'ACTIVE',
    priority: 'Med',
    tags: ['Migration', 'Cloud'],
  },
  {
    id: 'WI-103',
    title: 'Security Patching v2.4',
    description: 'Apply critical security patches to the customer portal middleware.',
    phase: 'REVIEW',
    capabilityId: 'CAP-001',
    workflowId: 'WF-001',
    status: 'BLOCKED',
    priority: 'High',
    tags: ['Security', 'Patching'],
    pendingRequest: {
      type: 'INPUT',
      message: 'Patch conflict detected with legacy auth module. Need manual input on override priority.',
      requestedBy: 'AGENT-SECURITY-01',
      timestamp: '2h ago'
    }
  },
  {
    id: 'WI-104',
    title: 'API Rate Limiting Update',
    description: 'Implement new rate limiting rules for the AccountAPI.',
    phase: 'DONE',
    capabilityId: 'CAP-001',
    workflowId: 'WF-001',
    status: 'COMPLETED',
    priority: 'Low',
    tags: ['API', 'Performance'],
  }
];
