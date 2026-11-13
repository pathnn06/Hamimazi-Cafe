import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import "./admin.css";

type Order = { id: string; customer_name: string | null; contact_number: string | null; notes: string | null; total_amount: number | string | null; status: string | null; created_at: string };
type OrderItem = Record<string, unknown>;
const money = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const localDate = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const displayDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const asString = (value: unknown) => value == null ? "" : String(value);
const itemName = (item: OrderItem) => asString(item.product_name ?? item.name ?? (typeof item.products === "object" && item.products !== null ? (item.products as Record<string, unknown>).name : null) ?? (item.product_id ? `Product #${item.product_id}` : "Drink"));
const itemQuantity = (item: OrderItem) => Number(item.quantity ?? 1) || 1;

export default function Admin() {
  const [sessionUser, setSessionUser] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [coffeeBreak, setCoffeeBreak] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, OrderItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Order | null>(null);
  const [itemLoading, setItemLoading] = useState(false);
  const pageSize = 10;

  useEffect(() => {
    let active = true;
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      const userId = session?.user?.id;
      setSessionUser(userId ?? null);
      if (!userId) { setAuthorized(false); setChecking(false); return; }
      const { data, error } = await supabase.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
      if (!active) return;
      setAuthorized(!error && !!data);
      setChecking(false);
    };
    void check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { if (active) { setChecking(true); void check(); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const refresh = useCallback(async () => {
    if (!authorized) return;
    setLoading(true); setLoadError("");
    try {
      // Supabase normally caps responses at 1,000 rows; fetch in batches to avoid silently losing older orders.
      const all: Order[] = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase.from("orders")
          .select("id,customer_name,contact_number,notes,total_amount,status,created_at")
          .order("created_at", { ascending: false }).range(start, start + 499);
        if (error) throw error;
        const batch = (data ?? []) as Order[];
        all.push(...batch);
        if (batch.length < 500) break;
      }
      setOrders(all);
      const { data: productRows } = await supabase.from("products").select("id,name");
      if (productRows) setProductNames(Object.fromEntries(productRows.map(p => [String(p.id), String(p.name)])));
    } catch (err) { setLoadError(err instanceof Error ? err.message : "Unable to load orders."); }
    finally { setLoading(false); }
  }, [authorized]);
  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => orders.filter(order =>
    (order.customer_name ?? "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (!date || localDate(order.created_at) === date)
  ), [orders, query, date]);
  const totalDue = filtered.reduce((sum, order) => sum + Number(order.total_amount ?? 0), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const openDetails = async (order: Order) => {
    setSelected(order);
    if (itemsByOrder[order.id]) return;
    setItemLoading(true);
    const { data, error } = await supabase.from("order_items").select("*").eq("order_id", order.id);
    if (error) setLoadError(`Unable to load order items: ${error.message}`);
    else setItemsByOrder(prev => ({ ...prev, [order.id]: (data ?? []) as OrderItem[] }));
    setItemLoading(false);
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSigningIn(true); setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      setPassword("");
      if (nextAttempts >= 3) {
        setCoffeeBreak(true);
        setAuthError("");
      } else {
        setAuthError(nextAttempts === 2
          ? "Oopsie! That login didn't work. One try left! 🍵"
          : "Oopsie! Incorrect email or password. Please try again. 💜");
      }
    } else {
      setFailedAttempts(0);
    }
    setSigningIn(false);
  };

  if (coffeeBreak) return <div className="admin-root"><div className="admin-overlay">
    <section className="admin-dialog admin-coffee-break" role="alertdialog" aria-modal="true" aria-labelledby="coffee-break-title">
      <div className="admin-mark">☕</div>
      <h2 id="coffee-break-title">Maybe take a coffee break first? 🤭</h2>
      <p>Oopsie! Three unsuccessful login attempts. Our matcha needs a little rest, and so does your keyboard! 💜</p>
      <a className="admin-button admin-home-button" href="/">Back to Hamimazi Café 🍵</a>
    </section>
  </div></div>;

  if (checking) return <div className="admin-root"><div className="admin-login"><h1>Hamimazi Café Admin</h1><p>Checking admin access…</p></div></div>;
  if (!sessionUser || !authorized) return <div className="admin-root"><div className="admin-login">
    <div className="admin-mark">🍵</div><h1>Hamimazi Café Admin</h1>
    <p>Private order dashboard · Authorized staff only</p>
    {sessionUser ? <><p className="admin-error">This account is not authorized to view café orders.</p><button className="admin-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></> :
      <form onSubmit={signIn} className="admin-login-form"><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {authError && <p className="admin-error" role="alert">{authError}</p>}
      <button className="admin-button" type="submit" disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button></form>}
    <a href="/">← Back to café menu</a>
  </div></div>;

  return <div className="admin-root"><div className="admin-layout">
    <div className="admin-sticky"><div className="admin-topline"><div><h1>Hamimazi Café Admin</h1><p>Customer orders · Amounts shown are due, not confirmed payments</p></div><div className="admin-top-actions"><a href="/">Café menu</a><button type="button" onClick={() => void supabase.auth.signOut()}>Sign out</button></div></div>
      <div className="admin-summary"><div><span>Orders received</span><strong>{filtered.length}</strong></div><div><span>Total amount due</span><strong>{money(totalDue)}</strong></div></div></div>
    <section className="admin-content"><div className="admin-filters"><label>Search name<input placeholder="First name or last name…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
      <label>Order date (Philippines)<input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(1); }} /></label>
      <button type="button" className="admin-outline" onClick={() => { setDate(""); setQuery(""); setPage(1); }}>Clear</button></div>
      <div className="admin-list-heading"><h2>Orders</h2><div><span>{filtered.length} results</span><button type="button" className="admin-outline" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
      {loadError && <p className="admin-error" role="alert">{loadError}</p>}
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Customer name</th><th>Date ordered</th><th>Items</th><th>Amount due</th><th>Order</th></tr></thead>
        <tbody>{shown.map(order => <tr key={order.id}><td><strong>{order.customer_name || "Unnamed customer"}</strong></td><td>{displayDate(order.created_at)}</td><td>View details</td><td className="admin-money">{money(Number(order.total_amount ?? 0))}</td><td><button type="button" className="admin-details-btn" onClick={() => void openDetails(order)}>View details</button></td></tr>)}</tbody></table>
        {!loading && shown.length === 0 && <p className="admin-empty">No orders match your search or selected date.</p>}</div>
      <div className="admin-pagination"><span>Showing {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span><div><button type="button" className="admin-outline" disabled={currentPage === 1} onClick={() => setPage(n => Math.max(1, n - 1))}>← Previous</button><span>Page {currentPage} of {pages}</span><button type="button" className="admin-outline" disabled={currentPage >= pages} onClick={() => setPage(n => Math.min(pages, n + 1))}>Next →</button></div></div>
    </section>
    {selected && <div className="admin-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-order-title"><div className="admin-dialog-header"><div><small>ORDER DETAILS</small><h2 id="admin-order-title">{selected.customer_name}</h2></div><button type="button" aria-label="Close order details" onClick={() => setSelected(null)}>✕</button></div>
      <p><b>Ordered:</b> {displayDate(selected.created_at)}</p><p><b>Contact:</b> {selected.contact_number || "Not provided"}</p><p><b>Notes:</b> {selected.notes || "No notes"}</p>
      <h3>Drinks ordered</h3>{itemLoading && !itemsByOrder[selected.id] ? <p>Loading drinks…</p> : (itemsByOrder[selected.id] ?? []).length ? <div className="admin-item-list">{itemsByOrder[selected.id].map((item, index) => <div key={asString(item.id) || index}><span><strong>{item.product_id != null && productNames[String(item.product_id)] ? productNames[String(item.product_id)] : itemName(item)}</strong><small>{asString(item.size)} · Qty {itemQuantity(item)}</small></span><span>{item.unit_price != null ? money(Number(item.unit_price) * itemQuantity(item)) : item.subtotal != null ? money(Number(item.subtotal)) : ""}</span></div>)}</div> : <p>No item details available.</p>}
      <div className="admin-dialog-total"><span>Total amount due (not paid)</span><strong>{money(Number(selected.total_amount ?? 0))}</strong></div><button type="button" className="admin-button" onClick={() => setSelected(null)}>Close</button></section></div>}
  </div></div>;
}
