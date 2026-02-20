import { useEffect, useMemo, useState } from 'react';
import { Calendar, dayjsLocalizer, type Event } from 'react-big-calendar';
import dayjs from 'dayjs';
import { api } from '../api';
import 'react-big-calendar/lib/css/react-big-calendar.css';

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

  useEffect(() => {
    const load = () => api.get<PublicBooking[]>('/api/public/bookings').then((r) => setRows(r.data));
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const events = useMemo<Event[]>(
    () =>
      rows.map((row) => {
        // Use shorter labels for better display in calendar
        const typeLabels: Record<string, string> = {
          'MOVE_IN': 'In',
          'MOVE_OUT': 'Out',
          'DELIVERY': 'Delivery'
        };
        const shortType = typeLabels[row.moveType] || row.moveType;

        return {
          title: `${shortType}: ${row.unit}`,
          start: new Date(row.startDatetime),
          end: new Date(row.endDatetime),
          resource: row
        };
      }),
    [rows]
  );

  return (
    <div>
      <h2>Approved Move Calendar</h2>
      <div style={{ height: 700 }}>
        <Calendar localizer={localizer} events={events} startAccessor="start" endAccessor="end" views={["month", "week", "day"]} defaultView="week" />
      </div>
    </div>
  );
}
