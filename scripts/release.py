#!/usr/bin/env python3
"""Проверяет сборки, создаёт архивы и манифест выпуска."""

import hashlib
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"


def run(*command):
    """Выполняет обязательную проверку из корня проекта."""
    subprocess.run(command, cwd=ROOT, check=True)


def validate(directory, platform):
    """Проверяет состав сборки и ссылки на локальные ресурсы."""
    files = sorted(path for path in directory.rglob("*") if path.is_file())
    names = {path.relative_to(directory).as_posix() for path in files}
    if "index.html" not in names or not any(name.startswith("assets/") for name in names):
        raise ValueError(f"{platform}: отсутствует index.html или assets")
    for name in names:
        if name != "index.html" and not name.startswith("assets/") and not name.startswith("favicon"):
            raise ValueError(f"{platform}: лишний файл {name}")
        if name.endswith((".map", ".ts")) or name.endswith("sdk.js"):
            raise ValueError(f"{platform}: запрещённый файл {name}")
    html = (directory / "index.html").read_text(encoding="utf-8")
    references = re.findall(r'''(?:src|href)=["']([^"']+)["']''', html)
    for reference in references:
        if reference.startswith(("/", "http:", "https:")):
            raise ValueError(f"{platform}: требуются относительные пути: {reference}")
        target = reference.split("?", 1)[0].split("#", 1)[0].removeprefix("./")
        if target and target not in names:
            raise ValueError(f"{platform}: отсутствует ресурс {reference}")
    content = "\n".join(path.read_text(encoding="utf-8") for path in files if path.suffix in {".js", ".html", ".css"})
    if "sdk.games.s3" in content:
        raise ValueError(f"{platform}: обнаружен запрещённый адрес SDK")
    if platform == "yandex" and "/sdk.js" not in content:
        raise ValueError("yandex: отсутствует путь /sdk.js")
    workers = [name for name in names if name.startswith("assets/") and ("worker" in name.lower() or Path(name).name.startswith("game-")) and name.endswith(".js")]
    if not workers or not any(Path(name).name in content for name in workers):
        raise ValueError(f"{platform}: worker отсутствует или на него нет ссылки")
    # Vite помещает ссылки на остальные ресурсы в HTML, CSS и JavaScript.
    for reference in re.findall(r'''(?:\./|/)assets/([\w.\-]+)''', content):
        if f"assets/{reference}" not in names:
            raise ValueError(f"{platform}: отсутствует assets/{reference}")
    return files


def main():
    """Создаёт ZIP, проверяет CRC и распаковывает их для smoke-проверки."""
    for command in (("npm", "run", "typecheck"), ("npm", "test"), ("npm", "run", "build")):
        run(*command)
    ARTIFACTS.mkdir(exist_ok=True)
    extract_root = Path(tempfile.mkdtemp(prefix="tango-release-"))
    archives = {}
    for platform in ("standalone", "yandex"):
        directory = ROOT / "dist" / platform
        files = validate(directory, platform)
        archive = ARTIFACTS / f"tango-{platform}.zip"
        with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as zipped:
            for path in files:
                # Фиксированная дата и порядок делают ZIP повторяемым для одинаковой сборки.
                from zipfile import ZipInfo
                entry = ZipInfo(path.relative_to(directory).as_posix(), (1980, 1, 1, 0, 0, 0))
                entry.compress_type = ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                zipped.writestr(entry, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
        target = extract_root / platform
        with ZipFile(archive) as zipped:
            bad = zipped.testzip()
            if bad:
                raise ValueError(f"{archive}: ошибка CRC {bad}")
            zipped.extractall(target)
        validate(target, platform)
        data = archive.read_bytes()
        archives[platform] = {"file": archive.name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        print(f"{platform}: {archive}\nДля статической раздачи: {target}", flush=True)
    git = lambda *args: subprocess.check_output(("git", *args), cwd=ROOT, text=True).strip()
    manifest = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "version": json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"],
        "tools": {"node": subprocess.check_output(("node", "--version"), text=True).strip(),
                  "npm": subprocess.check_output(("npm", "--version"), text=True).strip(),
                  "python": sys.version.split()[0]},
        "git_commit": git("rev-parse", "HEAD"),
        "git_ref": git("symbolic-ref", "--quiet", "--short", "HEAD") if subprocess.run(("git", "symbolic-ref", "--quiet", "HEAD"), cwd=ROOT, stdout=subprocess.DEVNULL).returncode == 0 else "detached",
        "git_dirty": bool(git("status", "--porcelain")),
        "archives": archives,
    }
    (ARTIFACTS / "release.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Манифест: {ARTIFACTS / 'release.json'}", flush=True)


if __name__ == "__main__":
    main()
