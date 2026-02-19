import { FormEvent, useState } from 'react';
import { api } from '../api';

export function ResidentSubmissionPage() {
  const [form, setForm] = useState<any>({ moveType: 'MOVE_IN', elevatorRequired: true, loadingBayRequired: false });
  const [message, setMessage] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await api.post('/api/bookings', form);
    setMessage('Submitted');
  };
  return (
    <form onSubmit={submit}>
      <h2>Move Request</h2>
      <input placeholder="Resident Name" onChange={(e) => setForm({ ...form, residentName: e.target.value })} />
      <input type="email" placeholder="Resident Email" onChange={(e) => setForm({ ...form, residentEmail: e.target.value })} />
      <input placeholder="Resident Phone" onChange={(e) => setForm({ ...form, residentPhone: e.target.value })} />
      <input placeholder="Unit" onChange={(e) => setForm({ ...form, unit: e.target.value })} />
      <input type="date" placeholder="Move Date" onChange={(e) => setForm({ ...form, moveDate: e.target.value })} />
      <input type="datetime-local" placeholder="Start" onChange={(e) => setForm({ ...form, startDatetime: e.target.value })} />
      <input type="datetime-local" placeholder="End" onChange={(e) => setForm({ ...form, endDatetime: e.target.value })} />
      <input placeholder="Notes" onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <label>
        <input type="checkbox" checked={form.elevatorRequired} onChange={(e) => setForm({ ...form, elevatorRequired: e.target.checked })} />
        Elevator Required
      </label>
      <label>
        <input type="checkbox" checked={form.loadingBayRequired} onChange={(e) => setForm({ ...form, loadingBayRequired: e.target.checked })} />
        Loading Bay Required
      </label>
      <select onChange={(e) => setForm({ ...form, moveType: e.target.value })}>
        <option>MOVE_IN</option>
        <option>MOVE_OUT</option>
        <option>DELIVERY</option>
      </select>
      <button>Submit</button>
      <p>{message}</p>
    </form>
  );
}
