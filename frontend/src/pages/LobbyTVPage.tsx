import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import '../styles/lobby-tv.css';

type PublicBooking = {
  id: string;
  moveType: string;
  unit: string;
  startDatetime: string;
  endDatetime: string;
};

const TYPE_LABELS: Record<string, string> = {
  MOVE_IN: 'Move In',
  MOVE_OUT: 'Move Out',
  DELIVERY: 'Delivery',
  RENO: 'Renovation',
};

// Strip the trailing 'Z' so the browser parses datetimes as wall-clock (local)
// time rather than converting from UTC. The server stores times as UTC but the
// values represent building-local time.
const wall = (dt: string) => new Date(dt.replace('Z', ''));

const TYPE_CLASS: Record<string, string> = {
  MOVE_IN: 'move-in',
  MOVE_OUT: 'move-out',
  DELIVERY: 'delivery',
  RENO: 'reno',
};

function getBookingStatus(booking: PublicBooking, now: Date): 'completed' | 'active' | 'upcoming' {
  const start = wall(booking.startDatetime);
  const end = wall(booking.endDatetime);
  if (now >= end) return 'completed';
  if (now >= start) return 'active';
  return 'upcoming';
}

export function LobbyTVPage() {
  const [bookings, setBookings] = useState<PublicBooking[]>([]);
  const [now, setNow] = useState(new Date());

  // Update clock every second
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Refresh bookings every 60 s
  useEffect(() => {
    const load = () => {
      api.get<PublicBooking[]>('/api/public/bookings').then((r) => setBookings(r.data));
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  // Full page reload every hour
  useEffect(() => {
    const t = setInterval(() => window.location.reload(), 3600000);
    return () => clearInterval(t);
  }, []);

  const todayEvents = useMemo(() => {
    const start = dayjs().startOf('day');
    const end   = start.add(1, 'day');
    return bookings
      .filter((b) => {
        const d = dayjs(b.startDatetime.replace('Z', ''));
        return d.isAfter(start) && d.isBefore(end);
      })
      .sort((a, b) => wall(a.startDatetime).getTime() - wall(b.startDatetime).getTime());
  }, [bookings, now]);

  const upcomingEvents = useMemo(() => {
    const cutoff = dayjs().startOf('day');
    return bookings
      .filter((b) => dayjs(b.startDatetime.replace('Z', '')).isAfter(cutoff))
      .sort((a, b) => wall(a.startDatetime).getTime() - wall(b.startDatetime).getTime())
      .slice(0, 10);
  }, [bookings, now]);

  const isToday = (dt: string) => {
    const d = dayjs(dt.replace('Z', ''));
    return d.isAfter(dayjs().startOf('day')) && d.isBefore(dayjs().endOf('day'));
  };

  return (
    <div className="tv-root">
      {/* ── Header ── */}
      <header className="tv-header">
        <div className="tv-building">
          Spectrum <span>4</span>
        </div>
        <div className="tv-clock-block">
          <div className="tv-time">{dayjs(now).format('h:mm:ss A')}</div>
          <div className="tv-date">{dayjs(now).format('dddd, MMMM D, YYYY')}</div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="tv-body">
        {/* Left: today */}
        <div className="tv-today-panel">
          <p className="tv-panel-heading">Today's Schedule</p>

          {todayEvents.length === 0 ? (
            <p className="tv-today-empty">No moves scheduled today</p>
          ) : (
            todayEvents.map((b) => {
              const status = getBookingStatus(b, now);
              return (
                <div key={b.id} className={`tv-today-card ${TYPE_CLASS[b.moveType] || ''} is-${status}`}>
                  <div className="tv-card-header">
                    <div className="tv-card-type">{TYPE_LABELS[b.moveType] || b.moveType}</div>
                    {status === 'active' && <span className="tv-status-badge is-active">In Progress</span>}
                    {status === 'completed' && <span className="tv-status-badge is-completed">✓ Done</span>}
                  </div>
                  <div className="tv-card-unit">Unit {b.unit}</div>
                  <div className="tv-card-time">
                    {dayjs(b.startDatetime.replace('Z', '')).format('h:mm A')} – {dayjs(b.endDatetime.replace('Z', '')).format('h:mm A')}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: upcoming */}
        <div className="tv-upcoming-panel">
          <p className="tv-panel-heading">
            <span className="tv-live-dot"></span>
            Upcoming Reservations
          </p>

          {upcomingEvents.length === 0 ? (
            <p className="tv-upcoming-empty">No upcoming reservations</p>
          ) : (
            upcomingEvents.map((b) => (
              <div key={b.id} className={`tv-upcoming-row ${isToday(b.startDatetime) ? 'is-today' : ''}`}>
                <div className="tv-upcoming-date">
                  <div className="tv-upcoming-day-num">{dayjs(b.startDatetime.replace('Z', '')).format('D')}</div>
                  <div className="tv-upcoming-day-name">{dayjs(b.startDatetime.replace('Z', '')).format('MMM')}</div>
                </div>
                <div className="tv-upcoming-info">
                  <div className="tv-upcoming-unit">Unit {b.unit}</div>
                  <div className="tv-upcoming-detail">
                    {dayjs(b.startDatetime.replace('Z', '')).format('h:mm A')} – {dayjs(b.endDatetime.replace('Z', '')).format('h:mm A')}
                  </div>
                </div>
                <span className={`tv-upcoming-badge ${TYPE_CLASS[b.moveType] || ''}`}>
                  {TYPE_LABELS[b.moveType] || b.moveType}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="tv-footer">
        <span>Approved reservations only · updated every 60 s</span>
        <span>Spectrum 4 Move Booking System</span>
      </footer>
    </div>
  );
}
