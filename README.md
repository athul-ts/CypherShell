<p align="center">
  <img src="build/icon.png" alt="CypherShell" width="128" />
</p>

<h1 align="center">CypherShell</h1>

<p align="center">
  <strong>A polished, secure, cross-platform SSH desktop client built with Electron, React, and TypeScript.</strong><br/>
  A powerful GUI alternative to PuTTY and MobaXterm — with built-in SFTP, key management, port forwarding, and encryption at rest.
</p>

<p align="center">
  <a href="https://github.com/athul-ts/CypherShell/releases"><img src="https://img.shields.io/github/v/release/athul-ts/CypherShell?style=flat-square&color=10b981" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/athul-ts/CypherShell?style=flat-square&color=6366f1" alt="License" /></a>
  <a href="https://github.com/athul-ts/CypherShell/stargazers"><img src="https://img.shields.io/github/stars/athul-ts/CypherShell?style=flat-square&color=f59e0b" alt="Stars" /></a>
  <a href="https://cyphershell.in"><img src="https://img.shields.io/badge/website-cyphershell.in-0ea5e9?style=flat-square" alt="Website" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-8b5cf6?style=flat-square" alt="Platform" />
</p>

---

## 📸 Screenshots

<!-- Replace the placeholders below with actual screenshots of CypherShell -->

<p align="center">
  <em>🖼️ Add a screenshot of the Home / Dashboard view here</em><br/>
  <!-- <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="800" /> -->
</p>

<p align="center">
  <em>🖼️ Add a screenshot of the Terminal session view here</em><br/>
  <!-- <img src="docs/screenshots/terminal.png" alt="Terminal" width="800" /> -->
</p>

<p align="center">
  <em>🖼️ Add a screenshot of the SFTP file manager here</em><br/>
  <!-- <img src="docs/screenshots/sftp.png" alt="SFTP" width="800" /> -->
</p>

> **Tip:** Place your screenshots in a `docs/screenshots/` directory and uncomment the `<img>` tags above.

---

## ✨ Features

### 🖥️ Multi-Tab Dashboard
A persistent **Home** tab for profile management, SSH keys, audit logs, and settings — with support for opening multiple concurrent profile detail views in separate tabs.

### 🪟 Standalone Connection Windows
Spawn independent, borderless, lightweight windows for interactive **Terminal** sessions and **SFTP** file explorers. Run multiple sessions side-by-side or across different monitors.

### 🔑 SSH Key Manager
Generate **RSA** or **ED25519** keypairs, or import existing PEM/OpenSSH keys. All private keys are **AES-256-GCM** encrypted at rest — never stored in plaintext.

### 📁 SFTP File Manager
Browse, upload, download, rename, delete, and `chmod` remote files with **real-time transfer progress** tracking.

### 🚇 Inline Port Forwarding
Configure, start, and monitor **local** and **remote** SSH port-forwarding tunnels directly inside the active profile tab — no separate tools needed.

### 📋 Audit Logs
Every connection, upload, and download is recorded with timestamps, durations, and status. Easily **export logs as CSV** for compliance or review.

### 🔒 App Lock
Optional master password protects all configuration and credentials. Encryption keys are derived via **PBKDF2-SHA512 (200k iterations)** and never written to disk.

### 🎨 Terminal Themes
Fully customizable terminals with **6 curated themes**: Default Dark, Dracula, Nord, Solarized Dark, Monokai, and One Dark.

### 🔐 Seamless Auth Propagation
Standalone session windows securely inherit JWT tokens from the main process, completely **bypassing the Lock Screen** for a frictionless workflow.

### 🔄 Auto-Updater
Silently checks for updates and notifies you when a new version is ready to install.

---


## 🚀 Getting Started

### Prerequisites

- **Node.js** 20 or later
- **npm** 9 or later
- **Git**

### 1. Clone the Repository

```bash
git clone https://github.com/athul-ts/CypherShell.git
cd CypherShell
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Install Backend Dependencies

```bash
cd backend
npm install
npx prisma migrate dev --name init
cd ..
```

### 4. Start in Development Mode

```bash
npm run dev
```

The app will launch with **hot-reload** for the renderer. The backend starts automatically on an ephemeral local port.

---

## 📦 Building for Production

| Platform | Command | Output |
|----------|---------|--------|
| **Windows** (NSIS) | `npm run build:win` | `.exe` installer |
| **macOS** (DMG) | `npm run build:mac` | `.dmg` disk image |
| **Linux** (AppImage + deb) | `npm run build:linux` | `.AppImage` & `.deb` |

All artifacts appear in the `dist/` directory.

> **Note:** During the production build, native modules (such as `better-sqlite3`) are automatically compiled against the target Electron ABI via the build pipeline staging hook.

---

## 📁 Project Structure

```
CypherShell/
├── src/
│   ├── main/                  # Electron main process (window manager, IPC, backend lifecycle)
│   ├── preload/               # Context bridge (secure IPC API surface)
│   └── renderer/src/          # React application
│       ├── components/
│       │   ├── terminal/      # TerminalPane, TabBar, TunnelModal
│       │   ├── sftp/          # SftpPane, LocalFilePane
│       │   ├── profiles/      # ProfileDetailPane, ProfileForm
│       │   ├── keys/          # SSH key management UI
│       │   └── layout/        # App shell, sidebar, navigation
│       ├── pages/             # Home, Settings, Keys, Logs, LockScreen, SetupWizard
│       ├── store/             # Zustand stores (tabs, themes, transfers)
│       ├── hooks/             # Custom React hooks (useSFTPTransfer, etc.)
│       └── lib/               # API client, terminal themes, utilities
│
├── backend/
│   ├── src/
│   │   ├── controllers/       # Request handlers
│   │   ├── services/          # SSH, SFTP, crypto, tunnel, audit, key services
│   │   ├── routes/            # Express route definitions
│   │   ├── middleware/        # Auth, rate limiting
│   │   ├── websocket/         # WebSocket handlers (terminal I/O)
│   │   └── config/            # App configuration
│   └── prisma/
│       └── schema.prisma      # Database schema (Profile, SSHKey, Tunnel, AuditLog, AppConfig)
│
├── build/                     # electron-builder resources (icons, installer scripts)
├── resources/                 # App icon assets
├── scripts/                   # Build helper scripts (native module rebuild, after-pack)
├── electron-builder.yml       # electron-builder configuration
└── electron.vite.config.ts    # Vite config for Electron
```

---

## 🔐 Security

CypherShell is designed with **defense-in-depth** — sensitive data is encrypted at every layer:

| What | How |
|------|-----|
| SSH passwords & private keys | **AES-256-GCM** encrypted before storage in SQLite |
| Master password | Hashed with **bcrypt (cost 12)** — never stored in plaintext |
| Encryption key derivation | **PBKDF2-SHA512** with 200,000 iterations; key held only in-memory |
| Backend access | Express bound to **`127.0.0.1`** — not externally reachable |
| Rate limiting | 5 auth attempts/min · 300 API requests/min |
| Session tokens | **JWT** with 8-hour expiration |
| Auto-lock | Configurable inactivity timeout (default: 15 minutes) |

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feature/my-awesome-feature
   ```
3. **Commit** your changes with a descriptive message:
   ```bash
   git commit -m "feat: add awesome feature"
   ```
4. **Push** to your fork and open a **Pull Request**

### Development Tips

- Run `npm run lint` to check for code style issues
- Run `npm run format` to auto-format with Prettier
- Run `npm run typecheck` to verify TypeScript types across all targets

Please open an [issue](https://github.com/athul-ts/CypherShell/issues) first for major changes so we can discuss the approach.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Athul T S**

- 🌐 Website: [cyphershell.in](https://cyphershell.in)
- 🐙 GitHub: [@athul-ts](https://github.com/athul-ts)

---

<p align="center">
  <sub>If you find CypherShell useful, consider giving it a ⭐ on GitHub — it helps others discover the project!</sub>
</p>
