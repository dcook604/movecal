import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { PublicCalendarPage } from './pages/PublicCalendarPage';
import { ResidentSubmissionPage } from './pages/ResidentSubmissionPage';
import { AdminPage } from './pages/AdminPage';
import './styles.css';

function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Public Calendar</Link> | <Link to="/submit">Resident Submit</Link> | <Link to="/admin">Admin</Link>
      </nav>
      <Routes>
        <Route path="/" element={<PublicCalendarPage />} />
        <Route path="/submit" element={<ResidentSubmissionPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
