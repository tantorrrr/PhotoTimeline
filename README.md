<div align="center">

# PhotoTimeline

**A lightweight Windows photo viewer that turns your scattered folders into a single Google-Photos-style timeline.**

Import any folders you want, keep your originals exactly where they are, and browse everything by capture date in one place.

[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=000)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Tests](https://img.shields.io/badge/tests-31%20passing-3fb950)](#)

</div>

---

## What it does

- **Import many folders, keep files in place.** Originals never move. The app only stores an index.
- **One unified timeline.** Day-grouped grid with a sticky month header, virtualized so 50k photos still scroll at 60fps.
- **Smart capture date.** Reads EXIF, but also parses dates out of filenames (iPhone, Pixel, Samsung, WhatsApp, screenshots, generic patterns). When the filename is older than EXIF, the filename wins - useful for files that were edited or converted and had EXIF rewritten.
- **NEF / RAW support.** Nikon `.nef` files render via their embedded JPEG preview, no debayer needed.
- **Drop multiple folders at once.** Native Windows folder dialog only allows one; drag-drop lets you import many in one go.
- **Lightroom-style viewer.** Wheel zoom-at-cursor (1x to 8x), drag to pan, arrow keys to navigate, Esc to close.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron 33 | Native dialogs, custom protocols, Windows install via NSIS |
| UI | React 18 + Vite | Fast HMR, small bundles |
| Index | better-sqlite3 (WAL) | Synchronous, fast, zero-config |
| EXIF | exifr | Streaming reader, also opens NEF |
| Thumbnails | sharp (libvips) | Native, multithreaded |
| Virtualization | @tanstack/react-virtual | Variable-height day groups |

## Quickstart

```bash
git clone https://github.com/tantorrrr/PhotoTimeline.git
cd PhotoTimeline
npm install
npm run dev          # hot reload + DevTools
```

Other scripts:

```bash
npm run build        # production bundle
npm start            # run the built app
npm test             # vitest (31 tests)
npm run package      # NSIS installer for Windows
```

> Note: on Vietnam-region networks the Electron binary can be flaky to fetch from GitHub. The included `.npmrc` redirects to a faster mirror.

## How it works

```
   walk()                  metadata pool                 thumb pool
folders -> files  ->  exifr + filename parse  ->  sharp resize -> .jpg cache
                              |                          |
                              v                          v
                          SQLite index <----- thumb_status flips to 'ready'
                              |
                              v
                       virtualized timeline (renderer)
```

The two pools run as a pipeline: each row is committed to SQLite the moment EXIF + date resolution finish, and a thumbnail job is enqueued without waiting for the rest of the folder. Cache hits (existing thumbnail file on disk) skip sharp entirely, so re-imports of unchanged folders complete in seconds.

## The smart-date rule

For each image:

```
filename_date  exif_date    -> picked
   set           set        -> EXIF, unless filename is more than 1 day older
   set           none       -> filename
   none          set        -> EXIF
   none          none       -> file mtime
```

Patterns recognised in filenames: `IMG_YYYYMMDD_HHMMSS`, `PXL_YYYYMMDD_HHMMSS`, `IMG-YYYYMMDD-WANNNN`, `Screenshot_YYYY-MM-DD-HH-MM-SS`, `YYYYMMDD_HHMMSS`, ISO `YYYY-MM-DD_HH-MM-SS`, and a generic 8-digit fallback validated against `1990 <= year <= currentYear+1`.

## Folder import semantics

| Situation | Behaviour |
|---|---|
| Path you already imported | duplicate, ignored |
| Different case or trailing separator of an imported path | duplicate, ignored |
| Sub-folder of an imported folder | absorbed, ignored (parent already covers it) |
| Parent of one or more imported folders | subsumes them, then re-indexes everything under one folder_id |

A toast tells you which case fired. Symlinks and junctions that loop back into the tree are short-circuited via `fs.realpath` + a visited set.

## Layout

```
electron/      main process - DB, scanner, IPC, custom protocols
src/           renderer - React UI, hooks, components
out/           build output (gitignored)
```

## Status

Early but functional. Built in a single afternoon for personal use. Tested on Windows 11 with folders of ~10k JPG/PNG/NEF mixed.

## License

No license declared yet. If you intend to use this beyond reading the source, please open an issue.
