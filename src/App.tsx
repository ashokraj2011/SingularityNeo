import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CapabilityProvider } from './context/CapabilityContext';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Designer = lazy(() => import('./pages/Designer'));
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

const RouteLoader = () => (
  <div className="glass-panel ambient-shadow min-h-[calc(100vh-10rem)] rounded-3xl border border-outline-variant/15 p-8">
    <div className="animate-pulse space-y-6">
      <div className="h-4 w-28 rounded-full bg-primary/10" />
      <div className="h-10 w-72 rounded-2xl bg-primary/12" />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="h-32 rounded-2xl border border-outline-variant/10 bg-surface-container-low"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-3xl bg-surface-container-low" />
        <div className="h-64 rounded-3xl bg-surface-container-low" />
      </div>
    </div>
  </div>
);

export default function App() {
  return (
    <CapabilityProvider>
      <Router>
        <Layout>
          <Suspense fallback={<RouteLoader />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/designer" element={<Designer />} />
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
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </Suspense>
        </Layout>
      </Router>
    </CapabilityProvider>
  );
}
