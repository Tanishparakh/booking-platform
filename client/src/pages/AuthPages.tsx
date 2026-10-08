import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '../api';
import { homeFor, useAuth } from '../auth';
import { Alert, Card, Field, useAction } from '../components/ui';

export function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const a = useAction();

  const finish = async (token: string) => {
    await signIn(token);
    const me = await get('/auth/me');
    nav(loc.state?.from || homeFor(me.role), { replace: true });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await a.run(async () => {
      if (mfaToken) return finish((await post('/auth/mfa/verify', { mfaToken, code })).token);
      const r = await post('/auth/login', { email, password });
      if (r.mfaRequired) setMfaToken(r.mfaToken); else await finish(r.token);
    });
  };
  return (
    <div className="center"><Card title={mfaToken ? 'Administrator verification' : 'Sign in'}>
      <form onSubmit={submit}>
        <Alert>{a.error}</Alert>
        {mfaToken ? (
          <>
            <Alert kind="info">We emailed a 6-digit code to {email}. (Local demo: open MailHog at http://localhost:8025.)</Alert>
            <Field label="One-time code"><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required /></Field>
          </>
        ) : (
          <>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          </>
        )}
        <button className="btn" disabled={a.busy}>{mfaToken ? 'Verify' : 'Sign in'}</button>
      </form>
      {!mfaToken && <p className="small dim">New here? <Link to="/register">Create an account</Link></p>}
    </Card></div>
  );
}

export function Register() {
  const [role, setRole] = useState<'CLIENT' | 'PROFESSIONAL'>('CLIENT');
  const [f, setF] = useState<any>({ professionalType: 'PHOTOGRAPHER' });
  const [done, setDone] = useState(false);
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: any = { role, email: f.email, password: f.password, fullName: f.fullName, phone: f.phone || undefined };
    if (role === 'PROFESSIONAL') { body.professionalType = f.professionalType; body.city = f.city; }
    if (await a.run(() => post('/auth/register', body))) setDone(true);
  };
  if (done) return <div className="center"><Card title="Check your email"><p>We sent a verification link to <b>{f.email}</b>. Open it to activate your account, then <Link to="/login">sign in</Link>.</p><p className="small dim">Local demo: emails appear in MailHog at http://localhost:8025.</p></Card></div>;
  return (
    <div className="center"><Card title="Create your account">
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className={'btn ' + (role === 'CLIENT' ? '' : 'secondary')} onClick={() => setRole('CLIENT')}>I want to hire</button>
        <button type="button" className={'btn ' + (role === 'PROFESSIONAL' ? '' : 'secondary')} onClick={() => setRole('PROFESSIONAL')}>I'm a photographer / videographer</button>
      </div>
      <form onSubmit={submit}>
        <Alert>{a.error}</Alert>
        <Field label="Full name"><input value={f.fullName || ''} onChange={set('fullName')} required minLength={2} /></Field>
        <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} required /></Field>
        <Field label="Phone (optional)"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Password" hint="At least 8 characters with a letter and a digit"><input type="password" value={f.password || ''} onChange={set('password')} required minLength={8} /></Field>
        {role === 'PROFESSIONAL' && (
          <>
            <Field label="I am a"><select value={f.professionalType} onChange={set('professionalType')}><option value="PHOTOGRAPHER">Photographer</option><option value="VIDEOGRAPHER">Videographer</option></select></Field>
            <Field label="Operating city"><input value={f.city || ''} onChange={set('city')} required minLength={2} /></Field>
          </>
        )}
        <button className="btn" disabled={a.busy}>Create account</button>
      </form>
    </Card></div>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState<{ ok?: boolean; msg: string }>({ msg: 'Verifying…' });
  useEffect(() => {
    get('/auth/verify-email?token=' + encodeURIComponent(params.get('token') || ''))
      .then((r) => setState({ ok: true, msg: r.message }))
      .catch((e) => setState({ ok: false, msg: e.message }));
  }, []);
  return <div className="center"><Card title="Email verification"><Alert kind={state.ok ? 'success' : state.ok === false ? 'error' : 'info'}>{state.msg}</Alert><Link className="btn" to="/login">Go to sign in</Link></Card></div>;
}
