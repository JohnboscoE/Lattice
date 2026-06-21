import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Agents from './pages/Agents'
import AgentProfile from './pages/AgentProfile'
import DeployAgent from './pages/DeployAgent'
import CreateTask from './pages/CreateTask'
import LiveDemo from './pages/LiveDemo'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<Layout />}>
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/deploy" element={<DeployAgent />} />
        <Route path="/agents/:id" element={<AgentProfile />} />
        <Route path="/tasks/new" element={<CreateTask />} />
        <Route path="/demo" element={<LiveDemo />} />
      </Route>
    </Routes>
  )
}
