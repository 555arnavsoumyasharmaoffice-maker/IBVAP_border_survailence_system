import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { useDemoRunner } from '@/demo/useDemoRunner'
import Login from '@/pages/Login'
import CommandCenter from '@/pages/CommandCenter'
import LiveCameras from '@/pages/LiveCameras'
import MapView from '@/pages/MapView'
import Alerts from '@/pages/Alerts'
import AlertDetail from '@/pages/AlertDetail'
import Anpr from '@/pages/Anpr'
import FaceWatchlist from '@/pages/FaceWatchlist'
import Zones from '@/pages/Zones'
import Analytics from '@/pages/Analytics'
import Reports from '@/pages/Reports'
import SettingsPage from '@/pages/Settings'
import AuditLog from '@/pages/AuditLog'
import SystemHealth from '@/pages/SystemHealth'
import About from '@/pages/About'
import QrtView from '@/pages/QrtView'
import Search from '@/pages/Search'

export default function App() {
  useDemoRunner()
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/qrt" element={<QrtView />} />
      <Route element={<Layout />}>
        <Route index element={<CommandCenter />} />
        <Route path="cameras" element={<LiveCameras />} />
        <Route path="map" element={<MapView />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="alerts/:id" element={<AlertDetail />} />
        <Route path="anpr" element={<Anpr />} />
        <Route path="search" element={<Search />} />
        <Route path="faces" element={<FaceWatchlist />} />
        <Route path="zones" element={<Zones />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="health" element={<SystemHealth />} />
        <Route path="about" element={<About />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
