import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PublicCalendarPage } from './pages/PublicCalendarPage';
import { BookingConfirmationPage } from './pages/BookingConfirmationPage';
import { ResidentBookingPage } from './pages/ResidentBookingPage';
import { ResidentSubmissionPage } from './pages/ResidentSubmissionPage';
import { FindBookingPage } from './pages/FindBookingPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { QueuePage } from './pages/admin/QueuePage';
import { BookingDetailPage } from './pages/admin/BookingDetailPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { getStoredRole } from './auth/session';
import { LobbyTVPage } from './pages/LobbyTVPage';
import { PaymentsLedgerPage } from './pages/PaymentsLedgerPage';
import { HistoryPage } from './pages/HistoryPage';
import './styles.css';

function Nav() {
  const { pathname } = useLocation();

  // Hide nav on TV mode — full-screen display
  if (pathname === '/tv') return null;
  return (
    <nav className="site-nav">
      <NavLink to="/" end>Calendar</NavLink>
      <NavLink to="/submit">Resident Submit</NavLink>
      <NavLink to="/admin">Admin</NavLink>
      <NavLink to="/tv">Lobby TV</NavLink>
    </nav>
  );
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const location = useLocation();
  if (!getStoredRole()) {
    return <Navigate to="/admin" state={{ from: location.pathname }} replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/"                element={<RequireAuth><PublicCalendarPage /></RequireAuth>} />
        <Route path="/submit"          element={<ResidentSubmissionPage />} />
        <Route path="/find-booking"    element={<FindBookingPage />} />
        <Route path="/booking/:id"              element={<ResidentBookingPage />} />
        <Route path="/booking/:id/confirmation" element={<BookingConfirmationPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<QueuePage />} />
          <Route path="bookings/:id" element={<BookingDetailPage />} />
          <Route path="payments" element={<PaymentsLedgerPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="/tv"              element={<LobbyTVPage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
