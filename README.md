# Drive — a Google Drive clone

A minimal, self-hosted file storage app inspired by Google Drive, with real
user authentication. Sign up, upload files, organize them into folders, star
favorites, search, and download — each account sees only its own files.

## Features

- **User authentication** — register / login / logout with hashed passwords
  (bcrypt) and signed JWT sessions stored in an httpOnly cookie.
- **File storage** — upload (button or drag-and-drop), download, inline preview,
  rename, and delete files. Uploads are size-limited and stored on disk.
- **Folders** — nested folders with breadcrumb navigation; deleting a folder
  cascades to its contents (in the database and on disk).
- **Starred & search** — mark files as favorites and search across all files.
- **Per-user isolation** — every query is scoped to the authenticated user, so
  one account can never read, download, or modify another's files.
- **Storage meter** — shows total space used by your files.

## Tech stack

| Layer     | Choice                                             |
| --------- | -------------------------------------------------- |
| Runtime   | Node.js + Express                                  |
| Database  | SQLite (`better-sqlite3`)                           |
| Auth      | `bcryptjs` password hashing, `jsonwebtoken` sessions |
| Uploads   | `multer` (disk storage)                            |
| Frontend  | Vanilla HTML / CSS / JS (no build step)            |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. (optional) configure environment
cp .env.example .env
#    then set a strong JWT_SECRET

# 3. Run
npm start          # or: npm run dev  (auto-restart on changes)
```

Open <http://localhost:3000>. You'll be redirected to the sign-in page where you
can create an account.

## Configuration

All settings are read from environment variables (see `.env.example`):

| Variable           | Default        | Description                          |
| ------------------ | -------------- | ------------------------------------ |
| `PORT`             | `3000`         | HTTP port                            |
| `JWT_SECRET`       | *(dev value)*  | Secret used to sign session tokens   |
| `DB_PATH`          | `./data.db`    | SQLite database file                 |
| `UPLOAD_DIR`       | `./uploads`    | Where uploaded files are stored      |
| `MAX_UPLOAD_BYTES` | `52428800`     | Max upload size (50 MB)              |

> **Set a strong `JWT_SECRET` in production.** The default is for local dev only.

## API overview

All `/api/files` and `/api/folders` routes require authentication (cookie or
`Authorization: Bearer <token>`).

### Auth
| Method | Path                  | Description                |
| ------ | --------------------- | -------------------------- |
| POST   | `/api/auth/register`  | Create an account          |
| POST   | `/api/auth/login`     | Sign in                    |
| POST   | `/api/auth/logout`    | Sign out                   |
| GET    | `/api/auth/me`        | Current user               |

### Folders
| Method | Path                            | Description               |
| ------ | ------------------------------- | ------------------------- |
| GET    | `/api/folders?parent_id=`       | List folders in a parent  |
| GET    | `/api/folders/:id/breadcrumb`   | Ancestor chain            |
| POST   | `/api/folders`                  | Create a folder           |
| PATCH  | `/api/folders/:id`              | Rename a folder           |
| DELETE | `/api/folders/:id`              | Delete (cascades)         |

### Files
| Method | Path                        | Description                          |
| ------ | --------------------------- | ------------------------------------ |
| GET    | `/api/files?folder_id=`     | List files (also `?starred=1`, `?q=`) |
| POST   | `/api/files`                | Upload (multipart: `file`, `folder_id?`) |
| GET    | `/api/files/:id/download`   | Download                             |
| GET    | `/api/files/:id/raw`        | Inline preview                       |
| PATCH  | `/api/files/:id`            | Rename / move / star                 |
| DELETE | `/api/files/:id`            | Delete                               |
| GET    | `/api/files/storage`        | Total bytes used                     |

## Testing

```bash
npm test
```

The suite (Node's built-in test runner) covers registration, duplicate/invalid
login, unauthenticated access, folder and file CRUD, and cross-user isolation.

## Project structure

```
server.js              Express app & middleware
src/
  config.js            Environment configuration
  db.js                SQLite schema & connection
  auth.js              Password hashing, JWT, auth middleware
  routes/
    auth.js            Register / login / logout / me
    folders.js         Folder CRUD + breadcrumb
    files.js           Upload / download / CRUD
public/                Static frontend (login + drive UI)
test/api.test.js       Integration tests
```

## Notes & limitations

This is a learning/demo project, not production-hardened storage. Notably it has
no rate limiting, no email verification, no file deduplication or virus
scanning, and files are stored unencrypted on the local disk. Add those before
using it for anything real.

## License

MIT — see [LICENSE](LICENSE).
