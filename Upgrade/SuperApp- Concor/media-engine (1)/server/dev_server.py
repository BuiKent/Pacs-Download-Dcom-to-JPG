"""Server độc lập chỉ để bạn/tôi test media_api.py qua HTTP thật.
Chạy: python3 dev_server.py
Đây KHÔNG phải server production của app — app thật của bạn include_router()
media_api vào FastAPI app hiện có, không chạy file này."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from media_api import router as media_router, WORK_ROOT

app = FastAPI()
app.include_router(media_router, prefix="/api/media")
# Cho phép tải file kết quả về trực tiếp để test bằng mắt (production thật
# nên có route riêng có auth, không serve thẳng thư mục work như thế này).
app.mount("/work", StaticFiles(directory=str(WORK_ROOT)), name="work")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8731, log_level="info")
