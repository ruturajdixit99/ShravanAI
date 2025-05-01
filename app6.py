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

# Load API key
openai.api_key = os.getenv("OPENAI_API_KEY", "your-openai-key-here")

# Load YOLO model
try:
    model = YOLO('yolov8n.pt')
    app.logger.info("✅ YOLOv8n loaded")
except Exception:
    app.logger.exception("❌ Failed to load YOLO model")
    raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/query', methods=['POST'])
def query():
    try:
        data = request.get_json(force=True)
        speech = data.get('text','').strip()
        img_b64 = data.get('image','')
        if not speech or not img_b64:
            raise ValueError("Missing 'text' or 'image'")

        # save image
        fname = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
        path = os.path.join('static', fname)
        with open(path,'wb') as f:
            f.write(base64.b64decode(img_b64.split(',',1)[1]))
        app.logger.info(f"Saved image {path}")

        # detect object
        res = model(path)[0]
        cls = res.boxes.cls
        names = res.names
        obj = names[int(cls[0])] if cls.nelement()>0 else 'nothing recognizable'
        app.logger.info(f"Detected: {obj}")

        # get location
        try:
            loc = requests.get('https://ipapi.co/json/').json()
            location = f"You are in {loc.get('city')}, {loc.get('country_name')}"
        except Exception:
            app.logger.exception("Geo error")
            location = 'Unable to fetch location.'
        app.logger.info(f"Location: {location}")

        # GPT with new API
        prompt = f"User said: '{speech}'. Object: {obj}. {location}. Reply succinctly."
        try:
            resp = openai.chat.completions.create(
                model="gpt-4o",
                messages=[{"role":"user","content":prompt}]
            )
            reply = resp.choices[0].message.content.strip()
            app.logger.info(f"GPT reply: {reply}")
        except Exception as oe:
            app.logger.error("OpenAI API call failed", exc_info=oe)
            return jsonify(error=f"OpenAI API error: {oe}"), 502

        return jsonify(reply=reply, object=obj, location=location)

    except Exception as e:
        app.logger.exception("/query handler error")
        return jsonify(error=str(e)), 500

if __name__=='__main__':
    app.run(host='0.0.0.0', port=8501)
