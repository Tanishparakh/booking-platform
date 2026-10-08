import { Link } from 'react-router-dom';
import { get, post } from '../api';
import { Alert, Card, Empty, fmtDateTime, useLoad } from '../components/ui';

export default function Notifications() {
  const { data, error, reload } = useLoad(() => get('/account/notifications'));
  return (
    <Card title="Notifications" actions={<button className="btn secondary sm" onClick={async () => { await post('/account/notifications/read', {}); reload(); }}>Mark all as read</button>}>
      <Alert>{error}</Alert>
      {data && data.items.length === 0 && <Empty>No notifications yet.</Empty>}
      {data?.items.map((n: any) => (
        <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontWeight: n.is_read ? 400 : 700 }}>
          {n.booking_id ? <Link to={'/bookings/' + n.booking_id}>{n.message}</Link> : n.message}
          <div className="small dim" style={{ fontWeight: 400 }}>{fmtDateTime(n.created_at)}</div>
        </div>
      ))}
    </Card>
  );
}
