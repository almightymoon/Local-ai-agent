from typing import Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    ok: bool
    app_name: str
    status: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)


class ChatResponse(BaseModel):
    response: str
    tool_plan: list[str]
    provider: str = 'ollama'
    model: str = 'local-default'
    requires_approval: bool = False


class ToolRequest(BaseModel):
    tool_name: str
    arguments: dict = {}


class ToolResponse(BaseModel):
    tool_name: str
    status: str
    requires_approval: bool = False
    message: str
    result: Optional[dict] = None


class ApprovalRequest(BaseModel):
    tool_name: str
    approved: bool
    environment: str = 'dev'


class ApprovalResponse(BaseModel):
    tool_name: str
    approved: bool
    status: str
    message: str
    environment: str


class MemoryProfile(BaseModel):
    preferred_package_manager: str = 'npm'
    preferred_editor: str = 'VS Code'
    style_preferences: list[str] = ['concise', 'local-first']


class MemoryResponse(BaseModel):
    profile: MemoryProfile
    project_scope: str = 'workspace-local'
    retention_policy: str = 'user-editable'


class SkillItem(BaseModel):
    name: str
    state: str
    description: str
    verification: str


class SkillsResponse(BaseModel):
    skills: list[SkillItem]


class MemorySaveRequest(BaseModel):
    key: str
    value: str


class MemoryValueResponse(BaseModel):
    key: str
    value: str


class ToolDefinition(BaseModel):
    name: str
    category: str
    description: str
    requires_approval: bool = False


class ToolsResponse(BaseModel):
    tools: list[ToolDefinition]


class ProviderStatusResponse(BaseModel):
    provider: str
    model: str
    available: bool
    endpoint: Optional[str] = None
    notes: str = ''


class StreamEvent(BaseModel):
    event: str
    data: str
