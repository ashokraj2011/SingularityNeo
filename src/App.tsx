import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CapabilityProvider } from './context/CapabilityContext';
import Dashboard from './pages/Dashboard';
import Designer from './pages/Designer';
import Tasks from './pages/Tasks';
import Ledger from './pages/Ledger';
import Team from './pages/Team';
import Studio from './pages/Studio';
import Chat from './pages/Chat';
import Orchestrator from './pages/Orchestrator';
import ArtifactDesigner from './pages/ArtifactDesigner';

export default function App() {
  return (
    <CapabilityProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/designer" element={<Designer />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="/team" element={<Team />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/orchestrator" element={<Orchestrator />} />
            <Route path="/artifact-designer" element={<ArtifactDesigner />} />
            {/* Fallback for other routes */}
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </Layout>
      </Router>
    </CapabilityProvider>
  );
}
