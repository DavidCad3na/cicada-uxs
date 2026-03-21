# Windows Setup (WSL2)

## Prerequisites

- **Windows 11** (has WSLg built-in for Gazebo GUI) or **Windows 10 Build 19044+**
- ~15 GB free disk space
- 8+ GB RAM recommended

## Step 1: Install WSL2 with Ubuntu 22.04

Open **PowerShell as Administrator** and run:

```powershell
wsl --install -d Ubuntu-22.04
```

Restart your computer when prompted. After restart, Ubuntu will open and ask you to create a username and password.

If `wsl --install` fails, you may need to enable virtualization in your BIOS (usually called **VT-x** or **AMD-V**).

## Step 2: Update WSL (important for GPU support)

In PowerShell:

```powershell
wsl --update
```

## Step 3: Install the Hackathon Environment

Open the **Ubuntu** app from the Start menu, then run:

```bash
git clone https://github.com/Haxerus/voice-driven-uxs.git ~/uxs-hackathon
cd ~/uxs-hackathon
chmod +x install.sh launch_gz.sh launch_sitl.sh
./install.sh
```

This takes 15-20 minutes. It installs Gazebo Harmonic, ArduPilot SITL, the Gazebo plugin, and pymavlink.

If the install fails partway through, just run `./install.sh` again — it skips already-completed steps.

## Step 4: Run the Simulation

You need **three Ubuntu terminals**. To open multiple terminals, right-click the Ubuntu icon in the taskbar and select "Ubuntu" again, or use `Ctrl+Shift+T` if supported.

```bash
# Terminal 1 — Gazebo (3D world)
cd ~/uxs-hackathon && ./launch_gz.sh

# Terminal 2 — ArduPilot SITL (flight controller)
cd ~/uxs-hackathon && ./launch_sitl.sh

# Terminal 3 — Test flight
cd ~/uxs-hackathon && source venv/bin/activate
python mavsdk-app/src/demo_flight.py
```

**Important:** Start Gazebo first. Wait until the 3D world is fully loaded (you see the compound). Then start SITL. Wait for `EKF3 IMU0 is using GPS` in the SITL terminal before running any Python scripts.

The Gazebo window appears automatically via **WSLg** (Windows Subsystem for Linux GUI). No extra X server needed.

## Troubleshooting

### "WSLg not available" / No Gazebo window

Make sure Windows is fully updated. Run in PowerShell:
```powershell
wsl --update
wsl --shutdown
```
Then re-open Ubuntu and try again.

### Gazebo is very slow / laggy

Check if GPU acceleration is working:
```bash
glxinfo | grep "OpenGL renderer"
```

- If it shows your GPU name (NVIDIA, AMD, Intel) → GPU is working, this is normal performance
- If it shows **"llvmpipe"** → software rendering, GPU not detected

To fix "llvmpipe":
1. Update your GPU drivers from the manufacturer's website
2. For NVIDIA: install the [NVIDIA WSL2 driver](https://developer.nvidia.com/cuda/wsl) (not the regular Windows driver)
3. Restart WSL: `wsl --shutdown` in PowerShell, then re-open Ubuntu

### Gazebo crashes on start

Try running Gazebo directly to see the error:
```bash
export GZ_SIM_RESOURCE_PATH="$HOME/uxs-hackathon/worlds:$HOME/uxs-hackathon/ardupilot_gazebo/models:$HOME/uxs-hackathon/ardupilot_gazebo/worlds"
export GZ_SIM_SYSTEM_PLUGIN_PATH="$HOME/uxs-hackathon/ardupilot_gazebo/build"
gz sim -v4 -r ~/uxs-hackathon/worlds/compound_ops.sdf
```

### SITL shows "Waiting for connection" forever

Gazebo must be running and fully loaded before SITL can connect. If Gazebo crashed or isn't running, SITL will wait indefinitely. Restart Gazebo first.

### "wsl --install" says virtualization is disabled

1. Restart your computer and enter BIOS (usually F2, F12, or DEL during boot)
2. Find the virtualization option (VT-x, AMD-V, SVM, or "Virtualization Technology")
3. Enable it, save, and reboot
4. Re-run `wsl --install -d Ubuntu-22.04`

### WSL is using too much memory

Create or edit `%UserProfile%\.wslconfig` in Windows:
```ini
[wsl2]
memory=8GB
processors=4
```
Then restart WSL: `wsl --shutdown`

### install.sh fails

The most common issues:
1. **Network problems** — install.sh downloads ~2-3 GB. Make sure you have a stable connection.
2. **Disk space** — need ~15 GB free in the WSL2 filesystem.
3. **Partial install** — just re-run `./install.sh`, it skips completed steps.
