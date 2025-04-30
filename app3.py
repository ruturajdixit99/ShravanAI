from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from ultralytics import YOLO
import openai, base64, os, cv2
from datetime import datetime
import requests

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

openai.api_key = "your-openai-key-here"
model = YOLO("yolov8n.pt")

def save_image(base64_img, filename):
    _, b64data = base64_img.split(',', 1)
    filepath = os.path.join("static", filename)
    with open(filepath, 'wb') as f:
        f.write(base64.b64decode(b64data))
    return filepath

def detect_object(image_path):
    result = model(image_path)[0]
    classes = result.names
    boxes = result.boxes.cls
    if boxes.nelement() > 0:
        return classes[int(boxes[0])]
    return "nothing recognizable"

def get_location():
    try:
        r = requests.get("https://ipapi.co/json/").json()
        return f"You are in {r.get('city')}, {r.get('country_name')}."
    except:
        return "Unable to fetch location."

def chat_gpt(prompt):
    res = openai.ChatCompletion.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )
    return res.choices[0].message.content.strip()

@app.route('/')
def index():
    return render_template("index.html")

@app.route('/query', methods=['POST'])
def query():
    data = request.json
    speech = data.get("text", "")
    image_b64 = data.get("image", "")
    fname = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
    path = save_image(image_b64, fname)
    detected = detect_object(path)
    location = get_location()
    prompt = f"User said: '{speech}'. Object in image: {detected}. {location}. Respond appropriately."
    reply = chat_gpt(prompt)
    return jsonify({"reply": reply})

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
