import { useEffect, useMemo, useState } from 'react';
import { Calendar, dayjsLocalizer, type Event, View } from 'react-big-calendar';
import dayjs from 'dayjs';
import { api } from '../api';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import '../styles/calendar.css';

type PublicBooking = {
  id: string;
  moveType: string;
  unit: string;
  startDatetime: string;
  endDatetime: string;
};

const localizer = dayjsLocalizer(dayjs);

function getCalendarHeight() {
  if (typeof window === 'undefined') return 600;
  if (window.innerWidth < 480) return 420;
  if (window.innerWidth < 768) return 500;
  return 620;
}

function getDefaultView(): View {
  if (typeof window === 'undefined') return 'week';
  return window.innerWidth < 768 ? 'agenda' : 'week';
}

export function PublicCalendarPage() {
  const [rows, setRows] = useState<PublicBooking[]>([]);
  const [view, setView] = useState<View>(getDefaultView);
  const [date, setDate] = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [calHeight, setCalHeight] = useState(getCalendarHeight);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const load = () => {
      api.get<PublicBooking[]>('/api/public/bookings').then((r) => {
        setRows(r.data);
        setLastUpdated(new Date());
      });
    };
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  // Auto-refresh entire page every 1 hour
  useEffect(() => {
    const pageRefreshTimer = setInterval(() => { window.location.reload(); }, 3600000);
    return () => clearInterval(pageRefreshTimer);
  }, []);

  // Update now every minute so past events get styled correctly
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Update calendar height on resize
  useEffect(() => {
    const onResize = () => setCalHeight(getCalendarHeight());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const events = useMemo<Event[]>(
    () =>
      rows.map((row) => {
        const typeLabels: Record<string, string> = {
          MOVE_IN: 'Move In',
          MOVE_OUT: 'Move Out',
          DELIVERY: 'Delivery',
          RENO: 'Renovation',
        };
        const fullType = typeLabels[row.moveType] || row.moveType;
        return {
          title: `${fullType} • Unit ${row.unit}`,
          start: new Date(row.startDatetime.replace('Z', '')),
          end: new Date(row.endDatetime.replace('Z', '')),
          resource: { ...row, displayType: fullType },
        };
      }),
    [rows]
  );

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter((e) => e.start && e.start >= now)
      .sort((a, b) => {
        if (!a.start || !b.start) return 0;
        return a.start.getTime() - b.start.getTime();
      })
      .slice(0, 5);
  }, [events]);

  const todayEvents = useMemo(() => {
    const today = dayjs().startOf('day');
    const tomorrow = today.add(1, 'day');
    return events.filter((e) => {
      if (!e.start) return false;
      const d = dayjs(e.start);
      return d.isAfter(today) && d.isBefore(tomorrow);
    });
  }, [events]);

  const scrollToTime = useMemo(() => {
    const viewStart = dayjs(date).startOf(view === 'day' ? 'day' : 'week');
    const viewEnd = viewStart.add(view === 'day' ? 1 : 7, 'day');
    const viewEvents = events.filter(
      (e) => e.start && dayjs(e.start).isAfter(viewStart) && dayjs(e.start).isBefore(viewEnd)
    );
    if (viewEvents.length === 0) {
      return dayjs().startOf('day').add(8, 'hour').toDate();
    }
    const earliest = viewEvents.reduce((min, e) => {
      if (!e.start) return min;
      return e.start.getTime() < min.getTime() ? e.start : min;
    }, viewEvents[0].start as Date);
    // Scroll to 30 min before the earliest event, minimum 7am
    const scrollTarget = dayjs(earliest).subtract(30, 'minute');
    const floor = dayjs(earliest).startOf('day').add(7, 'hour');
    return (scrollTarget.isBefore(floor) ? floor : scrollTarget).toDate();
  }, [events, date, view]);

  const eventStyleGetter = (event: Event) => {
    const moveType = (event.resource as any)?.moveType;
    const colors: Record<string, { bg: string; border: string }> = {
      MOVE_IN:   { bg: '#dbeafe', border: '#3b82f6' },
      MOVE_OUT:  { bg: '#fce7f3', border: '#ec4899' },
      DELIVERY:  { bg: '#d1fae5', border: '#10b981' },
      RENO:      { bg: '#fef3c7', border: '#f59e0b' },
    };
    const color = colors[moveType] || { bg: '#f3f4f6', border: '#6b7280' };

    const isPast   = event.end   && event.end   <= now;
    const isActive = event.start && event.end   && event.start <= now && now < event.end;

    if (isPast) {
      return {
        style: {
          backgroundColor: '#f1f5f9',
          borderLeft: '3px solid #94a3b8',
          borderRadius: '4px',
          color: '#94a3b8',
          border: 'none',
          outline: 'none',
          opacity: 0.6,
          textDecoration: 'line-through',
        },
      };
    }

    if (isActive) {
      return {
        style: {
          backgroundColor: color.bg,
          borderLeft: `3px solid ${color.border}`,
          borderRadius: '4px',
          color: '#1f2937',
          border: `1px solid ${color.border}`,
          outline: 'none',
          boxShadow: `0 0 0 2px ${color.border}40`,
          fontWeight: 600,
        },
      };
    }

    return {
      style: {
        backgroundColor: color.bg,
        borderLeft: `3px solid ${color.border}`,
        borderRadius: '4px',
        color: '#1f2937',
        border: 'none',
        outline: 'none',
      },
    };
  };

  return (
    <div className="public-calendar-container">
      {/* Header */}
      <header className="calendar-header">
        <div className="header-content">
          <div className="header-title-section">
            <h1 className="calendar-title">Spectrum 4 Calendar</h1>
            <p className="calendar-subtitle">Approved Move & Delivery Reservations</p>
          </div>
          <div className="header-info">
            <div className="current-date">{dayjs().format('dddd, MMMM D, YYYY')}</div>
            <div className="last-updated">
              Updated {dayjs(lastUpdated).format('h:mm A')}
              <span className="update-pulse"></span>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-value">{todayEvents.length}</div>
          <div className="stat-label">Today</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{upcomingEvents.length}</div>
          <div className="stat-label">Upcoming</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{events.length}</div>
          <div className="stat-label">Total</div>
        </div>
      </div>

      {/* View Controls */}
      <div className="view-controls">
        <div className="view-toggle">
          <button className={`view-btn ${view === 'month'  ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
          <button className={`view-btn ${view === 'week'   ? 'active' : ''}`} onClick={() => setView('week')}>Week</button>
          <button className={`view-btn ${view === 'day'    ? 'active' : ''}`} onClick={() => setView('day')}>Day</button>
          <button className={`view-btn ${view === 'agenda' ? 'active' : ''}`} onClick={() => setView('agenda')}>List</button>
        </div>

        <div className="legend">
          <div className="legend-item"><span className="legend-dot move-in"></span><span>Move In</span></div>
          <div className="legend-item"><span className="legend-dot move-out"></span><span>Move Out</span></div>
          <div className="legend-item"><span className="legend-dot delivery"></span><span>Delivery</span></div>
          <div className="legend-item"><span className="legend-dot reno"></span><span>Renovation</span></div>
        </div>
      </div>

      {/* Calendar */}
      <div className="calendar-wrapper">
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          views={['month', 'week', 'day', 'agenda']}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          eventPropGetter={eventStyleGetter}
          style={{ height: calHeight }}
          scrollToTime={scrollToTime}
          popup
        />
      </div>

      {/* Upcoming Events */}
      <div className="upcoming-list">
        <h3 className="upcoming-title">Next 5 Reservations</h3>
        {upcomingEvents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <p>No upcoming reservations</p>
          </div>
        ) : (
          <div className="event-cards">
            {upcomingEvents.map((event, idx) => {
              const resource = event.resource as any;
              const typeColors: Record<string, string> = {
                MOVE_IN: 'move-in', MOVE_OUT: 'move-out', DELIVERY: 'delivery', RENO: 'reno',
              };
              const colorClass = typeColors[resource.moveType] || 'default';
              return (
                <div key={idx} className={`event-card ${colorClass}`}>
                  <div className="event-type-badge">{resource.displayType}</div>
                  <div className="event-details">
                    <div className="event-unit">Unit {resource.unit}</div>
                    <div className="event-time">
                      {dayjs(event.start).format('MMM D, YYYY • h:mm A')} – {dayjs(event.end).format('h:mm A')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
