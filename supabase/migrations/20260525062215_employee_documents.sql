
-- ── Table ─────────────────────────────────────────────────────────────────
create table if not exists employee_documents (
    id               uuid default gen_random_uuid() primary key,
    company_id       uuid not null references companies(id) on delete cascade,
    employee_id      uuid not null references employees(id) on delete cascade,
    document_type    text not null,
    document_name    text not null,
    file_url         text not null,
    uploaded_by_role text not null default 'hr',
    created_at       timestamptz default now()
);

create index if not exists idx_employee_documents_employee on employee_documents(employee_id);
create index if not exists idx_employee_documents_company  on employee_documents(company_id);

-- ── RLS (HR / authenticated role) ─────────────────────────────────────────
alter table employee_documents enable row level security;

create policy "hr_select_employee_documents" on employee_documents
    for select using (
        company_id in (
            select company_id from employees
            where user_id = auth.uid()
            and access_level in ('owner','hr_admin','admin','manager')
        )
    );

create policy "hr_insert_employee_documents" on employee_documents
    for insert with check (
        company_id in (
            select company_id from employees
            where user_id = auth.uid()
            and access_level in ('owner','hr_admin','admin','manager')
        )
    );

create policy "hr_delete_employee_documents" on employee_documents
    for delete using (
        company_id in (
            select company_id from employees
            where user_id = auth.uid()
            and access_level in ('owner','hr_admin','admin','manager')
        )
    );

-- ── RPC: employee fetch own documents (anon bypass) ───────────────────────
create or replace function employee_get_documents(
    p_company_id  uuid,
    p_employee_id uuid
)
returns json language plpgsql security definer set search_path = public
as $$
begin
    perform 1 from employees
    where id = p_employee_id and company_id = p_company_id and is_active = true;
    if not found then raise exception 'Employee not found'; end if;

    return (
        select coalesce(json_agg(row_to_json(d) order by d.created_at desc), '[]'::json)
        from employee_documents d
        where d.employee_id = p_employee_id and d.company_id = p_company_id
    );
end; $$;

grant execute on function employee_get_documents(uuid, uuid) to anon, authenticated;

-- ── RPC: employee submit own document (anon bypass) ───────────────────────
create or replace function employee_submit_document(
    p_company_id    uuid,
    p_employee_id   uuid,
    p_document_type text,
    p_document_name text,
    p_file_url      text
)
returns json language plpgsql security definer set search_path = public
as $$
declare v_doc employee_documents%rowtype;
begin
    perform 1 from employees
    where id = p_employee_id and company_id = p_company_id and is_active = true;
    if not found then raise exception 'Employee not found'; end if;

    insert into employee_documents (company_id, employee_id, document_type, document_name, file_url, uploaded_by_role)
    values (p_company_id, p_employee_id, p_document_type, p_document_name, p_file_url, 'employee')
    returning * into v_doc;

    return row_to_json(v_doc);
end; $$;

grant execute on function employee_submit_document(uuid, uuid, text, text, text) to anon, authenticated;
;
