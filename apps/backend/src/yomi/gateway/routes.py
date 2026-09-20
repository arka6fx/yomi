from fastapi import APIRouter

from yomi.gateway.telegram import router as telegram_router

router = APIRouter()
router.include_router(telegram_router, prefix="")

@router.get("/status")
async def gateway_status():
    return {"running": True, "platform": "telegram"}
