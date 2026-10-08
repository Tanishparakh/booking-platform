import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { homeFor, Role, useAuth } from './auth';
import { get } from './api';
import { Login, Register, VerifyEmail } from './pages/AuthPages';
import Search from './pages/Search';
import ProfessionalPage from './pages/ProfessionalPage';
import { BookingList, BookingDetail } from './pages/Bookings';
import Notifications from './pages/Notifications';
import { ProDashboard, ProProfile, ProAvailability, ProPayouts } from './pages/ProPages';
import { AdminDashboard, Verifications, Users, SettingsPage, Payments, AuditLog } from './pages/AdminPages';
import { Disputes, DisputeDetail, ReportedContent } from './pages/StaffPages';

function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="wrap">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function Nav() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  const loc = useLocation();
  useEffect(() => {
    if (user) get('/account/notifications').then((r) => setUnread(r.unread)).catch(() => {});
  }, [user, loc.pathname]);
  const L = ({ to, children, end }: { to: string; children: ReactNode; end?: boolean }) => <NavLink className={({ isActive }) => 'link' + (isActive ? ' active' : '')} to={to} end={end}>{children}</NavLink>;
  return (
    <header className="nav"><div className="nav-in">
      <Link to={user ? homeFor(user.role) : '/'} className="brand">📷 FrameBook</Link>
      {(!user || user.role === 'CLIENT') && <L to="/" end>Find talent</L>}
      {user?.role === 'CLIENT' && <L to="/bookings">My bookings</L>}
      {user?.role === 'PROFESSIONAL' && <><L to="/pro" end>Dashboard</L><L to="/pro/profile">Profile</L><L to="/pro/availability">Availability</L><L to="/pro/payouts">Payouts</L><L to="/bookings">Bookings</L></>}
      {user?.role === 'ADMIN' && <><L to="/admin" end>Overview</L><L to="/admin/verifications">Verification</L><L to="/admin/users">Users</L><L to="/staff/disputes">Disputes</L><L to="/staff/reports">Moderation</L><L to="/admin/payments">Payments</L><L to="/admin/settings">Settings</L><L to="/admin/audit">Audit</L></>}
      {user?.role === 'SUPPORT' && <><L to="/staff" end>Disputes</L><L to="/staff/reports">Reported content</L></>}
      <span className="spacer" />
      {user ? (
        <>
          {user.role !== 'ADMIN' && user.role !== 'SUPPORT' && <L to="/notifications">🔔{unread > 0 ? ` (${unread})` : ''}</L>}
          <span className="dim small">{user.fullName} · {user.role.toLowerCase()}</span>
          <button className="btn secondary sm" onClick={() => { signOut(); nav('/login'); }}>Sign out</button>
        </>
      ) : (<><L to="/login">Sign in</L><Link className="btn sm" to="/register">Sign up</Link></>)}
    </div></header>
  );
}

export default function App() {
  const { user } = useAuth();
  return (
    <>
      <Nav />
      <main className="wrap">
        <Routes>
          <Route path="/" element={user && user.role !== 'CLIENT' ? <Navigate to={homeFor(user.role)} replace /> : <Search />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/professionals/:id" element={<ProfessionalPage />} />
          <Route path="/bookings" element={<Protected roles={['CLIENT', 'PROFESSIONAL']}><BookingList /></Protected>} />
          <Route path="/bookings/:id" element={<Protected><BookingDetail /></Protected>} />
          <Route path="/notifications" element={<Protected roles={['CLIENT', 'PROFESSIONAL']}><Notifications /></Protected>} />
          <Route path="/pro" element={<Protected roles={['PROFESSIONAL']}><ProDashboard /></Protected>} />
          <Route path="/pro/profile" element={<Protected roles={['PROFESSIONAL']}><ProProfile /></Protected>} />
          <Route path="/pro/availability" element={<Protected roles={['PROFESSIONAL']}><ProAvailability /></Protected>} />
          <Route path="/pro/payouts" element={<Protected roles={['PROFESSIONAL']}><ProPayouts /></Protected>} />
          <Route path="/admin" element={<Protected roles={['ADMIN']}><AdminDashboard /></Protected>} />
          <Route path="/admin/verifications" element={<Protected roles={['ADMIN']}><Verifications /></Protected>} />
          <Route path="/admin/users" element={<Protected roles={['ADMIN']}><Users /></Protected>} />
          <Route path="/admin/payments" element={<Protected roles={['ADMIN']}><Payments /></Protected>} />
          <Route path="/admin/settings" element={<Protected roles={['ADMIN']}><SettingsPage /></Protected>} />
          <Route path="/admin/audit" element={<Protected roles={['ADMIN']}><AuditLog /></Protected>} />
          <Route path="/staff" element={<Protected roles={['SUPPORT', 'ADMIN']}><Disputes /></Protected>} />
          <Route path="/staff/disputes" element={<Protected roles={['SUPPORT', 'ADMIN']}><Disputes /></Protected>} />
          <Route path="/staff/disputes/:id" element={<Protected roles={['SUPPORT', 'ADMIN']}><DisputeDetail /></Protected>} />
          <Route path="/staff/reports" element={<Protected roles={['SUPPORT', 'ADMIN']}><ReportedContent /></Protected>} />
          <Route path="*" element={<p className="empty">Page not found. <Link to="/">Go home</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
