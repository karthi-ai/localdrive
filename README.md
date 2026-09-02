# O2K Cloud Drive

Regional office drive for Pune, NCR, Kerala, Chennai, Bangalore and Hyderabad. Each region has its own workspace, files, folders and members.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`

Production build:

```bash
npm run build
set NODE_ENV=production
npm start
```

## What this version can do

- Sign in to a regional workspace
- Nested folders with breadcrumbs
- Multi-file upload and drag-and-drop
- Download, trash, restore and permanent delete
- Search inside a region
- Session restore after refresh
- 10 GB storage quota per region (200 MB per file)

## Default regional credentials

Change these before any real office use.

| Region | Email | Password |
|--------|-------|----------|
| Pune | pune@o2k.local | Pune@2026 |
| NCR | ncr@o2k.local | NCR@2026 |
| Kerala | kerala@o2k.local | Kerala@2026 |
| Chennai | chennai@o2k.local | Chennai@2026 |
| Bangalore | bangalore@o2k.local | Bangalore@2026 |
| Hyderabad | hyderabad@o2k.local | Hyderabad@2026 |
| Admin | admin@o2k.local | O2K@2026 |

## Data location

- Files: `data/uploads/`
- Metadata: `data/o2k-drive.json`

Back up both folders regularly. This is still a single-server office drive, not a public cloud product.

## Next upgrades for production

1. Put the app behind HTTPS on the office network or VPN
2. Replace JSON storage with SQLite or Postgres
3. Turn off default passwords and create one account per person
4. Add daily backups of `data/`
5. If you outgrow this server, move uploads to S3 / Azure Blob
