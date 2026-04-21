import { Suspense, lazy, type ReactNode } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  useLocation,
} from 'react-router-dom';
import { Layout } from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { CapabilityProvider } from './context/CapabilityContext';
import { ToastProvider } from './context/ToastContext';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const WorkflowDesignerNeo = lazy(() => import('./pages/WorkflowDesignerNeo'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Agents = lazy(() => import('./pages/Agents'));
const SkillLibrary = lazy(() => import('./pages/SkillLibrary'));
const ToolsLibrary = lazy(() => import('./pages/ToolsLibrary'));
const PoliciesLibrary = lazy(() => import('./pages/PoliciesLibrary'));
const Studio = lazy(() => import('./pages/Studio'));
const Chat = lazy(() => import('./pages/Chat'));
const Orchestrator = lazy(() => import('./pages/Orchestrator'));
const Operations = lazy(() => import('./pages/Operations'));
const Incidents = lazy(() => import('./pages/Incidents'));
const ModelRiskMonitoring = lazy(() => import('./pages/ModelRiskMonitoring'));
const ApprovalWorkspace = lazy(() => import('./pages/ApprovalWorkspace'));
const ArtifactDesigner = lazy(() => import('./pages/ArtifactDesigner'));
const CapabilitySetup = lazy(() => import('./pages/CapabilitySetup'));
const CapabilityMetadata = lazy(() => import('./pages/CapabilityMetadata'));
const Architecture = lazy(() => import('./pages/Architecture'));
const UsersAccess = lazy(() => import('./pages/UsersAccess'));
const CapabilityDatabases = lazy(() => import('./pages/CapabilityDatabases'));
const ToolAccess = lazy(() => import('./pages/ToolAccess'));
const RunConsole = lazy(() => import('./pages/RunConsole'));
const MemoryExplorer = lazy(() => import('./pages/MemoryExplorer'));
const EvalCenter = lazy(() => import('./pages/EvalCenter'));
const Login = lazy(() => import('./pages/Login'));
const EvidencePacketPage = lazy(() => import('./pages/EvidencePacket'));
const GovernanceControlsPage = lazy(() => import('./pages/GovernanceControls'));
const GovernanceExceptionsPage = lazy(() => import('./pages/GovernanceExceptions'));
const GovernanceProvenancePage = lazy(() => import('./pages/GovernanceProvenance'));
const GovernancePosturePage = lazy(() => import('./pages/GovernancePosture'));
const WorkItemReport = lazy(() => import('./pages/WorkItemReport'));
const ReleasePassport = lazy(() => import('./pages/ReleasePassport'));
const BlastRadius = lazy(() => import('./pages/BlastRadius'));
const Sentinel = lazy(() => import('./pages/Sentinel'));

const RouteLoader = () => (
  <div className="section-card ambient-shadow min-h-[calc(100vh-12rem)] p-8">
    <div className="animate-pulse space-y-6">
      <div className="h-4 w-28 rounded-full bg-primary/10" />
      <div className="h-10 w-72 rounded-xl bg-surface-container-low" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="h-32 rounded-2xl border border-outline-variant/40 bg-surface-container-low"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl bg-surface-container-low" />
        <div className="h-64 rounded-2xl bg-surface-container-low" />
      </div>
    </div>
  </div>
);

const RouteErrorBoundary = ({ children }: { children: ReactNode }) => {
  const location = useLocation();

  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
};

export default function App() {
  const Router = typeof window !== 'undefined' &&
    (window.singularityDesktop?.isDesktop || window.location.protocol === 'file:')
      ? HashRouter
      : BrowserRouter;

  return (
    <ToastProvider>
      <CapabilityProvider>
        <Router>
          <Layout>
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoader />}>
                <Routes>
                  <Route path="/" element={<Orchestrator />} />
                  <Route path="/home" element={<Dashboard />} />
                  <Route path="/designer" element={<WorkflowDesignerNeo />} />
                  <Route path="/workflow-designer-neo" element={<WorkflowDesignerNeo />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/ledger" element={<Ledger />} />
                  <Route path="/team" element={<Agents />} />
                  <Route path="/skills" element={<SkillLibrary />} />
                  <Route path="/tools" element={<ToolsLibrary />} />
                  <Route path="/policies" element={<PoliciesLibrary />} />
                  <Route path="/studio" element={<Studio />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/orchestrator" element={<Orchestrator />} />
                  <Route path="/work" element={<Orchestrator />} />
                  <Route
                    path="/work/approvals/:capabilityId/:runId/:waitId"
                    element={<ApprovalWorkspace />}
                  />
                  <Route path="/operations" element={<Operations />} />
                  <Route path="/incidents" element={<Incidents />} />
                  <Route path="/mrm" element={<ModelRiskMonitoring />} />
                  <Route path="/artifact-designer" element={<ArtifactDesigner />} />
                  <Route path="/capabilities/new" element={<CapabilitySetup />} />
                  <Route path="/capabilities/metadata" element={<CapabilityMetadata />} />
                  <Route path="/architecture" element={<Architecture />} />
                  <Route path="/access" element={<UsersAccess />} />
                  <Route path="/governance/controls" element={<GovernanceControlsPage />} />
                  <Route path="/governance/exceptions" element={<GovernanceExceptionsPage />} />
                  <Route path="/governance/provenance" element={<GovernanceProvenancePage />} />
                  <Route path="/governance/posture" element={<GovernancePosturePage />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/capabilities/databases" element={<CapabilityDatabases />} />
                  <Route path="/workspace/databases" element={<CapabilityDatabases />} />
                  <Route path="/tool-access" element={<ToolAccess />} />
                  <Route path="/rule-engine" element={<ToolAccess />} />
                  <Route path="/run-console" element={<RunConsole />} />
                  <Route path="/memory" element={<MemoryExplorer />} />
                  <Route path="/evals" element={<EvalCenter />} />
                  <Route path="/reports/work-items" element={<WorkItemReport />} />
                  <Route path="/e/:bundleId" element={<EvidencePacketPage />} />
                  <Route
                    path="/passport/:capabilityId/:runId"
                    element={<ReleasePassport />}
                  />
                  <Route path="/blast-radius" element={<BlastRadius />} />
                  <Route path="/sentinel" element={<Sentinel />} />
                  <Route path="*" element={<Orchestrator />} />
                </Routes>
              </Suspense>
            </RouteErrorBoundary>
          </Layout>
        </Router>
      </CapabilityProvider>
    </ToastProvider>
  );
}
