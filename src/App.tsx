import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { CapabilityProvider } from './context/CapabilityContext';
import { ToastProvider } from './context/ToastContext';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const WorkflowDesignerNeo = lazy(() => import('./pages/WorkflowDesignerNeo'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Team = lazy(() => import('./pages/Team'));
const SkillLibrary = lazy(() => import('./pages/SkillLibrary'));
const Studio = lazy(() => import('./pages/Studio'));
const Chat = lazy(() => import('./pages/Chat'));
const Orchestrator = lazy(() => import('./pages/Orchestrator'));
const ArtifactDesigner = lazy(() => import('./pages/ArtifactDesigner'));
const CapabilitySetup = lazy(() => import('./pages/CapabilitySetup'));
const CapabilityMetadata = lazy(() => import('./pages/CapabilityMetadata'));
const CapabilityDatabases = lazy(() => import('./pages/CapabilityDatabases'));
const ToolAccess = lazy(() => import('./pages/ToolAccess'));
const RunConsole = lazy(() => import('./pages/RunConsole'));
const MemoryExplorer = lazy(() => import('./pages/MemoryExplorer'));
const EvalCenter = lazy(() => import('./pages/EvalCenter'));

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
  return (
    <ToastProvider>
      <CapabilityProvider>
        <Router>
          <Layout>
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoader />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/designer" element={<WorkflowDesignerNeo />} />
                  <Route path="/workflow-designer-neo" element={<WorkflowDesignerNeo />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/ledger" element={<Ledger />} />
                  <Route path="/team" element={<Team />} />
                  <Route path="/skills" element={<SkillLibrary />} />
                  <Route path="/studio" element={<Studio />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/orchestrator" element={<Orchestrator />} />
                  <Route path="/artifact-designer" element={<ArtifactDesigner />} />
                  <Route path="/capabilities/new" element={<CapabilitySetup />} />
                  <Route path="/capabilities/metadata" element={<CapabilityMetadata />} />
                  <Route path="/capabilities/databases" element={<CapabilityDatabases />} />
                  <Route path="/workspace/databases" element={<CapabilityDatabases />} />
                  <Route path="/tool-access" element={<ToolAccess />} />
                  <Route path="/run-console" element={<RunConsole />} />
                  <Route path="/memory" element={<MemoryExplorer />} />
                  <Route path="/evals" element={<EvalCenter />} />
                  <Route path="*" element={<Dashboard />} />
                </Routes>
              </Suspense>
            </RouteErrorBoundary>
          </Layout>
        </Router>
      </CapabilityProvider>
    </ToastProvider>
  );
}
