# app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import openai
import os
from datetime import datetime
import cv2
import numpy as np

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# Load OpenAI API key
openai.api_key = os.getenv("OPENAI_API_KEY")

# Save and decode base64 image
def save_base64_image(b64_string, filename):
    header, encoded = b64_string.split(',', 1)
    img_data = base64.b64decode(encoded)
    with open(filename, 'wb') as f:
        f.write(img_data)
    return filename

# Chat with GPT-4o
def chat_with_gpt(prompt):
    response = openai.ChatCompletion.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content.strip()

@app.route('/query', methods=['POST'])
def handle_query():
    data = request.get_json()
    user_text = data.get("text", "")
    image_b64 = data.get("image")

    img_path = f"frame_{datetime.now().strftime('%H%M%S')}.jpg"
    save_base64_image(image_b64, img_path)

    # You can improve prompt logic here
    prompt = f"User asked: '{user_text}'. Here is an image: {img_path}. Describe what you see and answer the question."
    response = chat_with_gpt(prompt)

    return jsonify({"reply": response})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
