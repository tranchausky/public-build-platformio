# ESP32 Local Installer - Python

Local ESP32 PlatformIO firmware installer using Flask + ESP Web Tools.

## Features

- Save multiple PlatformIO project folders as server-side bookmarks in `config.json`
- Click a saved project to load and scan its latest `.pio/build/*` output
- Delete bookmarks without deleting any project files
- Remembers the last active project across restarts
- Exposes only the allowed firmware `.bin` files
- Uses ESP Web Tools 10.1.1 for flashing

## Install

Recommended on Debian/Ubuntu/Raspberry Pi:

```bash
sudo apt install python3-venv -y
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Open:

```text
http://localhost:3000
```

Bookmarks are stored in `config.json` next to `app.py`.
