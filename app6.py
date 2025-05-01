from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from ultralytics import YOLO
import openai, base64, os
from datetime import datetime
import requests
import logging

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)
app.logger.setLevel(logging.INFO)

# Load your key from env or hardcode (dev only)
openai.api_key = os.getenv("OPENAI_API_KEY", "your-openai-key-here")

# Load YOLO once
try:
    model = YOLO('yolov8n.pt')
    app.logger.info("✅ YOLOv8n loaded")
except Exception as e:
    app.logger.exception("❌ Failed to load YOLO model")
    raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/query', methods=['POST'])
def query():
    try:
        # 1) Parse incoming JSON
        data = request.get_json(force=True)
        speech = data.get('text', '').strip()
        img_b64 = data.get('image', '')
        if not speech or not img_b64:
            raise ValueError("Missing `text` or `image` in request")

        # 2) Save the image locally
        fname = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
        path = os.path.join('static', fname)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(img_b64.split(',', 1)[1]))
        app.logger.info(f"🖼️ Saved image: {path}")

        # 3) Run YOLO
        res = model(path)[0]
        cls = res.boxes.cls
        names = res.names
        obj = names[int(cls[0])] if cls.nelement() > 0 else "nothing recognizable"
        app.logger.info(f"🔍 Detected: {obj}")

        # 4) Fetch geolocation
        try:
            loc = requests.get('https://ipapi.co/json/').json()
            location = f"You are in {loc.get('city')}, {loc.get('country_name')}"
        except Exception as ge:
            app.logger.error("📍 Geolocation error", exc_info=ge)
            location = "Unable to fetch location."
        app.logger.info(f"📍 Location: {location}")

        # 5) Call GPT
        prompt = f"User said: '{speech}'. Object: {obj}. {location}. Reply succinctly."
        try:
            resp = openai.ChatCompletion.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}]
            )
            reply = resp.choices[0].message.content.strip()
            app.logger.info(f"🤖 GPT reply: {reply}")
        except Exception as oe:
            app.logger.error("🚨 OpenAI API error", exc_info=oe)
            return jsonify(error=f"OpenAI API error: {oe}"), 502

        # 6) Return everything
        return jsonify(reply=reply, object=obj, location=location)

    except Exception as e:
        app.logger.exception("🚨 /query error")
        return jsonify(error=str(e)), 500

if __name__ == '__main__':
    # Match this port to your frontend (window.location.origin)
    app.run(host='0.0.0.0', port=8501)
