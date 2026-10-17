"""Lip-sync one Noor take: portrait + speech -> talking-head mp4 (max 9 s).
Usage: uv run --with gradio_client python -I leaptalk.py <portrait.png> <speech.mp3> <out.mp4>
Uses the hugging-apps/leaptalk-talking-head Space on ZeroGPU; HF_TOKEN in the
environment gives the account's GPU quota (anonymous quota is a few runs a day)."""
import os, shutil, sys
from gradio_client import Client, handle_file

img, aud, out = sys.argv[1:4]
client = Client("hugging-apps/leaptalk-talking-head", token=os.environ.get("HF_TOKEN"), verbose=False)
res = client.predict(portrait_image=handle_file(img), speech_audio=handle_file(aud), max_seconds=9,
                     num_inference_steps=1, guidance_scale=1.0, seed=42, auto_crop_face=False, api_name="/generate")
video = res[0] if isinstance(res, (list, tuple)) else res
if isinstance(video, dict):
    video = video.get("video") or video.get("path")
shutil.copy(video, out)
print("take", out)
