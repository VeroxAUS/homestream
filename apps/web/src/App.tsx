import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { DASHBOARD_TABS } from './pages/dashboard/tabs';

const HomePage = lazy(() => import('./pages/HomePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const MovieDetailsPage = lazy(() => import('./pages/MovieDetailsPage'));
const ShowDetailsPage = lazy(() => import('./pages/ShowDetailsPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const DashboardLayout = lazy(() => import('./pages/dashboard/DashboardLayout'));
const DashboardPlaceholder = lazy(() => import('./pages/dashboard/DashboardPlaceholder'));

/** Every client-side route; the server answers any of these paths with `index.html`. */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="movie/:id" element={<MovieDetailsPage />} />
        <Route path="tv/:id" element={<ShowDetailsPage />} />
        <Route path="play/*" element={<PlayerPage />} />
        <Route path="dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="health" replace />} />
          {DASHBOARD_TABS.map((tab) => (
            <Route key={tab.path} path={tab.path} element={<DashboardPlaceholder section={tab.path} />} />
          ))}
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
