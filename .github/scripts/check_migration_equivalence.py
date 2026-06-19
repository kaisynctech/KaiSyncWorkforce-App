#!/usr/bin/env python3
"""
Gate 3: Migration Equivalence Check.
Compares local migration file versions against the Supabase production ledger.
Fails if any version is present in one but not the other.
"""
import os
import re
import subprocess
import json
import sys
MIGRATIONS_DIR = "KaiFlow.Timesheets.Maui/supabase/migrations"
PROJECT_ID = os.environ["SUPABASE_PROJECT_ID"]
ACCESS_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
# --- Local versions ---
local_versions = set()
for filename in os.listdir(MIGRATIONS_DIR):
    if filename.endswith(".sql"):
        # Extract the leading numeric prefix (up to first underscore)
        match = re.match(r'^(\d+)_', filename)
        if match:
            local_versions.add(match.group(1))
# --- Production versions ---
result = subprocess.run(
    ["supabase", "migration", "list", "--project-ref", PROJECT_ID, "--output", "json"],
    capture_output=True, text=True, check=True,
    env={**os.environ, "SUPABASE_ACCESS_TOKEN": ACCESS_TOKEN}
)
production_data = json.loads(result.stdout)
production_versions = set(entry["version"] for entry in production_data if entry.get("version"))
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
