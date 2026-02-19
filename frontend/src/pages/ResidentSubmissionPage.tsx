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
  return <form onSubmit={submit}><h2>Move Request</h2>{['residentName','residentEmail','residentPhone','unit','moveDate','startDatetime','endDatetime','notes'].map((k)=><input key={k} placeholder={k} onChange={(e)=>setForm({...form,[k]:e.target.value})}/>)}<select onChange={(e)=>setForm({...form,moveType:e.target.value})}><option>MOVE_IN</option><option>MOVE_OUT</option><option>DELIVERY</option></select><button>Submit</button><p>{message}</p></form>;
}
