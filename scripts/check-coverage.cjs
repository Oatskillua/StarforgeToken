// scripts/check-coverage.cjs
/* eslint-disable no-console */
"use strict";

/**
 * Coverage guard for solidity-coverage output (Windows & POSIX friendly)
 *
 * Usage (from project root):
 *   1) npx hardhat coverage
 *   2) node scripts/check-coverage.cjs
 *
 * Exits non-zero if floors are not met.
 */

const fs = require("fs");
const path = require("path");

// --------------------------- Floors (edit as needed) ---------------------------

// Global floors across all Solidity files under /contracts
const FLOORS_GLOBAL = {
  statements: 88, // %
  branches: 60,   // %
  functions: 87,  // %
  lines: 89       // %
};

// Per-file floors (keys use forward slashes and start with "contracts/")
const FLOORS_PER_FILE = {
  "contracts/StarforgeStaking.sol":   { statements: 93, branches: 60, functions: 86, lines: 100 },
  "contracts/TreasuryVesting.sol":    { statements: 75, branches: 55, functions: 75, lines: 75  },
  "contracts/OGNFT.sol":              { statements: 70, branches: 55, functions: 80, lines: 65  },
  "contracts/StarForge.sol":          { statements: 90, branches: 65, functions: 85, lines: 90  },
  "contracts/StarforgeGovernor.sol":  { statements: 95, branches: 70, functions: 95, lines: 95  },
};

// -----------------------------------------------------------------------------

const COVERAGE_CANDIDATES = [
  path.join("coverage", "coverage.json"),
  "coverage.json"
];

function readCoverageJSON() {
  for (const p of COVERAGE_CANDIDATES) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  }
  console.error("❌ coverage.json not found. Run `npx hardhat coverage` first.");
  process.exit(2);
}

/** Normalize file path keys so Windows backslashes become forward slashes,
 *  and strip any absolute prefix before "contracts/". */
function canonicalKey(raw) {
  const unixy = String(raw).replace(/\\/g, "/");
  const lower = unixy.toLowerCase();
  const idx = lower.lastIndexOf("contracts/");
  if (idx >= 0) return unixy.slice(idx); // "contracts/....sol"
  return unixy;
}

/** Build a map of canonicalKey -> coverageEntry, but only for Solidity files under /contracts. */
function collectContractFiles(cov) {
  const files = {};
  for (const rawKey of Object.keys(cov)) {
    const key = canonicalKey(rawKey);
    if (key.endsWith(".sol") && key.includes("contracts/")) {
      files[key] = cov[rawKey];
    }
  }
  return files;
}

function pct(covered, total) {
  if (!total) return 100.0;
  return Number(((covered * 100) / total).toFixed(2));
}

function metricsForFile(entry) {
  const s = entry.s || {};           // statements hits: { id: hits }
  const f = entry.f || {};           // functions hits: { id: hits }
  const b = entry.b || {};           // branches hits:  { id: [hit,left,hit,...] }
  const l = entry.l || {};           // lines hits:     { lineNumber: hits }

  // statements
  const statementsTotal = Object.keys(s).length;
  const statementsCovered = Object.values(s).filter((v) => v > 0).length;

  // functions
  const functionsTotal = Object.keys(f).length;
  const functionsCovered = Object.values(f).filter((v) => v > 0).length;

  // branches
  let branchesTotal = 0;
  let branchesCovered = 0;
  for (const hits of Object.values(b)) {
    const arr = Array.isArray(hits) ? hits : [];
    branchesTotal += arr.length;
    branchesCovered += arr.filter((v) => v > 0).length;
  }

  // lines
  const linesTotal = Object.keys(l).length;
  const linesCovered = Object.values(l).filter((v) => v > 0).length;

  return {
    counts: {
      statements: { covered: statementsCovered, total: statementsTotal },
      branches:   { covered: branchesCovered,   total: branchesTotal   },
      functions:  { covered: functionsCovered,  total: functionsTotal  },
      lines:      { covered: linesCovered,      total: linesTotal      },
    },
    pct: {
      statements: pct(statementsCovered, statementsTotal),
      branches:   pct(branchesCovered,   branchesTotal),
      functions:  pct(functionsCovered,  functionsTotal),
      lines:      pct(linesCovered,      linesTotal),
    }
  };
}

function sumCounts(sum, fileCounts) {
  const out = { ...sum };
  for (const k of ["statements", "branches", "functions", "lines"]) {
    out[k] = out[k] || { covered: 0, total: 0 };
    out[k].covered += fileCounts[k].covered;
    out[k].total   += fileCounts[k].total;
  }
  return out;
}

function pctFromCounts(counts) {
  return {
    statements: pct(counts.statements.covered, counts.statements.total),
    branches:   pct(counts.branches.covered,   counts.branches.total),
    functions:  pct(counts.functions.covered,  counts.functions.total),
    lines:      pct(counts.lines.covered,      counts.lines.total),
  };
}

/** Try to resolve a per-file floor key against the discovered coverage file keys. */
function resolveFileKey(wantedKey, availableKeys) {
  // exact first
  if (availableKeys.has(wantedKey)) return wantedKey;

  // case-insensitive exact
  const exactCI = [...availableKeys].find(k => k.toLowerCase() === wantedKey.toLowerCase());
  if (exactCI) return exactCI;

  // endsWith by filename
  const wantedFile = wantedKey.split("/").pop();
  const ends = [...availableKeys].filter(k => k.toLowerCase().endsWith(("/" + wantedFile).toLowerCase()));
  if (ends.length === 1) return ends[0];

  // endsWith by contracts/<file>
  const endsContract = [...availableKeys].filter(k => k.toLowerCase().endsWith(wantedKey.toLowerCase()));
  if (endsContract.length === 1) return endsContract[0];

  return null;
}

function table(rows) {
  // simple console table
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      const w = String(cell).length;
      widths[i] = Math.max(widths[i] || 0, w);
    });
  }
  for (const row of rows) {
    const line = row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
    console.log(line);
  }
}

(function main() {
  const cov = readCoverageJSON();
  const files = collectContractFiles(cov);
  const fileKeys = new Set(Object.keys(files));

  if (fileKeys.size === 0) {
    console.error("❌ No Solidity coverage entries found under /contracts. Did coverage run succeed?");
    process.exit(2);
  }

  // per-file metrics cache
  const perFileMetrics = {};
  let aggCounts = {};
  for (const k of fileKeys) {
    const m = metricsForFile(files[k]);
    perFileMetrics[k] = m;
    aggCounts = sumCounts(aggCounts, m.counts);
  }
  const globalPct = pctFromCounts(aggCounts);

  console.log("\n================ COVERAGE CHECK ================");

  // Global
  console.log("Global:");
  table([
    ["metric",     "pct",                 "floor"],
    ["statements", `${globalPct.statements.toFixed(2)}%`, `${FLOORS_GLOBAL.statements}%`],
    ["branches",   `${globalPct.branches.toFixed(2)}%`,   `${FLOORS_GLOBAL.branches}%`],
    ["functions",  `${globalPct.functions.toFixed(2)}%`,  `${FLOORS_GLOBAL.functions}%`],
    ["lines",      `${globalPct.lines.toFixed(2)}%`,      `${FLOORS_GLOBAL.lines}%`],
  ]);

  let failed = false;
  for (const k of Object.keys(FLOORS_GLOBAL)) {
    if (globalPct[k] < FLOORS_GLOBAL[k]) {
      console.error(`❌ Global ${k} ${globalPct[k].toFixed(2)}% < floor ${FLOORS_GLOBAL[k]}%`);
      failed = true;
    }
  }

  // Per-file floors
  const missing = [];
  const perFileRows = [["file", "metric", "pct", "floor", "ok?"]];
  for (const wanted of Object.keys(FLOORS_PER_FILE)) {
    const resolved = resolveFileKey(wanted, fileKeys);
    if (!resolved) {
      missing.push(wanted);
      continue;
    }
    const actualPct = perFileMetrics[resolved].pct;
    const floors = FLOORS_PER_FILE[wanted];
    for (const k of ["statements", "branches", "functions", "lines"]) {
      const ok = actualPct[k] >= floors[k];
      perFileRows.push([
        wanted,
        k,
        `${actualPct[k].toFixed(2)}%`,
        `${floors[k]}%`,
        ok ? "✅" : "❌"
      ]);
      if (!ok) failed = true;
    }
  }

  console.log("\nPer-file floors:");
  table(perFileRows);

  if (missing.length) {
    for (const m of missing) {
      console.warn(`(warn) file floor set but not found in coverage: ${m}`);
    }
  }

  if (failed) {
    console.error("\n❌ Coverage floors failed.");
    process.exit(1);
  } else {
    console.log("\n✅ Coverage floors met.");
    process.exit(0);
  }
})();
