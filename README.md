# ProxGlass

A beautiful, modern, "glassware-style" web console for Proxmox Virtual Environment (PVE). This application replaces the default, utilitarian Proxmox interface with a stunning, responsive dashboard that gives you stats and information about your nodes and virtual machines at a glance.

## Features

- **Beautiful Glassmorphism UI**: Dynamic, vibrant, and visually pleasing interface.
- **Multi-User & Role-based Access (RBAC)**: Support for multiple local users with "Admin" and "User" roles.
- **Secure Credential Storage**: Proxmox passwords and API tokens are encrypted at rest using AES-256 (Fernet).
- **Admin Management Console**: Administrators can manage access for other cluster operators.
- **Real-time Node & VM Stats**: Quickly view CPU, memory, and status of your Proxmox nodes and virtual machines.
- **Flexible Connectivity**: Supports standard username/password login as well as Proxmox API Tokens (`User@Realm!TokenID`).
- **Security Protections**: Built-in login rate limiting (lockout), security headers (HSTS, CSP-ready), and session timeout.

## Tech Stack

- **Backend**: Python 3.10+, FastAPI, Uvicorn, Proxmoxer
- **Security**: Bcrypt (Password Hashing), Cryptography (AES Encryption)
- **Frontend**: HTML5, Vanilla JS, Tailwind CSS, Phosphor Icons
- **Database**: SQLite (No external database required)

## Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/rindawork/ProxGlass.git
   cd ProxGlass
   ```

2. **Install Dependencies**:
   It's recommended to use a virtual environment.
   ```bash
   # Create virtual environment
   python -m venv venv
   
   # Activate it
   # On Windows:
   venv\Scripts\activate
   # On Linux/macOS:
   source venv/bin/activate
   
   # Install requirements
   pip install -r requirements.txt
   ```

3. **Run the Application**:
   ```bash
   python main.py
   ```
   *Note: On first run, ProxGlass will automatically generate an `app.db` file and a `secret.key` file for encryption.*

4. **Access the Console**:
   Open your browser and navigate to `http://localhost:9000`.

## Initial Configuration

### 1. Master Admin Login
ProxGlass comes with a default master admin account:
- **Username**: `admin`
- **Password**: `admin`

> [!IMPORTANT]
> **Change your password immediately** after your first login via the **Settings** menu to secure your installation.

### 2. Encryption Key (`secret.key`)
ProxGlass uses AES-256 encryption to protect your Proxmox credentials. This requires a secret key.

- **Auto-Generation**: If the file does not exist, ProxGlass will automatically generate a `secret.key` file in the root directory on first startup.
- **Manual Generation**: If you want to generate it manually (e.g., for production setups), you can run:
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" > secret.key
  ```
- **Security**: The `secret.key` is automatically ignored by Git (via `.gitignore`). **You must back up this file manually.** If you lose it, you will not be able to decrypt your stored Proxmox passwords in the database.

### 3. Environment Variables
You can customize ProxGlass behavior using the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PROXGLASS_PORT` | Port to run the server on. | `9000` |
| `PROXGLASS_DB_FILE` | Path to the SQLite database file. | `app.db` |
| `PROXGLASS_SECRET_KEY` | AES Key for credential encryption. If not set, it is read from/saved to `secret.key`. | *Generated* |
| `PROXGLASS_DEBUG` | Enable debug mode (auto-reload backend). | `0` |

### 3. Adding Proxmox Servers
Once logged in, go to the **Servers** tab to connect your Proxmox instances. You can use standard credentials or API tokens. If your PVE server uses a self-signed certificate, ensure "Strictly Verify SSL Certificate" is **unchecked**.

## Security Notes

- **Password Lockout**: After 5 failed login attempts, the account will be locked for 5 minutes.
- **Data Safety**: All Proxmox credentials are encrypted. Ensure you back up your `secret.key` file if you plan to move your `app.db`, otherwise you will lose access to your stored server settings.
- **HTTPS**: It is highly recommended to run ProxGlass behind a reverse proxy (like Nginx or Caddy) to provide HTTPS encryption.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
