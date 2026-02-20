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

export function PublicCalendarPage() {
  const [rows, setRows] = useState<PublicBooking[]>([]);
  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

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

  const events = useMemo<Event[]>(
    () =>
      rows.map((row) => {
        const typeLabels: Record<string, string> = {
          'MOVE_IN': 'Move In',
          'MOVE_OUT': 'Move Out',
          'DELIVERY': 'Delivery'
        };
        const fullType = typeLabels[row.moveType] || row.moveType;

        return {
          title: `${fullType} • Unit ${row.unit}`,
          start: new Date(row.startDatetime),
          end: new Date(row.endDatetime),
          resource: { ...row, displayType: fullType }
        };
      }),
    [rows]
  );

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter(e => e.start && e.start >= now)
      .sort((a, b) => {
        if (!a.start || !b.start) return 0;
        return a.start.getTime() - b.start.getTime();
      })
      .slice(0, 5);
  }, [events]);

  const todayEvents = useMemo(() => {
    const today = dayjs().startOf('day');
    const tomorrow = today.add(1, 'day');
    return events.filter(e => {
      if (!e.start) return false;
      const eventDate = dayjs(e.start);
      return eventDate.isAfter(today) && eventDate.isBefore(tomorrow);
    });
  }, [events]);

  const eventStyleGetter = (event: Event) => {
    const moveType = (event.resource as any)?.moveType;
    const colors: Record<string, { bg: string; border: string }> = {
      'MOVE_IN': { bg: '#dbeafe', border: '#3b82f6' },
      'MOVE_OUT': { bg: '#fce7f3', border: '#ec4899' },
      'DELIVERY': { bg: '#d1fae5', border: '#10b981' }
    };
    const color = colors[moveType] || { bg: '#f3f4f6', border: '#6b7280' };

    return {
      style: {
        backgroundColor: color.bg,
        borderLeft: `3px solid ${color.border}`,
        borderRadius: '4px',
        color: '#1f2937',
        border: 'none',
        outline: 'none'
      }
    };
  };

  return (
    <div className="public-calendar-container">
      {/* Header */}
      <header className="calendar-header">
        <div className="header-content">
          <div className="header-title-section">
            <h1 className="calendar-title">Building Calendar</h1>
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
          <button
            className={`view-btn ${view === 'month' ? 'active' : ''}`}
            onClick={() => setView('month')}
          >
            Month
          </button>
          <button
            className={`view-btn ${view === 'week' ? 'active' : ''}`}
            onClick={() => setView('week')}
          >
            Week
          </button>
          <button
            className={`view-btn ${view === 'day' ? 'active' : ''}`}
            onClick={() => setView('day')}
          >
            Day
          </button>
        </div>

        <div className="legend">
          <div className="legend-item">
            <span className="legend-dot move-in"></span>
            <span>Move In</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot move-out"></span>
            <span>Move Out</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot delivery"></span>
            <span>Delivery</span>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="calendar-wrapper">
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          views={['month', 'week', 'day']}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          eventPropGetter={eventStyleGetter}
          style={{ height: 600 }}
          popup
        />
      </div>

      {/* Upcoming Events Mobile List */}
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
                'MOVE_IN': 'move-in',
                'MOVE_OUT': 'move-out',
                'DELIVERY': 'delivery'
              };
              const colorClass = typeColors[resource.moveType] || 'default';

              return (
                <div key={idx} className={`event-card ${colorClass}`}>
                  <div className="event-type-badge">{resource.displayType}</div>
                  <div className="event-details">
                    <div className="event-unit">Unit {resource.unit}</div>
                    <div className="event-time">
                      {dayjs(event.start).format('MMM D, YYYY • h:mm A')} - {dayjs(event.end).format('h:mm A')}
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
