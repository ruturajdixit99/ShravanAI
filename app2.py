# app.py
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from ultralytics import YOLO
import base64
import openai
import os
from datetime import datetime
import cv2
import numpy as np

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)  # Enable CORS for frontend requests

# Hardcoded OpenAI API Key (for dev only)
openai.api_key = "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Load YOLO model
model = YOLO("yolov8n.pt")

# Save and decode base64 image
def save_base64_image(b64_string, filename):
    header, encoded = b64_string.split(',', 1)
    img_data = base64.b64decode(encoded)
    filepath = os.path.join("static", filename)
    with open(filepath, 'wb') as f:
        f.write(img_data)
    return filepath

# Chat with GPT-4o
def chat_with_gpt(prompt):
    response = openai.ChatCompletion.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content.strip()

@app.route('/')
def index():
    return render_template("index.html")

@app.route('/query', methods=['POST'])
def handle_query():
    data = request.get_json()
    user_text = data.get("text", "")
    image_b64 = data.get("image")

    filename = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
    img_path = save_base64_image(image_b64, filename)

    # Object detection
    results = model(img_path)
    detection_result = results[0]
    labels = detection_result.names
    boxes = detection_result.boxes.cls if detection_result.boxes is not None else []
    if len(boxes) > 0:
        cls_id = int(boxes[0].item())
        detected_label = labels[cls_id]
    else:
        detected_label = "nothing recognizable"

    # Generate GPT prompt
    prompt = f"User said: '{user_text}'. Detected in image: {detected_label}. Respond appropriately."
    response = chat_with_gpt(prompt)

    return jsonify({"reply": response})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
