# Glassware Proxmox Console

A beautiful, modern, "glassware-style" web console for Proxmox Virtual Environment (PVE). This application replaces the default, utilitarian Proxmox interface with a stunning, responsive dashboard that gives you stats and information about your nodes and virtual machines at a glance.

## Features

- **Beautiful Glassmorphism UI**: Dynamic, vibrant, and visually pleasing interface.
- **Real-time Node & VM Stats**: Quickly view CPU, memory, and status of your Proxmox nodes and virtual machines.
- **Flexible Authentication**: Supports standard username/password login as well as Proxmox API Tokens (`User@Realm!TokenID`).
- **Responsive Design**: Works seamlessly on both desktop and mobile devices.

## Tech Stack

- **Backend**: Python 3, FastAPI, Uvicorn, Proxmoxer
- **Frontend**: HTML5, Vanilla JS, CSS with a modern Glassmorphism design system

## Installation & Setup

1. **Clone the repository** (or download the files):
   ```bash
   git clone <repository-url>
   cd test_app
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
   Or using Uvicorn directly:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

4. **Access the Console**:
   Open your browser and navigate to `http://localhost:8000`.

## Logging In

When logging into the console, you have two options for the username:
- **Standard User**: `user@pam` or `user@pve`
- **API Token**: `user@pam!token_name` (with the token secret as the password)

If your Proxmox server is using a self-signed certificate (which is the default in many home labs), make sure to check the "Skip SSL Verification" box on the login screen.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
