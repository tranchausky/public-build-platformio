import json
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, abort
import bleach
import markdown

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config.json"

ALLOWED_FILES = {
    "bootloader.bin": 0x1000,
    "partitions.bin": 0x8000,
    "boot_app0.bin": 0xE000,
    "firmware.bin": 0x10000,
}


def default_config():
    return {"projects": [], "lastProject": ""}


def load_config():
    if not CONFIG_FILE.exists():
        return default_config()

    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return default_config()

    if not isinstance(config.get("projects"), list):
        config["projects"] = []
    if not isinstance(config.get("lastProject"), str):
        config["lastProject"] = ""

    return config


def save_config(config):
    CONFIG_FILE.write_text(
        json.dumps(config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def normalize_folder(folder):
    return str(Path(folder).expanduser().resolve())


def validate_project_folder(folder):
    if not folder:
        return None, "Folder is required"

    project_path = Path(folder).expanduser()

    if not project_path.exists():
        return None, "Folder does not exist"

    if not project_path.is_dir():
        return None, "Path is not a folder"

    return project_path.resolve(), None


def get_current_project():
    config = load_config()
    project = config.get("lastProject", "")

    if not project:
        return None

    project_path = Path(project)
    if not project_path.exists() or not project_path.is_dir():
        return None

    return project_path


def find_readme(project_path):
    for item in project_path.iterdir():
        if item.is_file() and item.name.lower() == "readme.md":
            return item
    return None


def render_readme(readme_path):
    raw = readme_path.read_text(encoding="utf-8", errors="replace")
    rendered = markdown.markdown(
        raw,
        extensions=["fenced_code", "tables", "sane_lists"],
    )

    allowed_tags = set(bleach.sanitizer.ALLOWED_TAGS).union({
        "p", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6",
        "hr", "br", "table", "thead", "tbody", "tr", "th", "td",
        "ul", "ol", "li", "blockquote", "strong", "em", "del",
    })

    return bleach.clean(
        rendered,
        tags=allowed_tags,
        attributes={"a": ["href", "title"]},
        protocols={"http", "https", "mailto"},
        strip=True,
    )


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
    config = load_config()

    projects = []
    for folder in config.get("projects", []):
        path = Path(folder)
        projects.append({
            "folder": folder,
            "name": path.name or folder,
            "exists": path.exists() and path.is_dir(),
            "active": folder == config.get("lastProject", ""),
        })

    return jsonify({
        "projects": projects,
        "lastProject": config.get("lastProject", ""),
    })


@app.route("/api/project", methods=["POST"])
def add_or_select_project():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()

    project_path, error = validate_project_folder(folder)
    if error:
        return jsonify({"success": False, "message": error}), 400

    folder = str(project_path)
    config = load_config()
    projects = config.get("projects", [])

    if folder not in projects:
        projects.append(folder)

    config["projects"] = projects
    config["lastProject"] = folder
    save_config(config)

    return jsonify({
        "success": True,
        "project": folder,
        "name": project_path.name or folder,
    })


@app.route("/api/project/select", methods=["POST"])
def select_project():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()

    config = load_config()
    projects = config.get("projects", [])

    if folder not in projects:
        return jsonify({"success": False, "message": "Project is not bookmarked"}), 404

    project_path, error = validate_project_folder(folder)
    if error:
        return jsonify({"success": False, "message": error}), 400

    resolved = str(project_path)

    if resolved != folder:
        projects = [resolved if item == folder else item for item in projects]
        config["projects"] = projects

    config["lastProject"] = resolved
    save_config(config)

    return jsonify({"success": True, "project": resolved})


@app.route("/api/project", methods=["DELETE"])
def delete_project():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()

    if not folder:
        return jsonify({"success": False, "message": "Folder is required"}), 400

    config = load_config()
    projects = config.get("projects", [])

    if folder not in projects:
        return jsonify({"success": False, "message": "Project is not bookmarked"}), 404

    projects.remove(folder)
    config["projects"] = projects

    if config.get("lastProject") == folder:
        config["lastProject"] = projects[0] if projects else ""

    save_config(config)

    return jsonify({
        "success": True,
        "lastProject": config.get("lastProject", ""),
    })


@app.route("/api/readme")
def get_readme():
    project = get_current_project()

    if not project:
        return jsonify({
            "success": False,
            "exists": False,
            "message": "No valid project selected",
        })

    readme_path = find_readme(project)

    if not readme_path:
        return jsonify({
            "success": True,
            "exists": False,
        })

    try:
        html = render_readme(readme_path)
    except OSError:
        return jsonify({
            "success": False,
            "exists": False,
            "message": "Unable to read README.md",
        }), 500

    return jsonify({
        "success": True,
        "exists": True,
        "filename": readme_path.name,
        "html": html,
    })


@app.route("/api/builds")
def get_builds():
    project = get_current_project()

    if not project:
        return jsonify({
            "success": False,
            "message": "No valid project selected",
            "builds": [],
        })

    return jsonify({
        "success": True,
        "project": str(project),
        "projectName": project.name or str(project),
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
