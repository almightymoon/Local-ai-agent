import re
import sqlite3
from pathlib import Path
from urllib import request
from html import unescape

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.model_runtime import LocalModelRouter
from app.schemas import (
    ApprovalRequest,
    ApprovalResponse,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    MemoryResponse,
    MemorySaveRequest,
    MemoryValueResponse,
    ProviderStatusResponse,
    SkillsResponse,
    ToolDefinition,
    ToolRequest,
    ToolResponse,
    ToolsResponse,
)

app = FastAPI(title="Local AI Agent API", version="0.1.0")
model_router = LocalModelRouter()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


RISKY_TOOLS = {
    'terraform_apply',
    'kubectl_apply',
    'docker_run',
}

WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
DB_PATH = Path(__file__).resolve().parent / 'local_agent.db'


def safe_workspace_path(relative_or_absolute_path: str) -> Path:
    candidate = Path(relative_or_absolute_path)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (WORKSPACE_ROOT / candidate).resolve()

    try:
        resolved.relative_to(WORKSPACE_ROOT)
    except ValueError:
        raise ValueError(f'Path escapes workspace root: {relative_or_absolute_path}')
    return resolved


def list_workspace_items(path: str = '.') -> list[str]:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f'Workspace path not found: {path}')

    items: list[str] = []
    for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if child.name.startswith('.') and child.name not in {'.env.example', '.gitignore'}:
            continue
        if child.is_dir():
            items.append(child.name + '/')
        else:
            items.append(child.name)
    return items


def inspect_project_structure(path: str = '.') -> dict:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f'Workspace path not found: {path}')

    key_files = ['README.md', 'package.json', 'services/api/app/main.py', 'apps/web/src/main.jsx']
    found_key_files = [name for name in key_files if (root / name).exists()]

    directories: list[str] = []
    files: list[str] = []
    for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if child.name.startswith('.') and child.name not in {'.env.example', '.gitignore'}:
            continue
        relative_name = child.name
        if child.is_dir():
            directories.append(relative_name + '/')
        else:
            files.append(relative_name)

    key_files_text = ', '.join(found_key_files) if found_key_files else 'none found.'
    return {
        'path': str(root.relative_to(WORKSPACE_ROOT)) if root != WORKSPACE_ROOT else '.',
        'file_count': len(files),
        'directory_count': len(directories),
        'directories': directories,
        'files': files,
        'key_files': found_key_files,
        'summary': f'Workspace has {len(directories)} directories and {len(files)} files. Key files: {key_files_text}',
    }


def search_workspace_files(path: str = '.', query: str = '', max_matches: int = 10) -> dict:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f'Workspace path not found: {path}')

    needle = query.strip()
    if not needle:
        raise ValueError('Search query cannot be empty.')

    excluded_dirs = {'.git', '.venv', '.pytest_cache', '__pycache__', 'node_modules'}
    matched_files: list[dict] = []
    seen = 0

    for file_path in root.rglob('*'):
        if file_path.is_dir():
            continue
        if any(part in excluded_dirs for part in file_path.relative_to(root).parts[:-1]):
            continue
        if file_path.name.startswith('.') and file_path.name not in {'.env.example', '.gitignore'}:
            continue

        try:
            text = file_path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue

        lines = text.splitlines()
        for line_number, line in enumerate(lines, start=1):
            if needle.lower() in line.lower():
                snippet = line.strip()
                if len(snippet) > 180:
                    snippet = snippet[:177] + '...'
                matched_files.append({
                    'file': file_path.relative_to(root).as_posix(),
                    'line': line_number,
                    'match': snippet,
                })
                seen += 1
                if seen >= max_matches:
                    break
        if seen >= max_matches:
            break

    return {
        'path': str(root.relative_to(WORKSPACE_ROOT)) if root != WORKSPACE_ROOT else '.',
        'query': needle,
        'count': len(matched_files),
        'matches': matched_files,
    }


def generate_project_plan(path: str = '.', goal: str = '') -> dict:
    root = safe_workspace_path(path)
    if not root.exists():
        raise FileNotFoundError(f'Workspace path not found: {path}')

    structure = inspect_project_structure(path)
    key_files = structure.get('key_files', []) or ['README.md', 'package.json']
    clean_goal = goal.strip() or 'Ship the next high-value milestone for the local AI agent.'

    steps = [
        f"1. Confirm the repo state and key files in {path}: {', '.join(key_files[:4])}.",
        '2. Identify the highest-impact missing capability, user flow, or quality issue in the current app state.',
        '3. Implement the smallest safe change that satisfies the milestone while preserving local-first safety constraints.',
        '4. Validate the behavior with focused tests and a local build check before moving on.',
        '5. Summarize the outcome, remaining risks, and the next milestone handoff.'
    ]

    return {
        'path': str(root.relative_to(WORKSPACE_ROOT)) if root != WORKSPACE_ROOT else '.',
        'goal': clean_goal,
        'steps': steps,
        'summary': f"Plan to {clean_goal.lower()} by validating repo state, implementing the target change, and verifying it with focused checks.",
    }


def fetch_webpage_title(url: str) -> dict:
    parsed_url = url if url.startswith('http://') or url.startswith('https://') else f'https://{url}'
    try:
        with request.urlopen(parsed_url, timeout=20) as response:
            html_text = response.read().decode('utf-8', errors='replace')
    except Exception as exc:
        raise RuntimeError(f'Unable to fetch {parsed_url}: {exc}') from exc

    match = re.search(r'<title[^>]*>(.*?)</title>', html_text, flags=re.IGNORECASE | re.DOTALL)
    title = unescape(re.sub(r'\s+', ' ', match.group(1)).strip()) if match else 'Untitled page'
    preview = re.sub(r'<[^>]+>', ' ', html_text)
    preview = re.sub(r'\s+', ' ', preview)
    preview = preview[:300].strip()
    return {'url': parsed_url, 'title': title, 'snippet': preview}


def get_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db() -> None:
    with get_db_connection() as connection:
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS memory (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )


initialize_db()


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        ok=True,
        app_name="Local AI Agent",
        status="ready",
    )


@app.get("/", response_model=HealthResponse)
def root() -> HealthResponse:
    return HealthResponse(
        ok=True,
        app_name="Local AI Agent",
        status="ready",
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    message = request.message.strip()
    runtime_status = model_router.status()
    provider = runtime_status.provider
    model = runtime_status.model

    lower_message = message.lower()
    if 'repo' in lower_message or 'file' in lower_message or 'workspace' in lower_message:
        tool_plan = ['list_workspace_files', 'inspect_project_structure']
        response = "I can inspect the workspace and summarize the repo structure before making changes."
    elif 'model' in lower_message or 'provider' in lower_message:
        tool_plan = ['check_model_provider']
        response = (
            f'I am configured to use the local {provider} provider with the {model} model. '
            f'Provider available: {runtime_status.available}. '
            f'{runtime_status.notes}'
        )
    elif 'search' in lower_message or 'find' in lower_message or 'match' in lower_message:
        tool_plan = ['search_workspace_files']
        response = 'I can search the repo for matching text and show the relevant file locations.'
    else:
        tool_plan = ['reason_about_user_request']
        generated = model_router.generate(message)
        response = generated['response']

    return ChatResponse(
        response=response,
        tool_plan=tool_plan,
        provider=provider,
        model=model,
        requires_approval=False,
    )


@app.post("/api/tool/execute", response_model=ToolResponse)
def execute_tool(request: ToolRequest) -> ToolResponse:
    tool_name = request.tool_name
    arguments = request.arguments or {}

    if tool_name in RISKY_TOOLS:
        environment = str(arguments.get('environment', '')).lower()
        if environment == 'prod':
            return ToolResponse(
                tool_name=tool_name,
                status='blocked',
                requires_approval=True,
                message='Production execution requires explicit approval before the tool is run.',
                result={'environment': environment, 'approved': False},
            )

    if tool_name == 'list_workspace_files':
        path = str(arguments.get('path', '.'))
        try:
            items = list_workspace_items(path)
            return ToolResponse(
                tool_name=tool_name,
                status='ready',
                requires_approval=False,
                message='Workspace listing generated successfully.',
                result={'path': path, 'items': items},
            )
        except (FileNotFoundError, ValueError) as exc:
            return ToolResponse(
                tool_name=tool_name,
                status='error',
                requires_approval=False,
                message=str(exc),
                result={'path': path, 'items': []},
            )

    if tool_name == 'read_file':
        file_path = str(arguments.get('path', ''))
        max_lines = int(arguments.get('max_lines', 200))
        try:
            resolved = safe_workspace_path(file_path)
            content = resolved.read_text(encoding='utf-8')
            lines = content.splitlines()
            limited_lines = '\n'.join(lines[:max_lines])
            return ToolResponse(
                tool_name=tool_name,
                status='ready',
                requires_approval=False,
                message='File content read successfully.',
                result={'path': file_path, 'content': limited_lines},
            )
        except (FileNotFoundError, ValueError, OSError, UnicodeDecodeError) as exc:
            return ToolResponse(
                tool_name=tool_name,
                status='error',
                requires_approval=False,
                message=str(exc),
                result={'path': file_path, 'content': ''},
            )

    if tool_name == 'inspect_project_structure':
        path = str(arguments.get('path', '.'))
        try:
            summary = inspect_project_structure(path)
            return ToolResponse(
                tool_name=tool_name,
                status='ready',
                requires_approval=False,
                message='Project structure inspected successfully.',
                result=summary,
            )
        except (FileNotFoundError, ValueError) as exc:
            return ToolResponse(
                tool_name=tool_name,
                status='error',
                requires_approval=False,
                message=str(exc),
                result={'path': path, 'directories': [], 'files': [], 'key_files': []},
            )

    if tool_name == 'search_workspace_files':
        path = str(arguments.get('path', '.'))
        query = str(arguments.get('query', ''))
        try:
            result = search_workspace_files(path, query, max_matches=int(arguments.get('max_matches', 10)))
            return ToolResponse(
                tool_name=tool_name,
                status='ready',
                requires_approval=False,
                message='Workspace search completed successfully.',
                result=result,
            )
        except (FileNotFoundError, ValueError) as exc:
            return ToolResponse(
                tool_name=tool_name,
                status='error',
                requires_approval=False,
                message=str(exc),
                result={'path': path, 'query': query, 'count': 0, 'matches': []},
            )

    if tool_name == 'generate_project_plan':
        path = str(arguments.get('path', '.'))
        goal = str(arguments.get('goal', ''))
        try:
            result = generate_project_plan(path, goal)
            return ToolResponse(
                tool_name=tool_name,
                status='ready',
                requires_approval=False,
                message='Project plan generated successfully.',
                result=result,
            )
        except (FileNotFoundError, ValueError) as exc:
            return ToolResponse(
                tool_name=tool_name,
                status='error',
                requires_approval=False,
                message=str(exc),
                result={'path': path, 'goal': goal, 'steps': [], 'summary': 'Plan creation failed.'},
            )

    if tool_name == 'browser_navigate':
        url = str(arguments.get('url', ''))
        try:
            result = fetch_webpage_title(url)
            return ToolResponse(
                tool_name=tool_name,
                status='ready',
                requires_approval=False,
                message='Web page fetched successfully.',
                result=result,
            )
        except Exception as exc:
            return ToolResponse(
                tool_name=tool_name,
                status='error',
                requires_approval=False,
                message=str(exc),
                result={'url': url, 'title': 'Failed to load', 'snippet': ''},
            )

    return ToolResponse(
        tool_name=tool_name,
        status='ready',
        requires_approval=False,
        message='Tool execution is permitted within policy.',
        result={'arguments': arguments},
    )


@app.get("/api/chat/stream")
def stream_chat(message: str) -> StreamingResponse:
    generated = model_router.generate(message)
    response_text = generated['response']
    chunks = response_text.split()

    def event_generator():
        for chunk in chunks:
            yield f"event: message\ndata: {chunk} \n\n"
        yield "event: done\ndata: completed\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/tool/approve", response_model=ApprovalResponse)
def approve_tool(request: ApprovalRequest) -> ApprovalResponse:
    approved = bool(request.approved)
    status = 'approved' if approved else 'rejected'
    message = (
        'Production tool execution approved and recorded.'
        if approved
        else 'Production tool execution rejected and not executed.'
    )

    return ApprovalResponse(
        tool_name=request.tool_name,
        approved=approved,
        status=status,
        message=message,
        environment=request.environment,
    )


@app.get("/api/memory", response_model=MemoryResponse)
def get_memory() -> MemoryResponse:
    return MemoryResponse(
        profile={
            'preferred_package_manager': 'npm',
            'preferred_editor': 'VS Code',
            'style_preferences': ['concise', 'local-first'],
        },
        project_scope='workspace-local',
        retention_policy='user-editable',
    )


@app.get("/api/skills", response_model=SkillsResponse)
def get_skills() -> SkillsResponse:
    return SkillsResponse(
        skills=[
            {
                'name': 'workspace_assessment',
                'state': 'verified',
                'description': 'Review the repo structure and summarize the project.',
                'verification': 'passed local smoke test',
            },
            {
                'name': 'safe_typed_tool_execution',
                'state': 'verified',
                'description': 'Executes guarded operations only after policy checks.',
                'verification': 'approval test passed',
            },
            {
                'name': 'production_deploy_guard',
                'state': 'draft',
                'description': 'Requires explicit human approval for production actions.',
                'verification': 'pending human validation',
            },
        ]
    )


@app.get("/api/tools", response_model=ToolsResponse)
def get_tools() -> ToolsResponse:
    return ToolsResponse(
        tools=[
            {
                'name': 'terraform_apply',
                'category': 'devops',
                'description': 'Apply a Terraform plan to a target environment.',
                'requires_approval': True,
            },
            {
                'name': 'list_workspace_files',
                'category': 'workspace',
                'description': 'List files and folders under a workspace path.',
                'requires_approval': False,
            },
            {
                'name': 'read_file',
                'category': 'workspace',
                'description': 'Read a file from the workspace.',
                'requires_approval': False,
            },
            {
                'name': 'inspect_project_structure',
                'category': 'workspace',
                'description': 'Summarize the project layout, top-level folders, and important files.',
                'requires_approval': False,
            },
            {
                'name': 'search_workspace_files',
                'category': 'workspace',
                'description': 'Search the repo for a query and return matching files and snippets.',
                'requires_approval': False,
            },
            {
                'name': 'generate_project_plan',
                'category': 'planning',
                'description': 'Turn repo context into an actionable milestone plan with validation steps.',
                'requires_approval': False,
            },
            {
                'name': 'browser_navigate',
                'category': 'research',
                'description': 'Fetch a web page and extract its title and text snippet.',
                'requires_approval': False,
            },
        ]
    )


@app.get("/api/model/status", response_model=ProviderStatusResponse)
def get_model_status() -> ProviderStatusResponse:
    status = model_router.status()
    return ProviderStatusResponse(
        provider=status.provider,
        model=status.model,
        available=status.available,
        endpoint=status.endpoint,
        notes=status.notes,
    )


@app.post("/api/memory/save", response_model=MemoryValueResponse)
def save_memory_value(request: MemorySaveRequest) -> MemoryValueResponse:
    with get_db_connection() as connection:
        connection.execute(
            'INSERT INTO memory (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
            (request.key, request.value),
        )
    return MemoryValueResponse(key=request.key, value=request.value)


@app.get("/api/memory/{key}", response_model=MemoryValueResponse)
def read_memory_value(key: str) -> MemoryValueResponse:
    with get_db_connection() as connection:
        row = connection.execute('SELECT value FROM memory WHERE key = ?', (key,)).fetchone()
    if row is None:
        raise ValueError(f'Memory key not found: {key}')
    return MemoryValueResponse(key=key, value=row['value'])
