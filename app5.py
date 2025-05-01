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

# Replace with your real key or env‐var method
openai.api_key = os.getenv("OPENAI_API_KEY", "your-openai-key-here")

# Load YOLO model once at startup
try:
    model = YOLO('yolov8n.pt')
    app.logger.info("YOLO model loaded.")
except Exception as e:
    app.logger.exception("Failed to load YOLO model")
    raise

def save_image(b64, fname):
    try:
        header, data = b64.split(',', 1)
        path = os.path.join('static', fname)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data))
        return path
    except Exception as e:
        app.logger.exception("Image save error")
        raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/query', methods=['POST'])
def query():
    try:
        data = request.get_json(force=True)
        speech = data.get('text', '').strip()
        img_b64 = data.get('image', '')

        # 1) Save
        fname = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
        img_path = save_image(img_b64, fname)
        app.logger.info(f"Saved image at {img_path}")

        # 2) Object detection
        res = model(img_path)[0]
        labels = res.names
        boxes = res.boxes.cls
        obj = labels[int(boxes[0])] if boxes.nelement() > 0 else 'nothing recognizable'
        app.logger.info(f"Detected object: {obj}")

        # 3) Geolocation
        try:
            loc = requests.get('https://ipapi.co/json/').json()
            location = f"You are in {loc.get('city')}, {loc.get('country_name')}"
        except Exception as ge:
            app.logger.exception("Geolocation error")
            location = 'Unable to fetch location.'
        app.logger.info(f"Location: {location}")

        # 4) GPT call
        prompt = f"User said: '{speech}'. Object: {obj}. {location}. Reply succinctly."
        try:
            resp = openai.ChatCompletion.create(
                model='gpt-4o',
                messages=[{'role':'user','content':prompt}]
            )
            reply = resp.choices[0].message.content.strip()
            app.logger.info(f"GPT reply: {reply}")
        except openai.error.OpenAIError as oe:
            app.logger.exception("OpenAI API error")
            return jsonify(error=f"OpenAI API error: {oe}"), 502

        # 5) Return success
        return jsonify(reply=reply, object=obj, location=location)

    except Exception as e:
        app.logger.exception("Unhandled /query error")
        return jsonify(error=str(e)), 500

if __name__ == '__main__':
    # Make sure this matches your frontend port (e.g. 8501)
    app.run(host='0.0.0.0', port=8501)
