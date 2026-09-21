import os
from pathlib import Path

WORKSPACE_ROOT = Path(
    os.getenv("AGENT_WORKSPACE", str(Path(__file__).resolve().parents[4]))
).resolve()


def safe_workspace_path(relative_or_absolute_path: str) -> Path:
    candidate = Path(relative_or_absolute_path)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (WORKSPACE_ROOT / candidate).resolve()

    try:
        resolved.relative_to(WORKSPACE_ROOT)
    except ValueError:
        raise ValueError(f"Path escapes workspace root: {relative_or_absolute_path}")
    if any(
        (
            part in {".git", ".env", ".agent-data"}
            or (part.startswith(".env.") and part != ".env.example")
            or part.endswith((".db", ".sqlite", ".sqlite3"))
        )
        for part in resolved.relative_to(WORKSPACE_ROOT).parts
    ):
        raise ValueError("Private workspace path is not available to tools.")
    return resolved


def list_workspace_items(path: str = ".") -> list[str]:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f"Workspace path not found: {path}")

    items: list[str] = []
    for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if child.name.startswith(".") and child.name not in {
            ".env.example",
            ".gitignore",
        }:
            continue
        if child.is_dir():
            items.append(child.name + "/")
        else:
            items.append(child.name)
    return items


def inspect_project_structure(path: str = ".") -> dict:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f"Workspace path not found: {path}")

    key_files = [
        "README.md",
        "package.json",
        "services/api/app/main.py",
        "apps/web/src/main.jsx",
    ]
    found_key_files = [name for name in key_files if (root / name).exists()]

    directories: list[str] = []
    files: list[str] = []
    for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if child.name.startswith(".") and child.name not in {
            ".env.example",
            ".gitignore",
        }:
            continue
        relative_name = child.name
        if child.is_dir():
            directories.append(relative_name + "/")
        else:
            files.append(relative_name)

    key_files_text = ", ".join(found_key_files) if found_key_files else "none found."
    return {
        "path": str(root.relative_to(WORKSPACE_ROOT))
        if root != WORKSPACE_ROOT
        else ".",
        "file_count": len(files),
        "directory_count": len(directories),
        "directories": directories,
        "files": files,
        "key_files": found_key_files,
        "summary": f"Workspace has {len(directories)} directories and {len(files)} files. Key files: {key_files_text}",
    }


def search_workspace_files(
    path: str = ".", query: str = "", max_matches: int = 10
) -> dict:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f"Workspace path not found: {path}")

    needle = query.strip()
    if not needle:
        raise ValueError("Search query cannot be empty.")

    excluded_dirs = {".git", ".venv", ".pytest_cache", "__pycache__", "node_modules"}
    matched_files: list[dict] = []
    seen = 0

    for file_path in root.rglob("*"):
        if file_path.is_dir():
            continue
        if any(
            part in excluded_dirs for part in file_path.relative_to(root).parts[:-1]
        ):
            continue
        if file_path.name.startswith(".") and file_path.name not in {
            ".env.example",
            ".gitignore",
        }:
            continue

        try:
            file_path = safe_workspace_path(str(file_path))
            if file_path.stat().st_size > 1_000_000:
                continue
            text = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError, ValueError):
            continue

        lines = text.splitlines()
        for line_number, line in enumerate(lines, start=1):
            if needle.lower() in line.lower():
                snippet = line.strip()
                if len(snippet) > 180:
                    snippet = snippet[:177] + "..."
                matched_files.append(
                    {
                        "file": file_path.relative_to(root).as_posix(),
                        "line": line_number,
                        "match": snippet,
                    }
                )
                seen += 1
                if seen >= max_matches:
                    break
        if seen >= max_matches:
            break

    return {
        "path": str(root.relative_to(WORKSPACE_ROOT))
        if root != WORKSPACE_ROOT
        else ".",
        "query": needle,
        "count": len(matched_files),
        "matches": matched_files,
    }


def generate_project_plan(path: str = ".", goal: str = "") -> dict:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f"Workspace path not found: {path}")

    structure = inspect_project_structure(path)
    key_files = structure.get("key_files", []) or ["README.md", "package.json"]
    clean_goal = (
        goal.strip() or "Ship the next high-value milestone for the local AI agent."
    )

    steps = [
        f"1. Confirm the repo state and key files in {path}: {', '.join(key_files[:4])}.",
        "2. Identify the highest-impact missing capability, user flow, or quality issue in the current app state.",
        "3. Implement the smallest safe change that satisfies the milestone while preserving local-first safety constraints.",
        "4. Validate the behavior with focused tests and a local build check before moving on.",
        "5. Summarize the outcome, remaining risks, and the next milestone handoff.",
    ]

    return {
        "path": str(root.relative_to(WORKSPACE_ROOT))
        if root != WORKSPACE_ROOT
        else ".",
        "goal": clean_goal,
        "steps": steps,
        "summary": f"Plan to {clean_goal.lower()} by validating repo state, implementing the target change, and verifying it with focused checks.",
    }
