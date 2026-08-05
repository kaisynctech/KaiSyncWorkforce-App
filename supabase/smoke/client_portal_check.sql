SELECT c.code AS company_code,
       cl.client_code,
       cl.name AS client_name,
       (SELECT count(*)::int FROM client_deals d
         WHERE d.client_id = cl.id AND d.visibility <> 'private') AS visible_projects
FROM clients cl
JOIN companies c ON c.id = cl.company_id
WHERE cl.client_code IS NOT NULL
LIMIT 5;

SELECT public.client_portal_list_projects(c.code, cl.client_code) AS projects_json
FROM clients cl
JOIN companies c ON c.id = cl.company_id
WHERE cl.client_code IS NOT NULL
LIMIT 1;
