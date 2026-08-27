import fs from 'fs'

const remoteOnly = [
  '20260803144623', '20260803150327', '20260804060653', '20260804060737',
  '20260804062951', '20260804072351', '20260804073320', '20260804074330',
  '20260804074433', '20260804074522', '20260804075947', '20260804080803',
  '20260804080807', '20260804082751', '20260804084201', '20260804084750',
  '20260804091339', '20260804093023', '20260804095942', '20260804112254',
  '20260805150503', '20260805151610', '20260805152558', '20260805152613',
  '20260805154109', '20260805154128', '20260812060916', '20260812090214',
  '20260812093806', '20260812131941', '20260814093545', '20260814105304',
]

const localOnly = [
  '20260716120000', '20260803160100', '20260804090000', '20260804093000',
  '20260804100000', '20260804110000', '20260804120000', '20260804130000',
  '20260804140000', '20260804141000', '20260804150000', '20260804160000',
  '20260804170000', '20260804190000', '20260804200000', '20260804210000',
  '20260804220000', '20260805120000', '20260805130000', '20260805140000',
  '20260805150000', '20260805160000', '20260805161000', '20260811000000',
  '20260811000100', '20260811000200', '20260811000300', '20260811000400',
  '20260811000500', '20260812000100', '20260812000200', '20260812000300',
  '20260812000400',
]

const files = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
const byVer = {}
for (const f of files) {
  byVer[f.slice(0, 14)] = f.replace(/\.sql$/, '').slice(15) || f.slice(0, 14)
}

const q = (s) => s.replace(/'/g, "''")
const del =
  'DELETE FROM supabase_migrations.schema_migrations WHERE version IN (' +
  remoteOnly.map((v) => `'${v}'`).join(',') +
  ');'

const ins =
  'INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES\n' +
  localOnly
    .map((v) => `  ('${v}', '${q(byVer[v] || v)}', ARRAY[]::text[])`)
    .join(',\n') +
  '\nON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;'

const verify = `
SELECT
  (SELECT COUNT(*)::int FROM supabase_migrations.schema_migrations
    WHERE version = ANY(ARRAY[${remoteOnly.map((v) => `'${v}'`).join(',')}]::text[])) AS remote_orphans_left,
  (SELECT COUNT(*)::int FROM supabase_migrations.schema_migrations
    WHERE version = ANY(ARRAY[${localOnly.map((v) => `'${v}'`).join(',')}]::text[])) AS local_versions_recorded;
`

const sql = `${del}\n\n${ins}\n${verify}\n`
fs.writeFileSync('supabase/_migration_history_cleanup.sql', sql)
console.log('wrote supabase/_migration_history_cleanup.sql')
