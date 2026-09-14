"""Serverless GPU endpoint for SongToNotes.

Deploy with: modal deploy gpu/modal_app.py
The returned base URL is configured in GitHub as the GPU_API_URL repository
variable. Audio is processed in a temporary file and never persisted.
"""

from __future__ import annotations

import os
import tempfile
import time

import modal


SAMPLE_RATE = 22_050
MAX_DURATION_SECONDS = 60 * 60
SUPABASE_URL = "https://ydcfafijktzasrkkxyux.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hmcfter-RriY3pKrbZnJqg_2228WwCM"
ALLOWED_ORIGINS = [
    "https://shmuel-lamed.github.io",
    "http://localhost:5173",
]

image = (
    modal.Image.from_registry("tensorflow/tensorflow:2.15.0-gpu")
    .apt_install("libsndfile1")
    .pip_install(
        "basic-pitch==0.4.0",
        "fastapi[standard]==0.116.1",
        "httpx==0.28.1",
    )
)

app = modal.App("song-to-notes-gpu")


@app.function(
    image=image,
    gpu="T4",
    memory=4096,
    timeout=20 * 60,
    max_containers=2,
    scaledown_window=5 * 60,
)
@modal.concurrent(max_inputs=1)
@modal.asgi_app()
def api():
    import httpx
    import numpy as np
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict
    from fastapi import FastAPI, Header, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from scipy.io import wavfile

    web = FastAPI(title="SongToNotes GPU", docs_url=None, redoc_url=None)
    web.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Audio-Sample-Rate"],
        max_age=3600,
    )

    # Loaded once per warm container; repeated songs avoid the expensive model
    # initialization and use TensorFlow's CUDA runtime on the assigned T4.
    model = Model(ICASSP_2022_MODEL_PATH)

    def verify_session(authorization: str | None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="יש להתחבר מחדש.")
        token = authorization.removeprefix("Bearer ").strip()
        try:
            response = httpx.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_PUBLISHABLE_KEY,
                    "Authorization": f"Bearer {token}",
                },
                timeout=10,
            )
        except httpx.HTTPError as error:
            raise HTTPException(status_code=503, detail="אימות המשתמש אינו זמין כרגע.") from error
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="החיבור פג תוקף. יש להתחבר מחדש.")
        user_id = response.json().get("id")
        if not isinstance(user_id, str) or not user_id:
            raise HTTPException(status_code=401, detail="המשתמש אינו תקין.")
        return user_id

    @web.post("/transcribe")
    async def transcribe_audio(
        request: Request,
        authorization: str | None = Header(default=None),
        x_audio_sample_rate: int = Header(default=0),
    ):
        verify_session(authorization)
        if x_audio_sample_rate != SAMPLE_RATE:
            raise HTTPException(status_code=400, detail="קצב הדגימה אינו נתמך.")

        content_length = request.headers.get("content-length")
        maximum_bytes = SAMPLE_RATE * MAX_DURATION_SECONDS * 4
        if content_length:
            try:
                declared_bytes = int(content_length)
            except ValueError as error:
                raise HTTPException(status_code=400, detail="גודל הבקשה אינו תקין.") from error
            if declared_bytes > maximum_bytes:
                raise HTTPException(status_code=413, detail="קטע השמע ארוך משעה.")

        body = await request.body()
        if not body or len(body) % 4:
            raise HTTPException(status_code=400, detail="נתוני האודיו אינם תקינים.")
        if len(body) > maximum_bytes:
            raise HTTPException(status_code=413, detail="קטע השמע ארוך משעה.")

        samples = np.frombuffer(body, dtype="<f4")
        if samples.size < SAMPLE_RATE // 20 or not np.isfinite(samples).all():
            raise HTTPException(status_code=400, detail="נתוני האודיו ריקים או פגומים.")

        descriptor, audio_path = tempfile.mkstemp(suffix=".wav")
        os.close(descriptor)
        started = time.perf_counter()
        try:
            wavfile.write(audio_path, SAMPLE_RATE, samples)
            inference_started = time.perf_counter()
            _, _, events = predict(
                audio_path,
                model,
                onset_threshold=0.244,
                frame_threshold=0.192,
                minimum_note_length=58.0,
                melodia_trick=True,
            )
            inference_ms = round((time.perf_counter() - inference_started) * 1000)
        finally:
            try:
                os.unlink(audio_path)
            except FileNotFoundError:
                pass

        notes = [
            {
                "midi": int(pitch),
                "start": float(start),
                "duration": float(end - start),
                "confidence": max(0.0, min(1.0, float(amplitude))),
            }
            for start, end, pitch, amplitude, _pitch_bends in events
        ]
        notes.sort(key=lambda note: (note["start"], note["midi"]))
        total_ms = round((time.perf_counter() - started) * 1000)
        return {
            "notes": notes,
            "timings": {
                "backend": "cloud-gpu",
                "load": 0,
                "infer": inference_ms,
                "decode": max(0, total_ms - inference_ms),
            },
        }

    return web
