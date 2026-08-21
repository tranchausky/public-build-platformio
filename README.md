# ESP32 Local Installer

Small local web UI that scans PlatformIO `.pio/build/*` folders and flashes firmware using ESP Web Tools.

## Run

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Paste a PlatformIO project folder such as:

```text
D:\Projects\ESP32\MyDevice
```

The app stores saved folders in `config.json`.

## Exposed firmware files

Only these files can be downloaded by the browser:

- firmware.bin
- bootloader.bin
- partitions.bin
- boot_app0.bin

The rest of the PlatformIO project is never exposed by Express static hosting.

## Notes

The default ESP32 offsets used are:

- bootloader.bin: 0x1000
- partitions.bin: 0x8000
- boot_app0.bin: 0xe000
- firmware.bin: 0x10000

These are common PlatformIO ESP32 layouts. If a board uses custom offsets, update `makeManifest()` in `server.js`.
