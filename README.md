# ESP32 Local Installer - Python

Local Flask web app for installing PlatformIO ESP32 builds with ESP Web Tools.

## Install

```bash
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

Enter the PlatformIO project folder. The app scans:

```text
.pio/build/*
```

It only exposes these firmware files when they exist:

- bootloader.bin
- partitions.bin
- boot_app0.bin
- firmware.bin

Project paths are stored locally in `config.json`.

## Note

The current version uses common ESP32 flash offsets. Projects with custom flash layouts may require automatic offset detection from PlatformIO build metadata.
