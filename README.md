# Artifact Vault

**English** · [简体中文](README.zh.md)

Workspace files accumulate in one flat directory as sessions pile up, and nothing records which session produced which file. Artifact Vault replays each session's own event log to attribute files to the session that wrote them, groups same-named files into versioned artifacts, and gives each session its own workspace folder with separate `tools/` and `artifacts/` compartments.

## Where it appears

**Settings (gear icon, bottom left) → Artifact Vault** in the settings navigation. The page has four tabs: Sessions / Untracked / Storage / Duplicates.

## How attribution works

The plugin reads the `tool/call` events in every session log and extracts the file paths each call wrote — `write`, `edit`, `apply_patch`, and files declared through `present`. Consequences:

- sessions that ran before the plugin was installed are indexed too;
- only paths a tool actually wrote are recorded;
- subagent sessions merge into the parent conversation;
- titles come from the session's durable `session/title` record, falling back to its first user message — never a bare session id.

Re-reads are incremental: a session log is re-parsed only when its persistence revision changes.

## Per-session workspaces

Each session can work inside its own folder:

```
<project>/sessions/20261118-a1b2c3d4/
├── tools/       throwaway scripts, probes, one-off commands
└── artifacts/   deliverables: documents, sheets, decks, images, data, archives
```

The folder name is the creation date plus an 8-character id derived from the session id. The id is stable, uses only unambiguous characters (no `0/o/1/l/i`), and is shown in the panel next to every session, so a folder can be found from the id and vice versa. A prompt rule tells the model where each kind of file belongs, and the working directory is switched automatically for sessions created after activation; older sessions opt in from the panel.

## Tabs

| Tab | What it shows |
| --- | --- |
| **Sessions** | One row per session: real title, short id, artifact count, bytes, last activity. Opening a session shows its workspace folder, per-compartment counts, and artifacts grouped by version (`v1`, `v2`, …). Groups are collapsed until clicked. |
| **Untracked** | Files no session ever wrote, grouped by folder. Each folder is a collapsible box with a whole-folder delete, and expanded rows have checkboxes for batch delete. |
| **Storage** | Cleanup priority cards (tool scripts → artifacts → loose files), per-session usage ranking, the recycle bin, and the C-drive planner. |
| **Duplicates** | Byte-identical files found by size then SHA-256, with the sessions each one came from. |

## Versions and status

`report`, `report_v2`, and `report-最终版` in one directory collapse into a single group numbered by first write. Each version carries status:

- **declared** — delivered through `present` (or labeled by hand);
- **inferred** — the path came from a shell redirect or `cp`, so it may be an intermediate file;
- **edited later** — the file changed after the session's last write;
- **missing** — the recorded file no longer exists.

## Managing files

- **Copy path**, **copy folder path**, **download**;
- **Recycle** — the bytes move to a same-drive staging folder, so a large file moves with one instant rename and needs no free space on the home volume. The manifest stays in `<DSH_HOME>/artifact-vault/index.json`. A cross-drive copy used to fail with `ENOSPC` when an 8 GB artifact on `D:` was recycled into a nearly-full `C:` home;
- **Delete folder** — a whole untracked folder is recycled as one entry and restored as one unit;
- **Batch delete** — tick rows in the untracked view and recycle them in one request; a failing path is reported without aborting the batch;
- **Clean by compartment** — `tools/`, `artifacts/`, or loose files, per session or across all sessions;
- **Restore / delete forever / empty the bin**.

Cleanup order is tool scripts first, deliverables second. Cleaning only moves files; it never deletes session memory. A session's whole workspace folder moves to the recycle bin only when that session no longer exists in any session record and its log is gone — and the move is reversible.

## Sorting

Sessions, per-session usage, artifact versions, and the recycle bin all sort by size, modified time, name, or session usage, ascending or descending.

## The agent tool

`artifact_declare` lets the model register a deliverable:

```json
{ "path": "artifacts/proposal.docx", "label": "client edition", "note": "includes pricing" }
```

Declared artifacts appear with the **declared** status instead of being guessed from paths.

## Why the C drive fills up

DSH is installed on `D:`, but its data directory (`~/.dsh`) lives on `C:`. Session logs, plugin caches, and projection caches accumulate there as sessions and plugins multiply. The Storage tab shows a live breakdown and a **conservative clean plan**:

| Source | Measured on this machine | Cleanable |
| --- | --- | --- |
| `~/.dsh/plugins/<plugin>/cache/` | 838 MB of downloaded archives | yes — re-downloadable |
| `~/.dsh/sessions/<project>/<session>/session.v4.jsonl.zstd` | 46 MB across 24 files | only logs of sessions that no longer exist |
| `~/.dsh/storages/session_projcache/` | 6.7 MB of derived cache | rebuildable, small gain |
| `~/.dsh/profiles/*/node_modules/` | 370 MB of installed plugins | no — removing breaks plugins |

The plan lists exactly what it would delete and how much it would free; you tick entries and confirm. It never touches workspace artifacts, tool scripts, or live session logs. Cleaning is not reversible, which is why every entry is previewed first.

## Configuration

These keys go in the bundle's patch row `config`:

| Key | Default | Meaning |
| --- | --- | --- |
| `sessionFolders` | `true` | One workspace folder per session; `false` keeps a single flat directory |
| `sessionsDirName` | `sessions` | Parent directory for session workspaces |
| `toolsDirName` | `tools` | Tool-script subdirectory |
| `artifactsDirName` | `artifacts` | Deliverable subdirectory |
| `sessionFolderRoot` | `""` | Where workspaces are created; empty uses each session's original directory |
| `autoAdoptSessions` | `true` | New sessions switch into their own workspace automatically |
| `adoptSessionsCreatedAfter` | `0` | Floor for automatic adoption in ms; `0` means "this activation", so only sessions created afterwards move automatically |
| `skipSessionIds` | `[]` | Sessions that never get a workspace |
| `keepBaseWritable` | `true` | Keep the project root writable after switching |
| `promptRule` | `true` | Inject the `tools/` `artifacts/` convention into the prompt |
| `trashOnSourceDrive` | `true` | Stage recycled bytes on the source drive; `false` returns to `<DSH_HOME>/artifact-vault/trash/` |
| `trashDirName` | `.dsh-artifact-vault-trash` | Same-drive staging directory name |
| `autoScan` | `true` | Background incremental indexing |
| `scanIntervalMinutes` | `10` | Rescan interval |
| `maxScanPerBatch` | `6` | Sessions read per scan request |
| `includeSubagents` | `true` | Merge subagent artifacts into the parent session |
| `roots` | `[]` | Extra scan roots; empty uses each session's working directory |
| `maxUntrackedDepth` | `4` | Directory depth for the untracked scan |
| `maxUntrackedFiles` | `6000` | File cap for the untracked scan |
| `ignoreDirs` | `node_modules`, `.git`, `.venv`, … | Directories the untracked scan does not descend into |

The index and recycle manifest live in `<DSH_HOME>/artifact-vault/` (default `~/.dsh/artifact-vault/`); deleting the JSON resets it.

## Tests

No dependencies; Node 22 is enough:

```bash
node test/logic.mjs          # filename normalization, version grouping, tool-call → path extraction
node test/client-smoke.mjs   # loader handshake, inject list, settings.section registration, style injection
node test/host-smoke.mjs     # scan, titles, workspace creation/adoption, compartment cleanup, recycle bin, dedupe, persistence
node test/features-smoke.mjs # folder recycle, sorted bin, C-drive plan, safe cache cleanup
```

## Platforms

Runs wherever DSH runs: **macOS, Windows and Linux**. The plugin is pure Node with builtins only, so there is no native module to rebuild per platform.

- **Path handling is platform-aware.** `pathKey` folds case only on Windows and preserves it elsewhere; every comparison goes through `node:path`, never string concatenation.
- **Recycling across volumes works everywhere.** A same-volume move is an instant `rename`; a cross-volume move gets `EXDEV` and falls back to copy+unlink — which is why `trashOnSourceDrive` exists.
- **Extra writable roots are honoured more completely on macOS than Windows.** The macOS Seatbelt profile turns `additionalWritableRoots` into `(allow file-write* (subpath …))`, so confined processes may write the project root too. On Windows only harness file tools honour the grant; process permissions are unchanged.
- **Filesystem bookkeeping is filtered.** `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.Spotlight-V100`, `.fseventsd`, `$RECYCLE.BIN` and similar entries never appear as untracked artifacts.

Two caveats worth knowing:

- **Case-insensitive filesystems.** macOS APFS is case-insensitive by default while `pathKey` preserves case off Windows, so `Report.md` and `report.md` count as two paths even though the disk sees one file. Windows is unaffected; name versions consistently if you rely on grouping.
- **The untracked scan skips symlinks.** A workspace reached only through a symlink (for example `/var` versus `/private/var` on macOS) is not descended into; attributed sessions are unaffected because their paths come from the session log.

The test suite is portable: `node test/logic.mjs` builds paths from a per-platform base and asserts the documented `pathKey` difference, so it passes on all three systems.

## Known limits

- Only files written **through a tool call** are discovered; files created by hand or by another editor land in Untracked.
- Attribution means "this session touched this path", not "this session authored the file"; when several sessions edit one file, all of them are listed.
- A session log must be readable; a corrupt log is reported as a read failure.
- "Session deleted" is inferred from "absent from the session list **and** its log is gone" — DSH has no deletion event. The workspace goes to the recycle bin rather than being erased, so a wrong inference is recoverable.
- Untracked groups by directory, not by file content.
- Every route listens on loopback only; the browser and the host communicate same-origin.
