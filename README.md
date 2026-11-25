# LuxDBDiag: LuxForge Database Diagrams built on ChartDB

LuxDBDiag (in full, **LuxForge Database Diagrams built on ChartDB**; in the app header, **LuxForge
DB diagrams**) is LuxForge Ltd's fork of [ChartDB](https://github.com/chartdb/chartdb). It exists to
produce and maintain LuxForge's own database schemas, such as the Grassroots Admin Portal schema,
as DBML. It is not a general-purpose product, and it follows LuxForge's needs rather than ChartDB's
roadmap.

The repository is `LuxForge-ltd/LuxDBDiagram`.

## What it adds to ChartDB

It keeps ChartDB's editor, canvas, DBML and SQL import and export, and relationships. On top of that,
one canonical schema can be shown in several ways:

- **Areas:** named, coloured views over the one schema, each with its own tables and layout.
- **Dupes:** the same table shown in several Areas, numbered so you can move between its copies.
- **Floats:** compact cards for relationships that cross an Area boundary, with crow's-foot ends.
  An Area shows outgoing Floats by default, or all of them.
- **Enhanced DBML:** `Area` blocks, multi-file import, and both a standard and an enhanced export.

The design, the enhanced DBML syntax and the known limitations are described in
[docs/luxdbdiagram/architecture.md](docs/luxdbdiagram/architecture.md).

## Using it

The hosted copy is at **https://luxdbdiagram.luxforge.dev**, behind Cloudflare Access for LuxForge
only. How it is built and deployed is described in
[docs/luxdbdiagram/deployment.md](docs/luxdbdiagram/deployment.md).

1. Create a diagram and choose **DBML** import.
2. Paste DBML, or use **Open files…** to load several `.dbml` files at once, for example a schema
   file and a file of `Area` blocks. **Open folder…** opens a whole folder of `.dbml` files:
   - each ticked file becomes an Area named after the file;
   - click a file to view or edit it in the editor before importing;
   - files that look like combined copies of the others start unticked.
3. Use the Area tabs above the canvas and the **Areas** panel in the sidebar.
4. Export with **Actions → Export as**, choosing either **DBML** (schema only) or **LuxDBDiagram DBML
   (with Areas)**.

Diagrams are saved in the browser you use. Export them as JSON or DBML to keep or move them.

**A diagram as files.** **Actions → Export as → LuxDBDiag files (one per Area)…** saves the diagram
as a folder of DBML files:
- one file per Area, holding every table that Area shows, so a table shown by two Areas is written
  in both files;
- `unassigned.dbml` for tables in no Area;
- `luxdbdiag.areas.dbml` for the Areas' colours and layout.

Edge and Chrome write straight into a folder you pick, such as your clone of a schema repository.
Other browsers download the files instead. Opening the folder again with **Open folder…** brings the
diagram back.

The DBML panel's **Show** picker displays any one of these files. The files are written by the DBML
exporter, so `//` comments are not kept.

**Settings → Accent colour** changes the accent from the default purple to one of ten colours,
including ChartDB's original pink. The choice is saved in your browser.

## Running and testing locally

Requires Node.js 24 (see `.nvmrc`). No database or backend is needed. The optional GitHub service
in `services/github/`, which lets the hosted copy open and commit to GitHub repositories, is only
needed for that.

```bash
npm ci            # install the exact dependency versions
npm run dev       # start the editor at http://localhost:5173
npx vitest run    # unit tests
npm run build     # lint, type-check and production build
```

The Grassroots Admin Portal (GAP) schema tests run only when `LUXDB_GAP_SCHEMA_DIR` points at
GAP's `docs/architecture/schema` folder. The schema is not stored in this repository.

```bash
LUXDB_GAP_SCHEMA_DIR="/path/to/Grassroots Admin Portal/docs/architecture/schema" npx vitest run src/lib/areas
```

To build the Docker image, run `docker build -t luxdbdiagram .`. The image turns off ChartDB's
analytics and ChartDB Cloud prompts by default. Never pass an OpenAI key to the build: the app would
hand it to every visitor. The GitHub service has its own image:
`docker build -t luxdbdiagram-github -f services/github/Dockerfile services/github`.

## Working on it

- Changes go through pull requests into `Dev`. The agent rules are in [AGENTS.md](AGENTS.md), and
  the approved work and its history are in [PHASES.md](PHASES.md).
- LuxDBDiag logic lives in its own modules (`src/lib/areas/`, `src/context/area-view-context/` and
  the Areas canvas and side-panel folders). Edits to ChartDB's own files are kept thin, so ChartDB
  changes can still be merged from the `upstream` remote (`chartdb/chartdb`).
- GitHub Actions are not used. Checks run on LuxForge's own devices.

## Licence and credit

LuxDBDiag is a modified version of ChartDB, which is licensed under the
[GNU Affero General Public License v3.0](LICENSE). Copyright in ChartDB remains with its authors.
LuxForge Ltd's modifications are released under the same licence, and the source of the running
version is offered through the GitHub button in the app's header.

ChartDB is © its contributors: https://github.com/chartdb/chartdb.
