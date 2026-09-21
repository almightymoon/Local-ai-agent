from fastapi import APIRouter
from . import router

app = APIRouter()
app.include_router(router.router)
