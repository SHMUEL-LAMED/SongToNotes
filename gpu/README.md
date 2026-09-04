# SongToNotes GPU service

שרת Modal שמריץ את Spotify Basic Pitch על NVIDIA T4. נקודת הקצה מקבלת דגימות
mono בקצב 22.05kHz ומחזירה את אותה צורת תווים שבה משתמש האתר.

## פריסה

```bash
python -m pip install "modal==1.5.5"
modal setup
modal deploy gpu/modal_app.py
```

לאחר הפריסה, מוסיפים ב־GitHub repository variable בשם `GPU_API_URL` את כתובת
הבסיס שהוחזרה, ללא `/transcribe` בסוף. תהליך הפריסה של GitHub Pages מעביר אותה
ל־Vite כ־`VITE_GPU_API_URL`.

השרת דורש Supabase access token תקף בכל בקשה. האודיו נכתב לקובץ זמני לצורך
המודל ונמחק ב־`finally`; הוא לא נשמר ב־Modal או ב־Supabase.
