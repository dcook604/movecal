import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PublicCalendarPage } from './pages/PublicCalendarPage';
import { BookingConfirmationPage } from './pages/BookingConfirmationPage';
import { ResidentBookingPage } from './pages/ResidentBookingPage';
import { ResidentSubmissionPage } from './pages/ResidentSubmissionPage';
import { FindBookingPage } from './pages/FindBookingPage';
import { AdminPage } from './pages/AdminPage';
import { LobbyTVPage } from './pages/LobbyTVPage';
import { PaymentsLedgerPage } from './pages/PaymentsLedgerPage';
import './styles.css';

function getStoredRole(): string | null {
  return localStorage.getItem('movecal_role');
}

function Nav() {
  const { pathname } = useLocation();
  const [role, setRole] = useState(getStoredRole);

  useEffect(() => {
    const update = () => setRole(getStoredRole());
    window.addEventListener('movecal-auth', update);
    return () => window.removeEventListener('movecal-auth', update);
  }, []);

  // Hide nav on TV mode — full-screen display
  if (pathname === '/tv') return null;
  return (
    <nav className="site-nav">
      <NavLink to="/">Calendar</NavLink>
      <NavLink to="/submit">Resident Submit</NavLink>
      <NavLink to="/admin">Admin</NavLink>
      {role === 'PROPERTY_MANAGER' && <NavLink to="/admin/payments">Payments</NavLink>}
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
        <Route path="/admin"           element={<AdminPage />} />
        <Route path="/admin/payments"  element={<PaymentsLedgerPage />} />
        <Route path="/tv"              element={<LobbyTVPage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
