import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PublicCalendarPage } from './pages/PublicCalendarPage';
import { ResidentSubmissionPage } from './pages/ResidentSubmissionPage';
import { AdminPage } from './pages/AdminPage';
import { LobbyTVPage } from './pages/LobbyTVPage';
import { PaymentsLedgerPage } from './pages/PaymentsLedgerPage';
import './styles.css';

function getStoredRole(): string | null {
  return localStorage.getItem('movecal_role');
}

function Nav() {
  const { pathname } = useLocation();
  // Hide nav on TV mode — full-screen display
  if (pathname === '/tv') return null;
  const role = getStoredRole();
  return (
    <nav className="site-nav">
      <NavLink to="/">Public Calendar</NavLink>
      <NavLink to="/submit">Resident Submit</NavLink>
      <NavLink to="/admin">Admin</NavLink>
      {role === 'PROPERTY_MANAGER' && <NavLink to="/admin/payments">Payments</NavLink>}
      <NavLink to="/tv">Lobby TV</NavLink>
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/"                element={<PublicCalendarPage />} />
        <Route path="/submit"          element={<ResidentSubmissionPage />} />
        <Route path="/admin"           element={<AdminPage />} />
        <Route path="/admin/payments"  element={<PaymentsLedgerPage />} />
        <Route path="/tv"              element={<LobbyTVPage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
