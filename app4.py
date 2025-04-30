from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from ultralytics import YOLO
import openai, base64, os, cv2
from datetime import datetime
import requests

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# Hardcoded API key (dev only)
openai.api_key = 'your-openai-key-here'
model = YOLO('yolov8n.pt')

def save_image(b64, fname):
    _, d = b64.split(',',1)
    path = os.path.join('static', fname)
    with open(path,'wb') as f: f.write(base64.b64decode(d))
    return path

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/query', methods=['POST'])
def query():
    data = request.json
    speech = data.get('text','')
    img_b64 = data.get('image','')
    fname = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
    img_path = save_image(img_b64, fname)

    # Object detection
    res = model(img_path)[0]
    labels = res.names
    boxes = res.boxes.cls
    obj = labels[int(boxes[0])] if boxes.nelement()>0 else 'nothing recognizable'

    # Geolocation
    try:
        loc = requests.get('https://ipapi.co/json/').json()
        location = f"You are in {loc.get('city')}, {loc.get('country_name')}"
    except:
        location = 'Unable to fetch location.'

    # GPT prompt
    prompt = f"User said: '{speech}'. Object: {obj}. {location}. Reply succinctly."
    resp = openai.ChatCompletion.create(
        model='gpt-4o',
        messages=[{'role':'user','content':prompt}]
    )
    reply = resp.choices[0].message.content.strip()

    return jsonify({ 'reply': reply, 'object': obj, 'location': location })

if __name__=='__main__':
    app.run(host='0.0.0.0', port=5000)
