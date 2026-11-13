-- Hamimazi Café Admin V1: run in Supabase SQL Editor as project owner.
-- IMPORTANT: Replace the email in the final INSERT with the real staff email.
-- Create that email/password account first in Supabase Authentication > Users.
-- Do not expose the service_role key in the browser.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon;
grant select on public.admin_users to authenticated;
drop policy if exists "Admins can see their own membership" on public.admin_users;
create policy "Admins can see their own membership" on public.admin_users
for select to authenticated using (user_id = (select auth.uid()));

-- Do not delete existing policies: checkout RPC may depend on them.
-- These policies permit only authenticated admin users to read customer data.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
grant select on public.orders, public.order_items to authenticated;
drop policy if exists "Hamimazi admins read orders" on public.orders;
create policy "Hamimazi admins read orders" on public.orders for select to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Hamimazi admins read order items" on public.order_items;
create policy "Hamimazi admins read order items" on public.order_items for select to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- REPLACE admin@example.com with the exact email you created in Authentication > Users.
-- The statement will add only that specific user as an admin.
insert into public.admin_users(user_id)
select id from auth.users where lower(email) = lower('admin@example.com')
on conflict (user_id) do nothing;

-- SECURITY REVIEW: Existing permissive SELECT policies on orders/order_items
-- can still expose customer data to anon. Inspect Policies in Supabase and
-- remove any unintended public-read policies, preserving place_order RPC access.
