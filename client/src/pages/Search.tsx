import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { Alert, Card, Empty, Field, money, Stars, useLoad } from '../components/ui';

export default function Search() {
  const [f, setF] = useState<Record<string, string>>({ sort: 'rating' });
  const [applied, setApplied] = useState<Record<string, string>>({ sort: 'rating' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)), page: String(page) }).toString();
  const { data, error, loading } = useLoad(() => get('/public/professionals?' + qs), [qs]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => { e.preventDefault(); setPage(1); setApplied(f); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="hero"><h1>Find the right photographer or videographer</h1><p>Browse verified professionals, compare packages and book securely. Payment is held until you approve the delivered work.</p></div>
      <Card>
        <form onSubmit={submit} className="grid g4">
          <Field label="Search"><input placeholder="Name, style, keyword…" value={f.q || ''} onChange={set('q')} /></Field>
          <Field label="Type"><select value={f.type || ''} onChange={set('type')}><option value="">Photographers & videographers</option><option value="PHOTOGRAPHER">Photographers</option><option value="VIDEOGRAPHER">Videographers</option></select></Field>
          <Field label="City"><input value={f.city || ''} onChange={set('city')} /></Field>
          <Field label="Available on"><input type="date" value={f.date || ''} onChange={set('date')} /></Field>
          <Field label="Min price (₹)"><input type="number" min={0} value={f.minPrice || ''} onChange={set('minPrice')} /></Field>
          <Field label="Max price (₹)"><input type="number" min={0} value={f.maxPrice || ''} onChange={set('maxPrice')} /></Field>
          <Field label="Min rating"><select value={f.minRating || ''} onChange={set('minRating')}><option value="">Any</option><option value="3">3★ & up</option><option value="4">4★ & up</option></select></Field>
          <Field label="Sort by"><select value={f.sort} onChange={set('sort')}><option value="rating">Top rated</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="newest">Newest</option></select></Field>
          <div className="row"><button className="btn">Search</button><button type="button" className="btn secondary" onClick={() => { setF({ sort: 'rating' }); setApplied({ sort: 'rating' }); setPage(1); }}>Clear</button></div>
        </form>
      </Card>
      <Alert>{error}</Alert>
      {loading && !data ? <Empty>Loading…</Empty> : data && data.results.length === 0 ? <Empty>No professionals match your search. Try changing the filters.</Empty> : (
        <div className="grid g2">
          {data?.results.map((p: any) => (
            <Link key={p.id} to={`/professionals/${p.id}`} className="card pro-card">
              {p.has_image ? <img className="avatar" src={`/api/public/professionals/${p.id}/image`} alt="" /> : <div className="avatar">{p.full_name[0]}</div>}
              <div style={{ flex: 1 }}>
                <div className="bold">{p.full_name} <span className="badge blue">{p.professional_type === 'PHOTOGRAPHER' ? 'Photographer' : 'Videographer'}</span></div>
                <div className="dim small">{p.headline || p.specialization} · {p.operating_city}</div>
                <div className="row small"><Stars value={p.avg_rating} /> <span className="dim">{p.review_count ? `${Number(p.avg_rating).toFixed(1)} (${p.review_count})` : 'No reviews yet'}</span></div>
                <div className="small">{p.min_price ? <>From <b>{money(p.min_price)}</b></> : <span className="dim">No packages yet</span>}{p.experience_years ? ` · ${p.experience_years} yrs experience` : ''}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {data && pages > 1 && <div className="row" style={{ justifyContent: 'center' }}><button className="btn secondary sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="dim small">Page {page} of {pages}</span><button className="btn secondary sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </>
  );
}
