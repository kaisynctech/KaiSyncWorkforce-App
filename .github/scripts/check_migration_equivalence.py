#!/usr/bin/env python3
"""
Gate 3: Migration Equivalence Check.
Compares local migration file versions against the Supabase production ledger
via the Supabase Management API. Fails if any version is present in one side
but not the other.
"""
import os
import re
import json
import sys
import urllib.request
import urllib.error

MIGRATIONS_DIR = "KaiFlow.Timesheets.Maui/supabase/migrations"
PROJECT_ID = os.environ["SUPABASE_PROJECT_ID"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]

# --- Local versions ---
local_versions = set()
for filename in os.listdir(MIGRATIONS_DIR):
    if filename.endswith(".sql"):
        match = re.match(r'^(\d+)_', filename)
        if match:
            local_versions.add(match.group(1))

# --- Production versions (via Management API) ---
url = f"https://api.supabase.com/v1/projects/{PROJECT_ID}/database/migrations"
req = urllib.request.Request(
    url,
    headers={
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
)
try:
    with urllib.request.urlopen(req) as resp:
        production_data = json.loads(resp.read().decode())
except urllib.error.HTTPError as e:
    print(f"::error::Supabase API error {e.code}: {e.read().decode()}")
    sys.exit(1)

production_versions = set(
    entry["version"] for entry in production_data if entry.get("version")
)

# --- Diff ---
local_only = sorted(local_versions - production_versions)
production_only = sorted(production_versions - local_versions)
failures = []

if local_only:
    failures.append("Local versions not in production:")
    for v in local_only:
        failures.append(f"  LOCAL ONLY: {v}")

if production_only:
    failures.append("Production versions not in local:")
    for v in production_only:
        failures.append(f"  PROD ONLY: {v}")

if failures:
    for line in failures:
        print(f"::error::{line}")
    sys.exit(1)

print(f"Equivalence check passed: {len(local_versions)} versions matched.")
