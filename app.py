import json
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, abort

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config.json"

ALLOWED_FILES = {
    "bootloader.bin": 0x1000,
    "partitions.bin": 0x8000,
    "boot_app0.bin": 0xE000,
    "firmware.bin": 0x10000,
}


def load_config():
    if not CONFIG_FILE.exists():
        return {"projects": [], "lastProject": ""}

    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"projects": [], "lastProject": ""}


def save_config(config):
    CONFIG_FILE.write_text(
        json.dumps(config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_current_project():
    config = load_config()
    project = config.get("lastProject", "")

    if not project:
        return None

    project_path = Path(project)
    if not project_path.exists() or not project_path.is_dir():
        return None

    return project_path


def detect_chip_family(env_name):
    name = env_name.lower()

    if "s3" in name:
        return "ESP32-S3"
    if "s2" in name:
        return "ESP32-S2"
    if "c3" in name:
        return "ESP32-C3"
    if "c6" in name:
        return "ESP32-C6"
    if "h2" in name:
        return "ESP32-H2"

    return "ESP32"


def scan_builds(project_path):
    build_root = project_path / ".pio" / "build"

    if not build_root.exists():
        return []

    builds = []

    for env_dir in sorted(build_root.iterdir(), key=lambda p: p.name.lower()):
        if not env_dir.is_dir():
            continue

        files = []

        for filename, offset in ALLOWED_FILES.items():
            file_path = env_dir / filename

            if file_path.exists() and file_path.is_file():
                files.append({
                    "name": filename,
                    "size": file_path.stat().st_size,
                    "offset": offset,
                })

        if not files:
            continue

        builds.append({
            "environment": env_dir.name,
            "chipFamily": detect_chip_family(env_dir.name),
            "files": files,
        })

    return builds


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config")
def get_config():
    return jsonify(load_config())


@app.route("/api/project", methods=["POST"])
def set_project():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()

    if not folder:
        return jsonify({"success": False, "message": "Folder is required"}), 400

    project_path = Path(folder).expanduser()

    if not project_path.exists():
        return jsonify({"success": False, "message": "Folder does not exist"}), 400

    if not project_path.is_dir():
        return jsonify({"success": False, "message": "Path is not a folder"}), 400

    project_path = project_path.resolve()
    folder = str(project_path)

    config = load_config()
    projects = config.get("projects", [])

    if folder not in projects:
        projects.append(folder)

    config["projects"] = projects
    config["lastProject"] = folder
    save_config(config)

    return jsonify({"success": True, "project": folder})


@app.route("/api/builds")
def get_builds():
    project = get_current_project()

    if not project:
        return jsonify({
            "success": False,
            "message": "No project selected",
            "builds": [],
        })

    return jsonify({
        "success": True,
        "project": str(project),
        "builds": scan_builds(project),
    })


@app.route("/api/manifest/<env>")
def manifest(env):
    project = get_current_project()

    if not project:
        abort(404)

    build_root = (project / ".pio" / "build").resolve()
    env_path = (build_root / env).resolve()

    try:
        env_path.relative_to(build_root)
    except ValueError:
        abort(403)

    if not env_path.exists() or not env_path.is_dir():
        abort(404)

    parts = []

    for filename, offset in ALLOWED_FILES.items():
        file_path = env_path / filename

        if file_path.exists() and file_path.is_file():
            parts.append({
                "path": f"/firmware/{env}/{filename}",
                "offset": offset,
            })

    if not parts:
        abort(404)

    return jsonify({
        "name": f"ESP32 Firmware - {env}",
        "version": "local",
        "new_install_prompt_erase": True,
        "builds": [{
            "chipFamily": detect_chip_family(env),
            "parts": parts,
        }],
    })


@app.route("/firmware/<env>/<filename>")
def firmware(env, filename):
    if filename not in ALLOWED_FILES:
        abort(403)

    project = get_current_project()

    if not project:
        abort(404)

    build_root = (project / ".pio" / "build").resolve()
    file_path = (build_root / env / filename).resolve()

    try:
        file_path.relative_to(build_root)
    except ValueError:
        abort(403)

    if not file_path.exists() or not file_path.is_file():
        abort(404)

    return send_file(
        file_path,
        mimetype="application/octet-stream",
        as_attachment=False,
    )


if __name__ == "__main__":
    print()
    print("ESP32 Local Installer")
    print("http://localhost:3000")
    print()

    app.run(
        host="127.0.0.1",
        port=3000,
        debug=True,
    )
